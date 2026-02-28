# Kaizen (改善) — Система непрерывного улучшения продуктов

> Отслеживание продуктов, сбор задач на улучшение, формирование и публикация релизов.

**Версия:** 1.0.0
**Дата:** 2026-02-28

---

## Модули

| Модуль | Статус | Описание |
|--------|--------|----------|
| Продукты | Реализован | CRUD продуктов, архивирование, путь к проекту |
| Задачи (Issues) | Реализован | CRUD задач, типизация (bug/improvement/feature), приоритеты, фильтрация по статусу |
| Релизы | Реализован | Формирование релизов из задач, публикация, каскадное управление статусами |

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Backend | Express.js 5.1 (Node.js, ESM) |
| Frontend | Vanilla JS + Custom CSS (dark theme) |
| БД | PostgreSQL (Supabase via Supavisor, порт 8053) |
| Схема БД | `opii` |
| Порт | 3034 |
| Зависимости | express, pg, dotenv |

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

# Миграция БД
node database/exec-sql.js --file database/migrations/001_initial_schema.sql

# Запуск (development)
npm run dev

# Открыть
open http://localhost:3034
```

## Статус проекта

| Этап | Статус |
|------|--------|
| Инициация и планирование | Готово |
| Миграция БД (001) | Готово |
| Backend API | Готово |
| Frontend (index + product) | Готово |
| Документация | Готово |
| Деплой (Docker) | Запланирован |
