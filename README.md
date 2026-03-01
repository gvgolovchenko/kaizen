# Kaizen (改善) — Система непрерывного улучшения продуктов

> Отслеживание продуктов, сбор задач на улучшение, формирование и публикация релизов.

**Версия:** 1.1.0
**Дата:** 2026-02-28

---

## Модули

| Модуль | Статус | Описание |
|--------|--------|----------|
| Продукты | Реализован | CRUD продуктов, архивирование, путь к проекту |
| Задачи (Issues) | Реализован | CRUD задач, типизация (bug/improvement/feature), приоритеты, фильтрация по статусу |
| Релизы | Реализован | Формирование релизов из задач, публикация, каскадное управление статусами |
| Модели ИИ | Реализован | Реестр моделей (ollama/mlx/anthropic/openai/google), auto-discover, warmup, api_key |
| Улучшение продукта | Реализован | AI-генерация задач: шаблоны промптов, выбор модели, утверждение предложений |

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Backend | Express.js 5.1 (Node.js, ESM) |
| Frontend | Vanilla JS + Custom CSS (dark theme) |
| БД | PostgreSQL (Supabase via Supavisor, порт 8053) |
| Схема БД | `opii` |
| Порт | 3034 |
| Зависимости | express, pg, dotenv |

## Навигация

| Страница | URL | Описание |
|----------|-----|----------|
| Продукты | `/` | Главная — карточки всех продуктов |
| Детали продукта | `/product.html?id=...` | Задачи, релизы, улучшение продукта |
| Модели ИИ | `/models.html` | Реестр AI-моделей (local + cloud) |

## Документация

| Документ | Описание |
|----------|----------|
| [MAIN_FUNC.md](docs/MAIN_FUNC.md) | Основные функции и бенефиты |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Руководство пользователя |
| [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | История релизов |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Схема базы данных |
| [RELEASE_001_SPEC.md](docs/RELEASE_001_SPEC.md) | Спецификация релиза 1.0.0 (MVP) |

## Быстрый старт

```bash
# Установка
cd ~/AIWork/Разработка\ ПО/kaizen
npm install

# Миграции БД
node database/exec-sql.js --file database/migrations/001_initial_schema.sql
node database/exec-sql.js --file database/migrations/002_ai_models.sql
node database/exec-sql.js --file database/migrations/003_ai_models_api_key.sql

# Запуск (development)
npm run dev

# Открыть
open http://localhost:3034
```

## Статус проекта

| Этап | Статус |
|------|--------|
| Инициация и планирование | Готово |
| Миграция БД (001–003) | Готово |
| Backend API (22 эндпоинта) | Готово |
| Frontend (3 страницы) | Готово |
| Модели ИИ + discover | Готово |
| AI-генерация задач (improve) | Готово |
| Документация | Готово |
| Деплой (Docker) | Запланирован |
