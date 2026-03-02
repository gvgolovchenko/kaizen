# Kaizen — Контекст проекта

Kaizen (改善) — система непрерывного улучшения продуктов v1.3.0. Отслеживает продукты компании, собирает задачи на улучшение (включая асинхронную AI-генерацию через 6 провайдеров с логированием) и формирует из них релизы с автоматическим управлением статусами.

## Архитектура

Вариант Е-lite: Express.js + Vanilla JS + PostgreSQL. Без фреймворков на фронтенде, минимум зависимостей.

```
[Браузер] → [Vanilla JS (4 страницы)] → [Express.js API (порт 3034)]
                                                ├── [PostgreSQL (схема opii)]
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
│   ├── index.js                  # Express-сервер (порт 3034), JSON + static
│   ├── ai-caller.js              # Универсальный AI caller (6 провайдеров)
│   ├── utils.js                  # parseJsonFromAI(), maskApiKey(), detectTestCommand()
│   ├── process-runner.js         # Фоновый исполнитель AI-процессов
│   ├── db/
│   │   ├── pool.js               # pg Pool (Supavisor)
│   │   ├── products.js           # getAll, getById, create, update, remove
│   │   ├── issues.js             # getByProduct, getById, create, update, remove
│   │   ├── releases.js           # getByProduct, getById, create, update, remove, publish, saveSpec, updateDevInfo
│   │   ├── ai-models.js          # getAll, getById, create, update, remove, updateStatus
│   │   ├── processes.js          # getAll, getByProduct, getById, create, update, remove
│   │   └── process-logs.js       # getByProcess, create
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
│       └── 008_approved_indices.sql
├── public/
│   ├── index.html                # Список продуктов (карточки)
│   ├── product.html              # Детали: задачи + релизы + процессы
│   ├── processes.html            # Все процессы (глобальная страница)
│   ├── models.html               # Реестр AI-моделей
│   ├── roadmap.html              # Дорожная карта из документа
│   ├── css/style.css             # Dark theme
│   └── js/
│       ├── app.js                # api(), toast(), confirm(), escapeHtml(), notifyStatusChanges(), modal helpers
│       ├── products.js           # Логика index.html
│       ├── product.js            # Логика product.html + процессы + improve
│       ├── processes.js          # Логика processes.html
│       ├── process-detail.js     # Общая логика отображения деталей процесса
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
- **Таблицы**: kaizen_products, kaizen_issues, kaizen_releases, kaizen_release_issues, kaizen_ai_models, kaizen_processes, kaizen_process_logs
- **PK**: UUID (gen_random_uuid())
- **Каскадное удаление**: products → issues + releases + processes; processes → process_logs
- **Триггеры**: updated_at на products, issues, releases, processes
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
| POST | /api/processes | Создать + запустить (fire-and-forget, timeout_min) |
| GET | /api/processes/:id/logs | Логи процесса |
| POST | /api/processes/:id/approve | Утвердить предложения → создать issues (с approved_indices) |
| POST | /api/processes/:id/approve-roadmap | Утвердить дорожную карту → создать релизы + issues |
| POST | /api/processes/:id/restart | Перезапустить процесс (создаёт копию) |
| DELETE | /api/processes/:id | Удалить процесс + логи |
| GET | /api/products/:id/processes | Процессы конкретного продукта |

## Бизнес-логика

- **Создание релиза**: issues из issue_ids[] → статус `in_release`
- **Публикация релиза**: релиз → `released`, released_at = now(), все issues → `done`
- **Удаление issue из релиза**: issue → `open`
- **Удаление релиза**: все issues → `open`, затем удаление
- **Каскадное удаление продукта**: ON DELETE CASCADE на FK
- **Асинхронные AI-процессы**: POST /processes создаёт запись + запускает фоновый runner (fire-and-forget). Статусы: pending → running → completed/failed. Каждый шаг логируется (request_sent, response_received, parse_result, issues_ready, error). Frontend: polling 4с (активные) / 10с (покой), живая длительность для running-процессов.
- **Уведомления о статусах**: create/publish/remove релизов возвращают `status_changes`, фронтенд показывает toast-info с деталями
- **Утверждение предложений**: POST /processes/:id/approve с indices[] → создаёт issues, сохраняет approved_indices (повторное одобрение — disabled чекбоксы)
- **Перезапуск процесса**: POST /processes/:id/restart → создаёт копию и запускает заново
- **Генерация спецификации**: POST /releases/:id/prepare-spec → AI-процесс (standalone или claude-code)
- **Разработка релиза**: POST /releases/:id/develop → claude-code создаёт ветку, реализует задачи, запускает тесты
- **Дорожная карта из документа**: POST /processes с type=roadmap_from_doc → парсит документ в релизы + задачи
- **Маскировка api_key**: первые 4 + `****` + последние 4 символа в API-ответах
- **AI-провайдеры**: ollama (localhost:11434), mlx (localhost:8080), claude-code (CLI), anthropic, openai, google
- **claude-code провайдер**: вызывает `/opt/homebrew/bin/claude` через `child_process.execFile`. Флаги: `-p --output-format text --dangerously-skip-permissions --tools Read,Glob,Grep --system-prompt <prompt> -- <user_prompt>`. Особенности: удаляет `CLAUDE*` env vars (защита от вложенных сессий), закрывает `child.stdin.end()`, использует `--` разделитель (чтобы `--system-prompt` не поглощал другие флаги), запускается в `cwd = product.project_path` для анализа реального кода. API key не требуется. Таймаут настраивается (3-60 мин, по умолчанию 20 мин).

## Важные правила

- **Миграции**: SQL-файлы, применяются через `node database/exec-sql.js --file <path>`
- **Секреты**: `.env` не коммитится
- **Транзакции**: releases.create/update/remove/publish используют BEGIN/COMMIT/ROLLBACK
- **Префикс таблиц**: всегда `kaizen_` (в одной схеме с другими проектами)
- **Frontend**: Vanilla JS, ESM imports, без сборщиков
