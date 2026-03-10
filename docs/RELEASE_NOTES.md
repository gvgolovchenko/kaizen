# Kaizen — История релизов

---

## v1.9.0 — Сквозной конвейер + Автоматизация продуктов (2026-03-10)

**Полный сквозной конвейер (improve → publish → press_release одной командой) + per-product автоматизация с гибкими настройками.**

### Сквозной конвейер (Этап 1 плана автоматизации)

- `kaizen_run_pipeline` расширен до 8 этапов: 5 базовых + 3 опциональных
  - Этап 6: `develop_release` — Claude Code реализует задачи (опциональный, `develop.enabled`)
  - Этап 7: auto-publish — автоматическая публикация при успешных тестах (`develop.auto_publish`)
  - Этап 8: `prepare_press_release` — генерация PR-материалов (опциональный, `press_release.enabled`)
- Auto-publish в `process-runner.js`: после `develop_release`, если `tests_passed && config.auto_publish` → `releases.publish()` + лог `auto_published`

### Endpoint approve-auto

- `POST /api/processes/:id/approve-auto` — утверждение предложений по правилу:
  - `all` — все предложения
  - `high_and_critical` — только high и critical приоритет
  - `critical_only` — только critical
- Исключает уже утверждённые (через `approved_indices`)
- Возвращает список созданных задач

### Автоматизация продуктов (Этап 2 плана автоматизации)

- JSONB-колонка `automation` в `kaizen_products` — per-product настройки
- **RC Auto-Sync**: автоматическая синхронизация тикетов из Rivc.Connect по расписанию
  - Настраиваемый интервал (1–720 часов)
  - Auto-import по правилам приоритетов (critical, high, medium)
- **Auto-Pipeline**: автоматический запуск полного конвейера
  - Триггер `threshold` — при накоплении N открытых задач
  - Триггер `schedule` — по расписанию (каждые N часов)
  - Триггер `on_sync` — после RC-синхронизации при новых тикетах
  - Настраиваемая конфигурация: модель, шаблон, правило утверждения, develop, press_release
  - Авто-инкремент версий (minor bump от последней)
- Scheduler расширен: `_runAutomation()` каждые 2 мин (4 тика по 30с)

### UI: таб «Автоматизация»

- Новый таб на странице продукта с полноценным интерфейсом настроек
- Toggle-секции: RC Auto-Sync, Auto-Import, Auto-Pipeline
- Выбор триггера, модели, шаблона, правил утверждения
- Доп. этапы: develop (auto-publish, test command), press-release (каналы, тональность)
- Сохранение в JSONB → восстановление при загрузке страницы

### API (1 новый эндпоинт)

- `POST /api/processes/:id/approve-auto` — автоматическое утверждение по правилу

### MCP-сервер

- `approveAuto()` метод в api-client.js
- `kaizen_run_pipeline` расширен новыми параметрами: `develop`, `press_release`

### База данных

- Миграция `014_automation.sql`:
  - Колонка `automation JSONB` в `kaizen_products`
  - Колонка `last_rc_sync_at TIMESTAMPTZ` в `kaizen_products`
  - Колонка `last_pipeline_at TIMESTAMPTZ` в `kaizen_products`

### Изменённые файлы

- `server/process-runner.js` — auto-publish после develop_release
- `server/routes/api.js` — endpoint approve-auto
- `server/scheduler.js` — _runAutomation(), _autoRcSync(), _autoPipeline(), _autoVersion()
- `server/rc-sync.js` — autoImportByRules()
- `server/db/products.js` — getWithAutomation(), automation в whitelist
- `mcp-server/index.js` — расширен kaizen_run_pipeline (этапы 6-8)
- `mcp-server/api-client.js` — approveAuto()
- `public/product.html` — таб «Автоматизация», панель настроек
- `public/js/product.js` — loadAutomationSettings(), handleSaveAutomation()

---

## v1.8.0 — Интеграция с Rivc.Connect + AI-формирование релизов (2026-03-09)

**Синхронизация тикетов из HelpDesk Rivc.Connect (MS SQL) и AI-формирование релизов из задач с 4 стратегиями группировки.**

### Интеграция с Rivc.Connect (HelpDesk)

- MS SQL клиент для подключения к БД Connect (`mssql` пакет)
- Синхронизация тикетов: MS SQL → кэш `kaizen_rc_tickets` (upsert по rc_ticket_id)
- Ручной импорт: RC-тикет → задача Kaizen (`kaizen_issues`) с сохранением `rc_ticket_id`
- Массовый импорт выбранных тикетов
- Игнорирование нерелевантных тикетов
- Вкладка «Тикеты RC» на странице продукта (таблица, фильтры, чекбоксы, модал деталей)
- Загрузка всех НЕ закрытых тикетов (12 статусов backlog)

### AI-формирование релизов (form_release)

- Новый тип AI-процесса `form_release` — группирует открытые задачи в релизы
- 4 стратегии группировки:
  - `balanced` — сбалансированные по объёму и приоритету (по умолчанию)
  - `critical_first` — критичные баги в первый релиз
  - `by_topic` — по функциональным областям
  - `single` — всё в один релиз
- Ручной режим: AI предлагает → пользователь просматривает → утверждает (с возможностью снять задачи)
- Авто-утверждение: AI предлагает → релизы создаются автоматически
- Модал настроек: стратегия, макс. релизов, модель, таймаут, чекбокс авто-утверждения
- Модал обзора: карточки предложенных релизов с чекбоксами задач, обоснование группировки

### API (11 новых эндпоинтов)

- `GET /api/rc/test` — проверка подключения к Rivc.Connect
- `GET /api/rc/systems` — список систем RC
- `GET /api/rc/systems/:id/modules` — модули системы
- `POST /api/products/:id/rc-sync` — синхронизация тикетов
- `GET /api/products/:id/rc-tickets` — кэшированные тикеты (?sync_status=)
- `GET /api/rc-tickets/:id` — детали тикета
- `POST /api/rc-tickets/:id/import` — импорт тикета → задача
- `POST /api/rc-tickets/import-bulk` — массовый импорт
- `POST /api/rc-tickets/:id/ignore` — игнорировать тикет
- `POST /api/processes` (type=form_release) — запуск AI-формирования
- `POST /api/processes/:id/approve-releases` — утверждение предложенных релизов

### База данных

- Миграция `013_rc_tickets.sql`:
  - Колонка `rc_ticket_id INTEGER` в `kaizen_issues`
  - Таблица `kaizen_rc_tickets` (кэш RC-тикетов, sync_status: new/imported/ignored)

### MCP-сервер (6 новых инструментов → 29 итого)

| Инструмент | Описание |
|------------|----------|
| `kaizen_rc_test` | Проверка подключения к Rivc.Connect |
| `kaizen_rc_sync` | Синхронизация тикетов продукта |
| `kaizen_rc_list_tickets` | Список кэшированных тикетов |
| `kaizen_rc_import_tickets` | Импорт тикетов → задачи |
| `kaizen_form_release` | AI-формирование релизов (strategy, auto_approve) |
| `kaizen_approve_releases` | Утверждение предложенных релизов |

### Новые серверные модули

- `server/rc-client.js` — MS SQL клиент (getSystems, getModules, getTickets)
- `server/rc-sync.js` — синхронизация и импорт (syncTickets, importTicket, importBulk)
- `server/db/rc-tickets.js` — CRUD для kaizen_rc_tickets

---

## v1.7.0 — MCP-сервер для Claude Code (2026-03-08)

**MCP-сервер с 27 инструментами для управления Kaizen через Claude Code. Полный конвейер улучшения продукта одной командой.**

### MCP-сервер (Model Context Protocol)

- 27 MCP-инструментов с префиксом `kaizen_` для программного управления системой
- Stdio-транспорт (стандарт Claude Code MCP)
- HTTP-клиент оборачивает существующий REST API — без дублирования логики
- Подключение через `~/.claude/settings.json` → `mcpServers.kaizen`

### Инструменты

| Категория | Инструменты |
|-----------|-------------|
| Продукты | `list_products`, `get_product` |
| Задачи | `list_issues`, `create_issue` |
| Модели | `list_models` |
| AI-процессы | `improve_product`, `roadmap_from_doc`, `get_process`, `list_processes`, `wait_process` |
| Утверждение | `approve_suggestions`, `approve_roadmap` |
| Релизы | `list_releases`, `create_release`, `get_release`, `prepare_spec`, `get_spec`, `develop_release`, `publish_release`, `prepare_press_release` |
| Очередь | `queue_stats` |
| Планы | `list_plans`, `get_plan`, `create_plan`, `start_plan`, `cancel_plan` |
| Конвейер | `run_pipeline` |

### kaizen_run_pipeline — полный конвейер

Запускает полный цикл улучшения одной командой:
1. AI-улучшение (improve) — генерация предложений
2. Ожидание завершения (polling 5с)
3. Автоматическое утверждение по правилам (`all`, `high_and_critical`, `critical_only`, `none`)
4. Создание релиза из утверждённых задач
5. Генерация спецификации (prepare_spec)

### Новые файлы

- `mcp-server/package.json` — пакет `kaizen-mcp-server`, зависимость `@modelcontextprotocol/sdk`
- `mcp-server/index.js` — MCP-сервер с 27 инструментами, Zod-валидация параметров
- `mcp-server/api-client.js` — HTTP-клиент ко всем эндпоинтам Kaizen API

### Документация

- `docs/ANALYSIS_REPORT.md` — глубокий анализ системы и сравнение с конкурентами

---

## v1.6.0 — Очередь процессов и планировщик (2026-03-04)

**QueueManager для контроля параллелизма AI-процессов по провайдерам + Scheduler для автоматического запуска цепочек процессов по расписанию.**

### Очередь процессов (QueueManager)

- Контроль параллелизма по AI-провайдерам: ollama:1, mlx:1, claude-code:2, anthropic:3, openai:3, google:3
- Новый статус `queued` — процесс ждёт свободный слот провайдера
- Приоритеты: 0 (normal), 1 (high), 2 (urgent)
- Автоматический запуск следующего queued-процесса при завершении текущего (`FOR UPDATE SKIP LOCKED`)
- Восстановление состояния при перезапуске сервера (`restoreFromDb()`)
- Виджет статистики очереди на странице процессов: `Ollama: 1/1 (2 ждут)`
- Badge «queued» + позиция в очереди + кнопка «Отменить»

### Планировщик (Scheduler)

- Планы с шагами — цепочки AI-процессов с зависимостями
- Каждый шаг: модель, тип процесса, промпт, таймаут, зависимости (depends_on)
- Тик каждые 30 секунд: активация scheduled планов, поиск готовых шагов, запуск через QueueManager
- При ошибке шага: `stop` (план fails) или `skip` (пропустить шаг, продолжить)
- Клонирование планов (шаблоны)
- Обратная связь: завершение процесса → обновление шага → проверка следующих шагов

### Новые страницы

- **plans.html** — глобальный список всех планов по всем продуктам
- **plan-edit.html** — редактор плана: название, описание, расписание, шаги с зависимостями
- Вкладка «Планы» на странице продукта — список планов с прогресс-баром

### API (14 новых эндпоинтов)

- `GET /api/queue/stats` — статистика очереди по провайдерам
- `POST /api/processes/:id/cancel` — отмена queued-процесса
- Планы: `GET/POST /api/plans`, `GET /api/products/:id/plans`, `GET/PUT/DELETE /api/plans/:id`
- Действия: `POST /api/plans/:id/start|cancel|clone`
- Шаги: `POST /api/plans/:id/steps`, `PUT/DELETE /api/plans/:id/steps/:stepId`

### База данных

- Миграция `011_queue.sql` — статус `queued`, `priority INTEGER`, `plan_step_id UUID`, частичный индекс
- Миграция `012_plans.sql` — таблицы `kaizen_plans` и `kaizen_plan_steps`, FK, индексы, триггеры updated_at

### Новые серверные модули

- `server/queue-manager.js` — QueueManager (singleton), контроль параллелизма
- `server/scheduler.js` — Scheduler (singleton), планировщик с тиком 30с
- `server/db/plans.js` — CRUD для kaizen_plans
- `server/db/plan-steps.js` — CRUD для kaizen_plan_steps

---

## v1.5.0 — Промежуточное логирование develop_release (2026-03-02)

**Стриминг событий Claude Code и визуальный степпер контрольных точек для процесса разработки релизов.**

### Стриминг вместо буферизации

- Новая функция `callClaudeCodeStreaming()` в `ai-caller.js` — использует `spawn` + `--output-format stream-json` вместо `execFile` + `--output-format text`
- NDJSON-события парсятся на лету через `readline`, callback `onEvent` вызывается для каждого события
- Старая `callClaudeCode()` сохранена для обратной совместимости (используется остальными процессами)

### Контрольные точки (checkpoints)

- State machine в `process-runner.js` детектирует 7 фаз разработки по инструментам Claude Code:
  - `repo` — git checkout/pull
  - `study` — Read/Glob/Grep (изучение кода)
  - `implement` — первое появление Write/Edit
  - `tests` — Write/Edit в `*.test.*` / `*.spec.*`
  - `test_run` — Bash с тест-командой (npm test, vitest, jest)
  - `docs` — Write/Edit в `docs/`
  - `commit` — Bash с git commit/push
- Фазы продвигаются только вперёд (не откатываются)
- При каждой смене фазы создаётся лог в `kaizen_process_logs` с `step: 'checkpoint'`

### Визуальный степпер

- В модале деталей `develop_release` процесса отображается степпер из 7 фаз
- Пройденные фазы — зелёные с галочкой
- Текущая фаза — фиолетовая с анимацией пульсации
- Будущие фазы — серые
- Время прохождения каждой фазы отображается справа
- Обновляется автоматически при поллинге (каждые 4с)
- Обратная совместимость: для старых процессов без checkpoint-логов степпер не показывается

### Файлы

- `server/ai-caller.js` — добавлена `callClaudeCodeStreaming()` (spawn + readline + NDJSON)
- `server/process-runner.js` — `createCheckpointTracker()`, интеграция в `runDevelopRelease()`
- `public/js/process-detail.js` — `renderCheckpointStepper()`, фильтрация checkpoint-логов
- `public/css/style.css` — стили `.checkpoint-stepper`, `.checkpoint-item`, анимация `checkpointPulse`

---

## v1.4.0 — Пресс-релизы (2026-03-02)

**Генерация PR-материалов для опубликованных релизов по 4 каналам: соцсети, сайт, Битрикс24, СМИ.**

### Новый процесс: prepare_press_release

- AI генерирует PR-материалы для выбранных каналов (ВК, Telegram, сайт, Б24, СМИ)
- Настройка тональности (официальная / дружелюбная / техническая / маркетинговая)
- Выбор целевой аудитории (сотрудники, клиенты, техсообщество, широкая аудитория)
- Промпты для генерации изображений и список необходимых скриншотов
- Модал просмотра с табами по каналам, копирование, скачивание `.md`

### API

- `POST /releases/:id/prepare-press-release` — запуск генерации пресс-релиза
- `GET /releases/:id/press-release` — получение пресс-релиза

### База данных

- Миграция `010_press_release.sql` — колонка `press_release JSONB` в kaizen_releases

### Интерфейс

- Кнопка «Пресс-релиз» на карточке опубликованного релиза
- Модал настроек: каналы, тональность, аудитория, промпты для изображений, ключевые акценты
- Модал просмотра: табы по каналам (Соцсети / Сайт / Битрикс24 / СМИ / Изображения)
- Копирование текста канала в буфер, скачивание всех каналов как `.md`

---

## v1.3.1 — Интеграция с Rivc.Connect (2026-03-02)

**Привязка продуктов к HelpDesk-системе Rivc.Connect через числовые идентификаторы.**

### Продукты — поля Rivc.Connect

- Новые необязательные поля: **ID системы** (`rc_system_id`) и **ID модуля** (`rc_module_id`)
- Отображение в мета-блоке на странице продукта: `RC: система 42 / модуль 15`
- Поддержка в формах создания и редактирования продукта

### База данных

- Миграция `009_product_rivc_connect.sql` — колонки `rc_system_id INTEGER`, `rc_module_id INTEGER`

---

## v1.3.0 — Уведомления о статусах, перезапуск процессов, approved_indices (2026-03-02)

**Повышение прозрачности автоматических изменений статусов, возможность перезапуска процессов и отслеживание одобренных предложений.**

### Уведомления об изменении статусов

- При создании релиза — toast-info с количеством задач, переведённых в `in_release`
- При публикации релиза — toast-info о переходе релиза в `released` и задач в `done`
- При удалении релиза — toast-info с количеством задач, возвращённых в `open`
- При утверждении AI-предложений — toast-info о количестве созданных задач
- Расширенный формат: заголовок + детали (синий toast #1e40af, 5 секунд)

### Перезапуск процессов

- Новый endpoint `POST /api/processes/:id/restart` — создаёт копию процесса и запускает заново
- Кнопка «Перезапустить» в модале деталей failed-процессов
- Доступно на обеих страницах (product.js, processes.js)

### Отслеживание одобренных предложений (approved_indices)

- Endpoint approve сохраняет `approved_indices` — массив индексов уже одобренных предложений
- При повторном открытии completed-процесса ранее одобренные предложения отображаются disabled с меткой «создана»
- Кнопки «Выбрать все / Снять все» игнорируют disabled чекбоксы
- Миграция `008_approved_indices.sql` — колонка `approved_indices` jsonb

### Backend

- `releases.create()`, `update()`, `remove()`, `publish()` — возвращают `status_changes`
- Эндпоинты релизов передают `status_changes` в ответ
- `processes.update()` — whitelist расширен: `approved_indices`
- `--watch-path=server` в package.json (вместо `--watch`)

### Рефакторинг: модуль process-detail.js

- Создан `public/js/process-detail.js` — общий модуль отображения деталей процесса
- Вынесены: `formatDuration`, `renderProcessDetailHtml`, `toggleAllSuggestions`, `updateApproveCount`, `approveProcess`
- Устранено дублирование между `product.js` и `processes.js`
- Различия параметризованы через `options` (showProductName, showSpecLink, showDevResult, excludeTypes)

### Интерфейс

- `notifyStatusChanges()` в `app.js` — расширенные toast с заголовком и деталями
- CSS-стили: `.toast-info`, `.toast-title`, `.toast-detail`

---

## v1.2.0 — AI-процессы, спецификации, разработка, дорожные карты (2026-03-01)

**Расширение AI-возможностей: генерация спецификаций, автоматическая разработка релизов, дорожные карты из документов.**

### Новые типы AI-процессов

- **prepare_spec** — генерация спецификации релиза (standalone или claude-code)
- **develop_release** — автоматическая разработка релиза через claude-code CLI (ветка, код, тесты)
- **roadmap_from_doc** — парсинг документа в дорожную карту (релизы + задачи)

### Backend / API

- `POST /releases/:id/prepare-spec` — запуск генерации спецификации
- `POST /releases/:id/develop` — запуск разработки релиза
- `GET /releases/:id/spec` — получение спецификации
- `POST /processes/:id/approve-roadmap` — утверждение дорожной карты
- claude-code провайдер в `ai-caller.js`
- `process-runner.js` — обработка всех типов процессов

### Интерфейс

- Страница «Процессы» (`/processes.html`) — глобальный список всех AI-процессов
- Страница «Дорожная карта» (`/roadmap.html`) — просмотр и утверждение
- Модалы: подготовка спецификации, просмотр спецификации, запуск разработки
- Dev-статус на карточках релизов (running/done/failed)

### База данных

- Миграции 004–007: processes, approved_count, release_spec, develop_release

---

## v1.1.0 — Модели ИИ и улучшение продукта (2026-02-28)

**AI-генерация задач и управление моделями ИИ.**

### Новые модули

- **Модели ИИ** — реестр AI-моделей с поддержкой 5 провайдеров (ollama, mlx, anthropic, openai, google), автообнаружение локальных моделей (discover), загрузка в GPU (warmup), хранение API-ключей с маскировкой
- **Улучшение продукта** — AI-генерация задач: 6 шаблонов промптов, выбор модели и количества задач, обзор и утверждение предложений

### Интерфейс

- Страница «Модели ИИ» (`/models.html`) — таблица моделей, форма создания/редактирования, discover локальных моделей, warmup, поле API Key для облачных провайдеров
- Навигационная панель на всех страницах (Продукты / Модели ИИ)
- Модал «Улучшение продукта» на странице продукта — 3 фазы: форма → загрузка (спиннер) → обзор предложений с чекбоксами

### Backend / API

- Новый модуль `ai-caller.js` — унифицированный вызов 5 AI-провайдеров через нативный fetch
- 6 новых эндпоинтов для моделей ИИ (CRUD, discover, warmup)
- 3 новых эндпоинта для улучшений (templates, improve, approve)
- Маскировка API-ключей в ответах API (`sk-a****cdef`)
- Итого: 22 эндпоинта (было 13)

### База данных

- Миграция `002_ai_models.sql` — таблица `kaizen_ai_models`
- Миграция `003_ai_models_api_key.sql` — колонка `api_key`

### Шаблоны промптов

| Шаблон | Описание |
|--------|----------|
| Общие улучшения | UX, функциональность, стабильность, масштабируемость |
| Улучшения UI | Навигация, визуальный дизайн, адаптивность, доступность |
| Производительность | Оптимизация загрузки, кэширование, задержки, запросы |
| Безопасность | Аутентификация, авторизация, защита данных, OWASP |
| Анализ конкурентов | Конкурентный паритет, недостающие функции |
| Developer Experience | Документация, CI/CD, тестирование, линтинг, DX |

---

## v1.0.0 — MVP (2026-02-28)

**Первый релиз. Базовая функциональность управления продуктами, задачами и релизами.**

### Новые модули

- **Продукты** — реестр продуктов компании с CRUD, архивированием, полем пути к проекту
- **Задачи (Issues)** — задачи привязаны к продуктам, типизация (bug/improvement/feature), приоритеты (critical/high/medium/low), фильтрация по статусу
- **Релизы** — формирование релизов из открытых задач, публикация с автоматическим управлением статусами

### Интерфейс

- Dark theme с CSS variables
- 2 страницы: список продуктов (карточки) + детали продукта (задачи + релизы)
- Модальные окна для создания/редактирования
- Toast-уведомления
- Диалоги подтверждения удаления

### Backend / API

- Express.js 5.1, ESM modules
- REST API: 13 эндпоинтов (Products, Issues, Releases)
- PostgreSQL через pg Pool (схема `opii`)

### База данных

- Миграция: `001_initial_schema.sql`
- Таблицы: `kaizen_products`, `kaizen_issues`, `kaizen_releases`, `kaizen_release_issues`
- Триггеры `updated_at` для всех основных таблиц
- Индексы по `product_id` и `status`

---

## Планируемые улучшения

- Условные переходы в планах (on_success, on_failure, on_condition)
- Webhook-система при ключевых событиях (release published, pipeline failed)
- Интеграция с Битрикс24 (автопост при публикации релиза)
- AI-приоритизация очереди, авто-ретрай с анализом ошибок
- Метрики и дашборд (время цикла, success rate)
- Docker-деплой (Dockerfile + nginx)
- WebSocket для real-time обновлений процессов (вместо polling)
