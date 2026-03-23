# Kaizen — История релизов

---

## v1.16.0 — GitLab Issues Sync + MCP-инструменты (2026-03-18)

**Синхронизация issues из GitLab, 3 новых MCP-инструмента, автосинхронизация в scheduler.**

### GitLab Issues — MCP-инструменты

- `kaizen_gitlab_sync` — синхронизировать issues из GitLab → локальный кэш
- `kaizen_gitlab_list_issues` — список кэшированных GitLab issues (с фильтром sync_status)
- `kaizen_gitlab_import_issues` — импортировать GitLab issues → задачи Kaizen

### Автосинхронизация GitLab Issues (Scheduler)

- Новый метод `_autoGitlabSync()` — полный аналог `_autoRcSync()`
- Настройка: `automation.gitlab_auto_sync` (enabled, interval_hours, auto_import.label_rules)
- Уведомления в Б24 (`gitlab_sync_done`)
- Триггер auto_pipeline при `trigger: "on_sync"`

### БД и API

- Миграция `020_gitlab_auto_sync.sql` — поле `last_gitlab_sync_at` в products
- `products.update()` — поддержка `last_gitlab_sync_at`
- `getWithAutomation()` — учитывает `gitlab_auto_sync.enabled`
- 5 функций в api-client.js: `gitlabSync`, `gitlabListIssues`, `gitlabImportBulk`, `gitlabImportIssue`, `gitlabIgnoreIssue`

---

## v1.15.0 — Линейные статусы релизов, комплексная проверка, UI Polish (2026-03-18)

**Упрощение жизненного цикла релизов, новый тип процесса validate_product, автоматическая проверка сборки, улучшения UI.**

### Линейные статусы релизов (миграция 019)

- Единый статус вместо двух полей (status + dev_status): `draft → spec → developing → developed → failed → published`
- Кнопка «Опубликовать» появляется только для `developed` (код готов, тесты прошли)
- Русские метки статусов: Черновик, Спецификация, Разработка, Готов, Ошибка, Опубликован
- `saveSpec()` автоматически переводит `draft → spec`
- `updateDevInfo()` синхронизирует dev_status с линейным status
- Dashboard: виджет релизов показывает черновики / готовы / опубликованы

### Комплексная проверка продукта (validate_product)

- Новый тип процесса: git pull → lint → build → tests → smoke → AI review
- 5 проверок (чекбоксы): сборка, юнит-тесты, smoke-тест (Playwright), lint, AI code review
- AI-анализ (опционально): подключение Ollama/Anthropic/Claude для code review и поиска уязвимостей
- Провайдер `local` (без AI) или с моделью из реестра
- `POST /products/:id/validate` — удобный API endpoint
- `detectLintCommand()` — автоопределение lint для Node.js, Python, Go, .NET, Rust
- UI: кнопка «Проверить» на странице продукта + модал с чекбоксами и выбором модели

### validate_build

- Автоматическая проверка сборки (`npm run build` / `dotnet build`) после develop_release
- Шаг 10b между парсингом результата и GitLab push
- Если build failed → `tests_passed = false`, процесс не авто-публикуется

### UI Polish

- Фильтр задач по приоритету: цветные chips (Critical/High/Medium/Low) вместо select
- Скелетоны загрузки (shimmer-анимация) для Dashboard и Процессов
- Человекочитаемые ошибки: 11 паттернов (ETIMEDOUT → «Превышено время ожидания»)
- Chart.js: интерактивный stacked bar chart на Dashboard (published/developed/прочие)
- Компактный Dashboard: помещается в 1 экран (viewport 900px)
- Табы продукта: compact, no-wrap, horizontal scroll
- ТОП-5 продуктов: сортировка по реальной активности (процессы и релизы за 7 дней)
- Динамика релизов: по `updated_at` вместо `created_at`

### API

- `POST /products/:id/validate` — запуск комплексной проверки

### БД (миграция 019)

- `019_release_linear_status.sql`: миграция данных из status+dev_status в единый линейный status

---

## v1.14.0 — Smoke-тесты, GitLab Issues, операционный центр, Develop UX (2026-03-16)

**Smoke-тесты Playwright с автообнаружением, интеграция с GitLab Issues, переработка страницы процессов, git diff/MR/rollback из UI.**

### Smoke-тесты (Playwright)

- Встроенные smoke-тесты после каждого `develop_release` — Playwright headless проверяет страницы
- **Автообнаружение**: Kaizen сам находит страницы проекта (Nuxt pages/, Vue router, HTML файлы), dev-команду и порт
- Конфиг автоматически сохраняется в продукт (`smoke_test` JSONB) после первого прогона
- Проверки: HTTP 200, отсутствие JS-ошибок в консоли, страница не пустая
- UI: toggle + настройки в табе «Деплой» на странице продукта
- Если smoke провален → `tests_passed = false`, процесс не авто-публикуется

### GitLab Issues интеграция

- Синхронизация issues из GitLab API → кэш `kaizen_gitlab_issues`
- Импорт в задачи Kaizen с маппингом labels → type/priority (bug, feature, critical, high...)
- Массовый импорт и игнорирование
- UI: таб «GitLab Issues» на странице продукта (появляется при настроенном `deploy.gitlab`)
- Миграция 018: таблица `kaizen_gitlab_issues`, колонка `gitlab_issue_id` в issues

### Операционный центр процессов

- Страница `/processes.html` полностью переработана из плоской таблицы в 4 секции:
  - **Сводка** (4 плитки): выполняются / в очереди / завершено / ошибки
  - **Активные**: карточки с live-таймером (обновление каждую секунду)
  - **В очереди**: карточки с кнопкой «Отменить»
  - **Требуют внимания**: failed-карточки с ошибкой и кнопкой «Перезапустить»
  - **История**: компактная таблица с пагинацией (20/стр) и фильтрами (тип, продукт, период)
- Индикация зависших процессов: пороги по типам, предупреждение «возможно завис»
- Кнопка «Удалить» убрана из списка (только в модале деталей)

### Develop Release UX

- `GET /releases/:id/diff` — git diff между веткой и main (stat, файлы, полный diff)
- `POST /releases/:id/create-mr` — создание Merge Request в GitLab
- `POST /releases/:id/rollback` — удаление ветки, сброс dev_status
- Автоматические git-теги `v{version}` при публикации релиза + push в GitLab
- UI: кнопки «Diff», «MR», «Откатить» на карточках релизов с dev_branch

### Markdown рендеринг

- Спецификации отображаются через `marked.js` вместо plain text `<pre>`
- CSS стили `.markdown-body` для заголовков, списков, таблиц, code blocks

### API (10+ новых эндпоинтов)

- `POST /products/:id/gitlab-sync`
- `GET /products/:id/gitlab-issues`
- `GET /gitlab-issues/:id`
- `POST /gitlab-issues/:id/import`
- `POST /gitlab-issues/import-bulk`
- `POST /gitlab-issues/:id/ignore`
- `GET /releases/:id/diff`
- `POST /releases/:id/rollback`
- `POST /releases/:id/create-mr`

### БД (миграция 018)

- `018_gitlab_issues.sql`: таблица `kaizen_gitlab_issues`, колонка `gitlab_issue_id` в issues

### Новые файлы

- `server/smoke-tester.js` — Playwright smoke-тесты с автообнаружением
- `server/gitlab-sync.js` — синхронизация/импорт GitLab Issues
- `server/db/gitlab-issues.js` — CRUD для кэша GitLab Issues
- `public/js/dashboard.js` — логика Dashboard
- `public/products.html` — страница списка продуктов
- `database/migrations/018_gitlab_issues.sql`

---

## v1.13.0 — Dashboard — Главная страница (2026-03-14)

**Полноценная главная страница с обзорной аналитикой. Список продуктов переехал на отдельную страницу `/products.html`.**

### Dashboard (`/`)

- Главная страница переделана из списка продуктов в полноценный Dashboard с 3 секциями и 8+ виджетами
- **Секция «Сводка»** (5 виджетов): Продукты, Задачи, Процессы, Релизы, Планы — ключевые метрики с stacked bars и badges
- **Секция «Детали»** (3 виджета): ТОП-5 продуктов по активности, CSS bar chart динамики релизов (8 недель), лента активности (10 последних событий)
- **Секция «Здоровье»** (2 виджета): автоматизация (pipeline/RC-sync), процессы по типам, задачи по типам и приоритетам (horizontal bars)
- Auto-refresh каждые 30с при наличии running/queued процессов
- Кликабельные виджеты — переход на соответствующие страницы

### Страница продуктов (`/products.html`)

- Новая отдельная страница для списка продуктов (карточки + сортировка + модал создания/редактирования)
- Используется существующий `products.js` — без дублирования логики

### Расширенный API Dashboard

- `GET /api/dashboard` расширен новыми подзапросами:
  - `products`: `archived`, `by_status`, `recent` (5 последних), `top_active` (ТОП-5)
  - `issues`: `by_type`, `by_priority`, `created_this_week`, `closed_this_week`
  - `processes`: `by_type`, `avg_duration_ms`, `success_rate`, `completed_this_week`
  - `releases`: `this_month`, `velocity` (релизы по неделям за 8 недель)
  - `plans`: `active`, `completed`, `templates` — новая секция
  - `automation`: `products_with_pipeline`, `products_with_rc_sync`, `last_pipeline_runs` — новая секция

### Навбар

- Обновлён на всех 8 страницах: **Главная | Продукты | Процессы | Планы | Модели ИИ**
- `app.js`: обновлён `navMap`, горячие клавиши (`g+h` → Главная, `g+p` → Продукты)

### CSS

- Новые стили: `.dashboard-summary` (5-колоночный grid), `.dashboard-details` (3-колоночный), `.dashboard-health` (2-колоночный)
- `.widget-clickable`, `.bar-chart`, `.health-bar-row`, `.success-rate`, `.duration-badge`, `.mini-table`
- Responsive breakpoints: 5→3→1 колонки на разных размерах экрана

### Новые файлы

- `public/products.html` — страница списка продуктов
- `public/js/dashboard.js` — логика Dashboard (loadDashboard, renderSummary, renderDetails, renderHealth)

### Изменённые файлы

- `server/db/dashboard.js` — расширен getStats() (12 новых подзапросов)
- `public/index.html` — полная переработка → Dashboard
- `public/js/products.js` — убрана встроенная логика дашборда
- `public/js/app.js` — обновлён navMap, shortcuts
- `public/css/style.css` — +180 строк стилей для Dashboard
- Все HTML файлы — обновлён навбар

---

## v1.12.0 — Деплой через GitLab CI/CD (2026-03-14)

**Per-product настройки деплоя, автоматический push в GitLab после разработки, тип процесса deploy, генерация CI/CD файлов.**

### GitLab-интеграция

- Per-product JSONB `deploy` в kaizen_products — GitLab URL, project_id, access_token, remote_url, default_branch
- Автоматический push ветки в GitLab после develop_release (если deploy.gitlab настроен)
- Модуль `server/gitlab-client.js` — push, pipeline status, wait for pipeline
- Аутентификация через OAuth2 access token в URL

### Deploy как тип процесса

- Новый тип процесса `deploy` — мерж ветки в default branch, push в GitLab, ожидание CI/CD pipeline
- Провайдер `local` (без AI-модели), лимит 3 в QueueManager
- Логирование шагов: deploy_started → gitlab_pushed → pipeline_waiting → pipeline_result
- Уведомления: deploy_completed / deploy_failed

### Авто-деплой при публикации

- `deploy.auto_deploy.on_publish === true` → при `POST /releases/:id/publish` автоматически создаётся процесс deploy
- Мерж ветки релиза в default branch → push → GitLab CI/CD pipeline

### Генерация CI/CD файлов

- `POST /api/products/:id/generate-ci` — генерация `.gitlab-ci.yml` по стеку и методу деплоя
- `POST /api/products/:id/generate-dockerfile` — генерация `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- Два метода: `docker` (compose pull + up) и `native` (git pull + npm ci + pm2 restart)
- Модуль `server/ci-generator.js` — шаблоны по стеку (Node.js, .NET, PHP)

### UI: таб «Деплой»

- Секция «GitLab» — URL, project ID, remote URL, default branch, access token
- Секция «Сервер деплоя» — хост, порт SSH, пользователь, метод (docker/native), пути
- Чекбокс «Авто-деплой при публикации релиза»
- Кнопки генерации .gitlab-ci.yml и Dockerfile с предпросмотром

### MCP-сервер (35 → 38 инструментов)

- `kaizen_deploy_release` — запустить деплой релиза
- `kaizen_deploy_status` — статус GitLab CI/CD pipeline
- `kaizen_generate_ci` — сгенерировать .gitlab-ci.yml + Dockerfile

### API (4 новых эндпоинта)

- `POST /api/products/:id/generate-ci`
- `POST /api/products/:id/generate-dockerfile`
- `POST /api/releases/:id/deploy`
- `GET /api/products/:id/pipeline-status?sha=`

### БД (миграция 017)

- `017_deploy_config.sql`: колонка `deploy JSONB DEFAULT '{}'` в kaizen_products

---

## v1.11.1 — Последовательное выполнение шагов плана (2026-03-14)

**Шаги внутри одного плана теперь выполняются строго последовательно по step_order. Несколько планов могут выполняться параллельно.**

### Изменения

- `plan-steps.js`: `getReadySteps()` → `getNextStep(planId, onFailure)` — возвращает один следующий pending-шаг по step_order; если текущий шаг ещё `running` — возвращает null
- `scheduler.js`: убрана дублирующая inline-фильтрация ready-шагов, используется единый `getNextStep()`
- Исправлено: `getNextStep()` корректно учитывает `on_failure === 'skip'` (ранее `getReadySteps` не учитывал)

### Документация

- Актуализирован `ANALYSIS_REPORT.md` до v1.11.0 (было v1.6.0)
- Актуализирован `DATABASE_SCHEMA.md` — добавлены миграции 015–016, nullable поля
- Создан единый `BACKLOG.md` (56 пунктов, ~158.5ч) из DEVELOP_QUALITY_REPORT + устаревших спек
- Удалены 7 устаревших документов (реализованные спецификации фич)

---

## v1.11.0 — Шаблоны планов + Тестирование + Документирование (2026-03-13)

**Шаблоны планов для переиспользования, интеграционное тестирование (run_tests) и автодокументирование (update_docs) как отдельные шаги в планах автоматизации.**

### Шаблоны планов

- Планы с `is_template=true` и `product_id=null` — переиспользуемые шаблоны
- Клонирование через `POST /plans/:id/clone` с указанием `product_id`
- Автоматический ремаппинг `depends_on` UUID при клонировании
- 3 предустановленных шаблона:
  - **Анализ продукта** (3 шага): improve → form_release → prepare_spec
  - **Полный цикл** (4 шага): prepare_spec → develop_release → run_tests → update_docs
  - **Ночная разработка** (8 шагов): (spec → develop) ×3 → run_tests → update_docs
- UI: фильтр «Шаблоны» на странице планов, кнопка клонирования с выбором продукта

### Тестирование (run_tests)

- Новый тип процесса: `run_tests` — локальный процесс без AI-модели
- Собирает ветки из зависимых шагов `develop_release` (depends_on)
- Создаёт интеграционную ветку, последовательно мержит ветки разработки
- Запускает тестовую команду проекта (автоопределение: npm test, pytest и т.д.)
- Парсит результаты: passed/failed/skipped
- Провайдер `local` в QueueManager (лимит: 3)

### Документирование (update_docs)

- Новый тип процесса: `update_docs` — локальный процесс
- Аналогично `run_tests` собирает и мержит ветки из depends_on
- Вызывает Claude Code с документационным промптом
- Обновляет README.md, RELEASE_NOTES.md, USER_GUIDE.md и другие docs/ файлы
- Шаг документации удалён из develop_release — выделен в отдельный процесс для надёжности

### Устойчивость JSON-парсинга

- `parseJsonFromAI()` в utils.js: поиск всех `{...}` блоков вместо первого
- Предпочтение объектов с ключами develop_release (branch, commit_hash, tests_passed)
- Git fallback в process-runner: извлечение результатов из git при неудаче парсинга

### БД (миграции 015–016)

- `015_run_tests.sql`: `model_id` nullable в processes и plan_steps
- `016_plan_templates.sql`: `product_id` nullable в plans для шаблонов

### MCP-сервер (33 → 35 инструментов)

- `kaizen_run_tests` — запуск тестирования
- `kaizen_update_docs` — запуск документирования
- Обновлены enum типов процессов: добавлены form_release, run_tests, update_docs

### UI

- Новые типы шагов в редакторе плана: «Формирование релиза», «Тестирование», «Документирование»
- Скрытие полей «Модель» и «Количество задач» для run_tests/update_docs
- Отображение «Локальный» для шагов без model_id
- Фильтр «Шаблоны» на странице планов, клонирование с диалогом выбора продукта

### Изменённые файлы

- `server/process-runner.js` — `runTests()`, `runUpdateDocs()`, `gitFallback()`, убран step docs из develop_release
- `server/utils.js` — улучшенный parseJsonFromAI (все {} блоки, prefer develop_release keys)
- `server/queue-manager.js` — провайдер `local` (лимит 3), `getNextQueuedLocal()`
- `server/db/processes.js` — LEFT JOIN для model, `getNextQueuedLocal()`
- `server/db/plans.js` — LEFT JOIN для product_id
- `server/routes/api.js` — поддержка run_tests/update_docs/form_release, clone с ремаппингом
- `server/scheduler.js` — model_id nullable
- `public/plan-edit.html` — новые типы шагов, stepModelGroup/stepCountGroup
- `public/js/plan-edit.js` — `onProcessTypeChange()`, model/count visibility
- `public/plans.html` — фильтр шаблонов
- `public/js/plans.js` — фильтрация шаблонов, clonePlan()
- `mcp-server/index.js` — 2 новых инструмента, обновлённые enum
- `database/migrations/015_run_tests.sql` — model_id nullable
- `database/migrations/016_plan_templates.sql` — product_id nullable

---

## v1.10.0 — Пресеты конвейера + Мульти-модель + Уведомления в Б24 (2026-03-10)

**Пресеты и per-stage модели для конвейера + уведомления через бота АФИИНА в Битрикс24 при ключевых событиях.**

### Пресеты конвейера (Presets)

- `kaizen_run_pipeline` принимает параметр `preset`:
  - `analysis` — этапы 1-5 (improve → approve → release → spec)
  - `full_cycle` — этапы 1-8 (improve → ... → develop → publish → press_release)
  - `custom` — ручной выбор этапов (как раньше)
- UI: селектор пресетов в табе автоматизации
- Карточки этапов с номерами для наглядности

### Per-stage модели (Multi-model Pipeline)

- Каждый этап конвейера может использовать свою AI-модель:
  - `improve.model_id` — модель для генерации предложений
  - `spec.model_id` — модель для генерации спецификации
  - `develop.model_id` — модель для разработки
  - `press_release.model_id` — модель для пресс-релиза
- Глобальный `model_id` используется как fallback, если per-stage не задан
- Scheduler `_triggerPipeline()` поддерживает preset и per-stage model config
- UI: per-stage выбор моделей (дропдауны) в табе автоматизации

### Уведомления через АФИИНА в Битрикс24

- Новый модуль `server/notifier.js` — отправка сообщений через `im.message.add` от бота АФИИНА (ID 1624)
- 7 типов событий:
  - `pipeline_completed` — конвейер успешно завершён
  - `pipeline_failed` — конвейер завершился с ошибкой
  - `release_published` — релиз опубликован
  - `develop_completed` — разработка завершена
  - `develop_failed` — разработка провалилась
  - `rc_sync_done` — RC-синхронизация завершена
  - `improve_completed` — AI-улучшение завершено
- BB-code форматирование сообщений для Битрикс24
- Per-product настройки: `automation.notifications` (enabled, bitrix24_user_id, events[])
- `.env`: `BITRIX24_WEBHOOK_URL`, `BITRIX24_NOTIFY_USER_ID=9`

### API (1 новый эндпоинт)

- `POST /api/notify` — отправка уведомления в Б24

### Интеграция уведомлений

- `server/process-runner.js` — уведомления при develop_completed, develop_failed, release_published
- `server/scheduler.js` — уведомления при rc_sync_done, pipeline_completed, pipeline_failed
- `mcp-server/index.js` — уведомления при завершении pipeline

### UI

- Селектор пресетов конвейера (analysis / full_cycle / custom)
- Per-stage дропдауны выбора AI-модели для каждого этапа
- Секция «Уведомления в Б24» в табе автоматизации:
  - Чекбоксы для каждого типа событий
  - Поле bitrix24_user_id
  - Кнопка тестирования уведомлений

### Изменённые файлы

- `server/notifier.js` — **новый** модуль уведомлений (im.message.add, BB-code)
- `server/process-runner.js` — интеграция notifier (develop/publish)
- `server/scheduler.js` — интеграция notifier (RC sync, pipeline), поддержка preset + per-stage models
- `server/routes/api.js` — endpoint POST /api/notify
- `mcp-server/index.js` — preset параметр, per-stage model_id, уведомления при pipeline
- `public/product.html` — UI пресетов, per-stage модели, секция уведомлений
- `public/js/product.js` — логика пресетов, per-stage моделей, уведомлений

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

### v1.14.0 — Безопасность и стабильность

- Валидация входных данных (zod) на всех POST/PUT эндпоинтах
- Валидация git branch names (regex `/^[a-z0-9._/-]+$/i`)
- Rate limiting (`express-rate-limit`: 100 req/мин API, 10 req/мин AI-процессы)
- Security headers (`helmet`: HSTS, CSP, X-Frame-Options, X-Content-Type-Options)
- Структурированное логирование (`pino`) вместо console.log/error
- Graceful shutdown (SIGTERM → остановка Scheduler/QueueManager/Pool)
- Health check эндпоинт (`GET /health` — сервер, БД, Scheduler, QueueManager)
- Исправление проглатывания ошибок в QueueManager.onProcessDone

### v1.15.0 — Качество разработки

- Unit-тесты бизнес-логики: parseJsonFromAI, approval rules, status transitions, QueueManager limits (50+ тестов)
- Пагинация API: limit/offset для processes, process_logs, issues
- Разбиение process-runner.js (1771 строк) на модули по типам процессов
- Индикация зависших процессов (elapsed time + warning при превышении таймаута)
- Трекинг миграций (таблица kaizen_migrations с автоматическим apply)
- Бейджи статусов на карточках релизов (Spec/Dev/PR)

### v1.16.0 — Масштабирование

- Аутентификация и авторизация (JWT + RBAC: admin/product-owner/viewer)
- Server-Sent Events (SSE) вместо polling для real-time статусов
- Интеграционные тесты (supertest + тестовая PostgreSQL)
- Auto-retry для AI-процессов (exponential backoff, retry_count/max_retries)
- Автоочистка process_logs (90 дней)

### Дальнейшие планы

- Условные переходы в планах (on_success, on_failure, on_condition)
- OpenAPI/Swagger документация API (swagger-jsdoc)
- Визуализация зависимостей планов (DAG: Mermaid/D3)
- Docker-деплой (Dockerfile + nginx)
- Расширенная аналитика (время цикла, детальные графики)
- Нагрузочное тестирование (k6) (вместо polling)
