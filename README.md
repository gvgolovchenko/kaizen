# Kaizen (改善) — Система непрерывного улучшения продуктов

> Отслеживание продуктов, сбор задач на улучшение, формирование и публикация релизов.

**Версия:** 1.4.0
**Дата:** 2026-03-02

---

## Модули

| Модуль | Статус | Описание |
|--------|--------|----------|
| Продукты | Реализован | CRUD продуктов, архивирование, путь к проекту, привязка к Rivc.Connect |
| Задачи (Issues) | Реализован | CRUD задач, типизация (bug/improvement/feature), приоритеты, фильтрация по статусу |
| Релизы | Реализован | Формирование релизов из задач, публикация, уведомления о статусах, спецификации |
| Модели ИИ | Реализован | Реестр моделей (ollama/mlx/claude-code/anthropic/openai/google), auto-discover, warmup |
| AI-процессы | Реализован | Улучшение продукта, генерация спецификаций, разработка релизов, дорожная карта, пресс-релизы |
| Уведомления | Реализован | Toast-уведомления о автоматических изменениях статусов при операциях с релизами |

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
| Детали продукта | `/product.html?id=...` | Задачи, релизы, AI-процессы, спецификации |
| Процессы | `/processes.html` | Все AI-процессы (глобальная) |
| Модели ИИ | `/models.html` | Реестр AI-моделей (local + cloud) |
| Дорожная карта | `/roadmap.html?process_id=...` | Просмотр и утверждение дорожной карты |

## Документация

| Документ | Описание |
|----------|----------|
| [MAIN_FUNC.md](docs/MAIN_FUNC.md) | Основные функции и бенефиты |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Руководство пользователя |
| [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | История релизов |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Схема базы данных |
| [RELEASE_001_SPEC.md](docs/RELEASE_001_SPEC.md) | Спецификация релиза 1.0.0 (MVP) |
| [RELEASE_SPEC_FEATURE.md](docs/RELEASE_SPEC_FEATURE.md) | Фича: генерация спецификаций |
| [DEVELOP_RELEASE_FEATURE.md](docs/DEVELOP_RELEASE_FEATURE.md) | Фича: разработка релизов (claude-code) |
| [ROADMAP_FROM_DOC_FEATURE.md](docs/ROADMAP_FROM_DOC_FEATURE.md) | Фича: дорожная карта из документа |

## Быстрый старт

```bash
# Установка
cd ~/AIWork/Разработка\ ПО/kaizen
npm install

# Миграции БД (все последовательно)
node database/exec-sql.js --file database/migrations/001_initial_schema.sql
node database/exec-sql.js --file database/migrations/002_ai_models.sql
node database/exec-sql.js --file database/migrations/003_ai_models_api_key.sql
node database/exec-sql.js --file database/migrations/004_processes.sql
node database/exec-sql.js --file database/migrations/005_processes_approved_count.sql
node database/exec-sql.js --file database/migrations/006_release_spec.sql
node database/exec-sql.js --file database/migrations/007_develop_release.sql
node database/exec-sql.js --file database/migrations/008_approved_indices.sql
node database/exec-sql.js --file database/migrations/009_product_rivc_connect.sql
node database/exec-sql.js --file database/migrations/010_press_release.sql

# Запуск (development)
npm run dev

# Открыть
open http://localhost:3034
```

## Статус проекта

| Этап | Статус |
|------|--------|
| Инициация и планирование | Готово |
| Миграция БД (001–010) | Готово |
| Backend API (35+ эндпоинтов) | Готово |
| Frontend (5 страниц) | Готово |
| Модели ИИ + discover | Готово |
| AI-процессы (improve, spec, develop, roadmap, press_release) | Готово |
| Уведомления о статусах | Готово |
| Перезапуск процессов | Готово |
| Документация | Готово |
| Деплой (Docker) | Запланирован |
