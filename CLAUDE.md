# Kaizen — Контекст проекта

Kaizen (改善) — система непрерывного улучшения продуктов v1.0.0. Отслеживает продукты компании, собирает задачи на улучшение и формирует из них релизы с автоматическим управлением статусами.

## Архитектура

Вариант Е-lite: Express.js + Vanilla JS + PostgreSQL. Без фреймворков на фронтенде, минимум зависимостей.

```
[Браузер] → [Vanilla JS (2 страницы)] → [Express.js API (порт 3034)]
                                                └── [PostgreSQL (схема opii)]
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
│   ├── db/
│   │   ├── pool.js               # pg Pool (Supavisor)
│   │   ├── products.js           # getAll, getById, create, update, remove
│   │   ├── issues.js             # getByProduct, getById, create, update, remove
│   │   └── releases.js           # getByProduct, getById, create, update, remove, publish
│   └── routes/
│       └── api.js                # Все 16 REST-эндпоинтов
├── database/
│   ├── exec-sql.js               # Утилита миграций
│   └── migrations/
│       └── 001_initial_schema.sql
├── public/
│   ├── index.html                # Список продуктов (карточки)
│   ├── product.html              # Детали: задачи + релизы
│   ├── css/style.css             # Dark theme (~300 строк)
│   └── js/
│       ├── app.js                # api(), toast(), confirm(), escapeHtml(), modal helpers
│       ├── products.js           # Логика index.html
│       └── product.js            # Логика product.html
└── docs/
    ├── MAIN_FUNC.md              # Функции и бенефиты
    ├── USER_GUIDE.md             # Руководство пользователя
    ├── RELEASE_NOTES.md          # История релизов
    ├── DATABASE_SCHEMA.md        # Схема БД
    └── RELEASE_001_SPEC.md       # Спецификация MVP
```

## Команды

```bash
npm run dev     # Development (node --watch)
npm start       # Production

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
- **Таблицы**: kaizen_products, kaizen_issues, kaizen_releases, kaizen_release_issues
- **PK**: UUID (gen_random_uuid())
- **Каскадное удаление**: products → issues + releases → release_issues
- **Триггеры**: updated_at на products, issues, releases
- **Подключение**: `DB_HOST:DB_PORT/DB_NAME` через pg Pool

## API (16 эндпоинтов)

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
| POST | /api/releases/:id/publish | Опубликовать |

## Бизнес-логика

- **Создание релиза**: issues из issue_ids[] → статус `in_release`
- **Публикация релиза**: релиз → `released`, released_at = now(), все issues → `done`
- **Удаление issue из релиза**: issue → `open`
- **Удаление релиза**: все issues → `open`, затем удаление
- **Каскадное удаление продукта**: ON DELETE CASCADE на FK

## Важные правила

- **Миграции**: SQL-файлы, применяются через `node database/exec-sql.js --file <path>`
- **Секреты**: `.env` не коммитится
- **Транзакции**: releases.create/update/remove/publish используют BEGIN/COMMIT/ROLLBACK
- **Префикс таблиц**: всегда `kaizen_` (в одной схеме с другими проектами)
- **Frontend**: Vanilla JS, ESM imports, без сборщиков
