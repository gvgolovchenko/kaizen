#!/usr/bin/env node

/**
 * Kaizen MCP Server
 *
 * MCP-сервер для управления системой непрерывного улучшения продуктов Kaizen.
 * Оборачивает REST API (localhost:3034) в MCP-инструменты.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './api-client.js';

const server = new McpServer({
  name: 'kaizen',
  version: '1.0.0',
  description: 'Kaizen (改善) — система непрерывного улучшения продуктов. Управление продуктами, задачами, релизами, AI-процессами и планами.',
  instructions: `Kaizen MCP server предоставляет инструменты для полного цикла улучшения продуктов:

1. Просмотр продуктов и их задач
2. Запуск AI-процессов улучшения (improve, prepare_spec, develop_release, roadmap_from_doc, prepare_press_release)
3. Утверждение AI-предложений → создание задач
4. Формирование релизов из задач
5. Генерация спецификаций и разработка релизов
6. Управление планами (цепочки AI-процессов)

Типичный конвейер:
  improve → approve → create_release → prepare_spec → develop → publish

Kaizen API работает на http://localhost:3034. Сервер должен быть запущен.`,
});

// ══════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_list_products',
  'Список всех продуктов с количеством открытых задач',
  {},
  async () => {
    const products = await api.listProducts();
    return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
  }
);

server.tool(
  'kaizen_get_product',
  'Детальная информация о продукте: метаданные, открытые задачи, релизы, активные процессы',
  { product_id: z.string().uuid().describe('UUID продукта') },
  async ({ product_id }) => {
    const [product, issues, releases, processes] = await Promise.all([
      api.getProduct(product_id),
      api.listIssues(product_id),
      api.listReleases(product_id),
      api.listProcesses({ product_id }),
    ]);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ product, issues, releases, active_processes: processes.filter(p => ['running', 'queued'].includes(p.status)) }, null, 2),
      }],
    };
  }
);

// ══════════════════════════════════════════════════════════════
// ISSUES
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_list_issues',
  'Список задач продукта. Можно фильтровать по статусу: open, in_release, done, closed',
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    status: z.enum(['open', 'in_release', 'done', 'closed']).optional().describe('Фильтр по статусу'),
  },
  async ({ product_id, status }) => {
    const issues = await api.listIssues(product_id, status);
    return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
  }
);

server.tool(
  'kaizen_create_issue',
  'Создать задачу вручную (баг, улучшение или новая фича)',
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    title: z.string().describe('Заголовок задачи'),
    description: z.string().optional().describe('Описание задачи'),
    type: z.enum(['improvement', 'bug', 'feature']).default('improvement').describe('Тип задачи'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium').describe('Приоритет'),
  },
  async (params) => {
    const issue = await api.createIssue(params);
    return { content: [{ type: 'text', text: JSON.stringify(issue, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// AI MODELS
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_list_models',
  'Список зарегистрированных AI-моделей (ollama, mlx, claude-code, anthropic, openai, google)',
  {},
  async () => {
    const models = await api.listModels();
    return { content: [{ type: 'text', text: JSON.stringify(models, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// AI PROCESSES — Улучшение продукта
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_improve_product',
  `Запустить AI-анализ продукта для генерации задач на улучшение.
Шаблоны: general, ui, performance, security, competitors, dx.
Или можно указать произвольный prompt.
Возвращает process_id — используй kaizen_get_process для отслеживания.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    model_id: z.string().uuid().describe('UUID AI-модели'),
    template_id: z.enum(['general', 'ui', 'performance', 'security', 'competitors', 'dx']).optional()
      .describe('ID шаблона промпта (или используй prompt)'),
    prompt: z.string().optional().describe('Произвольный промпт (вместо шаблона)'),
    count: z.number().min(1).max(10).default(5).describe('Количество предложений (1-10)'),
    timeout_min: z.number().min(3).max(60).default(20).describe('Таймаут в минутах'),
  },
  async ({ product_id, model_id, template_id, prompt, count, timeout_min }) => {
    const proc = await api.createProcess({
      product_id, model_id, type: 'improve',
      template_id, prompt, count, timeout_min,
    });
    return { content: [{ type: 'text', text: JSON.stringify(proc, null, 2) }] };
  }
);

server.tool(
  'kaizen_roadmap_from_doc',
  `Парсить документ (BRD, ТЗ, ФТ) в дорожную карту: релизы + задачи.
Результат — структура для утверждения через kaizen_approve_roadmap.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    model_id: z.string().uuid().describe('UUID AI-модели'),
    document: z.string().describe('Текст документа для парсинга'),
    timeout_min: z.number().min(3).max(60).default(20).describe('Таймаут в минутах'),
  },
  async ({ product_id, model_id, document, timeout_min }) => {
    const proc = await api.createProcess({
      product_id, model_id, type: 'roadmap_from_doc',
      prompt: document, timeout_min,
    });
    return { content: [{ type: 'text', text: JSON.stringify(proc, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// PROCESS MANAGEMENT
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_get_process',
  'Получить статус и результат AI-процесса. Для running-процессов показывает прогресс.',
  { process_id: z.string().uuid().describe('UUID процесса') },
  async ({ process_id }) => {
    const [proc, logs] = await Promise.all([
      api.getProcess(process_id),
      api.getProcessLogs(process_id),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ ...proc, logs }, null, 2) }] };
  }
);

server.tool(
  'kaizen_list_processes',
  'Список AI-процессов. Фильтрация по статусу и/или продукту.',
  {
    status: z.enum(['pending', 'queued', 'running', 'completed', 'failed']).optional(),
    product_id: z.string().uuid().optional(),
  },
  async (params) => {
    const procs = await api.listProcesses(params);
    return { content: [{ type: 'text', text: JSON.stringify(procs, null, 2) }] };
  }
);

server.tool(
  'kaizen_approve_suggestions',
  `Утвердить предложения AI-процесса (improve) → создаёт задачи в продукте.
indices — массив индексов предложений из result[] процесса (начиная с 0).
Пример: [0, 2, 4] — утвердить 1-е, 3-е и 5-е предложения.`,
  {
    process_id: z.string().uuid().describe('UUID завершённого процесса'),
    indices: z.array(z.number().int().min(0)).describe('Индексы предложений для утверждения'),
  },
  async ({ process_id, indices }) => {
    const result = await api.approveSuggestions(process_id, indices);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_approve_roadmap',
  `Утвердить дорожную карту из roadmap_from_doc процесса → создаёт релизы + задачи.
releases — массив объектов: { release_index, issue_indices[], version?, name? }`,
  {
    process_id: z.string().uuid().describe('UUID завершённого roadmap_from_doc процесса'),
    releases: z.array(z.object({
      release_index: z.number().int().min(0).describe('Индекс релиза в roadmap'),
      issue_indices: z.array(z.number().int().min(0)).describe('Индексы задач в релизе'),
      version: z.string().optional(),
      name: z.string().optional(),
    })).describe('Массив релизов для утверждения'),
  },
  async ({ process_id, releases }) => {
    const result = await api.approveRoadmap(process_id, releases);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// RELEASES
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_list_releases',
  'Список релизов продукта',
  { product_id: z.string().uuid().describe('UUID продукта') },
  async ({ product_id }) => {
    const rels = await api.listReleases(product_id);
    return { content: [{ type: 'text', text: JSON.stringify(rels, null, 2) }] };
  }
);

server.tool(
  'kaizen_create_release',
  'Создать релиз из открытых задач. Задачи автоматически переходят в статус in_release.',
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    version: z.string().describe('Версия релиза (например, "2.1.0")'),
    name: z.string().describe('Название релиза'),
    description: z.string().optional().describe('Описание'),
    issue_ids: z.array(z.string().uuid()).describe('Массив UUID задач для включения в релиз'),
  },
  async (params) => {
    const release = await api.createRelease(params);
    return { content: [{ type: 'text', text: JSON.stringify(release, null, 2) }] };
  }
);

server.tool(
  'kaizen_get_release',
  'Детали релиза с вложенными задачами, спецификацией и статусом разработки',
  { release_id: z.string().uuid().describe('UUID релиза') },
  async ({ release_id }) => {
    const release = await api.getRelease(release_id);
    return { content: [{ type: 'text', text: JSON.stringify(release, null, 2) }] };
  }
);

server.tool(
  'kaizen_prepare_spec',
  `Запустить AI-генерацию спецификации для релиза.
Требуется: релиз в статусе draft с задачами.
Возвращает process_id для отслеживания.`,
  {
    release_id: z.string().uuid().describe('UUID релиза'),
    model_id: z.string().uuid().describe('UUID AI-модели'),
    timeout_min: z.number().min(3).max(60).default(20).describe('Таймаут в минутах'),
  },
  async ({ release_id, model_id, timeout_min }) => {
    const result = await api.prepareSpec(release_id, { model_id, timeout_min });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_get_spec',
  'Получить сгенерированную спецификацию релиза',
  { release_id: z.string().uuid().describe('UUID релиза') },
  async ({ release_id }) => {
    const spec = await api.getSpec(release_id);
    return { content: [{ type: 'text', text: JSON.stringify(spec, null, 2) }] };
  }
);

server.tool(
  'kaizen_develop_release',
  `Запустить автоматическую разработку релиза через claude-code.
Требуется: спецификация (prepare_spec), claude-code модель, product.project_path.
7 фаз: repo → study → implement → tests → test_run → docs → commit.`,
  {
    release_id: z.string().uuid().describe('UUID релиза'),
    model_id: z.string().uuid().describe('UUID claude-code модели'),
    git_branch: z.string().optional().describe('Название ветки (по умолчанию kaizen/release-{version})'),
    test_command: z.string().optional().describe('Команда запуска тестов (авто-определение по tech_stack)'),
    timeout_min: z.number().min(10).max(480).default(60).describe('Таймаут в минутах'),
  },
  async ({ release_id, model_id, git_branch, test_command, timeout_min }) => {
    const result = await api.developRelease(release_id, { model_id, git_branch, test_command, timeout_min });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_publish_release',
  'Опубликовать релиз. Все задачи → done, фиксируется released_at.',
  { release_id: z.string().uuid().describe('UUID релиза') },
  async ({ release_id }) => {
    const result = await api.publishRelease(release_id);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_prepare_press_release',
  `Сгенерировать пресс-релиз для опубликованного релиза.
Каналы: social (ВК, Telegram), website, bitrix24, media.`,
  {
    release_id: z.string().uuid().describe('UUID опубликованного релиза'),
    model_id: z.string().uuid().describe('UUID AI-модели'),
    channels: z.array(z.enum(['social', 'website', 'bitrix24', 'media'])).describe('Каналы публикации'),
    tone: z.string().optional().describe('Тональность (например, "профессиональный", "дружелюбный")'),
    audiences: z.array(z.string()).optional().describe('Целевые аудитории'),
    timeout_min: z.number().min(3).max(60).default(20).describe('Таймаут в минутах'),
  },
  async ({ release_id, model_id, channels, tone, audiences, timeout_min }) => {
    const result = await api.preparePressRelease(release_id, { model_id, channels, tone, audiences, timeout_min });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// QUEUE
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_queue_stats',
  'Статистика очереди: активные и ожидающие процессы по провайдерам',
  {},
  async () => {
    const stats = await api.getQueueStats();
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// PLANS
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_list_plans',
  'Список планов (цепочки AI-процессов). Фильтр по статусу: draft, scheduled, active, completed, failed, cancelled.',
  {
    status: z.enum(['draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled']).optional(),
  },
  async ({ status }) => {
    const plans = await api.listPlans(status);
    return { content: [{ type: 'text', text: JSON.stringify(plans, null, 2) }] };
  }
);

server.tool(
  'kaizen_get_plan',
  'Детали плана с шагами, статусами и зависимостями',
  { plan_id: z.string().uuid().describe('UUID плана') },
  async ({ plan_id }) => {
    const plan = await api.getPlan(plan_id);
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  }
);

server.tool(
  'kaizen_create_plan',
  `Создать план (цепочку AI-процессов) с шагами.
Каждый шаг: модель, тип процесса, промпт, зависимости (depends_on).
Шаги выполняются автоматически планировщиком.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    name: z.string().describe('Название плана'),
    description: z.string().optional(),
    on_failure: z.enum(['stop', 'skip']).default('stop').describe('Поведение при ошибке шага'),
    scheduled_at: z.string().optional().describe('ISO datetime для отложенного запуска'),
    steps: z.array(z.object({
      name: z.string().describe('Название шага'),
      model_id: z.string().uuid().optional().describe('UUID AI-модели (не нужно для run_tests)'),
      process_type: z.enum(['improve', 'prepare_spec', 'develop_release', 'form_release', 'run_tests', 'update_docs', 'roadmap_from_doc', 'prepare_press_release']),
      input_prompt: z.string().optional(),
      input_template_id: z.string().optional(),
      input_count: z.number().optional(),
      release_id: z.string().uuid().optional(),
      timeout_min: z.number().optional().default(20),
      depends_on: z.array(z.string().uuid()).optional().describe('UUID шагов, от которых зависит этот шаг'),
    })).optional().describe('Массив шагов плана'),
  },
  async (params) => {
    const plan = await api.createPlan(params);
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  }
);

server.tool(
  'kaizen_start_plan',
  'Запустить план (из draft/scheduled → active). Планировщик начнёт выполнение шагов.',
  { plan_id: z.string().uuid().describe('UUID плана') },
  async ({ plan_id }) => {
    const result = await api.startPlan(plan_id);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_cancel_plan',
  'Отменить план и все ожидающие шаги',
  { plan_id: z.string().uuid().describe('UUID плана') },
  async ({ plan_id }) => {
    const result = await api.cancelPlan(plan_id);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_create_issues_bulk',
  `Создать несколько задач за один вызов (до 100 штук).
Передай массив объектов с полями: title, description, type, priority.
product_id задаётся один раз для всех.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    issues: z.array(z.object({
      title: z.string().describe('Заголовок задачи'),
      description: z.string().optional(),
      type: z.enum(['improvement', 'bug', 'feature']).default('improvement'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    })).describe('Массив задач (до 100)'),
  },
  async ({ product_id, issues: items }) => {
    const enriched = items.map(item => ({ ...item, product_id }));
    const result = await api.createIssuesBulk(enriched);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_create_plan_from_releases',
  `Создать план выполнения из списка релизов.
Автоматически строит цепочку: prepare_spec → develop_release для каждого релиза.
Каждый следующий релиз стартует после завершения предыдущего.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    name: z.string().describe('Название плана'),
    description: z.string().optional(),
    release_ids: z.array(z.string().uuid()).describe('Массив UUID релизов в порядке выполнения'),
    model_id: z.string().uuid().describe('UUID AI-модели для всех шагов'),
    on_failure: z.enum(['stop', 'skip']).default('stop'),
    timeout_spec: z.number().optional().default(30).describe('Таймаут для спецификации (мин)'),
    timeout_develop: z.number().optional().default(60).describe('Таймаут для разработки (мин)'),
  },
  async (params) => {
    const plan = await api.createPlanFromReleases(params);
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  }
);

server.tool(
  'kaizen_import_roadmap',
  `Импортировать дорожную карту: создать issues + releases + (опционально) план выполнения за один вызов.
Принимает структурированный массив релизов, каждый с массивом задач.
Заменяет десятки отдельных вызовов create_issue/create_release одним.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    releases: z.array(z.object({
      version: z.string().describe('Версия (например "0.1.0")'),
      name: z.string().describe('Название релиза'),
      description: z.string().optional(),
      issues: z.array(z.object({
        title: z.string().describe('Заголовок задачи'),
        description: z.string().optional(),
        type: z.enum(['improvement', 'bug', 'feature']).default('feature'),
        priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      })).describe('Задачи для этого релиза'),
    })).describe('Массив релизов с задачами'),
    create_plan: z.boolean().default(false).describe('Создать план выполнения (spec → develop)'),
    model_id: z.string().uuid().optional().describe('UUID AI-модели для плана (если create_plan=true)'),
    plan_name: z.string().optional().describe('Название плана'),
  },
  async (params) => {
    const result = await api.importRoadmap(params);
    let text = `Импорт roadmap завершён:\n`;
    text += `- Релизов: ${result.total_releases}\n`;
    text += `- Задач: ${result.total_issues}\n`;
    for (const rel of result.releases) {
      text += `  ${rel.version} — ${rel.name} (${rel.issues_count} задач) [${rel.id}]\n`;
    }
    if (result.plan) {
      text += `- План: ${result.plan.id} (${result.plan.steps_count} шагов)\n`;
    }
    text += `\nJSON:\n${JSON.stringify(result, null, 2)}`;
    return { content: [{ type: 'text', text }] };
  }
);

// ══════════════════════════════════════════════════════════════
// PIPELINE — Полный конвейер одной командой
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_run_pipeline',
  `Запустить полный конвейер улучшения продукта одной командой.

Пресеты:
- "analysis" — этапы 1-5 (improve → approve → release → spec)
- "full_cycle" — этапы 1-8 (+ develop → publish → press_release)
- "custom" — выбор этапов вручную через параметры develop/press_release

Multi-model: каждый AI-этап может использовать свою модель.
- model_id — глобальный fallback для всех этапов
- improve.model_id — модель для генерации предложений
- spec.model_id — модель для спецификации
- develop.model_id — модель для разработки (только claude-code)
- press_release.model_id — модель для пресс-релиза

Этапы (базовые, всегда выполняются):
1. AI-улучшение (improve) — генерация предложений
2. Ожидание завершения процесса (polling)
3. Автоматическое утверждение по правилам (priority/type)
4. Создание релиза из утверждённых задач
5. Генерация спецификации (prepare_spec)

Опциональные этапы (включаются пресетом или параметрами):
6. Разработка (develop_release) — Claude Code реализует задачи
7. Публикация релиза (auto-publish если тесты пройдены)
8. Пресс-релиз (prepare_press_release)

Полный сквозной конвейер: improve → approve → release → spec → develop → publish → press_release`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    model_id: z.string().uuid().describe('UUID AI-модели (глобальный fallback для всех этапов)'),
    preset: z.enum(['analysis', 'full_cycle', 'custom']).default('custom')
      .describe('Пресет: analysis (1-5), full_cycle (1-8), custom (ручной выбор)'),
    template_id: z.enum(['general', 'ui', 'performance', 'security', 'competitors', 'dx']).default('general')
      .describe('Шаблон промпта'),
    count: z.number().min(1).max(10).default(5).describe('Количество предложений'),
    version: z.string().describe('Версия нового релиза (например, "2.1.0")'),
    release_name: z.string().describe('Название релиза'),
    auto_approve: z.enum(['all', 'high_and_critical', 'critical_only', 'none']).default('high_and_critical')
      .describe('Правила автоматического утверждения'),
    timeout_min: z.number().min(3).max(60).default(20).describe('Таймаут на каждый этап'),
    // ── Per-stage model overrides ──
    improve: z.object({
      model_id: z.string().uuid().optional().describe('UUID модели для improve (override)'),
    }).optional().describe('Настройки этапа improve'),
    spec: z.object({
      model_id: z.string().uuid().optional().describe('UUID модели для спецификации (override)'),
    }).optional().describe('Настройки этапа спецификации'),
    // ── Опциональные этапы ──
    develop: z.object({
      enabled: z.boolean().default(false),
      model_id: z.string().uuid().optional().describe('UUID модели для разработки (override, только claude-code)'),
      git_branch: z.string().optional().describe('Имя ветки (по умолчанию kaizen/release-{version})'),
      test_command: z.string().optional().describe('Команда запуска тестов'),
      auto_publish: z.boolean().default(false).describe('Автоматическая публикация после успешных тестов'),
    }).optional().describe('Настройки этапа разработки (develop_release)'),
    press_release: z.object({
      enabled: z.boolean().default(false),
      model_id: z.string().uuid().optional().describe('UUID модели для пресс-релиза (override)'),
      channels: z.array(z.string()).default(['social', 'website', 'bitrix24', 'media']).describe('Каналы пресс-релиза'),
      tone: z.string().default('official').describe('Тон пресс-релиза'),
    }).optional().describe('Настройки пресс-релиза'),
  },
  async ({ product_id, model_id, preset, template_id, count, version, release_name, auto_approve, timeout_min, improve: improveOpts, spec: specOpts, develop, press_release }) => {
    const stages = [];

    // ── Resolve preset → effective config ──
    const effectiveDevelop = preset === 'full_cycle'
      ? { enabled: true, auto_publish: true, ...(develop || {}) }
      : (develop || {});
    const effectivePressRelease = preset === 'full_cycle'
      ? { enabled: true, ...(press_release || {}) }
      : (press_release || {});

    // ── Per-stage model resolution (override → global fallback) ──
    const improveModelId = improveOpts?.model_id || model_id;
    const specModelId = specOpts?.model_id || model_id;
    const developModelId = effectiveDevelop.model_id || model_id;
    const prModelId = effectivePressRelease.model_id || model_id;

    stages.push({ stage: '0_config', preset, models: {
      improve: improveModelId, spec: specModelId,
      develop: effectiveDevelop.enabled ? developModelId : 'n/a',
      press_release: effectivePressRelease.enabled ? prModelId : 'n/a',
    }});

    // ── Helper: poll process until done ──
    async function waitForProcess(processId) {
      let result;
      const deadline = Date.now() + timeout_min * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        result = await api.getProcess(processId);
        if (['completed', 'failed'].includes(result.status)) break;
      }
      return result;
    }

    // ── Этап 1: Запуск improve ──
    const proc = await api.createProcess({
      product_id, model_id: improveModelId, type: 'improve',
      template_id, count, timeout_min,
    });
    stages.push({ stage: '1_improve_started', process_id: proc.id, status: proc.status, model_id: improveModelId });

    // ── Этап 2: Ожидание завершения ──
    const result = await waitForProcess(proc.id);

    if (result.status !== 'completed') {
      stages.push({ stage: '2_improve_result', status: result.status, error: result.error || 'timeout' });
      return { content: [{ type: 'text', text: JSON.stringify({ pipeline: 'failed', stages }, null, 2) }] };
    }

    const suggestions = result.result || [];
    stages.push({ stage: '2_improve_completed', suggestions_count: suggestions.length });

    // ── Этап 3: Автоматическое утверждение ──
    let indicesToApprove = [];
    if (auto_approve === 'all') {
      indicesToApprove = suggestions.map((_, i) => i);
    } else if (auto_approve === 'high_and_critical') {
      indicesToApprove = suggestions.map((s, i) => ['high', 'critical'].includes(s.priority) ? i : null).filter(i => i !== null);
    } else if (auto_approve === 'critical_only') {
      indicesToApprove = suggestions.map((s, i) => s.priority === 'critical' ? i : null).filter(i => i !== null);
    }

    if (indicesToApprove.length === 0) {
      stages.push({
        stage: '3_approve',
        approved: 0,
        message: 'Нет предложений, соответствующих правилам утверждения',
        suggestions: suggestions.map((s, i) => ({ index: i, title: s.title, priority: s.priority, type: s.type })),
      });
      return { content: [{ type: 'text', text: JSON.stringify({ pipeline: 'needs_manual_approval', stages }, null, 2) }] };
    }

    const approved = await api.approveSuggestions(proc.id, indicesToApprove);
    stages.push({ stage: '3_approved', count: approved.count, issues: approved.created.map(i => ({ id: i.id, title: i.title })) });

    // ── Этап 4: Создание релиза ──
    const issueIds = approved.created.map(i => i.id);
    const release = await api.createRelease({
      product_id, version, name: release_name,
      issue_ids: issueIds,
    });
    stages.push({ stage: '4_release_created', release_id: release.id, version, issues_count: issueIds.length });

    // ── Этап 5: Генерация спецификации ──
    const specProc = await api.prepareSpec(release.id, { model_id: specModelId, timeout_min });
    stages.push({ stage: '5_spec_started', process_id: specProc.id, model_id: specModelId });

    const specResult = await waitForProcess(specProc.id);

    if (specResult.status === 'completed') {
      stages.push({ stage: '5_spec_completed', release_id: release.id });
    } else {
      stages.push({ stage: '5_spec_result', status: specResult.status, error: specResult.error || 'timeout' });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pipeline: 'partial',
            stopped_at: 'spec',
            release_id: release.id,
            stages,
            next_steps: ['Проверить статус спецификации: kaizen_get_process'],
          }, null, 2),
        }],
      };
    }

    // ── Этап 6: Разработка (опциональный) ──
    if (effectiveDevelop.enabled) {
      const devConfig = {
        git_branch: effectiveDevelop.git_branch,
        test_command: effectiveDevelop.test_command,
        auto_publish: effectiveDevelop.auto_publish || false,
      };
      const devProc = await api.developRelease(release.id, {
        model_id: developModelId,
        timeout_min,
        ...devConfig,
      });
      stages.push({ stage: '6_develop_started', process_id: devProc.id, model_id: developModelId });

      const devResult = await waitForProcess(devProc.id);

      if (devResult.status === 'completed') {
        const devData = devResult.result || {};
        stages.push({
          stage: '6_develop_completed',
          branch: devData.branch,
          tests_passed: devData.tests_passed,
          commit: devData.commit_hash,
        });

        // ── Этап 7: Публикация (если auto_publish и тесты пройдены) ──
        if (effectiveDevelop.auto_publish && devData.tests_passed) {
          try {
            await api.publishRelease(release.id);
            stages.push({ stage: '7_published', release_id: release.id, version });
          } catch (pubErr) {
            stages.push({ stage: '7_publish_failed', error: pubErr.message });
          }
        } else if (!devData.tests_passed) {
          stages.push({
            stage: '7_publish_skipped',
            reason: 'tests_failed',
            message: 'Публикация пропущена — тесты не пройдены',
          });
        }

        // ── Этап 8: Пресс-релиз (опциональный) ──
        if (effectivePressRelease.enabled && devData.tests_passed) {
          try {
            const prProc = await api.preparePressRelease(release.id, {
              model_id: prModelId,
              timeout_min,
              channels: effectivePressRelease.channels || ['social', 'website', 'bitrix24', 'media'],
              tone: effectivePressRelease.tone || 'official',
            });
            stages.push({ stage: '8_press_release_started', process_id: prProc.id, model_id: prModelId });

            const prResult = await waitForProcess(prProc.id);
            if (prResult.status === 'completed') {
              stages.push({ stage: '8_press_release_completed' });
            } else {
              stages.push({ stage: '8_press_release_result', status: prResult.status, error: prResult.error || 'timeout' });
            }
          } catch (prErr) {
            stages.push({ stage: '8_press_release_failed', error: prErr.message });
          }
        }
      } else {
        stages.push({ stage: '6_develop_result', status: devResult.status, error: devResult.error || 'timeout' });
      }
    }

    // ── Определяем итоговый статус ──
    const lastStage = stages[stages.length - 1];
    const pipelineStatus = lastStage.stage.includes('failed') || lastStage.stage.includes('skipped')
      ? 'partial'
      : 'success';

    const nextSteps = [];
    if (!effectiveDevelop.enabled) {
      nextSteps.push('kaizen_develop_release — запустить разработку');
      nextSteps.push('kaizen_publish_release — опубликовать');
    }
    if (!effectivePressRelease.enabled && pipelineStatus === 'success') {
      nextSteps.push('kaizen_prepare_press_release — пресс-релиз');
    }

    // ── Notify via Б24 ──
    try {
      const notifyEvent = pipelineStatus === 'success' ? 'pipeline_completed' : 'pipeline_failed';
      const notifyData = pipelineStatus === 'success'
        ? { product: product_id, version, release_id: release.id, stages_count: stages.length, preset }
        : { product: product_id, version, stopped_at: stages[stages.length - 1]?.stage, error: stages[stages.length - 1]?.error };
      // Fetch product name for notification
      const prod = await api.getProduct(product_id);
      if (prod) notifyData.product = prod.name;
      await api.sendNotify(notifyEvent, notifyData, product_id);
    } catch {}

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          pipeline: pipelineStatus,
          preset,
          release_id: release.id,
          stages,
          ...(nextSteps.length > 0 ? { next_steps: nextSteps } : {}),
        }, null, 2),
      }],
    };
  }
);

// ══════════════════════════════════════════════════════════════
// WAIT HELPER
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_wait_process',
  'Дождаться завершения AI-процесса (polling каждые 5 сек). Возвращает финальный результат.',
  {
    process_id: z.string().uuid().describe('UUID процесса'),
    timeout_min: z.number().min(1).max(60).default(20).describe('Максимальное время ожидания'),
  },
  async ({ process_id, timeout_min }) => {
    const deadline = Date.now() + timeout_min * 60 * 1000;
    let proc;
    while (Date.now() < deadline) {
      proc = await api.getProcess(process_id);
      if (['completed', 'failed'].includes(proc.status)) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    const logs = await api.getProcessLogs(process_id);
    return { content: [{ type: 'text', text: JSON.stringify({ ...proc, logs }, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════
// RIVC.CONNECT
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_rc_test',
  'Проверить подключение к Rivc.Connect HelpDesk (MS SQL)',
  {},
  async () => {
    const result = await api.rcTest();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_rc_sync',
  'Загрузить тикеты-бэклог из Rivc.Connect для продукта (ручная синхронизация)',
  { product_id: z.string().describe('UUID продукта Kaizen') },
  async ({ product_id }) => {
    const stats = await api.rcSync(product_id);
    return { content: [{ type: 'text', text: `Синхронизация завершена: ${stats.new} новых, ${stats.updated} обновлённых (всего ${stats.total})` }] };
  }
);

server.tool(
  'kaizen_rc_list_tickets',
  'Список кэшированных тикетов RC для продукта',
  {
    product_id: z.string().describe('UUID продукта Kaizen'),
    sync_status: z.enum(['new', 'imported', 'ignored']).optional().describe('Фильтр по статусу синхронизации'),
  },
  async ({ product_id, sync_status }) => {
    const tickets = await api.rcListTickets(product_id, sync_status);
    return { content: [{ type: 'text', text: JSON.stringify(tickets, null, 2) }] };
  }
);

server.tool(
  'kaizen_rc_import_tickets',
  'Импортировать тикеты RC → задачи Kaizen',
  { ticket_ids: z.array(z.string()).describe('Массив UUID кэшированных тикетов из kaizen_rc_tickets') },
  async ({ ticket_ids }) => {
    const issues = await api.rcImportBulk(ticket_ids);
    return { content: [{ type: 'text', text: `Импортировано ${issues.length} задач:\n${issues.map(i => `- ${i.title} (${i.type}, ${i.priority})`).join('\n')}` }] };
  }
);

// ══════════════════════════════════════════════════════════════
// FORM RELEASE (AI)
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_form_release',
  'AI-формирование релизов из открытых задач продукта. Стратегии: balanced, critical_first, by_topic, single.',
  {
    product_id: z.string().describe('UUID продукта'),
    model_id: z.string().describe('UUID AI-модели'),
    strategy: z.enum(['balanced', 'critical_first', 'by_topic', 'single']).default('balanced').describe('Стратегия группировки'),
    max_releases: z.number().min(1).max(10).default(3).describe('Максимум релизов'),
    auto_approve: z.boolean().default(false).describe('Авто-утверждение (создать релизы без ручного обзора)'),
    timeout_min: z.number().min(3).max(60).default(20).optional(),
  },
  async ({ product_id, model_id, strategy, max_releases, auto_approve, timeout_min }) => {
    const proc = await api.createProcess({
      product_id,
      model_id,
      type: 'form_release',
      prompt: '',
      config: { strategy, max_releases, auto_approve },
      timeout_min: timeout_min || 20,
    });

    // Poll until completed
    let result;
    const maxWait = (timeout_min || 20) * 60 * 1000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 5000));
      result = await api.getProcess(proc.id);
      if (result.status === 'completed' || result.status === 'failed') break;
    }

    if (!result || result.status !== 'completed') {
      return { content: [{ type: 'text', text: `Процесс ${proc.id} не завершён (статус: ${result?.status || 'unknown'}). Используйте kaizen_wait_process для ожидания.` }] };
    }

    const r = result.result;
    let text = `Формирование релиза завершено (process_id: ${proc.id})\n\n`;
    if (r.auto_approved) {
      text += `Авто-утверждение: создано ${r.created_releases?.length || 0} релизов\n`;
      (r.created_releases || []).forEach(cr => {
        text += `  - ${cr.version} — ${cr.name} (${cr.issues} задач)\n`;
      });
    } else {
      text += `Предложение: ${r.releases?.length || 0} релизов\n`;
      (r.releases || []).forEach(rel => {
        text += `\n### ${rel.version} — ${rel.name} [${rel.priority}]\n`;
        text += `${rel.description}\n`;
        (rel.issues || []).forEach(iss => {
          text += `  - ${iss.title} (${iss.type}, ${iss.priority}) [id: ${iss.id}]\n`;
        });
        if (rel.rationale) text += `Обоснование: ${rel.rationale}\n`;
      });
      if (r.unassigned?.length) text += `\nНе включены: ${r.unassigned.length} задач\n`;
      text += `\nИспользуйте kaizen_approve_releases для утверждения.`;
    }
    if (r.summary) text += `\n\n${r.summary}`;

    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'kaizen_approve_releases',
  'Утвердить предложенные ИИ релизы (после kaizen_form_release)',
  {
    process_id: z.string().describe('UUID процесса form_release'),
    releases: z.array(z.object({
      version: z.string(),
      name: z.string(),
      description: z.string().optional(),
      issue_ids: z.array(z.string()).describe('UUID задач для включения в релиз'),
    })).describe('Массив релизов для создания'),
  },
  async ({ process_id, releases }) => {
    const result = await api.approveReleases(process_id, releases);
    return { content: [{ type: 'text', text: `Утверждено: создано ${result.created_releases} релизов, ${result.total_issues} задач включено.\n${result.releases.map(r => `  - ${r.version} — ${r.name} (${r.issues} задач)`).join('\n')}` }] };
  }
);

server.tool(
  'kaizen_update_docs',
  `Обновить документацию продукта. Использует Claude Code для анализа изменений и обновления docs/.
При запуске из плана — автоматически мержит ветки develop_release из depends_on.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    model_id: z.string().uuid().describe('UUID модели (claude-code)'),
    doc_files: z.array(z.string()).optional().describe('Файлы для обновления (по умолчанию: USER_GUIDE, MAIN_FUNC, RELEASE_NOTES, DATABASE_SCHEMA)'),
    branches: z.array(z.string()).optional().describe('Ветки для мержа перед обновлением'),
    timeout_min: z.number().optional().default(20),
  },
  async ({ product_id, model_id, doc_files, branches, timeout_min }) => {
    const config = {};
    if (doc_files?.length) config.doc_files = doc_files;
    if (branches?.length) config.branches = branches;

    const result = await api.createProcess({
      product_id,
      model_id,
      type: 'update_docs',
      config,
      timeout_min,
    });
    return { content: [{ type: 'text', text: `Процесс документирования создан: ${result.id}\nСтатус: ${result.status}` }] };
  }
);

server.tool(
  'kaizen_run_tests',
  `Запустить тесты продукта. Определяет тестовую команду по стеку автоматически.
При запуске из плана — автоматически мержит ветки develop_release из depends_on.
Можно указать кастомную команду и ветки для мержа.`,
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    test_command: z.string().optional().describe('Команда для тестов (по умолчанию: auto-detect по стеку)'),
    branches: z.array(z.string()).optional().describe('Ветки для мержа перед тестированием'),
    timeout_min: z.number().optional().default(10).describe('Таймаут в минутах'),
  },
  async ({ product_id, test_command, branches, timeout_min }) => {
    const config = {};
    if (test_command) config.test_command = test_command;
    if (branches?.length) config.branches = branches;

    const result = await api.createProcess({
      product_id,
      type: 'run_tests',
      config,
      timeout_min,
    });
    return { content: [{ type: 'text', text: `Процесс тестирования создан: ${result.id}\nСтатус: ${result.status}${result.queue?.queued ? ` (очередь, позиция ${result.queue.position})` : ''}` }] };
  }
);

// ══════════════════════════════════════════════════════════════
// DEPLOY
// ══════════════════════════════════════════════════════════════

server.tool(
  'kaizen_deploy_release',
  `Запустить деплой релиза через GitLab CI/CD.
Мержит ветку разработки в default branch, пушит в GitLab, ждёт завершения pipeline.
Требуется: deploy.gitlab настроен для продукта.`,
  {
    release_id: z.string().uuid().describe('UUID релиза для деплоя'),
    timeout_min: z.number().min(5).max(30).default(15).describe('Таймаут ожидания pipeline'),
  },
  async ({ release_id, timeout_min }) => {
    const result = await api.deployRelease(release_id, { timeout_min });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'kaizen_deploy_status',
  'Статус GitLab CI/CD pipeline для коммита',
  {
    product_id: z.string().uuid().describe('UUID продукта'),
    sha: z.string().describe('SHA коммита'),
  },
  async ({ product_id, sha }) => {
    const status = await api.getPipelineStatus(product_id, sha);
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

server.tool(
  'kaizen_generate_ci',
  'Сгенерировать .gitlab-ci.yml и Dockerfile для продукта на основе его стека и настроек деплоя',
  {
    product_id: z.string().uuid().describe('UUID продукта'),
  },
  async ({ product_id }) => {
    const [ci, docker] = await Promise.all([
      api.generateCI(product_id),
      api.generateDockerfile(product_id),
    ]);
    let text = `# .gitlab-ci.yml\n\n${ci.content}\n\n`;
    text += `# Dockerfile\n\n${docker.dockerfile}\n\n`;
    text += `# docker-compose.yml\n\n${docker.docker_compose}\n\n`;
    text += `# .dockerignore\n\n${docker.dockerignore}`;
    return { content: [{ type: 'text', text }] };
  }
);

// ══════════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);
