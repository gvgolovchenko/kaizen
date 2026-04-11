# Kaizen — Техническое задание

> Версия: 1.17.0 | Дата: 2026-03-26

---

## 1. Назначение

Kaizen (改善) — внутренняя система непрерывного улучшения программных продуктов компании РИВЦ-Пулково. Автоматизирует полный цикл: от сбора задач до разработки, тестирования и деплоя через AI-агентов.

---

## 2. Модули системы

### 2.1. Управление продуктами
- Реестр продуктов (название, описание, стек, репозиторий, ответственный, путь к проекту)
- Статусы: active / archived
- Per-product настройки: automation, deploy, smoke_test, notifications

### 2.2. Управление задачами (Issues)
- CRUD задач с привязкой к продукту
- Типы: bug, improvement, feature
- Приоритеты: critical, high, medium, low
- Статусы: open → in_release → done / closed
- Массовое создание (bulk), импорт из RC и GitLab

### 2.3. Управление релизами
- Формирование из задач (issue_ids[])
- Статусы: draft → spec → developing → developed → failed → published
- Спецификация (AI), разработка (Claude Code), пресс-релиз (AI)
- Публикация: issues → done, released_at фиксируется

### 2.4. AI-процессы
- 9 типов: improve, form_release, prepare_spec, develop_release, run_tests, update_docs, deploy, roadmap_from_doc, prepare_press_release
- Очередь (QueueManager): per-provider concurrency, priority, FOR UPDATE SKIP LOCKED
- Логирование каждого шага (process_logs)
- 6 AI-провайдеров: ollama, mlx, claude-code, anthropic, openai, google + local

### 2.5. Сценарии (ScenarioRunner)
- 5 пресетов: batch_develop, auto_release, nightly_audit, full_cycle, analysis
- batch_develop: spec → develop → [run_tests] → [update_docs] → [publish] → [deploy]
- 3 режима запуска: сейчас / в указанное время / по cron
- Cron работает в MSK (локальное время сервера)
- Автоматическое отключение одноразовых сценариев

### 2.6. Планировщик (Scheduler)
- Тик каждые 30с: планы, автоматизация
- Тик каждые 60с: cron-сценарии
- Тик каждые 2 мин: RC sync, GitLab sync, auto-pipeline
- Очистка логов: раз в 24 часа (>90 дней)

### 2.7. Уведомления
- Битрикс24: бот АФИИНА (ID 1624), im.message.add, BB-code
- 9 типов событий
- Per-product настройки: enabled, events[], bitrix24_user_id

### 2.8. Интеграции
- Rivc.Connect (MS SQL): синхронизация тикетов HelpDesk
- GitLab: push, pipeline, issues sync, CI/CD deploy
- GitLab CI/CD: генерация .gitlab-ci.yml, Dockerfile, docker-compose.yml

### 2.9. Дашборд
- Alert-полоска (ошибки, running сценарии)
- 5 виджетов: продукты, задачи, процессы, релизы, сценарии
- Обзор продуктов: ТОП-15 + хитмап + приоритеты задач
- Лента активности: фильтры, иконки, версии
- Без скролла (таблица 70% + лента 30%)

### 2.10. MCP-сервер
- 48 инструментов с префиксом kaizen_
- Транспорт: stdio
- HTTP-клиент к localhost:3034/api

---

## 3. Технический стек

| Компонент | Технология |
|-----------|-----------|
| Runtime | Node.js (ESM), Express 5.1 |
| Frontend | Vanilla JS + Custom CSS (dark theme) |
| БД | PostgreSQL (Supabase via Supavisor) |
| Зависимости | express, pg, dotenv |
| MCP | @modelcontextprotocol/sdk, zod |
| Порт | 3034 |

---

## 4. Критерии готовности

### MVP (выполнено)
- [x] CRUD продуктов, задач, релизов
- [x] AI-генерация задач (improve) с 6 провайдерами
- [x] Очередь процессов с контролем параллелизма
- [x] Генерация спецификаций и разработка через Claude Code
- [x] Публикация релизов с автоматическим управлением статусами
- [x] MCP-сервер для управления через Claude Code
- [x] Дашборд с аналитикой
- [x] Уведомления в Битрикс24

### v1.17.0 (текущая)
- [x] Сценарии с 5 пресетами и cron-расписанием
- [x] batch_develop: полная цепочка с тестами, документами, деплоем
- [x] Обновлённый дашборд (объединённая таблица, лента v2, alert)
- [x] Cron в MSK без конвертации
- [x] 6 критических/высоких багфиксов

### Планируемое
- [ ] Structured logging (pino/winston)
- [ ] Разбиение process-runner.js на модули
- [ ] Unit/integration тесты
- [ ] Rate limiting на API
- [ ] Soft-delete для issues/releases
- [ ] Prometheus /metrics endpoint
