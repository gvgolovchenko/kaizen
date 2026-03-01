import * as processes from './db/processes.js';
import * as processLogs from './db/process-logs.js';
import * as products from './db/products.js';
import * as aiModels from './db/ai-models.js';
import { callAI } from './ai-caller.js';
import { parseJsonFromAI } from './utils.js';

const IMPROVE_TEMPLATES = {
  general: 'Проанализируй продукт и предложи общие улучшения: UX, функциональность, стабильность, масштабируемость.',
  ui: 'Предложи улучшения пользовательского интерфейса: удобство навигации, визуальный дизайн, адаптивность, доступность.',
  performance: 'Предложи улучшения производительности: оптимизация загрузки, кэширование, уменьшение задержек, эффективность запросов.',
  security: 'Проанализируй потенциальные уязвимости и предложи улучшения безопасности: аутентификация, авторизация, защита данных, OWASP.',
  competitors: 'Представь, что ты аналитик. Какие функции есть у конкурентов, но отсутствуют в этом продукте? Предложи задачи для конкурентного паритета.',
  dx: 'Предложи улучшения для разработчиков: документация, CI/CD, тестирование, линтинг, структура кода, DX.',
};

/**
 * Run a process in the background (fire-and-forget).
 * @param {string} processId
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Timeout in ms (default 20 min)
 */
export async function runProcess(processId, options = {}) {
  const timeoutMs = options.timeoutMs || 20 * 60 * 1000;
  const startTime = Date.now();

  try {
    // 1. Update status → running
    await processes.update(processId, { status: 'running', started_at: new Date().toISOString() });

    // 2. Load process + product + model
    const proc = await processes.getById(processId);
    if (!proc) throw new Error('Process not found');

    const product = await products.getById(proc.product_id);
    if (!product) throw new Error('Product not found');

    const model = await aiModels.getById(proc.model_id);
    if (!model) throw new Error('Model not found');

    if (model.deployment === 'cloud' && model.provider !== 'claude-code' && !model.api_key) {
      throw new Error('API key required for cloud model');
    }

    const taskCount = Math.min(Math.max(parseInt(proc.input_count) || 5, 1), 10);

    // 3. Build prompts
    const isClaudeCode = model.provider === 'claude-code';
    const hasProjectPath = isClaudeCode && product.project_path;

    const systemPrompt = `Ты — эксперт по улучшению программных продуктов. Анализируй продукт и генерируй конкретные, реализуемые задачи.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${!hasProjectPath && product.repo_url ? `Репозиторий: ${product.repo_url}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}
${hasProjectPath ? `\nПроект находится в текущей директории. Используй инструменты Read, Glob, Grep чтобы изучить код, архитектуру, структуру файлов. Основывай предложения на реальном коде проекта.` : ''}

ВАЖНО: Верни ответ ТОЛЬКО как JSON-массив из ${taskCount} задач. Никакого текста, рассуждений или тегов до или после JSON. Не используй <think> блоки.
Формат каждой задачи:
{
  "title": "Краткое название задачи",
  "description": "Подробное описание что нужно сделать и зачем",
  "type": "improvement | bug | feature",
  "priority": "critical | high | medium | low"
}`;

    const userPrompt = proc.input_prompt || IMPROVE_TEMPLATES[proc.input_template_id] || IMPROVE_TEMPLATES.general;

    // 4. Log: request_sent
    await processLogs.create({
      process_id: processId,
      step: 'request_sent',
      message: `Запрос отправлен модели ${model.name}${hasProjectPath ? ` (cwd: ${product.project_path})` : ''}`,
      data: { model_name: model.name, provider: model.provider, system_prompt_length: systemPrompt.length, user_prompt_length: userPrompt.length, cwd: product.project_path || null },
    });

    // 5. Call AI
    const aiOptions = {};
    if (hasProjectPath) aiOptions.cwd = product.project_path;
    if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
    const rawResponse = await callAI(model, systemPrompt, userPrompt, aiOptions);

    // 6. Log: response_received
    await processLogs.create({
      process_id: processId,
      step: 'response_received',
      message: `Ответ получен (${rawResponse.length} символов)`,
      data: { response_length: rawResponse.length },
    });

    // 7. Parse JSON
    const parsed = parseJsonFromAI(rawResponse);
    if (!parsed) {
      await processLogs.create({
        process_id: processId,
        step: 'error',
        message: 'Не удалось распарсить JSON из ответа модели',
        data: { raw_response: rawResponse.slice(0, 2000) },
      });
      throw new Error('Failed to parse AI response as JSON');
    }

    // 8. Log: parse_result
    await processLogs.create({
      process_id: processId,
      step: 'parse_result',
      message: `JSON распарсен: ${parsed.length} элементов`,
      data: { count: parsed.length },
    });

    // 9. Validate and normalize
    const validTypes = ['improvement', 'bug', 'feature'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    const suggestions = parsed.slice(0, taskCount).map(s => ({
      title: String(s.title || '').slice(0, 200),
      description: String(s.description || ''),
      type: validTypes.includes(s.type) ? s.type : 'improvement',
      priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
    })).filter(s => s.title.length > 0);

    // 10. Log: issues_ready
    await processLogs.create({
      process_id: processId,
      step: 'issues_ready',
      message: `Подготовлено предложений: ${suggestions.length}`,
      data: { count: suggestions.length },
    });

    // 11. Update process → completed
    const durationMs = Date.now() - startTime;
    await processes.update(processId, {
      status: 'completed',
      result: suggestions,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    });

  } catch (err) {
    // 12. Error handling
    const durationMs = Date.now() - startTime;
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: err.message,
      data: { stack: err.stack },
    }).catch(() => {});

    await processes.update(processId, {
      status: 'failed',
      error: err.message,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).catch(() => {});

    console.error(`Process ${processId} failed:`, err.message);
  }
}
