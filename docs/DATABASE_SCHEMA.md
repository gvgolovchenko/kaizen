# Kaizen — Схема базы данных

> Версия схемы: 1.2.0 (миграции 001–003, 009)
> СУБД: PostgreSQL (Supabase via Supavisor, порт 8053)

---

## Обзор

- **Схема**: `opii`
- **Префикс таблиц**: `kaizen_` (изоляция от других таблиц в схеме)
- **Первичные ключи**: UUID (`gen_random_uuid()`)
- **Временные метки**: `created_at` (auto), `updated_at` (trigger)
- **Каскадное удаление**: продукт → задачи + релизы
- **Таблицы**: 5 (products, issues, releases, release_issues, ai_models)

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

Функция триггера: `opii.kaizen_update_timestamp()`

---

## Связи (ER)

```
kaizen_products
    ├── 1:N → kaizen_issues (product_id, CASCADE)
    └── 1:N → kaizen_releases (product_id, CASCADE)
                    └── M:N → kaizen_issues (через kaizen_release_issues)

kaizen_ai_models (независимая таблица)
```

---

## Миграции

| # | Файл | Описание |
|---|------|----------|
| 001 | 001_initial_schema.sql | Создание схемы opii, 4 таблицы, индексы, триггеры |
| 002 | 002_ai_models.sql | Таблица kaizen_ai_models (модели ИИ) |
| 003 | 003_ai_models_api_key.sql | Колонка api_key в ai_models |
| 009 | 009_product_rivc_connect.sql | Колонки rc_system_id, rc_module_id в products |
