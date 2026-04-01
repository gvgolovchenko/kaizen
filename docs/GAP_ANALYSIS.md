# Kaizen — GAP-анализ

> Дата: 2026-04-01 | Версия: 1.18.1 | На основе: SPEC.md

---

## Прогресс: 95%

---

## Сопоставление модулей

| # | Модуль | Статус | Версия | Комментарий |
|---|--------|--------|--------|-------------|
| 2.1 | Управление продуктами | ГОТОВО | 1.0 | CRUD + automation + deploy + smoke_test |
| 2.2 | Управление задачами | ГОТОВО | 1.0 | CRUD + bulk + RC/GitLab import + labels |
| 2.3 | Управление релизами | ГОТОВО | 1.15 | Линейные статусы, spec, develop, press-release, publish |
| 2.4 | AI-процессы | ГОТОВО | 1.18 | 9 типов, очередь, 4 код-агента (Claude/Qwen/Ollama/Kilo), base_url для Ollama |
| 2.5 | Сценарии | ГОТОВО | 1.17 | 5 пресетов, cron MSK, batch_develop полная цепочка |
| 2.6 | Планировщик | ГОТОВО | 1.18 | Планы + сценарии + RC/GitLab auto-sync (без auto-pipeline) |
| 2.7 | Уведомления | ГОТОВО | 1.18 | 7 событий (Б24), Telegram частично |
| 2.8a | Интеграция RC | ГОТОВО | 1.13 | Sync + auto-import по правилам приоритета |
| 2.8b | Интеграция GitLab | ГОТОВО | 1.18 | Issues sync + push + pipeline + CI/CD генерация + **UI Auto-Sync** |
| 2.9 | Дашборд | ГОТОВО | 1.17 | Alert + 5 виджетов + объединённая таблица + лента v2 |
| 2.10 | MCP-сервер | ГОТОВО | 1.17 | 48 инструментов, сценарии, pipeline |
| — | Structured logging | ГОТОВО | 1.18.1 | pino (JSON prod, pino-pretty dev), 60 вызовов мигрированы |
| — | Автотесты | НЕ СДЕЛАНО | — | npm test пустой |
| — | Rate limiting | НЕ СДЕЛАНО | — | API без ограничений |
| — | Soft-delete | НЕ СДЕЛАНО | — | Hard delete с каскадами |
| — | Prometheus metrics | НЕ СДЕЛАНО | — | Нет /metrics endpoint |
| — | Telegram-уведомления (полные) | ЧАСТИЧНО | 1.17 | Только gitlab_sync_done, остальные события не форматируются |

---

## Детали по частично реализованным

### Уведомления — Telegram (частично)
- Б24: 7 событий, полностью работает
- Telegram: настроен token/chat_id в .env, но форматтер только для `gitlab_sync_done`
- Остальные 6 событий в Telegram не отправляются (нет tgFormatters)

### Планы (legacy)
- Полностью реализованы, но скрыты из навигации
- Заменены Сценариями для практического использования
- Код остаётся, scheduler обрабатывает active планы

---

## Что было убрано в v1.18.0

| Функционал | Причина удаления |
|---|---|
| Auto-Pipeline (threshold/schedule/on_sync) | Дублировал Сценарии. Сценарии мощнее (batch_develop, auto_release, nightly_audit, cron, история) |
| POST /products/:id/run-pipeline | Эндпоинт удалён вместе с auto-pipeline |
| context_files / critical_paths UI | Никто не использовал JSON-textarea. Данные лучше задавать через CLAUDE.md проекта |
| События: pipeline_completed/failed, improve_completed | Нигде не вызывались в коде (мёртвый код) |

---

## Дорожная карта

### v1.19.0 (планируемый)
- Разбиение process-runner.js на модули
- Telegram форматтеры для всех событий
- Unit-тесты для scenario-runner и calcNextRun

### v1.20.0+
- Rate limiting (sliding window)
- Soft-delete + архивирование
- Prometheus /metrics
- Webhook system для внешних интеграций
- Kilo Code + Ollama (когда CLI поддержит локальные провайдеры)
