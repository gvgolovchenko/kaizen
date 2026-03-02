# Kaizen — Схема базы данных

> Версия схемы: 1.4.0 (миграции 001–010)
> СУБД: PostgreSQL (Supabase via Supavisor, порт 8053)

---

## Обзор

- **Схема**: `opii`
- **Префикс таблиц**: `kaizen_` (изоляция от других таблиц в схеме)
- **Первичные ключи**: UUID (`gen_random_uuid()`)
- **Временные метки**: `created_at` (auto), `updated_at` (trigger)
- **Каскадное удаление**: продукт → задачи + релизы
- **Таблицы**: 7 (products, issues, releases, release_issues, ai_models, processes, process_logs)

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
| api_key | TEXT | YES | NULL | API-ключ для облачных провайдеров |
| created_at | TIMESTAMPTZ | YES | now() | Дата создания |
| updated_at | TIMESTAMPTZ | YES | now() | Дата обновления (trigger) |

### opii.kaizen_processes

AI-процессы (фоновые задачи генерации).

| Поле | Тип | Null | Default | Описание |
|------|-----|:----:|---------|----------|
| id | UUID | NO | gen_random_uuid() | PK |
| product_id | UUID | NO | — | FK → kaizen_products(id) ON DELETE CASCADE |
| model_id | UUID | YES | NULL | FK → kaizen_ai_models(id) |
| type | VARCHAR(50) | YES | 'improve' | improve / prepare_spec / develop_release / roadmap_from_doc / prepare_press_release |
| status | VARCHAR(20) | YES | 'pending' | pending / running / completed / failed |
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

---

## Индексы

| Индекс | Таблица | Поле(я) |
|--------|---------|---------|
| idx_kaizen_issues_product | kaizen_issues | product_id |
| idx_kaizen_issues_status | kaizen_issues | status |
| idx_kaizen_releases_product | kaizen_releases | product_id |
| idx_kaizen_releases_status | kaizen_releases | status |

---

## Триггеры

| Триггер | Таблица | Действие |
|---------|---------|----------|
| trg_kaizen_products_updated | kaizen_products | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_issues_updated | kaizen_issues | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_releases_updated | kaizen_releases | BEFORE UPDATE → updated_at = now() |
| trg_kaizen_processes_updated | kaizen_processes | BEFORE UPDATE → updated_at = now() |

Функция триггера: `opii.kaizen_update_timestamp()`

---

## Связи (ER)

```
kaizen_products
    ├── 1:N → kaizen_issues (product_id, CASCADE)
    ├── 1:N → kaizen_releases (product_id, CASCADE)
    │                └── M:N → kaizen_issues (через kaizen_release_issues)
    └── 1:N → kaizen_processes (product_id, CASCADE)
                     └── 1:N → kaizen_process_logs (process_id, CASCADE)

kaizen_ai_models (независимая таблица, ссылается из processes)
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
