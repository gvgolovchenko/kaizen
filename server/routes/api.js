import { Router } from 'express';
import * as products from '../db/products.js';
import * as issues from '../db/issues.js';
import * as releases from '../db/releases.js';
import * as aiModels from '../db/ai-models.js';
import * as processes from '../db/processes.js';
import * as processLogs from '../db/process-logs.js';
import { callAI } from '../ai-caller.js';
import { parseJsonFromAI, maskApiKey, detectTestCommand } from '../utils.js';
import * as plans from '../db/plans.js';
import * as planSteps from '../db/plan-steps.js';
import * as rcClient from '../rc-client.js';
import * as rcTickets from '../db/rc-tickets.js';
import * as rcSync from '../rc-sync.js';

const router = Router();

// Получаем queueManager из app.locals
function getQueueManager(req) {
  return req.app.locals.queueManager;
}

// ── Products ──────────────────────────────────────────────

router.get('/products', async (req, res) => {
  const rows = await products.getAll();
  res.json(rows);
});

router.post('/products', async (req, res) => {
  const product = await products.create(req.body);
  res.status(201).json(product);
});

router.get('/products/:id', async (req, res) => {
  const product = await products.getById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.put('/products/:id', async (req, res) => {
  const product = await products.update(req.params.id, req.body);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.delete('/products/:id', async (req, res) => {
  const ok = await products.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

// ── Issues ────────────────────────────────────────────────

router.get('/products/:id/issues', async (req, res) => {
  const rows = await issues.getByProduct(req.params.id, req.query.status);
  res.json(rows);
});

router.post('/issues', async (req, res) => {
  try {
    if (!req.body.product_id) {
      return res.status(400).json({ error: 'product_id is required' });
    }
    if (!req.body.title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const issue = await issues.create(req.body);
    res.status(201).json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/issues/bulk', async (req, res) => {
  try {
    const { issues: items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'issues array is required and must not be empty' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 issues per request' });
    }
    const created = [];
    for (const item of items) {
      if (!item.product_id || !item.title) {
        return res.status(400).json({ error: `Each issue must have product_id and title. Missing in: ${JSON.stringify(item).slice(0, 100)}` });
      }
      const issue = await issues.create(item);
      created.push(issue);
    }
    res.status(201).json({ created, count: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/issues/:id', async (req, res) => {
  const issue = await issues.getById(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  res.json(issue);
});

router.put('/issues/:id', async (req, res) => {
  const issue = await issues.update(req.params.id, req.body);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  res.json(issue);
});

router.delete('/issues/:id', async (req, res) => {
  const ok = await issues.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Issue not found' });
  res.json({ ok: true });
});

// ── Releases ──────────────────────────────────────────────

router.get('/products/:id/releases', async (req, res) => {
  const rows = await releases.getByProduct(req.params.id);
  res.json(rows);
});

router.post('/releases', async (req, res) => {
  try {
    // Accept both 'title' and 'name' for consistency with issues API
    if (req.body.title && !req.body.name) {
      req.body.name = req.body.title;
    }
    if (!req.body.name) {
      return res.status(400).json({ error: 'name (or title) is required' });
    }
    if (!req.body.product_id) {
      return res.status(400).json({ error: 'product_id is required' });
    }
    if (!req.body.version) {
      return res.status(400).json({ error: 'version is required' });
    }
    const release = await releases.create(req.body);
    res.status(201).json(release);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/releases/:id', async (req, res) => {
  const release = await releases.getById(req.params.id);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});

router.put('/releases/:id', async (req, res) => {
  if (req.body.title && !req.body.name) req.body.name = req.body.title;
  const release = await releases.update(req.params.id, req.body);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});

router.delete('/releases/:id', async (req, res) => {
  const result = await releases.remove(req.params.id);
  if (!result) return res.status(404).json({ error: 'Release not found' });
  const response = typeof result === 'object' ? result : { ok: true };
  res.json(response);
});

router.post('/releases/:id/publish', async (req, res) => {
  const release = await releases.publish(req.params.id);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});

router.post('/releases/:id/prepare-spec', async (req, res) => {
  try {
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });
    if (release.status === 'released') return res.status(400).json({ error: 'Release is already published' });
    if (!release.issues || release.issues.length === 0) return res.status(400).json({ error: 'Release has no issues' });

    const { model_id, timeout_min } = req.body;
    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const model = await aiModels.getById(model_id);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const proc = await processes.create({
      product_id: release.product_id,
      model_id,
      type: 'prepare_spec',
      release_id: release.id,
    });

    // Ставим в очередь (или запускаем сразу если есть слот)
    const timeoutMs = Math.min(Math.max(parseInt(timeout_min) || 20, 3), 60) * 60 * 1000;
    const qResult = await getQueueManager(req).enqueue(proc.id, { timeoutMs });

    res.status(201).json({ ...proc, queue: qResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Release Development ───────────────────────────────────

router.post('/releases/:id/develop', async (req, res) => {
  try {
    const { model_id, git_branch, test_command, timeout_min } = req.body;

    // Load release
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });

    // Preconditions
    if (release.status === 'released')
      return res.status(400).json({ error: 'Release already published' });
    if (!release.spec)
      return res.status(400).json({ error: 'Release spec is required. Run prepare-spec first.' });
    if (!release.issues || release.issues.length === 0)
      return res.status(400).json({ error: 'Release has no issues' });

    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const model = await aiModels.getById(model_id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (model.provider !== 'claude-code')
      return res.status(400).json({ error: 'Only claude-code models are supported for development' });

    const product = await products.getById(release.product_id);
    if (!product?.project_path)
      return res.status(400).json({ error: 'product.project_path is required for development' });

    // Determine parameters
    const branchName = git_branch  || `kaizen/release-${release.version}`;
    const testCmd    = test_command || detectTestCommand(product.tech_stack);
    const timeoutMs  = Math.min(Math.max(parseInt(timeout_min) || 60, 10), 480) * 60 * 1000;

    // Create process
    const proc = await processes.create({
      product_id:  release.product_id,
      model_id,
      type:        'develop_release',
      input_prompt: JSON.stringify({ git_branch: branchName, test_command: testCmd }),
      release_id:  release.id,
    });

    // Ставим в очередь (или запускаем сразу если есть слот)
    const qResult = await getQueueManager(req).enqueue(proc.id, { timeoutMs });

    res.status(201).json({ ...proc, queue: qResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/releases/:id/spec', async (req, res) => {
  try {
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });

    // Find the latest prepare_spec process for this release
    const allProcesses = await processes.getAll({ product_id: release.product_id });
    const specProcess = allProcesses.find(p => p.type === 'prepare_spec' && p.release_id === release.id);

    res.json({
      release_id: release.id,
      spec: release.spec || null,
      process: specProcess ? {
        id: specProcess.id,
        status: specProcess.status,
        model_name: specProcess.model_name,
        duration_ms: specProcess.duration_ms,
        created_at: specProcess.created_at,
        result: specProcess.result,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Press Release ─────────────────────────────────────────

router.post('/releases/:id/prepare-press-release', async (req, res) => {
  try {
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });
    if (release.status !== 'released') return res.status(400).json({ error: 'Release must be published first' });
    if (!release.issues || release.issues.length === 0) return res.status(400).json({ error: 'Release has no issues' });

    const { model_id, channels, tone, audiences, generate_images, key_points, timeout_min } = req.body;
    if (!model_id) return res.status(400).json({ error: 'model_id is required' });
    if (!channels || !Array.isArray(channels) || channels.length === 0) return res.status(400).json({ error: 'At least one channel is required' });

    const model = await aiModels.getById(model_id);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const proc = await processes.create({
      product_id: release.product_id,
      model_id,
      type: 'prepare_press_release',
      input_prompt: JSON.stringify({ channels, tone, audiences, generate_images, key_points }),
      release_id: release.id,
    });

    const timeoutMs = Math.min(Math.max(parseInt(timeout_min) || 20, 3), 60) * 60 * 1000;
    const qResult = await getQueueManager(req).enqueue(proc.id, { timeoutMs });

    res.status(201).json({ ...proc, queue: qResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/releases/:id/press-release', async (req, res) => {
  try {
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });

    const allProcesses = await processes.getAll({ product_id: release.product_id });
    const prProcess = allProcesses.find(p => p.type === 'prepare_press_release' && p.release_id === release.id);

    res.json({
      release_id: release.id,
      press_release: release.press_release || null,
      process: prProcess ? {
        id: prProcess.id,
        status: prProcess.status,
        model_name: prProcess.model_name,
        duration_ms: prProcess.duration_ms,
        created_at: prProcess.created_at,
        result: prProcess.result,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Models ────────────────────────────────────────────

router.get('/ai-models/discover', async (req, res) => {
  const TIMEOUT = 5000;

  async function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  // Ollama: GET /api/tags + POST /api/show for context_length
  async function discoverOllama() {
    const resp = await fetchWithTimeout('http://localhost:11434/api/tags');
    if (!resp || !resp.ok) return { available: false, models: [] };

    const data = await resp.json();
    const models = [];

    for (const m of (data.models || [])) {
      let context_length = null;
      try {
        const showResp = await fetchWithTimeout('http://localhost:11434/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: m.name }),
        });
        if (showResp && showResp.ok) {
          const info = await showResp.json();
          const mi = info.model_info || {};
          const ctxKey = Object.keys(mi).find(k => k.endsWith('.context_length'));
          context_length = ctxKey ? mi[ctxKey] : null;
        }
      } catch { /* ignore */ }

      models.push({
        model_id: m.name,
        name: m.name,
        parameters_size: m.details?.parameter_size || null,
        context_length,
        quantization: m.details?.quantization_level || null,
        size_bytes: m.size || null,
      });
    }

    return { available: true, models };
  }

  // MLX: GET /v1/models
  async function discoverMLX() {
    const resp = await fetchWithTimeout('http://localhost:8080/v1/models');
    if (!resp || !resp.ok) return { available: false, models: [] };

    const data = await resp.json();
    const models = (data.data || []).map(m => ({
      model_id: m.id,
      name: m.id,
    }));

    return { available: true, models };
  }

  const [ollama, mlx] = await Promise.all([discoverOllama(), discoverMLX()]);
  res.json({ ollama, mlx });
});

router.get('/ai-models', async (req, res) => {
  const { provider, deployment } = req.query;
  const rows = await aiModels.getAll({ provider, deployment });
  res.json(rows.map(maskApiKey));
});

router.post('/ai-models', async (req, res) => {
  const { name, model_id } = req.body;
  if (!name || !model_id) return res.status(400).json({ error: 'name and model_id are required' });
  const model = await aiModels.create(req.body);
  res.status(201).json(maskApiKey(model));
});

router.get('/ai-models/:id', async (req, res) => {
  const model = await aiModels.getById(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json(maskApiKey(model));
});

router.put('/ai-models/:id', async (req, res) => {
  const body = { ...req.body };
  // Don't overwrite real key with masked value
  if (body.api_key && body.api_key.includes('****')) {
    delete body.api_key;
  }
  const model = await aiModels.update(req.params.id, body);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json(maskApiKey(model));
});

router.delete('/ai-models/:id', async (req, res) => {
  const ok = await aiModels.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Model not found' });
  res.json({ ok: true });
});

router.post('/ai-models/:id/warmup', async (req, res) => {
  const model = await aiModels.getById(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  if (model.deployment !== 'local') {
    return res.status(400).json({ error: 'Warmup is only available for local models' });
  }

  await aiModels.updateStatus(model.id, 'loaded');

  try {
    let result;
    if (model.provider === 'mlx') {
      // MLX: POST /v1/chat/completions
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const resp = await fetch('http://localhost:8080/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.model_id, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      result = { success: resp.ok, provider: 'mlx' };
    } else {
      // Ollama: POST /api/generate
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const resp = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.model_id, prompt: '', keep_alive: '10m' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      result = { success: resp.ok, provider: 'ollama' };
    }

    const newStatus = result.success ? 'loaded' : 'unknown';
    await aiModels.updateStatus(model.id, newStatus);
    res.json({ status: newStatus, ...result });
  } catch (e) {
    await aiModels.updateStatus(model.id, 'unknown');
    res.status(500).json({ status: 'unknown', error: e.message });
  }
});

// ── Improve templates ────────────────────────────────────

const IMPROVE_TEMPLATES = [
  { id: 'general', name: 'Общие улучшения', prompt: 'Проанализируй продукт и предложи общие улучшения: UX, функциональность, стабильность, масштабируемость.' },
  { id: 'ui', name: 'Улучшения UI', prompt: 'Предложи улучшения пользовательского интерфейса: удобство навигации, визуальный дизайн, адаптивность, доступность.' },
  { id: 'performance', name: 'Производительность', prompt: 'Предложи улучшения производительности: оптимизация загрузки, кэширование, уменьшение задержек, эффективность запросов.' },
  { id: 'security', name: 'Безопасность', prompt: 'Проанализируй потенциальные уязвимости и предложи улучшения безопасности: аутентификация, авторизация, защита данных, OWASP.' },
  { id: 'competitors', name: 'Анализ конкурентов', prompt: 'Представь, что ты аналитик. Какие функции есть у конкурентов, но отсутствуют в этом продукте? Предложи задачи для конкурентного паритета.' },
  { id: 'dx', name: 'Developer Experience', prompt: 'Предложи улучшения для разработчиков: документация, CI/CD, тестирование, линтинг, структура кода, DX.' },
];

router.get('/improve-templates', (req, res) => {
  res.json(IMPROVE_TEMPLATES);
});

// ── Processes ────────────────────────────────────────────

router.get('/processes', async (req, res) => {
  try {
    const { status, product_id } = req.query;
    const rows = await processes.getAll({ status, product_id });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/processes/:id', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    res.json(proc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/processes', async (req, res) => {
  try {
    const { product_id, model_id, type, prompt, template_id, count, timeout_min, config } = req.body;

    if (!product_id) return res.status(400).json({ error: 'product_id is required' });
    if (!model_id && type !== 'run_tests') return res.status(400).json({ error: 'model_id is required' });

    const product = await products.getById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    if (model_id) {
      const model = await aiModels.getById(model_id);
      if (!model) return res.status(404).json({ error: 'Model not found' });
    }

    if (type === 'roadmap_from_doc' && !prompt) {
      return res.status(400).json({ error: 'prompt (document text) is required for roadmap_from_doc' });
    }
    if (type !== 'roadmap_from_doc' && type !== 'form_release' && type !== 'run_tests' && type !== 'update_docs' && !prompt && !template_id) {
      return res.status(400).json({ error: 'prompt or template_id is required' });
    }

    // For form_release/run_tests, store config as JSON in input_prompt
    const inputPrompt = (type === 'form_release' || type === 'run_tests' || type === 'update_docs')
      ? JSON.stringify(config || {}) : (prompt || null);

    const proc = await processes.create({
      product_id,
      model_id: model_id || null,
      type: type || 'improve',
      input_prompt: inputPrompt,
      input_template_id: template_id || null,
      input_count: Math.min(Math.max(parseInt(count) || 5, 1), 10),
    });

    // Ставим в очередь (или запускаем сразу если есть слот)
    const timeoutMs = Math.min(Math.max(parseInt(timeout_min) || 20, 3), 60) * 60 * 1000;
    const qResult = await getQueueManager(req).enqueue(proc.id, { timeoutMs });

    res.status(201).json({ ...proc, queue: qResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/processes/:id/logs', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    const logs = await processLogs.getByProcess(req.params.id);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/processes/:id/approve', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    if (proc.status !== 'completed') {
      return res.status(400).json({ error: 'Process is not completed' });
    }

    const suggestions = proc.result || [];
    const { indices } = req.body;

    if (!Array.isArray(indices) || indices.length === 0) {
      return res.status(400).json({ error: 'indices array is required' });
    }

    const selected = indices
      .filter(i => i >= 0 && i < suggestions.length)
      .map(i => suggestions[i]);

    if (selected.length === 0) {
      return res.status(400).json({ error: 'No valid suggestions selected' });
    }

    const created = [];
    for (const item of selected) {
      const issue = await issues.create({
        product_id: proc.product_id,
        title: String(item.title || '').slice(0, 200),
        description: String(item.description || ''),
        type: ['improvement', 'bug', 'feature'].includes(item.type) ? item.type : 'improvement',
        priority: ['critical', 'high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
      });
      created.push(issue);
    }

    // Merge previously approved indices with new ones
    const prevApproved = proc.approved_indices || [];
    const allApproved = [...new Set([...prevApproved, ...indices])];
    await processes.update(proc.id, { approved_count: allApproved.length, approved_indices: JSON.stringify(allApproved) });
    res.status(201).json({ created, count: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/processes/:id/approve-auto', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    if (proc.status !== 'completed') {
      return res.status(400).json({ error: 'Process is not completed' });
    }

    const suggestions = proc.result || [];
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return res.status(400).json({ error: 'No suggestions in process result' });
    }

    const { rule } = req.body;
    const validRules = ['all', 'high_and_critical', 'critical_only'];
    if (!validRules.includes(rule)) {
      return res.status(400).json({ error: `rule must be one of: ${validRules.join(', ')}` });
    }

    // Filter suggestions by rule
    let indicesToApprove = [];
    if (rule === 'all') {
      indicesToApprove = suggestions.map((_, i) => i);
    } else if (rule === 'high_and_critical') {
      indicesToApprove = suggestions
        .map((s, i) => ['high', 'critical'].includes(s.priority) ? i : null)
        .filter(i => i !== null);
    } else if (rule === 'critical_only') {
      indicesToApprove = suggestions
        .map((s, i) => s.priority === 'critical' ? i : null)
        .filter(i => i !== null);
    }

    // Exclude already approved indices
    const prevApproved = proc.approved_indices || [];
    const newIndices = indicesToApprove.filter(i => !prevApproved.includes(i));

    if (newIndices.length === 0) {
      return res.json({ created: [], count: 0, message: 'No new suggestions match the rule' });
    }

    const selected = newIndices.map(i => suggestions[i]);
    const created = [];
    for (const item of selected) {
      const issue = await issues.create({
        product_id: proc.product_id,
        title: String(item.title || '').slice(0, 200),
        description: String(item.description || ''),
        type: ['improvement', 'bug', 'feature'].includes(item.type) ? item.type : 'improvement',
        priority: ['critical', 'high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
      });
      created.push(issue);
    }

    const allApproved = [...new Set([...prevApproved, ...newIndices])];
    await processes.update(proc.id, { approved_count: allApproved.length, approved_indices: JSON.stringify(allApproved) });

    res.status(201).json({ created, count: created.length, rule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/processes/:id/restart', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    if (!['completed', 'failed', 'queued'].includes(proc.status)) {
      return res.status(400).json({ error: 'Process must be completed, failed, or queued to restart' });
    }

    const newProc = await processes.create({
      product_id: proc.product_id,
      model_id: proc.model_id,
      type: proc.type,
      input_prompt: proc.input_prompt,
      input_template_id: proc.input_template_id,
      input_count: proc.input_count,
      release_id: proc.release_id,
    });

    const timeoutMs = 20 * 60 * 1000;
    const qResult = await getQueueManager(req).enqueue(newProc.id, { timeoutMs });

    res.status(201).json({ ...newProc, queue: qResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Roadmap ───────────────────────────────────────────────

router.post('/processes/:id/approve-roadmap', async (req, res) => {
  const client = await (await import('../db/pool.js')).pool.connect();
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    if (proc.type !== 'roadmap_from_doc') return res.status(400).json({ error: 'Wrong process type' });
    if (proc.status !== 'completed') return res.status(400).json({ error: 'Process not completed' });

    const { releases: selectedReleases } = req.body;
    if (!Array.isArray(selectedReleases) || selectedReleases.length === 0) {
      return res.status(400).json({ error: 'releases array is required' });
    }

    const roadmap = proc.result?.roadmap || [];
    if (roadmap.length === 0) return res.status(400).json({ error: 'No roadmap data in process result' });

    await client.query('BEGIN');

    const createdReleases = [];
    let totalIssues = 0;

    for (const sel of selectedReleases) {
      const ri = sel.release_index;
      if (ri < 0 || ri >= roadmap.length) continue;

      const srcRelease = roadmap[ri];
      const version = sel.version || srcRelease.version;
      const name = sel.name || srcRelease.name;
      const description = sel.description || srcRelease.description || null;

      // Create release
      const { rows: [newRelease] } = await client.query(
        `INSERT INTO opii.kaizen_releases (product_id, version, name, description)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [proc.product_id, version, name, description]
      );

      // Create issues and link them
      const issueIndices = Array.isArray(sel.issue_indices) ? sel.issue_indices : [];
      let releaseIssueCount = 0;

      for (const ii of issueIndices) {
        if (ii < 0 || ii >= (srcRelease.issues || []).length) continue;
        const srcIssue = srcRelease.issues[ii];

        const { rows: [newIssue] } = await client.query(
          `INSERT INTO opii.kaizen_issues (product_id, title, description, type, priority, status)
           VALUES ($1, $2, $3, $4, $5, 'in_release') RETURNING *`,
          [
            proc.product_id,
            String(srcIssue.title || '').slice(0, 200),
            String(srcIssue.description || ''),
            ['improvement', 'bug', 'feature'].includes(srcIssue.type) ? srcIssue.type : 'feature',
            ['critical', 'high', 'medium', 'low'].includes(srcIssue.priority) ? srcIssue.priority : 'medium',
          ]
        );

        await client.query(
          `INSERT INTO opii.kaizen_release_issues (release_id, issue_id) VALUES ($1, $2)`,
          [newRelease.id, newIssue.id]
        );
        releaseIssueCount++;
      }

      totalIssues += releaseIssueCount;
      createdReleases.push({
        id: newRelease.id,
        version,
        name,
        issue_count: releaseIssueCount,
      });
    }

    await client.query('COMMIT');

    // Track approved_count
    await processes.update(proc.id, { approved_count: totalIssues });

    res.status(201).json({
      created_releases: createdReleases.length,
      created_issues: totalIssues,
      releases: createdReleases,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/processes/:id/approve-releases', async (req, res) => {
  try {
    const proc = await processes.getById(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    if (proc.type !== 'form_release') return res.status(400).json({ error: 'Wrong process type' });
    if (proc.status !== 'completed') return res.status(400).json({ error: 'Process not completed' });
    if (proc.result?.auto_approved) return res.status(400).json({ error: 'Already auto-approved' });

    const { releases: releasesToCreate } = req.body;
    if (!Array.isArray(releasesToCreate) || releasesToCreate.length === 0) {
      return res.status(400).json({ error: 'releases array is required' });
    }

    const createdReleases = [];
    let totalIssues = 0;

    for (const rel of releasesToCreate) {
      const issueIds = rel.issue_ids || [];
      if (issueIds.length === 0) continue;

      const created = await releases.create({
        product_id: proc.product_id,
        version: rel.version,
        name: rel.name,
        description: rel.description || null,
        issue_ids: issueIds,
      });
      totalIssues += issueIds.length;
      createdReleases.push({ id: created.id, version: created.version, name: created.name, issues: issueIds.length });
    }

    await processes.update(proc.id, { approved_count: totalIssues });

    res.status(201).json({
      created_releases: createdReleases.length,
      total_issues: totalIssues,
      releases: createdReleases,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/processes/:id', async (req, res) => {
  try {
    const ok = await processes.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Process not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/:id/processes', async (req, res) => {
  try {
    const rows = await processes.getByProduct(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Queue ─────────────────────────────────────────────────

router.get('/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueManager(req).getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/processes/:id/cancel', async (req, res) => {
  try {
    const result = await getQueueManager(req).cancel(req.params.id);
    res.json(result);
  } catch (err) {
    const code = err.message.includes('not found') ? 404
      : err.message.includes('not queued') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── Plans ─────────────────────────────────────────────────

router.get('/plans', async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await plans.getAll({ status });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/:id/plans', async (req, res) => {
  try {
    const rows = await plans.getByProduct(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans', async (req, res) => {
  try {
    const { name, description, product_id, on_failure, is_template, scheduled_at, steps } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!product_id && !is_template) return res.status(400).json({ error: 'product_id is required' });

    if (product_id) {
      const product = await products.getById(product_id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
    }

    const plan = await plans.create({ name, description, product_id, on_failure, is_template, scheduled_at });

    // Создать шаги если переданы
    let createdSteps = [];
    if (Array.isArray(steps) && steps.length > 0) {
      createdSteps = await planSteps.bulkCreate(plan.id, steps);
    }

    // Если есть scheduled_at — перевести в scheduled
    if (scheduled_at) {
      await plans.updateStatus(plan.id, 'scheduled');
      plan.status = 'scheduled';
    }

    res.status(201).json({ ...plan, steps: createdSteps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/from-releases', async (req, res) => {
  try {
    const { product_id, name, description, release_ids, model_id, on_failure, timeout_spec, timeout_develop } = req.body;

    if (!product_id) return res.status(400).json({ error: 'product_id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Array.isArray(release_ids) || release_ids.length === 0) {
      return res.status(400).json({ error: 'release_ids array is required' });
    }
    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const product = await products.getById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Create the plan
    const plan = await plans.create({
      name,
      description: description || `Автоматический план: spec → develop для ${release_ids.length} релизов`,
      product_id,
      on_failure: on_failure || 'stop',
    });

    // Build sequential steps: for each release, spec then develop
    // Each release's spec depends on previous release's develop
    const stepsToCreate = [];
    let stepOrder = 1;

    for (let i = 0; i < release_ids.length; i++) {
      const releaseId = release_ids[i];

      // prepare_spec step
      stepsToCreate.push({
        step_order: stepOrder++,
        name: `Спецификация (релиз ${i + 1}/${release_ids.length})`,
        model_id,
        process_type: 'prepare_spec',
        release_id: releaseId,
        timeout_min: timeout_spec || 30,
        depends_on: i > 0 ? [`__prev_dev__`] : [],
      });

      // develop_release step
      stepsToCreate.push({
        step_order: stepOrder++,
        name: `Разработка (релиз ${i + 1}/${release_ids.length})`,
        model_id,
        process_type: 'develop_release',
        release_id: releaseId,
        timeout_min: timeout_develop || 60,
        depends_on: [`__prev_spec__`],
      });
    }

    // Now create steps and resolve depends_on with real IDs
    const createdSteps = [];
    for (let i = 0; i < stepsToCreate.length; i++) {
      const stepDef = stepsToCreate[i];

      // Resolve depends_on
      const resolvedDeps = [];
      for (const dep of (stepDef.depends_on || [])) {
        if (dep === '__prev_spec__') {
          // This is a develop step — depends on the spec step right before it
          resolvedDeps.push(createdSteps[i - 1].id);
        } else if (dep === '__prev_dev__') {
          // This is a spec step — depends on the develop step of previous release
          resolvedDeps.push(createdSteps[i - 1].id);
        }
      }
      stepDef.depends_on = resolvedDeps.length > 0 ? resolvedDeps : null;

      const created = await planSteps.create({ ...stepDef, plan_id: plan.id });
      createdSteps.push(created);
    }

    const allSteps = await planSteps.getByPlan(plan.id);
    res.status(201).json({ ...plan, steps: allSteps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plans/:id', async (req, res) => {
  try {
    const plan = await plans.getById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const steps = await planSteps.getByPlan(plan.id);
    res.json({ ...plan, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plans/:id', async (req, res) => {
  try {
    const plan = await plans.update(req.params.id, req.body);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    const ok = await plans.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Plan not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/:id/start', async (req, res) => {
  try {
    const plan = await plans.getById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!['draft', 'scheduled'].includes(plan.status)) {
      return res.status(400).json({ error: `Cannot start plan with status '${plan.status}'` });
    }

    const steps = await planSteps.getByPlan(plan.id);
    if (steps.length === 0) return res.status(400).json({ error: 'Plan has no steps' });

    await plans.updateStatus(plan.id, 'active', { started_at: new Date().toISOString() });

    // Триггерить scheduler tick для немедленного запуска
    const scheduler = req.app.locals.queueManager?.onProcessDone
      ? null : null; // scheduler вызовется через tick
    // Форсируем tick через import
    const { Scheduler } = await import('../scheduler.js');
    // На самом деле scheduler уже тикает каждые 30с, но можем форсировать
    // через queueManager reference — не нужно, следующий tick подхватит

    res.json({ ...plan, status: 'active', steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/:id/cancel', async (req, res) => {
  try {
    const plan = await plans.getById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (['completed', 'cancelled'].includes(plan.status)) {
      return res.status(400).json({ error: `Plan is already ${plan.status}` });
    }

    // Отменить все queued процессы этого плана
    const steps = await planSteps.getByPlan(plan.id);
    const qm = getQueueManager(req);
    for (const step of steps) {
      if (step.status === 'pending') {
        await planSteps.update(step.id, { status: 'skipped' });
      }
      if (step.process_id && step.status === 'running') {
        try { await qm.cancel(step.process_id); } catch {}
      }
    }

    await plans.updateStatus(plan.id, 'cancelled', { completed_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/:id/clone', async (req, res) => {
  try {
    const source = await plans.getById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Plan not found' });

    const { name, product_id } = req.body;
    const targetProductId = product_id || source.product_id;
    if (!targetProductId) return res.status(400).json({ error: 'product_id is required when cloning a template' });

    const newPlan = await plans.create({
      name: name || `${source.name} (копия)`,
      description: source.description,
      product_id: targetProductId,
      on_failure: source.on_failure,
      is_template: false,
    });

    const sourceSteps = await planSteps.getByPlan(source.id);

    // Create steps sequentially and build old→new ID mapping for depends_on
    const idMap = new Map(); // old step id → new step id
    const newSteps = [];
    for (const s of sourceSteps) {
      // Remap depends_on from source step IDs to new step IDs
      const newDeps = s.depends_on?.length
        ? s.depends_on.map(depId => idMap.get(depId)).filter(Boolean)
        : null;

      const newStep = await planSteps.create({
        plan_id: newPlan.id,
        step_order: s.step_order,
        name: s.name,
        model_id: s.model_id,
        process_type: s.process_type,
        input_prompt: s.input_prompt,
        input_template_id: s.input_template_id,
        input_count: s.input_count,
        release_id: null, // release_id не переносится — релизы другие
        timeout_min: s.timeout_min,
        depends_on: newDeps?.length ? newDeps : null,
      });
      idMap.set(s.id, newStep.id);
      newSteps.push(newStep);
    }

    res.status(201).json({ ...newPlan, steps: newSteps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Plan Steps ────────────────────────────────────────────

router.post('/plans/:id/steps', async (req, res) => {
  try {
    const plan = await plans.getById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!['draft', 'scheduled'].includes(plan.status)) {
      return res.status(400).json({ error: 'Can only add steps to draft/scheduled plans' });
    }

    const step = await planSteps.create({ ...req.body, plan_id: plan.id });
    res.status(201).json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/:id/steps/bulk', async (req, res) => {
  try {
    const plan = await plans.getById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!['draft', 'scheduled'].includes(plan.status)) {
      return res.status(400).json({ error: 'Can only add steps to draft/scheduled plans' });
    }
    const { steps: items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'steps array is required' });
    }
    const created = await planSteps.bulkCreate(plan.id, items);
    res.status(201).json({ steps: created, count: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plans/:id/steps/:stepId', async (req, res) => {
  try {
    const step = await planSteps.update(req.params.stepId, req.body);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plans/:id/steps/:stepId', async (req, res) => {
  try {
    const ok = await planSteps.remove(req.params.stepId);
    if (!ok) return res.status(404).json({ error: 'Step not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rivc.Connect ─────────────────────────────────────────

router.get('/rc/test', async (req, res) => {
  try {
    const result = await rcClient.testConnection();
    res.json(result);
  } catch (err) {
    res.status(503).json({ connected: false, error: err.message });
  }
});

router.get('/rc/systems', async (req, res) => {
  try {
    const systems = await rcClient.getSystems();
    res.json(systems);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/rc/systems/:id/modules', async (req, res) => {
  try {
    const modules = await rcClient.getModules(parseInt(req.params.id));
    res.json(modules);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/products/:id/rc-sync', async (req, res) => {
  try {
    const stats = await rcSync.syncTickets(req.params.id);
    res.json(stats);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.get('/products/:id/rc-tickets', async (req, res) => {
  try {
    const rows = await rcTickets.getByProduct(req.params.id, req.query.sync_status);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rc-tickets/:id', async (req, res) => {
  try {
    const ticket = await rcTickets.getById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'RC ticket not found' });
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rc-tickets/:id/import', async (req, res) => {
  try {
    const issue = await rcSync.importTicket(req.params.id);
    res.status(201).json(issue);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

router.post('/rc-tickets/import-bulk', async (req, res) => {
  try {
    const { ticket_ids } = req.body;
    if (!ticket_ids || !ticket_ids.length) {
      return res.status(400).json({ error: 'ticket_ids required' });
    }
    const issues = await rcSync.importBulk(ticket_ids);
    res.status(201).json(issues);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/rc-tickets/:id/ignore', async (req, res) => {
  try {
    const ticket = await rcTickets.updateSyncStatus(req.params.id, 'ignored');
    if (!ticket) return res.status(404).json({ error: 'RC ticket not found' });
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Run Pipeline (manual / scheduled) ──────────────────────

router.post('/products/:id/run-pipeline', async (req, res) => {
  try {
    const product = await products.getById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const auto = product.automation?.auto_pipeline;
    if (!auto?.enabled) return res.status(400).json({ error: 'Auto-pipeline not configured. Enable it in Automation settings.' });

    const pc = auto.pipeline_config || {};
    const globalModelId = pc.improve?.model_id || pc.model_id;
    if (!globalModelId) return res.status(400).json({ error: 'No model configured for pipeline' });

    const { scheduled_at } = req.body || {};

    // Import scheduler from app context
    const scheduler = req.app.get('scheduler');
    if (!scheduler) return res.status(500).json({ error: 'Scheduler not available' });

    if (scheduled_at) {
      // Deferred: create a plan with scheduled_at
      const { default: plansDb } = await import('../db/plans.js');
      const version = await scheduler._autoVersion(product.id, pc.version_strategy);
      const plan = await plansDb.create({
        product_id: product.id,
        name: `Pipeline v${version} (запланирован)`,
        status: 'scheduled',
        scheduled_at,
      });
      // Store pipeline config in plan metadata for reference
      await plansDb.update(plan.id, {
        description: JSON.stringify({
          _pipeline_run: true,
          preset: auto.preset,
          version,
          pipeline_config: pc,
        }),
      });

      // Schedule actual trigger via setTimeout
      const delay = new Date(scheduled_at).getTime() - Date.now();
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await scheduler._triggerPipeline(product, auto);
            await plansDb.updateStatus(plan.id, 'completed', { completed_at: new Date().toISOString() });
          } catch (err) {
            console.error('Scheduled pipeline error:', err.message);
            await plansDb.updateStatus(plan.id, 'failed', { completed_at: new Date().toISOString() });
          }
        }, delay);
      }

      res.json({ ok: true, mode: 'scheduled', scheduled_at, plan_id: plan.id });
    } else {
      // Immediate
      await scheduler._triggerPipeline(product, auto);
      res.json({ ok: true, mode: 'immediate' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Notifications ──────────────────────────────────────────

router.post('/notify', async (req, res) => {
  try {
    const { event, data, product_id } = req.body;
    if (!event || !data) return res.status(400).json({ error: 'event and data required' });

    const { notify, getNotifyOpts } = await import('../notifier.js');
    let opts = {};
    if (product_id) {
      const product = await products.getById(product_id);
      if (product) opts = getNotifyOpts(product);
    }
    await notify(event, data, opts);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import Roadmap ───────────────────────────────────────
// Принимает структурированный план (релизы + задачи) и создаёт всё за один вызов:
// issues, releases (с привязкой issues), и опционально план выполнения.

router.post('/import-roadmap', async (req, res) => {
  try {
    const { product_id, releases: releaseDefs, create_plan, model_id, plan_name } = req.body;

    if (!product_id) return res.status(400).json({ error: 'product_id is required' });
    if (!Array.isArray(releaseDefs) || releaseDefs.length === 0) {
      return res.status(400).json({ error: 'releases array is required' });
    }

    const product = await products.getById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const createdReleases = [];

    for (const relDef of releaseDefs) {
      if (!relDef.version || !relDef.name) {
        return res.status(400).json({ error: `Each release must have version and name. Missing in: ${JSON.stringify(relDef).slice(0, 100)}` });
      }

      // Create issues for this release
      const issueIds = [];
      if (Array.isArray(relDef.issues)) {
        for (const issueDef of relDef.issues) {
          if (!issueDef.title) continue;
          const issue = await issues.create({
            product_id,
            title: issueDef.title,
            description: issueDef.description || null,
            type: issueDef.type || 'feature',
            priority: issueDef.priority || 'medium',
          });
          issueIds.push(issue.id);
        }
      }

      // Create release with issues
      const release = await releases.create({
        product_id,
        version: relDef.version,
        name: relDef.name,
        description: relDef.description || null,
        issue_ids: issueIds,
      });

      createdReleases.push({
        id: release.id,
        version: relDef.version,
        name: relDef.name,
        issues_count: issueIds.length,
        issue_ids: issueIds,
      });
    }

    // Optionally create an execution plan (spec → develop for each release)
    let plan = null;
    if (create_plan && model_id) {
      plan = await plans.create({
        name: plan_name || `Разработка: ${product.name}`,
        description: `Автоматический план из импорта roadmap: ${createdReleases.length} релизов`,
        product_id,
        on_failure: 'stop',
      });

      let stepOrder = 1;
      const createdSteps = [];

      for (let i = 0; i < createdReleases.length; i++) {
        const rel = createdReleases[i];

        // prepare_spec step
        const specStep = await planSteps.create({
          plan_id: plan.id,
          step_order: stepOrder++,
          name: `Спецификация ${rel.version}`,
          model_id,
          process_type: 'prepare_spec',
          release_id: rel.id,
          timeout_min: 30,
          depends_on: i > 0 ? [createdSteps[createdSteps.length - 1].id] : null,
        });
        createdSteps.push(specStep);

        // develop_release step
        const devStep = await planSteps.create({
          plan_id: plan.id,
          step_order: stepOrder++,
          name: `Разработка ${rel.version}`,
          model_id,
          process_type: 'develop_release',
          release_id: rel.id,
          timeout_min: 60,
          depends_on: [specStep.id],
        });
        createdSteps.push(devStep);
      }

      plan.steps = createdSteps;
    }

    res.status(201).json({
      product_id,
      releases: createdReleases,
      total_issues: createdReleases.reduce((sum, r) => sum + r.issues_count, 0),
      total_releases: createdReleases.length,
      plan: plan ? { id: plan.id, steps_count: plan.steps.length } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
