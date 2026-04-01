# Kaizen — Схема базы данных

> Версия схемы: 1.18.0 (миграции 001–024) — актуализировано 2026-04-01
> СУБД: PostgreSQL (Supabase via Supavisor, порт 8053)

---

## Обзор

- **Схема**: `opii`
- **Префикс таблиц**: `kaizen_` (изоляция от других таблиц в схеме)
- **Первичные ключи**: UUID (`gen_random_uuid()`)
- **Временные метки**: `created_at` (auto), `updated_at` (trigger)
- **Каскадное удаление**: продукт → задачи + релизы + процессы + планы; процессы → логи; планы → шаги
- **Таблицы**: 13 (products, issues, releases, release_issues, ai_models, processes, process_logs, plans, plan_steps, rc_tickets, gitlab_issues, **scenarios**, **scenario_runs**)

---

## Таблицы

### opii.kaizen_products

Реестр продуктов компании.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | VARCHAR(255) | NO | — | Название продукта |
| description | TEXT | YES | NULL | Краткое описание |
| repo_url | VARCHAR(500) | YES | NULL | Ссылка на репозиторий |
| tech_stack | VARCHAR(255) | YES | NULL | Стек технологий |
| owner | VARCHAR(255) | YES | NULL | Ответственный |
| project_path | VARCHAR(500) | YES | NULL | Путь к проекту на сервере |
| rc_system_id | INTEGER | YES | NULL | ID системы в Rivc.Connect |
| rc_module_id | INTEGER | YES | NULL | ID модуля в Rivc.Connect |
| automation | JSONB | YES | '{}' | Настройки автоматизации (rc_auto_sync, auto_pipeline, notifications) |
| deploy | JSONB | YES | '{}' | Настройки деплоя (gitlab, target, auto_deploy) |
| last_rc_sync_at | TIMESTAMPTZ | YES | NULL | Время последней авто-синхронизации RC |
| last_pipeline_at | TIMESTAMPTZ | YES | NULL | Время последнего авто-запуска pipeline |
| status | VARCHAR(20) | YES | 'active' | active / archived |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_issues

Задачи (баги, улучшения, фичи), привязанные к продукту.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| product_id | UUID | NO | — | FK → kaizen_products(id) ON DELETE CASCADE |
| title | VARCHAR(500) | NO | — | Краткое описание задачи |
| description | TEXT | YES | NULL | Подробное описание |
| type | VARCHAR(20) | YES | 'improvement' | bug / improvement / feature |
| priority | VARCHAR(20) | YES | 'medium' | critical / high / medium / low |
| status | VARCHAR(20) | YES | 'open' | open / in_release / done / closed |
| rc_ticket_id | INTEGER | YES | NULL | ID тикета Rivc.Connect (если импортирован) |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_releases

Релизы продукта — группировка задач в версионированные выпуски.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| product_id | UUID | NO | — | FK → kaizen_products(id) ON DELETE CASCADE |
| version | VARCHAR(50) | NO | — | Номер версии (1.0.0, v2.1) |
| name | VARCHAR(255) | NO | — | Название релиза |
| description | TEXT | YES | NULL | Release notes |
| status | VARCHAR(20) | YES | 'draft' | draft / in_progress / released |
| released_at | TIMESTAMPTZ | YES | NULL | Дата фактического выпуска |
| press_release | JSONB | YES | NULL | PR-материалы для каналов (соцсети, сайт, Б24, СМИ) |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_release_issues

Связь M:N между релизами и задачами.

| Поле | Тип | Null | Описание |
|------|-----|:----:|----------|
| release_id | UUID | NO | FK → kaizen_releases(id) ON DELETE CASCADE |
| issue_id | UUID | NO | FK → kaizen_issues(id) ON DELETE CASCADE |

**PK**: (release_id, issue_id) — составной ключ.

### opii.kaizen_ai_models

Реестр AI-моделей для генерации задач.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | VARCHAR(255) | NO | — | Название модели |
| provider | VARCHAR(50) | YES | 'ollama' | Провайдер (ollama/mlx/anthropic/openai/google) |
| deployment | VARCHAR(20) | YES | 'local' | Тип развёртывания (local/cloud) |
| model_id | VARCHAR(255) | NO | — | Идентификатор модели у провайдера |
| description | TEXT | YES | '' | Описание модели |
| parameters_size | VARCHAR(50) | YES | NULL | Размер параметров (30B, 70B) |
| context_length | INTEGER | YES | NULL | Длина контекста (токены) |
| status | VARCHAR(20) | YES | 'unknown' | Статус (loaded/unloaded/unknown) |
| base_url | TEXT | YES | NULL | Custom API base URL (для Ollama: http://localhost:11434/v1) |
| api_key | TEXT | YES | NULL | API-ключ для облачных провайдеров |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_processes

AI-процессы (фоновые задачи генерации).

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| product_id | UUID | NO | — | FK → kaizen_products(id) ON DELETE CASCADE |
| model_id | UUID | YES | NULL | FK → kaizen_ai_models(id) (nullable: run_tests, update_docs не требуют модели) |
| type | VARCHAR(50) | YES | 'improve' | improve / prepare_spec / develop_release / form_release / run_tests / update_docs / deploy / roadmap_from_doc / prepare_press_release |
| status | VARCHAR(20) | YES | 'pending' | pending / queued / running / completed / failed |
| priority | INTEGER | YES | 0 | Приоритет в очереди (0=normal, 1=high, 2=urgent) |
| plan_step_id | UUID | YES | NULL | FK → kaizen_plan_steps(id) ON DELETE SET NULL |
| input_prompt | TEXT | YES | NULL | Входной промпт или JSON-параметры |
| input_template_id | VARCHAR(50) | YES | NULL | ID шаблона промпта |
| input_count | INTEGER | YES | 5 | Запрошенное количество результатов |
| release_id | UUID | YES | NULL | FK → kaizen_releases(id) (для spec/develop/press_release) |
| result | JSONB | YES | NULL | Результат выполнения |
| error | TEXT | YES | NULL | Текст ошибки |
| approved_count | INTEGER | YES | 0 | Количество одобренных предложений |
| approved_indices | JSONB | YES | NULL | Индексы одобренных предложений |
| started_at | TIMESTAMPTZ | YES | NULL | Начало выполнения |
| completed_at | TIMESTAMPTZ | YES | NULL | Завершение |
| duration_ms | INTEGER | YES | NULL | Длительность (мс) |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_process_logs

Логи шагов AI-процессов.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| process_id | UUID | NO | — | FK → kaizen_processes(id) ON DELETE CASCADE |
| step | VARCHAR(50) | NO | — | Название шага (request_sent, response_received, error и т.д.) |
| message | TEXT | YES | NULL | Описание шага |
| data | JSONB | YES | NULL | Дополнительные данные |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |

### opii.kaizen_plans

Планы автоматического запуска цепочек AI-процессов.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | VARCHAR(255) | NO | — | Название плана |
| description | TEXT | YES | NULL | Описание |
| product_id | UUID | YES | NULL | FK → kaizen_products(id) ON DELETE CASCADE (nullable: NULL для универсальных шаблонов, is_template=true) |
| status | VARCHAR(20) | NO | 'draft' | draft / scheduled / active / paused / completed / failed / cancelled |
| on_failure | VARCHAR(20) | YES | 'stop' | stop / skip |
| is_template | BOOLEAN | YES | false | Флаг шаблона |
| scheduled_at | TIMESTAMPTZ | YES | NULL | Запланированное время запуска |
| started_at | TIMESTAMPTZ | YES | NULL | Начало выполнения |
| completed_at | TIMESTAMPTZ | YES | NULL | Завершение |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_plan_steps

Шаги планов — каждый создаёт AI-процесс при выполнении.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| plan_id | UUID | NO | — | FK → kaizen_plans(id) ON DELETE CASCADE |
| step_order | INTEGER | NO | 0 | Порядок выполнения |
| name | VARCHAR(255) | YES | NULL | Название шага |
| model_id | UUID | YES | NULL | FK → kaizen_ai_models(id) (nullable: run_tests, update_docs не требуют модели) |
| process_type | VARCHAR(50) | NO | 'improve' | Тип процесса |
| input_prompt | TEXT | YES | NULL | Промпт |
| input_template_id | VARCHAR(50) | YES | NULL | ID шаблона промпта |
| input_count | INTEGER | YES | 5 | Количество результатов |
| release_id | UUID | YES | NULL | FK → kaizen_releases(id) |
| timeout_min | INTEGER | YES | 20 | Таймаут (мин) |
| depends_on | UUID[] | YES | NULL | Массив step_id зависимостей |
| status | VARCHAR(20) | NO | 'pending' | pending / running / completed / failed / skipped |
| process_id | UUID | YES | NULL | FK → kaizen_processes(id) — созданный процесс |
| error | TEXT | YES | NULL | Текст ошибки |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_rc_tickets

Кэш тикетов из Rivc.Connect HelpDesk.

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| product_id | UUID | NO | — | FK → kaizen_products(id) ON DELETE CASCADE |
| rc_ticket_id | INTEGER | NO | — | ID тикета в Rivc.Connect |
| rc_system_id | INTEGER | YES | NULL | ID системы RC |
| rc_module_id | INTEGER | YES | NULL | ID модуля RC |
| title | VARCHAR(500) | NO | — | Тема тикета |
| description | TEXT | YES | NULL | Описание |
| rc_status | VARCHAR(100) | YES | NULL | Статус в RC |
| rc_status_id | INTEGER | YES | NULL | ID статуса |
| rc_priority | VARCHAR(100) | YES | NULL | Приоритет в RC |
| rc_priority_id | INTEGER | YES | NULL | ID приоритета |
| rc_type | VARCHAR(100) | YES | NULL | Тип в RC |
| rc_type_id | INTEGER | YES | NULL | ID типа |
| rc_author | VARCHAR(255) | YES | NULL | Автор |
| rc_author_email | VARCHAR(255) | YES | NULL | Email автора |
| rc_created_at | TIMESTAMPTZ | YES | NULL | Дата создания в RC |
| rc_updated_at | TIMESTAMPTZ | YES | NULL | Дата обновления в RC |
| rc_deadline | TIMESTAMPTZ | YES | NULL | Дедлайн |
| sync_status | VARCHAR(20) | YES | 'new' | new / imported / ignored |
| issue_id | UUID | YES | NULL | FK → kaizen_issues(id) (если импортирован) |
| raw_data | JSONB | YES | NULL | Полные данные тикета |
| created_at | TIMESTAMPTZ | YES | now() | Дата кэширования |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

**UNIQUE**: (rc_ticket_id, product_id)

---

## Индексы

| Индекс | Таблица | Поле(я) |
|--------|---------|---------|
| idx_kaizen_issues_product | kaizen_issues | product_id |
| idx_kaizen_issues_status | kaizen_issues | status |
| idx_kaizen_releases_product | kaizen_releases | product_id |
| idx_kaizen_releases_status | kaizen_releases | status |
| idx_kaizen_processes_queued | kaizen_processes | status, priority DESC, created_at ASC (partial: status='queued') |
| idx_kaizen_plans_status | kaizen_plans | status |
| idx_kaizen_plans_scheduled | kaizen_plans | scheduled_at (partial: status='scheduled') |
| idx_kaizen_plan_steps_plan | kaizen_plan_steps | plan_id, step_order |

---

## Триггеры

| Триггер | Таблица | Действие |
|---------|---------|----------|
| trg_kaizen_products_updated | kaizen_products | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_issues_updated | kaizen_issues | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_releases_updated | kaizen_releases | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_processes_updated | kaizen_processes | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_plans_updated | kaizen_plans | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_plan_steps_updated | kaizen_plan_steps | BEFORE UPDATE → updated_at = now() |

Функция триггера: `opii.kaizen_update_timestamp()`

---

## Связи (ER)

```
kaizen_products
    ├── 1:N → kaizen_issues (product_id, CASCADE)
    ├── 1:N → kaizen_releases (product_id, CASCADE)
    │                └── M:N → kaizen_issues (через kaizen_release_issues)
    ├── 1:N → kaizen_processes (product_id, CASCADE)
    │                ├── 1:N → kaizen_process_logs (process_id, CASCADE)
    │                └── N:1 → kaizen_plan_steps (plan_step_id, SET NULL)
    ├── 1:N → kaizen_plans (product_id, CASCADE)
    │                └── 1:N → kaizen_plan_steps (plan_id, CASCADE)
    └── 1:N → kaizen_rc_tickets (product_id, CASCADE)

kaizen_ai_models (независимая таблица, ссылается из processes и plan_steps)
```

---

## Миграции

| # | Файл | Описание |
|---|------|----------|
| 001 | 001_initial_schema.sql | Создание схемы opii, 4 таблицы, индексы, триггеры |
| 002 | 002_ai_models.sql | Таблица kaizen_ai_models (модели ИИ) |
| 003 | 003_ai_models_api_key.sql | Колонка api_key в ai_models |
| 004 | 004_processes.sql | Таблицы kaizen_processes и kaizen_process_logs |
| 005 | 005_processes_approved_count.sql | Колонка approved_count в processes |
| 006 | 006_release_spec.sql | Колонка spec в releases |
| 007 | 007_develop_release.sql | Колонки dev_branch, dev_commit, dev_status в releases; release_id в processes |
| 008 | 008_approved_indices.sql | Колонка approved_indices JSONB в processes |
| 009 | 009_product_rivc_connect.sql | Колонки rc_system_id, rc_module_id в products |
| 010 | 010_press_release.sql | Колонка press_release JSONB в releases |
| 011 | 011_queue.sql | Статус queued, priority, plan_step_id в processes; частичный индекс |
| 012 | 012_plans.sql | Таблицы kaizen_plans и kaizen_plan_steps, FK, индексы, триггеры |
| 013 | 013_rc_tickets.sql | Таблица kaizen_rc_tickets, rc_ticket_id в issues, UNIQUE constraint |
| 014 | 014_automation.sql | Колонки automation JSONB, last_rc_sync_at, last_pipeline_at в products |
| 015 | 015_run_tests.sql | model_id nullable в processes и plan_steps (для run_tests/update_docs) |
| 016 | 016_plan_templates.sql | product_id nullable в plans + пересоздание FK (для шаблонов) |
| 017 | 017_deploy_config.sql | Колонка deploy JSONB в products (GitLab CI/CD) |
| 018 | 018_gitlab_issues.sql | GitLab Issues кэш + gitlab_issue_id в issues |
| 019 | 019_release_linear_status.sql | Линейные статусы: draft→spec→developing→developed→published |
| 020 | 020_gitlab_auto_sync.sql | last_gitlab_sync_at в products |
| 021 | 021_process_config.sql | JSONB config в processes |
| 022 | 022_issue_labels.sql | Labels JSONB в issues |
| 023 | 023_scenarios.sql | Таблицы сценариев и запусков |
| 024 | 024_model_base_url.sql | base_url TEXT в kaizen_ai_models (кастомный API endpoint) |

---

## Структура JSONB-полей

### automation (kaizen_products)

### deploy (kaizen_products)

```json
{
  "gitlab": {
    "url": "https://gitlab.rivc-pulkovo.ru",
    "project_id": 42,
    "remote_url": "git@gitlab.rivc-pulkovo.ru:opii/project.git",
    "default_branch": "main",
    "access_token": "glpat-xxxx"
  },
  "target": {
    "host": "192.168.196.213",
    "port": 22,
    "user": "opii",
    "method": "docker|native",
    "docker_compose_path": "/opt/project/docker-compose.yml",
    "service_name": "kaizen",
    "project_path_on_server": "/opt/project",
    "pm2_name": "kaizen"
  },
  "auto_deploy": {
    "on_publish": true
  }
}
```

```json
{
  "rc_auto_sync": {
    "enabled": true,
    "interval_hours": 24,
    "auto_import": { "enabled": true, "rules": ["critical", "high"] }
  },
  "gitlab_auto_sync": {
    "enabled": true,
    "interval_hours": 12,
    "auto_import": { "enabled": true, "label_rules": ["bug", "enhancement"] }
  },
  "notifications": {
    "enabled": true,
    "bitrix24_user_id": 9,
    "events": ["release_published", "develop_completed", "develop_failed", "rc_sync_done", "gitlab_sync_done", "scenario_completed", "scenario_failed"]
  }
}
```
