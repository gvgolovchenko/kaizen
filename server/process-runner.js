import * as processes from './db/processes.js';
import * as processLogs from './db/process-logs.js';
import * as products from './db/products.js';
import * as releases from './db/releases.js';
import * as aiModels from './db/ai-models.js';
import { callAI } from './ai-caller.js';
import { parseJsonFromAI, detectTestCommand } from './utils.js';
import { collectProjectContext } from './context-collector.js';

/**
 * Watchdog wrapper — guarantees a Promise settles within timeoutMs.
 * If the inner promise hangs (callAI timeout doesn't fire), this rejects.
 */
function withWatchdog(promise, timeoutMs, label = 'AI call') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Watchdog: ${label} не завершился за ${Math.round(timeoutMs / 1000)}с`));
    }, timeoutMs);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

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

    // Dispatch by process type
    if (proc.type === 'prepare_spec') {
      await runPrepareSpec(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'roadmap_from_doc') {
      await runRoadmapFromDoc(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'develop_release') {
      await runDevelopRelease(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'prepare_press_release') {
      await runPreparePressRelease(processId, proc, product, model, startTime, timeoutMs);
      return;
    }

    const taskCount = Math.min(Math.max(parseInt(proc.input_count) || 5, 1), 10);

    // 3. Build prompts
    const isClaudeCode = model.provider === 'claude-code';
    const hasProjectPath = !!product.project_path;
    const useInteractiveTools = isClaudeCode && hasProjectPath;
    const useCollectedContext = !isClaudeCode && hasProjectPath;

    // Collect project context for non-claude-code providers
    let fileContext = '';
    let contextStats = null;
    if (useCollectedContext) {
      try {
        const contextLength = model.context_length || 8192;
        const maxTokens = Math.max(Math.floor(contextLength * 0.4), 1000);
        const result = await collectProjectContext(product.project_path, {
          maxTokens,
          techStack: product.tech_stack,
        });
        fileContext = result.context;
        contextStats = result.stats;
      } catch (err) {
        await processLogs.create({
          process_id: processId,
          step: 'context_warning',
          message: `Не удалось собрать контекст: ${err.message}`,
        });
      }
    }

    const systemPrompt = `Ты — эксперт по улучшению программных продуктов. Анализируй продукт и генерируй конкретные, реализуемые задачи.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${!hasProjectPath && product.repo_url ? `Репозиторий: ${product.repo_url}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}
${useInteractiveTools ? `\nПроект находится в текущей директории. Начни с чтения CLAUDE.md и файлов из docs/ — там контекст проекта, архитектура, API, схема БД, бизнес-логика. Затем используй инструменты Read, Glob, Grep чтобы изучить код и структуру файлов. Основывай предложения на реальном коде и документации проекта.` : ''}
${fileContext ? `\nНиже приведён контекст проекта (файлы, документация, структура). Используй его для анализа и генерации предложений на основе реального кода.\n\n${fileContext}` : ''}

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
    const logData = {
      model_name: model.name,
      provider: model.provider,
      system_prompt_length: systemPrompt.length,
      user_prompt_length: userPrompt.length,
      cwd: useInteractiveTools ? product.project_path : null,
    };
    if (contextStats) {
      logData.context_stats = contextStats;
    }

    let logMsg = `Запрос отправлен модели ${model.name}`;
    if (useInteractiveTools) logMsg += ` (cwd: ${product.project_path})`;
    if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

    await processLogs.create({
      process_id: processId,
      step: 'request_sent',
      message: logMsg,
      data: logData,
    });

    // 5. Call AI (with watchdog safety net)
    const aiOptions = {};
    if (useInteractiveTools) aiOptions.cwd = product.project_path;
    if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
    const watchdogMs = timeoutMs + 60_000; // +60s grace for normal timeout to fire first
    const rawResponse = await withWatchdog(
      callAI(model, systemPrompt, userPrompt, aiOptions),
      watchdogMs,
      `improve/${model.name}`,
    );

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

    // Reset dev_status on failure for develop_release processes
    if (proc?.type === 'develop_release' && proc?.release_id) {
      await releases.updateDevInfo(proc.release_id, { dev_status: 'failed' }).catch(() => {});
    }

    console.error(`Process ${processId} failed:`, err.message);
  }
}

/**
 * Run a prepare_spec process — generate AI release specification.
 */
async function runPrepareSpec(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (!release.issues || release.issues.length === 0) throw new Error('Release has no issues');

  // Load last 3 published releases for context
  const publishedReleases = await releases.getPublishedByProduct(product.id, 3);

  // 2. Determine mode (same pattern as improve)
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;

  // 3. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.4), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 4. Build system prompt
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  let systemPrompt = `Ты — опытный техлид и архитектор. Твоя задача — подготовить подробную спецификацию разработки для релиза программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПроект находится в текущей директории. Начни с чтения CLAUDE.md и файлов из docs/ — там контекст проекта, архитектура, API, схема БД, бизнес-логика. Затем используй инструменты Read, Glob, Grep чтобы изучить код и структуру файлов. Основывай спецификацию на реальном коде и документации проекта.`;
  }

  if (fileContext) {
    systemPrompt += `\n\nНиже приведён контекст проекта (файлы, документация, структура). Используй его для написания спецификации на основе реального кода.\n\n${fileContext}`;
  }

  systemPrompt += `\n\nВАЖНО: Верни ТОЛЬКО текст спецификации в формате Markdown. Никаких обёрток, тегов, JSON или рассуждений. Не используй <think> блоки.`;

  // 5. Build user prompt
  const issuesList = release.issues.map((iss, i) =>
    `${i + 1}. **${iss.title}** (${iss.type}, ${iss.priority})${iss.description ? `\n   ${iss.description}` : ''}`
  ).join('\n');

  let historySection = '';
  if (publishedReleases.length > 0) {
    historySection = `\n\n## История последних релизов\n\n` + publishedReleases.map(r => {
      const rIssues = (r.issues || []).map(i => `  - ${i.title} (${i.type})`).join('\n');
      return `### ${r.version} — ${r.name}\n${rIssues}`;
    }).join('\n\n');
  }

  const userPrompt = `Подготовь спецификацию разработки для релиза.

## Релиз: ${release.version} — ${release.name}
${release.description ? `\nОписание: ${release.description}` : ''}

## Задачи релиза

${issuesList}
${historySection}

## Формат спецификации

Напиши документ в Markdown со следующей структурой:

# Спецификация релиза ${release.version} — ${release.name}

## Обзор
Краткое описание релиза, его целей и ожидаемого результата.

## Задачи

Для каждой задачи из релиза:
### Задача N: <название>
- **Тип**: improvement/bug/feature
- **Приоритет**: critical/high/medium/low
- **Описание**: Подробное описание что нужно сделать
- **Файлы для изменения**: Какие файлы нужно создать/изменить
- **Шаги реализации**: Пошаговый план (конкретные действия)
- **Критерии приёмки**: Как проверить что задача выполнена

## Порядок реализации
Рекомендуемая последовательность выполнения задач (с учётом зависимостей).

## Риски и замечания
Потенциальные риски, на что обратить внимание при реализации.`;

  // 6. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    release_version: release.version,
    issues_count: release.issues.length,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос спецификации отправлен модели ${model.name} (${mode})`;
  if (useInteractiveTools) logMsg += ` (cwd: ${product.project_path})`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 7. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `prepare_spec/${model.name}`,
  );

  // 8. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 9. Save spec
  await releases.saveSpec(release.id, rawResponse);

  await processLogs.create({
    process_id: processId,
    step: 'spec_saved',
    message: `Спецификация сохранена (${rawResponse.length} символов)`,
    data: { char_count: rawResponse.length },
  });

  // 10. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: { text: rawResponse.slice(0, 500), mode, char_count: rawResponse.length },
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

/**
 * Run a roadmap_from_doc process — analyze requirements document and generate roadmap.
 */
async function runRoadmapFromDoc(processId, proc, product, model, startTime, timeoutMs) {
  const docText = proc.input_prompt;
  if (!docText) throw new Error('Document text is empty');

  // 1. Determine mode
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  // 2. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.3), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 3. Build system prompt
  let systemPrompt = `Ты — опытный технический аналитик и архитектор. Тебе предстоит создать дорожную карту разработки на основе документа с требованиями.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПуть к проекту: ${product.project_path}\nУ тебя есть доступ к файлам проекта (Read, Glob, Grep). Используй их для понимания текущего состояния кодовой базы перед составлением дорожной карты.`;
  }

  if (fileContext) {
    systemPrompt += `\n\n=== ДОКУМЕНТАЦИЯ И АРХИТЕКТУРА ПРОЕКТА ===\n${fileContext}`;
  }

  systemPrompt += `\n\nВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON. Не используй <think> блоки.`;

  // 4. Build user prompt
  const userPrompt = `Проанализируй следующий документ с требованиями и создай дорожную карту разработки.

=== ДОКУМЕНТ ===
${docText}
=== КОНЕЦ ДОКУМЕНТА ===

Разбей требования на логические этапы (релизы) и задачи. Каждый релиз должен быть самодостаточным и приносить ценность. Учитывай зависимости между задачами при определении порядка релизов.

Верни JSON строго в следующем формате:
{
  "summary": "Краткое описание дорожной карты (2-4 предложения)",
  "total_releases": <число>,
  "total_issues": <число>,
  "roadmap": [
    {
      "version": "1.0.0",
      "name": "Название релиза",
      "description": "Что войдёт в этот релиз и какую ценность принесёт",
      "issues": [
        {
          "title": "Краткое название задачи (до 150 символов)",
          "description": "Подробное описание что нужно сделать и зачем",
          "type": "feature | improvement | bug",
          "priority": "critical | high | medium | low"
        }
      ]
    }
  ]
}`;

  // 5. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    document_length: docText.length,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос отправлен модели ${model.name}, режим: ${mode}, документ: ${docText.length} символов`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 6. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `roadmap_from_doc/${model.name}`,
  );

  // 7. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 8. Parse and validate
  const parsed = parseJsonFromAI(rawResponse);
  if (!parsed || !Array.isArray(parsed.roadmap) || parsed.roadmap.length === 0) {
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: 'Невалидная структура дорожной карты в ответе модели',
      data: { raw_response: rawResponse.slice(0, 2000) },
    });
    throw new Error('Invalid roadmap structure in AI response');
  }

  const validTypes = ['feature', 'improvement', 'bug'];
  const validPriorities = ['critical', 'high', 'medium', 'low'];

  const roadmap = parsed.roadmap.map(release => ({
    version: String(release.version || '').slice(0, 20),
    name: String(release.name || '').slice(0, 100),
    description: String(release.description || ''),
    issues: Array.isArray(release.issues) ? release.issues
      .map(i => ({
        title: String(i.title || '').slice(0, 200),
        description: String(i.description || ''),
        type: validTypes.includes(i.type) ? i.type : 'feature',
        priority: validPriorities.includes(i.priority) ? i.priority : 'medium',
      }))
      .filter(i => i.title.length > 0) : [],
  })).filter(r => r.version.length > 0 && r.name.length > 0);

  const result = {
    summary: String(parsed.summary || ''),
    total_releases: roadmap.length,
    total_issues: roadmap.reduce((sum, r) => sum + r.issues.length, 0),
    roadmap,
  };

  // 9. Log: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Дорожная карта: ${result.total_releases} релизов, ${result.total_issues} задач`,
    data: { total_releases: result.total_releases, total_issues: result.total_issues },
  });

  // 10. Save result
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

/**
 * Run a develop_release process — Claude Code implements all release tasks.
 */
async function runDevelopRelease(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (!release.spec) throw new Error('Release spec is required for development');
  if (!product.project_path) throw new Error('product.project_path is required');

  // 2. Parse config from input_prompt
  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const branchName  = config.git_branch  || `kaizen/release-${release.version}`;
  const testCommand = config.test_command || detectTestCommand(product.tech_stack);

  // 3. Mark release as in_progress
  await releases.updateDevInfo(release.id, { dev_status: 'in_progress' });

  // 4. System prompt
  const systemPrompt = `Ты — опытный разработчик. Твоя задача — полностью реализовать релиз программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack  ? `Стек: ${product.tech_stack}`       : ''}
Путь к проекту: ${product.project_path}

СТРОГИЙ ПОРЯДОК ДЕЙСТВИЙ:

Шаг 1 — ПОДГОТОВКА РЕПОЗИТОРИЯ
  Выполни: git pull
  Создай ветку: git checkout -b ${branchName}
  (если ветка существует: git checkout ${branchName})

Шаг 2 — ИЗУЧЕНИЕ КОДОВОЙ БАЗЫ
  Изучи структуру проекта, ключевые файлы, архитектурные паттерны.
  Пойми стиль кода прежде чем писать.

Шаг 3 — РЕАЛИЗАЦИЯ ВСЕХ ЗАДАЧ
  Реализуй каждую задачу из спецификации полностью.
  Пиши код в стиле существующего проекта.
  Не пропускай задачи — реализуй все.

Шаг 4 — ОБНОВЛЕНИЕ ДОКУМЕНТАЦИИ
  После реализации задач обнови документацию проекта, если она есть:
  - docs/USER_GUIDE.md — руководство пользователя (новые возможности, изменённое поведение)
  - docs/MAIN_FUNC.md — основная функциональность (технические изменения, новые модули/API)
  - docs/RELEASE_NOTES.md — добавь запись о текущем релизе
  Обновляй только разделы, затронутые изменениями. Если файла нет — пропусти.
  Сохрани существующий формат и стиль документа.

Шаг 5 — НАПИСАНИЕ ТЕСТОВ
  Напиши тесты для каждого реализованного компонента / функции / эндпоинта.
  Покрой основные сценарии использования и граничные случаи.

Шаг 6 — ПРОВЕРКА ТЕСТОВ (максимум 3 итерации)
  Запусти: ${testCommand}
  Если тесты упали:
    - Проанализируй ошибки
    - Исправь код (не тест, если только тест не содержит явную ошибку)
    - Запусти снова
  После 3 неудачных итераций: зафиксируй причину в summary и переходи к шагу 7.

Шаг 7 — КОММИТ И ПУШ
  git add -A
  git commit -m "feat: ${release.version} — ${release.name}"
  git push origin ${branchName}
  (если отклонён: git push --set-upstream origin ${branchName})
  Получи хэш коммита: git rev-parse HEAD

Шаг 8 — ИТОГОВЫЙ JSON
  Последней строкой ответа выведи ТОЛЬКО этот JSON (без пояснений):
  {"branch":"${branchName}","commit_hash":"<хэш>","files_changed":<N>,"tests_written":<N>,"tests_passed":<true|false>,"summary":"<краткое описание>"}

ПРАВИЛА:
- Не выходи за пределы ${product.project_path}
- Не создавай Pull Request
- При непреодолимой ошибке: опиши в summary, верни JSON с tests_passed: false`;

  // 5. User prompt
  const issuesList = release.issues.map((iss, i) =>
    `### ${i + 1}. ${iss.title} (${iss.type}, ${iss.priority})\n${iss.description || '—'}`
  ).join('\n\n');

  const userPrompt = `Реализуй релиз:

ВЕТКА: ${branchName}
ТЕСТ-КОМАНДА: ${testCommand}

=== СПЕЦИФИКАЦИЯ ===
${release.spec}

=== ЗАДАЧИ РЕЛИЗА (${release.issues.length} шт.) ===
${issuesList}`;

  // 6. Log: request_sent
  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: `Запрос отправлен Claude Code. Ветка: ${branchName}, задач: ${release.issues.length}`,
    data: { branch: branchName, test_command: testCommand, issues_count: release.issues.length,
            cwd: product.project_path },
  });

  // 7. Call Claude Code with full tools
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, {
      cwd: product.project_path,
      timeoutMs,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      maxBufferMb: 50,
    }),
    watchdogMs,
    `develop_release/${model.name}`,
  );

  // 8. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 9. Parse JSON from last line of response
  const parsedArr = parseJsonFromAI(rawResponse);
  const parsed = parsedArr ? parsedArr[0] : null;
  const resultObj = parsed ? {
    branch:        parsed.branch        || branchName,
    commit_hash:   parsed.commit_hash   || null,
    files_changed: parsed.files_changed || null,
    tests_written: parsed.tests_written || null,
    tests_passed:  parsed.tests_passed  !== false,
    summary:       parsed.summary       || '',
  } : {
    branch:       branchName,
    commit_hash:  null,
    tests_passed: false,
    summary:      'Не удалось распарсить итоговый JSON',
    raw_tail:     rawResponse.slice(-2000),
  };

  // 10. Log: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Ветка: ${resultObj.branch} · коммит: ${resultObj.commit_hash || '—'} · тесты: ${resultObj.tests_passed ? 'пройдены' : 'не пройдены'}`,
    data: resultObj,
  });

  // 11. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: resultObj,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  // 12. Update release
  await releases.updateDevInfo(release.id, {
    dev_branch: resultObj.branch,
    dev_commit: resultObj.commit_hash,
    dev_status: resultObj.tests_passed ? 'done' : 'failed',
  });
}

/**
 * Run a prepare_press_release process — generate PR materials for multiple channels.
 */
async function runPreparePressRelease(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (release.status !== 'released') throw new Error('Release must be published first');
  if (!release.issues || release.issues.length === 0) throw new Error('Release has no issues');

  // 2. Parse parameters from input_prompt
  let params = {};
  try { params = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const channels = params.channels || ['social', 'website', 'bitrix24', 'media'];
  const tone = params.tone || 'official';
  const audiences = params.audiences || ['employees'];
  const generateImages = params.generate_images !== false;
  const keyPoints = params.key_points || '';

  // 3. Determine mode
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  // 4. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.3), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 5. Build tone/audience labels
  const toneLabels = { official: 'Официальная', friendly: 'Дружелюбная', technical: 'Техническая', marketing: 'Маркетинговая' };
  const audienceLabels = { employees: 'Сотрудники', clients: 'Клиенты', tech_community: 'Техническое сообщество', general: 'Широкая аудитория' };
  const toneText = toneLabels[tone] || tone;
  const audienceText = audiences.map(a => audienceLabels[a] || a).join(', ');

  // 6. Build system prompt
  let systemPrompt = `Ты — PR-менеджер и маркетолог технологической компании. Твоя задача — подготовить PR-материалы для опубликованного релиза программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}

Тональность: ${toneText}
Целевая аудитория: ${audienceText}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПроект находится в текущей директории. Изучи CLAUDE.md и docs/ для понимания продукта. Используй Read, Glob, Grep для анализа.`;
  }

  if (fileContext) {
    systemPrompt += `\n\nКонтекст проекта:\n\n${fileContext}`;
  }

  const channelInstructions = [];
  if (channels.includes('social')) channelInstructions.push('"social" — посты для ВКонтакте и Telegram с хештегами');
  if (channels.includes('website')) channelInstructions.push('"website" — статья для сайта компании с SEO');
  if (channels.includes('bitrix24')) channelInstructions.push('"bitrix24" — внутренний пост в ленту Битрикс24 для сотрудников');
  if (channels.includes('media')) channelInstructions.push('"media" — пресс-релиз для СМИ с цитатами и бойлерплейтом');

  systemPrompt += `\n\nВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON. Не используй <think> блоки.`;

  // 7. Build user prompt
  const issuesList = release.issues.map((iss, i) =>
    `${i + 1}. **${iss.title}** (${iss.type}, ${iss.priority})${iss.description ? `\n   ${iss.description}` : ''}`
  ).join('\n');

  let userPrompt = `Подготовь PR-материалы для опубликованного релиза.

## Релиз: ${release.version} — ${release.name}
${release.description ? `\nОписание: ${release.description}` : ''}

## Задачи релиза

${issuesList}

${release.spec ? `## Спецификация\n\n${typeof release.spec === 'string' ? release.spec.slice(0, 3000) : ''}\n` : ''}
${keyPoints ? `## Ключевые акценты\n\n${keyPoints}\n` : ''}

## Требуемые каналы

${channelInstructions.join('\n')}

## JSON-формат ответа

{
  "channels": {
    ${channels.includes('social') ? `"social": { "platform_vk": "Текст поста для ВК", "platform_telegram": "Текст поста для Telegram", "hashtags": ["#тег1", "#тег2"] },` : ''}
    ${channels.includes('website') ? `"website": { "title": "Заголовок", "subtitle": "Подзаголовок", "body": "Текст статьи (Markdown)", "seo_keywords": ["ключ1"], "meta_description": "Мета-описание" },` : ''}
    ${channels.includes('bitrix24') ? `"bitrix24": { "title": "Заголовок", "body": "Текст поста", "mentions": ["@отдел или @имя"] },` : ''}
    ${channels.includes('media') ? `"media": { "title": "Заголовок", "lead": "Лид", "body": "Текст", "quotes": ["Цитата 1"], "boilerplate": "О компании" }` : ''}
  }${generateImages ? `,
  "image_prompts": [{ "description": "Описание изображения", "purpose": "Для чего", "style": "Стиль", "dimensions": "Размеры" }],
  "screenshots_needed": [{ "what": "Что снять", "why": "Зачем", "annotations": "Подписи" }]` : ''}
}`;

  // 8. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    release_version: release.version,
    issues_count: release.issues.length,
    channels,
    tone,
    audiences,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос пресс-релиза отправлен модели ${model.name} (${mode}), каналы: ${channels.join(', ')}`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 9. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `prepare_press_release/${model.name}`,
  );

  // 10. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 11. Parse JSON
  const parsed = parseJsonFromAI(rawResponse);
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!data || !data.channels) {
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: 'Не удалось распарсить JSON пресс-релиза из ответа модели',
      data: { raw_response: rawResponse.slice(0, 2000) },
    });
    throw new Error('Failed to parse press release JSON from AI response');
  }

  // 12. Normalize: keep only requested channels
  const normalizedChannels = {};
  for (const ch of channels) {
    if (data.channels[ch]) normalizedChannels[ch] = data.channels[ch];
  }
  const normalizedData = { channels: normalizedChannels };
  if (generateImages && data.image_prompts) normalizedData.image_prompts = data.image_prompts;
  if (generateImages && data.screenshots_needed) normalizedData.screenshots_needed = data.screenshots_needed;

  // 13. Save press release
  await releases.savePressRelease(release.id, normalizedData);

  await processLogs.create({
    process_id: processId,
    step: 'press_release_saved',
    message: `Пресс-релиз сохранён (${Object.keys(normalizedChannels).length} каналов)`,
    data: { channels: Object.keys(normalizedChannels) },
  });

  // 14. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: { mode, channels: Object.keys(normalizedChannels), has_images: !!normalizedData.image_prompts },
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}
