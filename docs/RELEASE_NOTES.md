# Kaizen — История релизов

---

## v1.24.0 — Синхронизация GitLab-лейблов при закрытии задач (2026-04-17)

### Добавлено

- **Авто-обновление GitLab-лейблов при переходе задачи в `done`** — при актуализации kaizen-задачи со связанным GitLab issue (`gitlab_issue_id`) с GL issue автоматически снимаются метки `В работе` и `Требуется доработка`, ставится `Разработка завершена`, и пишется комментарий «🧪 Разработка завершена в Kaizen — готово к тестированию». GL issue **остаётся open** — тестировщик утром увидит задачу в своей выдаче с новым лейблом. Работает во всех продуктах, использующих стандартную схему GitLab-лейблов
- **`gitlab-client.js`**: экспорт `DEVELOPED_LABELS`, функции `updateIssueLabels(deploy, issueIid, {remove_labels, add_labels})`, `markIssueDeveloped(deploy, issueIid, {comment})`, батч-хелпер `syncIssuesDeveloped(deploy, issues)` (fire-and-forget, Promise.allSettled). Подробные юнит-тесты в `tests/gitlab-label-sync.test.js`

### Изменено

- **`PUT /api/issues/:id`** при `status='done'` больше НЕ закрывает GitLab issue — вместо этого обновляет лейблы. Старое поведение (close + comment «✅ Задача закрыта в Kaizen») заменено на label-sync, чтобы тестировщик видел задачу как требующую тестирования, а не закрытую
- **`releases.publish()`** после COMMIT транзакции теперь делает batch-sync GitLab-лейблов для всех задач релиза (fire-and-forget). Покрывает все сценарии публикации: ручной через API, авто-публикация в develop_release, сценарии `batch_develop` и `auto_release`

---

## v1.23.0 — Маркетинг и стабильность (2026-04-13)

### Добавлено

- **Сценарий `weekly_digest`** — новый пресет для еженедельной публикации дайджеста релизов в Б24-группу. Собирает все опубликованные релизы за N дней по всем продуктам, считает AI-процессы по типам, формирует BB-code пост и публикует в указанную группу. Не требует AI-модели. Настраивается через cron (каждый понедельник `5 9 * * 1`). UI: поля `b24_group_id` и `days` в форме создания сценария
- **МК3: Публичная страница дорожной карты** — `GET /api/public/roadmap` (без авторизации) + `/public-roadmap.html`. Показывает статус релизов по всем продуктам (spec/developing/developed/published за 30 дней). Фильтры по статусу, авто-обновление раз в минуту. Ссылку можно отправить маркетингу напрямую
- **МК2: Авто-пресс-релиз при публикации** — после `publish`, если в продукте задан `automation.notifications.marketing_group_id`, автоматически запускается процесс `prepare_press_release` и ставится в очередь
- **B6: Security headers** — подключён `helmet` middleware (HSTS, X-Frame-Options, X-Content-Type-Options, X-DNS-Prefetch-Control). CSP отключён — фронтенд использует inline scripts
- **Кнопка дорожной карты на дашборде** — карточка-ссылка «🗺️ Дорожная карта разработки» на главной странице, открывает `/public-roadmap.html` в новой вкладке

### Улучшено

- **Smoke-тесты (Т4)** — `smoke-tester.js` теперь проверяет: наличие текстов ошибок на странице (паттерны: "не удалось загрузить", "failed to fetch", "500 internal server" и др.); ожидание ключевых DOM-элементов через CSS-селекторы из `smoke_test.expect_elements` конфига; авторизация через `smoke_test.auth` (login_url, username/password, CSS-селекторы формы)
- **Форма редактирования релиза** — кнопка ✏ Изменить на каждой карточке релиза: редактирование названия, версии, описания, состава задач с чекбоксами. Компактный layout, textarea 4 строки, список задач 330px (≈10 строк)
- **П3: Автоочистка логов** — подтверждено что `_cleanupOldLogs()` уже реализован в Scheduler (DELETE kaizen_process_logs старше 90 дней, раз в 24 часа)

---

## v1.22.0 — Новый тип процесса seed_data (генерация моковых данных) (2026-04-11)

### Добавлено

- **Тип процесса `seed_data`** — AI-процесс на базе claude-code для автоматической генерации реалистичных моковых данных после разработки нового функционала
  - Анализирует `git diff` новых миграций: находит новые таблицы (нужны INSERT) и новые FK-колонки в существующих таблицах (нужны UPDATE)
  - Перед INSERT делает SELECT реальных ID из родительских таблиц для корректных FK-связей
  - Вставляет новые сущности (настраиваемый `seed_count`, по умолчанию 20) и обновляет существующие записи
  - Соблюдает порядок операций (родители → дети), не трогает nullable FK если связь неочевидна
  - Два режима доступа к БД: `use_api: true` (через REST API приложения) или прямой SQL (psql/sqlcmd)
  - Конфиг: `seed_count` (кол-во записей), `tables` (фокус на конкретных таблицах), `use_api`, `branches` (override зависимостей из плана), `language`
  - Результат: `records_inserted`, `records_updated`, `tables_seeded`, `tables_updated`, `summary`
- **UI**: иконка 🌱, карточка результата `+N записей ~M обновлено` в ленте дашборда, детальный модал с разбивкой по таблицам
- **Редактор планов**: `seed_data` добавлен в список типов процессов — можно вставлять в план после `develop_release`
- **DURATION_THRESHOLDS**: `seed_data = 15 мин` (для индикатора предупреждения о зависании)

---

## v1.21.0 — GitLab pre-sync в авто-релизе + новый UI Формирования релиза (2026-04-10)

### Добавлено

- **GitLab pre-sync в `auto_release`** — перед поиском открытых задач сценарий теперь автоматически синхронизирует GitLab: обновляет кэш issues, импортирует новые, и — ключевое — вызывает `reopenSyncedIssues()`: если задача закрыта в Kaizen при публикации релиза, но в GitLab остаётся открытой, она возвращается в статус `open`. Устраняет проблему «0 открытых задач» при повторных запусках авто-релиза. Стадия `gitlab_sync_done` с полями `synced/imported/reopened` добавлена в историю запуска
- **`reopenSyncedIssues(productId)`** — новая функция в `gitlab-sync.js`: находит Kaizen-задачи в статусе `done`, чей связанный GL issue остаётся `opened`, и возвращает их в `open`
- **`approved_count` в сценарии** — `scenario-runner.js` теперь обновляет `approved_count` у `form_release` процесса после создания релизов, чтобы UI корректно показывал состояние

### Улучшено

- **Новый UI «Формирование релиза»** (страницы Процессы и Продукт):
  - **Summary-баннер**: счётчики «X релизов предложено / Y задач / Z не включены» + AI-summary + стратегия
  - **Карточки релизов**: цветные пипки приоритетов (■■□□), счётчик задач, версия
  - **Задачи**: цветная левая полоса по приоритету (красная/оранжевая/жёлтая), badges в строке
  - **Обоснование AI** (`rationale`): серый блок «AI: ...» под описанием каждого релиза
  - **Блок «Не вошли в релизы»**: задачи из `unassigned` в отдельном сворачиваемом блоке
  - **Read-only режим**: если релизы уже созданы — чекбоксы и кнопка «Создать» скрыты, показывается «✓ Релизы созданы (N)»
  - **Умное определение состояния**: проверяет `approved_count`, `result.auto_approved` и наличие релизов с совпадающими версиями в продукте
  - **Кнопка**: `Создать релизы (N) · M задач` с динамическим счётчиком

### Исправлено

- **`SyntaxError: Identifier 'product' has already been declared`** в `scenario-runner.js` — переменная `product` в pre-sync блоке переименована в `productCfg` во избежание конфликта с переменной в AR6-summary
- **Порт smoke-тестов**: `-- --port` вместо `--port` для npm-скриптов (Vite игнорировал флаг без `--` разделителя); инъекция порта перемещена за пределы блока autodiscovery — работает даже при кэшированных страницах
- **Отчёт о релизе в Б24** (улучшения `postReleaseReport`): ссылки на GitLab issues `[url=...]#N[/url]`, иконка 🟡 для medium-приоритета, имя модели разработки, время разработки, ссылка на GitLab Pipeline

---

## v1.20.0 — Отчёты о релизах в Б24-группы (2026-04-08)

### Добавлено
- **`postReleaseReport`** в `notifier.js` — публикация отчёта о релизе в Живую ленту Б24-группы (`log.blogpost.add`). Группировка задач по типу с иконками (🐛 Исправления / ✨ Новое / ⚡ Улучшения), дата публикации в MSK. Если `b24_group_id` не задан — функция молча пропускается
- **Per-product поле `b24_group_id`** в JSONB `automation.notifications` — ID группы Б24 для публикации отчётов
- **UI**: поле «ID группы для отчётов» в табе Автоматизации → секция «Уведомления в Б24»
- Триггеры: авто-публикация после `develop_release` (`process-runner.js`) + ручная публикация через `/api/releases/:id/publish` (`api.js`)

### Исправлено
- **Формат DEST в Б24 API**: правильный формат `DEST[]=SG{id}` вместо `DEST[0][TYPE]=SG&DEST[0][ID]=...` (последний всегда возвращал INTERNAL_SERVER_ERROR)

---

## v1.19.0 — Авто-релиз 2.0 + GitLab Auto-Import улучшения (2026-04-07)

### Исправлено
- **Критический баг авто-релиза**: `formProc.result` — объект `{releases:[...]}`, а не массив. Сценарий `auto_release` всегда возвращал "AI не предложил релизов" даже при наличии предложений AI

### Авто-релиз (AR1–AR6)

- **AR1**: Обработка ВСЕХ предложенных AI релизов (не только первого). Цикл по всем `proposed`, `on_failure: stop|skip`
- **AR2**: Параметр `auto_approve` теперь реально фильтрует задачи по приоритету:
  - `all` — создавать все задачи (по умолчанию)
  - `high_and_critical` — только задачи с приоритетом high или critical
  - `critical_only` — только критические задачи
  - При пустом результате фильтрации релиз пропускается со стадией `skipped_no_issues_after_filter`
- **AR3**: Добавлены опциональные шаги в `develop.*`: `run_tests`, `update_docs`, `deploy` — единообразно с `batch_develop`
- **AR4**: Параметр `min_issues` — ранний выход с `below_min_issues` если открытых задач меньше порога
- **AR5**: `develop.enabled === true` (явная проверка) — разработка больше не запускается без явного включения
- **AR6**: Читаемый `summary`: `Rivc.BI v0.22.0: 3 задачи → опубликован (1 из 1 релизов)`
- Новые параметры сценария: `min_issues`, `on_failure`, `develop.run_tests`, `develop.update_docs`, `develop.deploy`

### GitLab Auto-Import (GL1–GL5)

- **GL1**: Флаг `auto_import.import_all: true` — импортировать все новые открытые GL issues без фильтра по labels
- **GL2**: `close_sync: true` (по умолчанию) — при sync `state=closed` в GitLab автоматически переводит связанный Kaizen issue в `done`. Новая функция `closeSyncedIssues(productId)` в `gitlab-sync.js`
- **GL3**: `auto_import.exclude_labels: ["wontfix", "duplicate"]` — исключать issues с нежелательными метками
- **GL4**: `auto_import.min_priority: 'high'` — импортировать только high+critical через маппинг labels → priority
- **GL5**: `auto_import.ai_enrich: {enabled, model_id}` — после импорта создаёт `improve` процесс в очереди для AI-обогащения новых задач
- `autoImportByLabels` сохранён для обратной совместимости, делегирует в новый `autoImport(productId, config)`
- `closed_count` добавлен в уведомление `gitlab_sync_done`

### UI и инфраструктура
- **Версия в шапке**: `common.js` загружает версию из `/api/health` и отображает `v1.19.0` рядом с логотипом на всех 9 страницах
- **Этапы авто-релиза в UI**: добавлены Тестирование, Документирование, Деплой (были скрыты)
- **Удалены пресеты** `full_cycle` и `analysis` из UI — упрощение интерфейса (3 пресета: batch_develop, auto_release, nightly_audit)
- **`detectBuildCommand`**: Java/Spring проверяется до Vue/Node — проекты типа Spring+Vue теперь корректно собираются через `mvn compile -q`; Vue-проект с `frontend/` → `cd frontend && npm run build`
- **Уведомление об ошибке разработки**: точный текст — `сборка провалена` или `тесты не пройдены` в зависимости от реальной причины
- `package.json` version обновлён до `1.19.0`; `/api/health` возвращает `version`

---

## v1.18.1 — Structured logging + Сценарии на странице продукта (2026-04-01)

### Добавлено
- Structured logging (pino): 60 console-вызовов заменены на JSON-логи с контекстом (module, processId, planId)
- server/logger.js — фабрика child-логгеров по модулям (`createLogger('module')`)
- Dev: pino-pretty (цветной вывод), Prod: JSON stdout
- Блок «Сценарии продукта» в табе Автоматизация — таблица со статусом, расписанием, кнопкой запуска
- Кнопка «+ Создать» на странице продукта → переход на /scenarios.html с предзаполненным продуктом
- scenarios.js: поддержка URL-параметров `product_id`, `create`, `highlight`

---

## 1.18.2 — Hotfix: sanitize branch names (2026-04-02)

### Исправлено
- validateBranchName теперь sanitize-ит невалидные символы вместо throw
- Кириллица, пробелы, .lock, двойные точки — автоматически очищаются
- Пример: "kaizen/release-1.2. Фикс" → "kaizen/release-1.2"
- Стандартизированы события уведомлений для всех 8 продуктов (убраны мёртвые pipeline_completed/failed/improve_completed, добавлены scenario_completed/failed)

---

## v1.18.0 — Автоматизация 2.0 + AI-агенты (2026-04-01)

### Удалено
- Блок «Авто-конвейер» из таба Автоматизации (заменён Сценариями)
- Триггеры threshold и on_sync (scheduler.js)
- Эндпоинт POST /products/:id/run-pipeline
- Блок «Контекст для AI» (context_files/critical_paths) из UI
- Мёртвые события уведомлений: pipeline_completed, pipeline_failed, improve_completed

### Добавлено
- GitLab Auto-Sync UI в табе Автоматизация (ранее только через API)
- Поддержка Ollama через base_url в kaizen_ai_models (миграция 024)
- ai-caller.js: --auth-type openai + OPENAI_BASE_URL для qwen-code с Ollama
- Модель Kilo Code (kilo-code провайдер) — Kilo Gateway бесплатные модели
- CSS-стили бейджей qwen-code (зелёный) и kilo-code (жёлтый)
- События уведомлений: gitlab_sync_done, scenario_completed, scenario_failed

### Улучшено
- Бейдж mode в процессах показывает реальный провайдер (не всегда 'claude-code')
- Текст логов показывает имя модели вместо 'Claude Code'
- Таб Автоматизация: компактный grid-layout (RC + GitLab в 2 колонки)
- Лимит очереди kilo-code снижен с 2 до 1 (GPU-совместимость)
- CLAUDE.md добавлен в дефолтный список update_docs
- Скилл update-docs обновлён (CLAUDE.md вместо README.md)

---

## v1.17.0 — Сценарии, обновлённый дашборд, багфиксы (2026-03-25, обн. 2026-03-26)

**Сценарии — автономные рабочие процессы с расписанием. Обновлённый дашборд. 6 критических/высоких багфиксов.**

### Сценарии (ScenarioRunner)

- Новая сущность `kaizen_scenarios` + `kaizen_scenario_runs` (миграция 023)
- 5 пресетов: `batch_develop`, `auto_release`, `nightly_audit`, `full_cycle`, `analysis`
- Три режима запуска: сейчас / в указанное время (дата+час MSK) / по расписанию (cron)
- Движок `scenario-runner.js` — создание процессов, polling, авто-утверждение, авто-публикация
- Одноразовые сценарии автоматически отключаются после выполнения
- Cron-сценарии проверяются каждые 60с через scheduler
- 7 MCP-инструментов: `list/get/create/update/run/get_run/delete_scenario`
- 11 API-эндпоинтов для CRUD + запуск/отмена
- Уведомления в Б24: `scenario_completed`, `scenario_failed`

### UI сценариев (`/scenarios.html`)

- Таблица с фильтром по типу, колонки: продукт, название, тип, расписание, результат, запуски
- Динамическая форма создания: поля зависят от пресета (batch_develop → выбор релизов, nightly_audit → шаблон/кол-во)
- Режим запуска: Сейчас / В указанное время (date+hour picker MSK) / По расписанию (cron presets + custom 5-полей)
- Редактирование сценария через ту же форму (кнопка в детальной карточке)
- Детальная карточка по клику: продукт, модель, параметры, таблица релизов
- Закрытие модалок по ESC

### Обновлённый дашборд

- Alert-полоска: красная при ошибках процессов, синяя при running сценариях
- Виджет "Задачи" — кликабельный (ссылка на /products.html)
- Виджет "Сценарии" — заменил "Планы", с stacked bar и статистикой за неделю
- Объединённая таблица продуктов: ТОП-15 активности + хитмап 7 дней + приоритеты задач (C/H/M/L) + зебра
- Лента активности v2: 2 колонки карточек, фильтры (Все/Разработка/Релизы/Сценарии/AI/Ошибки), иконки, версия релиза бейджем
- Layout без скролла: таблица (70%) + лента (30%) рядом, внутренний скролл

### Процессы — улучшения

- `release_version` и `release_name` в API (JOIN на releases)
- Бейдж версии релиза в карточках и таблице истории
- Колонка "Релиз" в таблице истории процессов

### Навигация

- Планы скрыты из навигации (страницы доступны по прямой ссылке)
- Таб "Планы" убран со страницы продукта
- Виджет "Планы" заменён на "Сценарии" на дашборде

### Багфиксы (6 шт.)

- **CRITICAL**: retry enqueue — неправильные параметры (process-runner.js)
- **CRITICAL**: notifier отправлял UUID вместо версии релиза в develop_failed
- **CRITICAL**: stack traces утекали в API-ответах по умолчанию (теперь только при NODE_ENV=development)
- **HIGH**: GitLab API fetch без таймаута — мог зависнуть навсегда (добавлен AbortSignal.timeout 30с)
- **HIGH**: nightly_audit запускался на архивных продуктах (добавлен фильтр status=active)
- **HIGH**: JSON.parse config падал молча — теперь логирование + fallback на proc.config объект

### batch_develop — расширенная цепочка (2026-03-26)

- Добавлены опциональные этапы: `run_tests` → `update_docs` → `deploy`
- Полная цепочка: spec → develop → [тестирование] → [документирование] → [публикация] → [деплой]
- 4 чекбокса в форме: Тестирование, Документирование, Опубликовать релиз (закрыть задачи), Деплой
- Авто-публикация выключена по умолчанию

### Cron в MSK (2026-03-26)

- **Cron хранится и работает в московском времени** — никакой конвертации UTC
- `calcNextRun()` использует `getHours()/getMinutes()` (локальное время сервера = MSK)
- Фронтенд записывает час как есть, без MSK→UTC конвертации
- Пресеты cron обновлены на MSK-значения (21:00, 22:00, 00:00, 01:00, 03:00, 05:00)
- Валидация: час обязателен при custom cron (нельзя `*`)
- Все существующие cron в БД пересчитаны UTC→MSK

### Прочее

- Все даты/время на фронтенде явно в MSK (`timeZone: 'Europe/Moscow'`)
- Smoke test и build validation отключаемы per-product (`smoke_test.enabled`, `smoke_test.build_command`)
- Продукты в select-ах отсортированы по алфавиту (ru locale)
- Form submit через addEventListener (fix для ESM modules)

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
