# План полной автоматизации Kaizen

> Дата: 2026-03-10
> Статус: УТВЕРЖДЁН

---

## Цель

Полная автоматизация процесса развития продуктов: пользователь задаёт направление — всё остальное выполняется автоматически (от синхронизации тикетов до публикации релиза и уведомлений).

---

## Текущее состояние (~70% автоматизации)

```
improve → [auto-approve по правилам] → create_release → prepare_spec → СТОП
                                                                         ↓
                                                              РУЧНОЕ: develop → publish → press_release
```

RC-тикеты требуют ручной синхронизации и импорта.

---

## 7 ключевых разрывов

| # | Разрыв | Критичность | Суть |
|---|--------|-------------|------|
| 1 | Approve только через REST | Критическая | Утверждение не может быть шагом плана — нужен ручной POST |
| 2 | Нет auto-develop после spec | Критическая | Pipeline останавливается после spec |
| 3 | Нет auto-publish после develop | Критическая | Публикация требует ручного клика даже если тесты прошли |
| 4 | RC-sync не по расписанию | Средняя | Нет cron для периодической синхронизации тикетов |
| 5 | Нет условных переходов | Средняя | Планы не умеют ветвление (если тесты упали → пропустить publish) |
| 6 | Нет внешних уведомлений | Средняя | Нет webhook/Slack/email при завершении или ошибке |
| 7 | form_release не в pipeline | Низкая | kaizen_run_pipeline не включает шаг form_release |

---

## Целевой конвейер

```
                          ┌─────── Триггер ───────┐
                          │                       │
                    [RC auto-sync]        [Ручная задача]
                          │                       │
                          ▼                       ▼
                   auto-import new        issues in product
                          │                       │
                          └──────────┬────────────┘
                                     ▼
                    ┌─── form_release (AI группирует) ───┐
                    │                                     │
                    ▼                                     ▼
            auto_approve_releases              review modal (opt.)
                    │                                     │
                    └──────────┬──────────────────────────┘
                               ▼
                        prepare_spec (AI)
                               │
                               ▼
                       develop_release (Claude Code)
                               │
                         ┌─────┴─────┐
                         ▼           ▼
                   tests pass    tests fail
                         │           │
                         ▼           ▼
                  auto-publish    retry / notify
                         │
                         ▼
                prepare_press_release
                         │
                         ▼
                 webhook → Slack / Битрикс24
```

---

## Этап 1 — Сквозной конвейер (КРИТИЧНО) ✅ РЕАЛИЗОВАНО

**Цель**: одна команда → полный цикл от задач до опубликованного релиза.

### 1.1. Auto-publish после develop_release ✅

В `process-runner.js` после успешного `develop_release` (tests_passed === true):
- ✅ Автоматически вызывает `releases.publish(releaseId)` если `config.auto_publish === true`
- ✅ Логирует шаг `auto_published` / `auto_publish_failed`
- ✅ Настройка: поле `auto_publish` в config процесса (по умолчанию false)

### 1.2. Расширен kaizen_run_pipeline ✅

Конвейер расширен до 8 этапов (5 базовых + 3 опциональных):
```
improve → approve → release → spec → [develop → publish → press_release]
```

Новые параметры:
- ✅ `develop: { enabled, git_branch, test_command, auto_publish }` — запуск develop_release
- ✅ `press_release: { enabled, channels, tone }` — генерация пресс-релиза
- ✅ Auto-publish встроен в develop (если `auto_publish: true` и тесты ok)

### 1.3. Endpoint auto-approve ✅

`POST /processes/:id/approve-auto` с параметром `rule`:
- ✅ `all` — утвердить все предложения
- ✅ `high_and_critical` — только high и critical
- ✅ `critical_only` — только critical
- ✅ Возвращает список созданных задач, исключает уже утверждённые

### 1.4. Новые шаги для планов

Расширить Scheduler новыми типами шагов (отложено на Этап 2):
- `approve_auto` — автоматическое утверждение с правилом
- `publish_release` — публикация релиза
- `form_release_auto` — form_release + auto-approve

### Файлы (изменения):

```
server/process-runner.js     # ✅ +auto_publish в runDevelopRelease (шаг 13)
server/routes/api.js         # ✅ +POST /processes/:id/approve-auto
mcp-server/index.js          # ✅ расширен kaizen_run_pipeline (этапы 6-8)
mcp-server/api-client.js     # ✅ +approveAuto метод
server/scheduler.js          # (отложено на Этап 2)
```

---

## Этап 2 — Автотриггеры ✅ РЕАЛИЗОВАНО

### 2.1. Пользовательские настройки автоматизации ✅

JSONB-колонка `automation` в `kaizen_products` — каждый продукт настраивается независимо.

Структура настроек:
```json
{
  "rc_auto_sync": {
    "enabled": true,
    "interval_hours": 24,
    "auto_import": { "enabled": true, "rules": ["critical", "high"] }
  },
  "auto_pipeline": {
    "enabled": true,
    "trigger": "threshold|schedule|on_sync",
    "threshold_count": 5,
    "schedule_hours": 168,
    "pipeline_config": {
      "model_id": "uuid",
      "template_id": "general",
      "count": 5,
      "auto_approve": "high_and_critical",
      "version_strategy": "auto_increment",
      "develop": { "enabled": false, "auto_publish": false, "test_command": null },
      "press_release": { "enabled": false, "channels": ["social","website"], "tone": "official" }
    }
  }
}
```

### 2.2. RC auto-sync по расписанию ✅
- Scheduler проверяет `last_rc_sync_at` vs `interval_hours`
- При наступлении интервала → автоматический `rcSync.syncTickets()`
- Авто-импорт по правилам приоритетов (critical, high, medium)

### 2.3. Триггеры авто-конвейера ✅
- **threshold** — запуск при накоплении N открытых задач
- **schedule** — запуск по расписанию (каждые N часов)
- **on_sync** — запуск после RC-синхронизации при новых тикетах
- Авто-инкремент версий (minor bump от последней)

### 2.4. UI: таб «Автоматизация» ✅
- Полноценный UI на странице продукта с toggle-секциями
- Настройки RC sync, auto-import, pipeline триггеров
- Выбор модели, шаблона, правил утверждения
- Доп. этапы: develop + auto-publish, press-release с каналами
- Сохранение → PUT /products/:id → JSONB → восстановление при загрузке

### Файлы:
```
database/migrations/014_automation.sql  # ✅ +automation JSONB, +last_rc_sync_at, +last_pipeline_at
server/db/products.js                   # ✅ +getWithAutomation(), automation в whitelist
server/scheduler.js                     # ✅ +_runAutomation(), +_autoRcSync(), +_autoPipeline(), +_autoVersion()
server/rc-sync.js                       # ✅ +autoImportByRules()
public/product.html                     # ✅ +таб «Автоматизация», +панель настроек
public/js/product.js                    # ✅ +loadAutomationSettings(), +handleSaveAutomation()
```

---

## Этап 3 — Условная логика и уведомления

- Условные переходы в планах: on_success, on_failure, on_condition
- Webhook-система при ключевых событиях
- Интеграция с Битрикс24 (автопост при публикации релиза)

---

## Этап 4 — Интеллектуальная автоматизация

- AI-приоритизация очереди
- Авто-ретрай с анализом ошибки
- Батч-релизы по расписанию
- Метрики и дашборд (время цикла, success rate)

---

## Ожидаемый результат

| Этап | Ручного труда | Что получите |
|------|---------------|-------------|
| Сейчас | ~8 кликов на релиз | Запуск каждого шага вручную |
| Этап 1 | 1 клик / MCP-команда | Полный цикл до публикации |
| Этап 2 | 0 (мониторинг) | Тикеты из RC → релиз по расписанию |
| Этап 3 | 0 + оповещения | Умная обработка ошибок + Slack/Б24 |
| Этап 4 | Только стратегия | AI решает когда и что релизить |
