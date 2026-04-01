# Kaizen — Контекст проекта

Kaizen (改善) — система непрерывного улучшения продуктов v1.17.0. Отслеживает продукты компании, собирает задачи на улучшение (включая асинхронную AI-генерацию через 6 провайдеров с логированием), формирует из них релизы с автоматическим управлением статусами. Поддерживает очередь процессов (QueueManager) с контролем параллелизма по провайдерам, сценарии (ScenarioRunner) для автономных ночных рабочих процессов и планировщик (Scheduler) для автоматического запуска по расписанию.

## Архитектура

Вариант Е-lite: Express.js + Vanilla JS + PostgreSQL. Без фреймворков на фронтенде, минимум зависимостей.

```
[Браузер] → [Vanilla JS (9 страниц)] → [Express.js API (порт 3034)]
                                                ├── [PostgreSQL (схема opii)]
                                                ├── [QueueManager (контроль параллелизма)]
                                                ├── [ScenarioRunner (автономные сценарии)]
                                                ├── [Scheduler (планировщик, tick 30с)]
                                                └── [AI Process Runner (фоновые задачи)]

[Claude Code] → [MCP-сервер (kaizen)] → [Express.js API (порт 3034)]
                 48 инструментов             ↑ HTTP-клиент (api-client.js)
```

## Структура

```
kaizen/
├── CLAUDE.md                     # Контекст проекта (этот файл)
├── package.json                  # type: module, 3 зависимости
├── .env                          # DB credentials, PORT=3034
├── server/
│   ├── index.js                  # Express-сервер (порт 3034), JSON + static + init QueueManager/Scheduler
│   ├── ai-caller.js              # Универсальный AI caller (6 провайдеров + streaming)
│   ├── utils.js                  # parseJsonFromAI(), maskApiKey(), detectTestCommand()
│   ├── process-runner.js         # Фоновый исполнитель AI-процессов
│   ├── scenario-runner.js        # ScenarioRunner — движок выполнения сценариев (batch_develop, auto_release, nightly_audit, full_cycle)
│   ├── notifier.js               # Уведомления в Б24 через бота АФИИНА (im.message.add) + Telegram
│   ├── queue-manager.js          # QueueManager — контроль параллелизма по провайдерам
│   ├── scheduler.js              # Scheduler — планировщик (tick 30с): планы + cron-сценарии + автоматизация
│   ├── gitlab-client.js          # GitLab API клиент (push, pipeline status, wait)
│   ├── ci-generator.js           # Генерация .gitlab-ci.yml, Dockerfile, docker-compose.yml
│   ├── db/
│   │   ├── pool.js               # pg Pool (Supavisor)
│   │   ├── products.js           # getAll, getById, create, update, remove
│   │   ├── issues.js             # getByProduct, getById, create, update, remove
│   │   ├── releases.js           # getByProduct, getById, create, update, remove, publish, saveSpec, savePressRelease, updateDevInfo
│   │   ├── ai-models.js          # getAll, getById, create, update, remove, updateStatus
│   │   ├── processes.js          # getAll, getByProduct, getById, create, update, remove, getNextQueued, getQueuePosition
│   │   ├── process-logs.js       # getByProcess, create
│   │   ├── plans.js              # getAll, getByProduct, getById, create, update, updateStatus, remove
│   │   ├── plan-steps.js         # getByPlan, getById, create, bulkCreate, update, remove, getNextStep
│   │   ├── rc-tickets.js         # getByProduct, getById, getByRcTicketId, upsert, updateSyncStatus, countByProduct
│   │   ├── gitlab-issues.js     # getByProduct, getById, upsert, updateSyncStatus, countByProduct
│   │   ├── scenarios.js          # getAll, getByProduct, getById, create, update, remove, getDueScenarios, calcNextRun
│   │   └── scenario-runs.js     # getByScenario, getById, create, updateResult, getRunning
│   ├── rc-client.js              # MS SQL клиент для Rivc.Connect HelpDesk
│   ├── rc-sync.js                # Синхронизация и импорт тикетов RC → Kaizen
│   ├── gitlab-sync.js            # Синхронизация и импорт GitLab Issues → Kaizen
│   ├── smoke-tester.js           # Playwright smoke-тесты с автообнаружением страниц
│   └── routes/
│       └── api.js                # REST-эндпоинты
├── mcp-server/
│   ├── package.json              # MCP-сервер: @modelcontextprotocol/sdk
│   ├── index.js                  # 48 MCP-инструментов (kaizen_*) + конвейер + сценарии
│   └── api-client.js             # HTTP-клиент к REST API (localhost:3034)
├── database/
│   ├── exec-sql.js               # Утилита миграций
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_ai_models.sql
│       ├── 003_ai_models_api_key.sql
│       ├── 004_processes.sql     # Процессы + логи
│       ├── 005_processes_approved_count.sql
│       ├── 006_release_spec.sql
│       ├── 007_develop_release.sql
│       ├── 008_approved_indices.sql
│       ├── 009_product_rivc_connect.sql
│       ├── 010_press_release.sql
│       ├── 011_queue.sql           # Статус queued, priority, plan_step_id
│       ├── 012_plans.sql           # Таблицы планов и шагов
│       ├── 013_rc_tickets.sql      # RC-тикеты кэш + rc_ticket_id в issues
│       ├── 014_automation.sql       # Automation JSONB + pipeline поля
│       ├── 015_run_tests.sql        # model_id nullable (processes + plan_steps)
│       ├── 016_plan_templates.sql   # product_id nullable для шаблонов планов
│       ├── 017_deploy_config.sql    # deploy JSONB в products (GitLab CI/CD)
│       ├── 018_gitlab_issues.sql   # GitLab Issues кэш + gitlab_issue_id в issues
│       ├── 019_release_linear_status.sql  # Линейные статусы: draft→spec→developing→developed→published
│       ├── 020_gitlab_auto_sync.sql # last_gitlab_sync_at в products
│       ├── 021_process_config.sql   # JSONB config в processes
│       ├── 022_issue_labels.sql     # Labels JSONB в issues
│       ├── 023_scenarios.sql        # Таблицы сценариев и запусков
│       └── 024_model_base_url.sql   # base_url TEXT в kaizen_ai_models (кастомный API endpoint, напр. Ollama)
├── public/
│   ├── index.html                # Dashboard — обзор системы (8+ виджетов)
│   ├── products.html             # Список продуктов (карточки + сортировка)
│   ├── product.html              # Детали: задачи + релизы + процессы + автоматизация + деплой
│   ├── processes.html            # Все процессы (операционный центр)
│   ├── scenarios.html            # Сценарии (создание, управление, история запусков)
│   ├── plans.html                # Планы (legacy, скрыт из навигации)
│   ├── plan-edit.html            # Редактор плана (legacy)
│   ├── models.html               # Реестр AI-моделей
│   ├── roadmap.html              # Дорожная карта из документа
│   ├── css/style.css             # Dark theme
│   └── js/
│       ├── app.js                # api(), toast(), confirm(), escapeHtml(), notifyStatusChanges(), modal helpers
│       ├── dashboard.js          # Логика index.html (Dashboard виджеты, auto-refresh)
│       ├── products.js           # Логика products.html
│       ├── product.js            # Логика product.html + процессы + improve
│       ├── processes.js          # Логика processes.html (операционный центр, release_version)
│       ├── process-detail.js     # Общая логика отображения деталей процесса
│       ├── scenarios.js          # Логика scenarios.html (CRUD, запуск, редактирование, фильтры)
│       ├── plans.js              # Логика plans.html (legacy)
│       ├── plan-edit.js          # Логика plan-edit.html (legacy)
│       ├── roadmap.js            # Логика roadmap.html
│       └── models.js             # Логика models.html
└── docs/
    ├── MAIN_FUNC.md              # Функции и бенефиты
    ├── USER_GUIDE.md             # Руководство пользователя
    ├── RELEASE_NOTES.md          # История релизов
    ├── DATABASE_SCHEMA.md        # Схема БД
    ├── ANALYSIS_REPORT.md        # Глубокий анализ и сравнение с конкурентами
    └── BACKLOG.md                # Единый бэклог доработок
```

## Команды

```bash
npm run dev     # Development (node --watch-path=server)
npm start       # Production
npm test        # Тесты (node --test)

# Миграции
node database/exec-sql.js --file database/migrations/001_initial_schema.sql
```

## Стек

- **Runtime**: Node.js (ESM), Express 5.1
- **Frontend**: Vanilla JS + Custom CSS (dark theme)
- **БД**: PostgreSQL (Supabase via Supavisor, порт 8053)
- **Зависимости**: express, pg, dotenv
- **Порт**: 3034

## База данных

- **Схема**: `opii`
- **Префикс**: `kaizen_` (изоляция в общей схеме)
- **Таблицы**: kaizen_products, kaizen_issues, kaizen_releases, kaizen_release_issues, kaizen_ai_models, kaizen_processes, kaizen_process_logs, kaizen_plans, kaizen_plan_steps, kaizen_rc_tickets, kaizen_gitlab_issues, **kaizen_scenarios**, **kaizen_scenario_runs**
- **PK**: UUID (gen_random_uuid())
- **Каскадное удаление**: products → issues + releases + processes + plans; processes → process_logs; plans → plan_steps
- **Триггеры**: updated_at на products, issues, releases, processes, plans, plan_steps
- **Подключение**: `DB_HOST:DB_PORT/DB_NAME` через pg Pool

## API

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/products | Список (с open_issues count) |
| POST | /api/products | Создать |
| GET | /api/products/:id | По ID |
| PUT | /api/products/:id | Обновить |
| DELETE | /api/products/:id | Удалить (каскадно) |
| GET | /api/products/:id/issues | Задачи (?status=) |
| POST | /api/issues | Создать задачу (валидация: product_id, title) |
| POST | /api/issues/bulk | Массовое создание задач (до 100) |
| GET | /api/issues/:id | Задача по ID |
| PUT | /api/issues/:id | Обновить |
| DELETE | /api/issues/:id | Удалить |
| GET | /api/products/:id/releases | Релизы продукта |
| POST | /api/releases | Создать (с issue_ids[], принимает name или title) |
| GET | /api/releases/:id | С вложенными issues |
| PUT | /api/releases/:id | Обновить (add/remove issues) |
| DELETE | /api/releases/:id | Удалить (issues → open) |
| POST | /api/releases/:id/publish | Опубликовать (issues → done) |
| POST | /api/releases/:id/prepare-spec | Генерация спецификации (AI) |
| POST | /api/releases/:id/develop | Разработка релиза (claude-code) |
| GET | /api/releases/:id/spec | Спецификация релиза |
| POST | /api/releases/:id/prepare-press-release | Генерация пресс-релиза (AI) |
| GET | /api/releases/:id/press-release | Пресс-релиз |
| GET | /api/ai-models/discover | Автообнаружение (Ollama + MLX) |
| GET | /api/ai-models | Список (api_key маскирован) |
| POST | /api/ai-models | Создать модель |
| GET | /api/ai-models/:id | По ID |
| PUT | /api/ai-models/:id | Обновить |
| DELETE | /api/ai-models/:id | Удалить |
| POST | /api/ai-models/:id/warmup | Загрузить в GPU |
| GET | /api/improve-templates | 6 шаблонов промптов |
| GET | /api/processes | Все процессы (?status=, ?product_id=) |
| GET | /api/processes/:id | Детали процесса |
| POST | /api/processes | Создать + поставить в очередь (timeout_min) |
| GET | /api/processes/:id/logs | Логи процесса |
| POST | /api/processes/:id/approve | Утвердить предложения → создать issues (с approved_indices) |
| POST | /api/processes/:id/approve-roadmap | Утвердить дорожную карту → создать релизы + issues |
| POST | /api/processes/:id/restart | Перезапустить процесс (создаёт копию) |
| POST | /api/processes/:id/cancel | Отменить queued-процесс |
| POST | /api/processes/:id/approve-auto | Автоматическое утверждение по правилу (all/high_and_critical/critical_only) |
| POST | /api/processes/:id/approve-releases | Утвердить предложенные AI-релизы (form_release) |
| DELETE | /api/processes/:id | Удалить процесс + логи |
| GET | /api/products/:id/processes | Процессы конкретного продукта |
| GET | /api/rc/test | Проверить подключение к Rivc.Connect |
| GET | /api/rc/systems | Список систем RC |
| GET | /api/rc/systems/:id/modules | Модули системы RC |
| POST | /api/products/:id/rc-sync | Синхронизировать тикеты из RC |
| GET | /api/products/:id/rc-tickets | Кэшированные RC-тикеты продукта |
| GET | /api/rc-tickets/:id | Детали RC-тикета |
| POST | /api/rc-tickets/:id/import | Импортировать тикет → задача |
| POST | /api/rc-tickets/import-bulk | Массовый импорт тикетов |
| POST | /api/rc-tickets/:id/ignore | Игнорировать тикет |
| GET | /api/queue/stats | Статистика очереди по провайдерам |
| GET | /api/plans | Список планов (?status=) |
| GET | /api/products/:id/plans | Планы конкретного продукта |
| POST | /api/plans | Создать план |
| GET | /api/plans/:id | План с шагами |
| PUT | /api/plans/:id | Обновить метаданные плана |
| DELETE | /api/plans/:id | Удалить план |
| POST | /api/plans/:id/start | Запустить план немедленно |
| POST | /api/plans/:id/cancel | Отменить план |
| POST | /api/plans/:id/clone | Клонировать план |
| POST | /api/plans/:id/steps | Добавить шаг к плану |
| POST | /api/plans/:id/steps/bulk | Массовое добавление шагов |
| PUT | /api/plans/:id/steps/:stepId | Обновить шаг |
| DELETE | /api/plans/:id/steps/:stepId | Удалить шаг |
| POST | /api/plans/from-releases | Создать план spec→develop из списка release_ids |
| POST | /api/import-roadmap | Импорт roadmap: issues + releases + план за один вызов |
| POST | /api/notify | Отправить уведомление в Б24 (event_type, product_id, data) |
| POST | /api/products/:id/generate-ci | Сгенерировать .gitlab-ci.yml по настройкам продукта |
| POST | /api/products/:id/generate-dockerfile | Сгенерировать Dockerfile + docker-compose.yml |
| POST | /api/releases/:id/deploy | Запустить деплой релиза (мерж + push → GitLab CI/CD) |
| GET | /api/products/:id/pipeline-status | Статус GitLab CI/CD pipeline (?sha=) |
| GET | /api/scenarios | Список сценариев (?enabled=, ?product_id=) |
| GET | /api/products/:id/scenarios | Сценарии конкретного продукта |
| POST | /api/scenarios | Создать сценарий (name, preset, config, cron) |
| GET | /api/scenarios/:id | Детали сценария + последние 10 запусков |
| PUT | /api/scenarios/:id | Обновить сценарий |
| DELETE | /api/scenarios/:id | Удалить сценарий + историю |
| POST | /api/scenarios/:id/run | Запустить сценарий вручную |
| GET | /api/scenarios/:id/runs | История запусков (?limit=) |
| GET | /api/scenario-runs/:id | Детали запуска (статус, result, stages) |
| POST | /api/scenario-runs/:id/cancel | Отменить выполняющийся запуск |

## Бизнес-логика

- **Создание релиза**: issues из issue_ids[] → статус `in_release`
- **Публикация релиза**: релиз → `released`, released_at = now(), все issues → `done`
- **Удаление issue из релиза**: issue → `open`
- **Удаление релиза**: все issues → `open`, затем удаление
- **Каскадное удаление продукта**: ON DELETE CASCADE на FK
- **Очередь процессов (QueueManager)**: POST /processes ставит процесс в очередь. Контроль параллелизма по провайдерам: ollama:1, mlx:1, claude-code:2, kilo-code:1, anthropic:3, openai:3, google:3, local:3. Статусы: pending → queued → running → completed/failed. При завершении — автоматический запуск следующего queued-процесса (`FOR UPDATE SKIP LOCKED`). Восстановление состояния при перезапуске сервера. Frontend: badge «queued», позиция в очереди, кнопка отмены. Провайдер `local` — для процессов без AI-модели (run_tests, update_docs).
- **Планировщик (Scheduler)**: автоматический запуск цепочек AI-процессов. Шаги внутри плана выполняются **строго последовательно по step_order** (один за другим). Несколько планов могут выполняться параллельно. Тик 30с: активация scheduled планов (scheduled_at ≤ NOW()), запуск следующего шага через `getNextStep()` и QueueManager. Каждые 2 мин — `_runAutomation()`: RC auto-sync, GitLab auto-sync, auto-import по правилам. Обратная связь: при завершении процесса → обновление шага → запуск следующего. При ошибке: stop (план fails) или skip (пропустить шаг). Статусы плана: draft → scheduled → active → completed/failed/cancelled.
- **Автоматизация продуктов**: JSONB `automation` в products — per-product настройки rc_auto_sync (interval_hours, auto_import rules), gitlab_auto_sync (interval_hours, auto_import label_rules) и notifications (enabled, bitrix24_user_id, events[]). UI: таб «Автоматизация» на странице продукта.
- **Уведомления в Б24**: модуль `notifier.js` отправляет сообщения через бота АФИИНА (ID 1624) методом `im.message.add`. 7 типов событий (release_published, develop_completed/failed, rc_sync_done, gitlab_sync_done, scenario_completed/failed). BB-code форматирование. Интегрирован в process-runner, scheduler, scenario-runner, mcp-server. Per-product настройки через `automation.notifications`.
- **Асинхронные AI-процессы**: POST /processes создаёт запись + ставит в очередь QueueManager. Каждый шаг логируется (request_sent, response_received, parse_result, issues_ready, error). Frontend: polling 4с (активные) / 10с (покой), живая длительность для running-процессов.
- **Уведомления о статусах**: create/publish/remove релизов возвращают `status_changes`, фронтенд показывает toast-info с деталями
- **Утверждение предложений**: POST /processes/:id/approve с indices[] → создаёт issues, сохраняет approved_indices (повторное одобрение — disabled чекбоксы)
- **Перезапуск процесса**: POST /processes/:id/restart → создаёт копию и запускает заново
- **Генерация спецификации**: POST /releases/:id/prepare-spec → AI-процесс (standalone или claude-code)
- **Разработка релиза**: POST /releases/:id/develop → claude-code создаёт ветку, реализует задачи, запускает тесты. Стриминг NDJSON с промежуточными checkpoint-логами (6 фаз). Auto-publish: если `config.auto_publish === true` и тесты пройдены — автоматическая публикация. После коммита — автоматический push в GitLab (если deploy.gitlab настроен).
- **Деплой релиза**: POST /releases/:id/deploy → мерж ветки в default branch, push в GitLab, ожидание CI/CD pipeline. Тип процесса `deploy`, провайдер `local`. Авто-деплой при publish (если `deploy.auto_deploy.on_publish === true`).
- **GitLab-интеграция**: per-product JSONB `deploy` — GitLab URL/project_id/access_token, сервер деплоя (host/user/method), авто-деплой. Генерация `.gitlab-ci.yml`, `Dockerfile`, `docker-compose.yml` по стеку продукта. Два метода деплоя: `docker` (compose pull + up) и `native` (git pull + npm ci + pm2 restart). UI: таб «Деплой» на странице продукта.
- **Дорожная карта из документа**: POST /processes с type=roadmap_from_doc → парсит документ в релизы + задачи
- **Пресс-релиз**: POST /releases/:id/prepare-press-release → AI генерирует PR-материалы для 4 каналов (соцсети, сайт, Б24, СМИ)
- **Формирование релиза (AI)**: POST /processes с type=form_release → AI группирует открытые задачи в релизы. 4 стратегии (balanced, critical_first, by_topic, single). Авто-утверждение или ручной обзор предложения.
- **Тестирование (run_tests)**: Локальный процесс (без AI). Собирает ветки из depends_on develop_release шагов, создаёт интеграционную ветку, мержит последовательно, запускает тестовую команду проекта. model_id = null, провайдер `local`.
- **Документирование (update_docs)**: Локальный процесс. Аналогично run_tests собирает ветки, мержит, вызывает Claude Code с документационным промптом для обновления docs/ файлов.
- **Шаблоны планов**: Планы с `is_template=true` и `product_id=null`. Клонирование через POST /plans/:id/clone с product_id, автоматический ремаппинг depends_on UUID. 3 предустановленных шаблона: «Анализ продукта» (3 шага), «Полный цикл» (4 шага), «Ночная разработка» (8 шагов).
- **Сценарии (ScenarioRunner)**: автономные рабочие процессы = именованная конфигурация pipeline + расписание + история. 5 пресетов: `batch_develop` (spec→develop→[run_tests]→[update_docs]→[publish]→[deploy] для списка релизов), `auto_release` (form_release→spec→develop из open issues), `nightly_audit` (improve→approve для нескольких продуктов), `full_cycle` (полный конвейер), `analysis` (без разработки). Запуск: сейчас / отложенный (конкретная дата+время MSK) / по cron (регулярно). **Cron хранится и работает в MSK** (локальное время сервера) — никакой конвертации UTC. Cron-сценарии проверяются каждые 60с через scheduler `_runDueScenarios()`. Одноразовые сценарии (с конкретной датой в cron) автоматически отключаются после выполнения. История запусков: `kaizen_scenario_runs` (status, result.stages[], result.summary). Уведомления: `scenario_completed` / `scenario_failed` → Б24. UI: `/scenarios.html` — таблица, фильтры по типу, создание/редактирование с динамической формой, детальная карточка по клику.
- **Интеграция с Rivc.Connect**: MS SQL клиент → синхронизация тикетов HelpDesk → кэш в kaizen_rc_tickets → ручной/авто импорт в задачи (kaizen_issues) с сохранением rc_ticket_id
- **Интеграция с GitLab Issues**: синхронизация issues из GitLab → кэш в kaizen_gitlab_issues → ручной/авто импорт в задачи. Label→type/priority маппинг. MCP: `gitlab_sync`, `gitlab_list_issues`, `gitlab_import_issues`. Автосинхронизация через scheduler (`gitlab_auto_sync` в automation JSONB).
- **Маскировка api_key**: первые 4 + `****` + последние 4 символа в API-ответах
- **AI-провайдеры**: ollama (localhost:11434), mlx (localhost:8080), claude-code (CLI), anthropic, openai, google, local (без модели — для run_tests, update_docs, deploy). qwen-code и kilo-code поддерживают кастомный `base_url` для интеграции с Ollama. qwen-code с base_url → Ollama OpenAI-compat (--auth-type openai, OPENAI_BASE_URL)
- **claude-code провайдер**: два режима вызова CLI `claude`:
  - `callClaudeCode` (execFile, `--output-format text`) — для improve, prepare_spec и др. Буферизирует весь stdout.
  - `callClaudeCodeStreaming` (spawn, `--output-format stream-json`) — для develop_release. Парсит NDJSON-события на лету, детектирует контрольные точки (6 фаз: repo → study → implement → tests → test_run → commit), пишет промежуточные логи с `step: 'checkpoint'`.
  - Общее: удаляет `CLAUDE*` env vars, `child.stdin.end()`, `--` разделитель, `cwd = product.project_path`. API key не требуется. Таймаут 3-60 мин (по умолчанию 20 мин).

## Важные правила

- **Миграции**: SQL-файлы, применяются через `node database/exec-sql.js --file <path>`
- **Секреты**: `.env` не коммитится
- **Транзакции**: releases.create/update/remove/publish используют BEGIN/COMMIT/ROLLBACK
- **Префикс таблиц**: всегда `kaizen_` (в одной схеме с другими проектами)
- **Frontend**: Vanilla JS, ESM imports, без сборщиков

## MCP-сервер

- **Путь**: `mcp-server/` (отдельный package.json, `@modelcontextprotocol/sdk`)
- **Транспорт**: stdio (стандарт Claude Code)
- **API-клиент**: HTTP к `http://localhost:3034/api` (env `KAIZEN_API_URL`)
- **Подключение**: `~/.claude/settings.json` → `mcpServers.kaizen`
- **48 инструментов** с префиксом `kaizen_`:
  - Продукты: `list_products`, `get_product`
  - Задачи: `list_issues`, `create_issue`
  - Модели: `list_models`
  - AI-процессы: `improve_product`, `roadmap_from_doc`, `get_process`, `list_processes`, `wait_process`
  - Утверждение: `approve_suggestions`, `approve_roadmap`
  - Релизы: `list_releases`, `create_release`, `get_release`, `prepare_spec`, `get_spec`, `develop_release`, `publish_release`, `prepare_press_release`
  - Очередь: `queue_stats`
  - Планы (legacy): `list_plans`, `get_plan`, `create_plan`, `start_plan`, `cancel_plan`
  - **Сценарии**: `list_scenarios`, `get_scenario`, `create_scenario`, `update_scenario`, `run_scenario`, `get_scenario_run`, `delete_scenario`
  - RC: `rc_test`, `rc_sync`, `rc_list_tickets`, `rc_import_tickets`
  - GitLab Issues: `gitlab_sync`, `gitlab_list_issues`, `gitlab_import_issues`
  - Формирование релиза: `form_release`, `approve_releases`
  - Тестирование и документирование: `run_tests`, `update_docs`
  - Bulk-операции: `create_issues_bulk`, `create_plan_from_releases`, `import_roadmap`
  - Деплой: `deploy_release`, `deploy_status`, `generate_ci`
  - **Конвейер**: `run_pipeline` — полный сквозной цикл одной командой
- **kaizen_run_pipeline**: 5 базовых этапов (improve → approve → release → spec) + 3 опциональных (develop → publish → press_release). Пресеты: analysis (1-5), full_cycle (1-8), custom. Per-stage model_id (improve/spec/develop/press_release) с глобальным fallback. Авто-утверждение по правилам, polling статусов, auto-publish при успешных тестах
