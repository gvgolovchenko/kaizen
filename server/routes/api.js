import { Router } from 'express';
import * as products from '../db/products.js';
import * as issues from '../db/issues.js';
import * as releases from '../db/releases.js';
import * as aiModels from '../db/ai-models.js';
import * as processes from '../db/processes.js';
import * as processLogs from '../db/process-logs.js';
import { callAI } from '../ai-caller.js';
import { parseJsonFromAI, maskApiKey } from '../utils.js';
import { runProcess } from '../process-runner.js';

const router = Router();

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
  const issue = await issues.create(req.body);
  res.status(201).json(issue);
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
  const release = await releases.create(req.body);
  res.status(201).json(release);
});

router.get('/releases/:id', async (req, res) => {
  const release = await releases.getById(req.params.id);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});

router.put('/releases/:id', async (req, res) => {
  const release = await releases.update(req.params.id, req.body);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});

router.delete('/releases/:id', async (req, res) => {
  const ok = await releases.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Release not found' });
  res.json({ ok: true });
});

router.post('/releases/:id/publish', async (req, res) => {
  const release = await releases.publish(req.params.id);
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
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
    const { product_id, model_id, type, prompt, template_id, count, timeout_min } = req.body;

    if (!product_id) return res.status(400).json({ error: 'product_id is required' });
    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const product = await products.getById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const model = await aiModels.getById(model_id);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    if (!prompt && !template_id) {
      return res.status(400).json({ error: 'prompt or template_id is required' });
    }

    const proc = await processes.create({
      product_id,
      model_id,
      type: type || 'improve',
      input_prompt: prompt || null,
      input_template_id: template_id || null,
      input_count: Math.min(Math.max(parseInt(count) || 5, 1), 10),
    });

    // Fire-and-forget — запускаем процесс без await
    const timeoutMs = Math.min(Math.max(parseInt(timeout_min) || 20, 3), 60) * 60 * 1000;
    runProcess(proc.id, { timeoutMs });

    res.status(201).json(proc);
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

    res.status(201).json({ created, count: created.length });
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

export default router;
