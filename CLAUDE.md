# Kaizen — Контекст проекта

Kaizen (改善) — система непрерывного улучшения продуктов v1.6.0. Отслеживает продукты компании, собирает задачи на улучшение (включая асинхронную AI-генерацию через 6 провайдеров с логированием), формирует из них релизы с автоматическим управлением статусами. Поддерживает очередь процессов (QueueManager) с контролем параллелизма по провайдерам и планировщик (Scheduler) для автоматического запуска цепочек AI-процессов.

## Архитектура

Вариант Е-lite: Express.js + Vanilla JS + PostgreSQL. Без фреймворков на фронтенде, минимум зависимостей.

```
[Браузер] → [Vanilla JS (7 страниц)] → [Express.js API (порт 3034)]
                                                ├── [PostgreSQL (схема opii)]
                                                ├── [QueueManager (контроль параллелизма)]
                                                ├── [Scheduler (планировщик, tick 30с)]
                                                └── [AI Process Runner (фоновые задачи)]
```

## Структура

```
kaizen/
├── CLAUDE.md                     # Контекст проекта (этот файл)
├── README.md                     # Обзор, quickstart, статус
├── package.json                  # type: module, 3 зависимости
├── .env                          # DB credentials, PORT=3034
├── server/
│   ├── index.js                  # Express-сервер (порт 3034), JSON + static + init QueueManager/Scheduler
│   ├── ai-caller.js              # Универсальный AI caller (6 провайдеров + streaming)
│   ├── utils.js                  # parseJsonFromAI(), maskApiKey(), detectTestCommand()
│   ├── process-runner.js         # Фоновый исполнитель AI-процессов
│   ├── queue-manager.js          # QueueManager — контроль параллелизма по провайдерам
│   ├── scheduler.js              # Scheduler — планировщик выполнения планов (tick 30с)
│   ├── db/
│   │   ├── pool.js               # pg Pool (Supavisor)
│   │   ├── products.js           # getAll, getById, create, update, remove
│   │   ├── issues.js             # getByProduct, getById, create, update, remove
│   │   ├── releases.js           # getByProduct, getById, create, update, remove, publish, saveSpec, savePressRelease, updateDevInfo
│   │   ├── ai-models.js          # getAll, getById, create, update, remove, updateStatus
│   │   ├── processes.js          # getAll, getByProduct, getById, create, update, remove, getNextQueued, getQueuePosition
│   │   ├── process-logs.js       # getByProcess, create
│   │   ├── plans.js              # getAll, getByProduct, getById, create, update, updateStatus, remove
│   │   └── plan-steps.js         # getByPlan, getById, create, bulkCreate, update, remove, getReadySteps
│   └── routes/
│       └── api.js                # REST-эндпоинты
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
│       └── 012_plans.sql           # Таблицы планов и шагов
├── public/
│   ├── index.html                # Список продуктов (карточки)
│   ├── product.html              # Детали: задачи + релизы + процессы + планы
│   ├── processes.html            # Все процессы (глобальная страница)
│   ├── plans.html                # Все планы (глобальная страница)
│   ├── plan-edit.html            # Редактор плана (создание/редактирование шагов)
│   ├── models.html               # Реестр AI-моделей
│   ├── roadmap.html              # Дорожная карта из документа
│   ├── css/style.css             # Dark theme
│   └── js/
│       ├── app.js                # api(), toast(), confirm(), escapeHtml(), notifyStatusChanges(), modal helpers
│       ├── products.js           # Логика index.html
│       ├── product.js            # Логика product.html + процессы + improve + планы
│       ├── processes.js          # Логика processes.html + виджет очереди
│       ├── process-detail.js     # Общая логика отображения деталей процесса
│       ├── plans.js              # Логика plans.html
│       ├── plan-edit.js          # Логика plan-edit.html (CRUD шагов)
│       ├── roadmap.js            # Логика roadmap.html
│       └── models.js             # Логика models.html
└── docs/
    ├── MAIN_FUNC.md              # Функции и бенефиты
    ├── USER_GUIDE.md             # Руководство пользователя
    ├── RELEASE_NOTES.md          # История релизов
    ├── DATABASE_SCHEMA.md        # Схема БД
    ├── RELEASE_001_SPEC.md       # Спецификация MVP
    ├── RELEASE_SPEC_FEATURE.md   # Фича: генерация спецификаций
    ├── DEVELOP_RELEASE_FEATURE.md # Фича: разработка релизов (claude-code)
    └── ROADMAP_FROM_DOC_FEATURE.md # Фича: дорожная карта из документа
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
- **Таблицы**: kaizen_products, kaizen_issues, kaizen_releases, kaizen_release_issues, kaizen_ai_models, kaizen_processes, kaizen_process_logs, kaizen_plans, kaizen_plan_steps
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
| POST | /api/issues | Создать задачу |
| GET | /api/issues/:id | Задача по ID |
| PUT | /api/issues/:id | Обновить |
| DELETE | /api/issues/:id | Удалить |
| GET | /api/products/:id/releases | Релизы продукта |
| POST | /api/releases | Создать (с issue_ids[]) |
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
| DELETE | /api/processes/:id | Удалить процесс + логи |
| GET | /api/products/:id/processes | Процессы конкретного продукта |
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
| PUT | /api/plans/:id/steps/:stepId | Обновить шаг |
| DELETE | /api/plans/:id/steps/:stepId | Удалить шаг |

## Бизнес-логика

- **Создание релиза**: issues из issue_ids[] → статус `in_release`
- **Публикация релиза**: релиз → `released`, released_at = now(), все issues → `done`
- **Удаление issue из релиза**: issue → `open`
- **Удаление релиза**: все issues → `open`, затем удаление
- **Каскадное удаление продукта**: ON DELETE CASCADE на FK
- **Очередь процессов (QueueManager)**: POST /processes ставит процесс в очередь. Контроль параллелизма по провайдерам: ollama:1, mlx:1, claude-code:2, anthropic:3, openai:3, google:3. Статусы: pending → queued → running → completed/failed. При завершении — автоматический запуск следующего queued-процесса (`FOR UPDATE SKIP LOCKED`). Восстановление состояния при перезапуске сервера. Frontend: badge «queued», позиция в очереди, кнопка отмены.
- **Планировщик (Scheduler)**: автоматический запуск цепочек AI-процессов. Планы с шагами (depends_on для зависимостей). Тик 30с: активация scheduled планов (scheduled_at ≤ NOW()), поиск ready шагов, запуск через QueueManager. Обратная связь: при завершении процесса → обновление шага → проверка следующих. При ошибке: stop (план fails) или skip (пропустить шаг). Статусы плана: draft → scheduled → active → completed/failed/cancelled.
- **Асинхронные AI-процессы**: POST /processes создаёт запись + ставит в очередь QueueManager. Каждый шаг логируется (request_sent, response_received, parse_result, issues_ready, error). Frontend: polling 4с (активные) / 10с (покой), живая длительность для running-процессов.
- **Уведомления о статусах**: create/publish/remove релизов возвращают `status_changes`, фронтенд показывает toast-info с деталями
- **Утверждение предложений**: POST /processes/:id/approve с indices[] → создаёт issues, сохраняет approved_indices (повторное одобрение — disabled чекбоксы)
- **Перезапуск процесса**: POST /processes/:id/restart → создаёт копию и запускает заново
- **Генерация спецификации**: POST /releases/:id/prepare-spec → AI-процесс (standalone или claude-code)
- **Разработка релиза**: POST /releases/:id/develop → claude-code создаёт ветку, реализует задачи, запускает тесты. Стриминг NDJSON с промежуточными checkpoint-логами (7 фаз)
- **Дорожная карта из документа**: POST /processes с type=roadmap_from_doc → парсит документ в релизы + задачи
- **Пресс-релиз**: POST /releases/:id/prepare-press-release → AI генерирует PR-материалы для 4 каналов (соцсети, сайт, Б24, СМИ)
- **Маскировка api_key**: первые 4 + `****` + последние 4 символа в API-ответах
- **AI-провайдеры**: ollama (localhost:11434), mlx (localhost:8080), claude-code (CLI), anthropic, openai, google
- **claude-code провайдер**: два режима вызова CLI `claude`:
  - `callClaudeCode` (execFile, `--output-format text`) — для improve, prepare_spec и др. Буферизирует весь stdout.
  - `callClaudeCodeStreaming` (spawn, `--output-format stream-json`) — для develop_release. Парсит NDJSON-события на лету, детектирует контрольные точки (7 фаз: repo → study → implement → tests → test_run → docs → commit), пишет промежуточные логи с `step: 'checkpoint'`.
  - Общее: удаляет `CLAUDE*` env vars, `child.stdin.end()`, `--` разделитель, `cwd = product.project_path`. API key не требуется. Таймаут 3-60 мин (по умолчанию 20 мин).

## Важные правила

- **Миграции**: SQL-файлы, применяются через `node database/exec-sql.js --file <path>`
- **Секреты**: `.env` не коммитится
- **Транзакции**: releases.create/update/remove/publish используют BEGIN/COMMIT/ROLLBACK
- **Префикс таблиц**: всегда `kaizen_` (в одной схеме с другими проектами)
- **Frontend**: Vanilla JS, ESM imports, без сборщиков
