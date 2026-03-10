# План интеграции Kaizen с Rivc.Connect HelpDesk

> Дата: 2026-03-09
> Статус: НА СОГЛАСОВАНИИ

---

## Текущее состояние

- Продукты Kaizen имеют поля `rc_system_id` и `rc_module_id` (миграция 009)
- Связь с Rivc.Connect — только хранение ID, нет активной интеграции
- Rivc.Connect — это **MS SQL Server** (БД `Connect`, хост `192.168.196.47:1433`), **не REST API**
- ~93 800 заявок с 2007 года, 14 систем, 100+ модулей

## Цель

Загружать тикеты-бэклог из Rivc.Connect по продуктам Kaizen, просматривать их, и **вручную** импортировать как задачи (issues) для включения в релизы. При импорте сохраняется ID тикета RC для трассировки.

---

## Архитектура

```
MS SQL Server (Connect, 192.168.196.47:1433)
        ↓ (mssql запросы через VPN)
[Kaizen Server] → rc-client.js (SQL-клиент)
        ↓
[kaizen_rc_tickets] → таблица-кэш тикетов (PostgreSQL)
        ↓ (ручной импорт)
[kaizen_issues] → задачи продукта (с rc_ticket_id)
```

**Почему кэш, а не прямые запросы:**
- MS SQL доступен только через VPN — нестабильное подключение
- Не нагружаем продуктивную БД хелпдеска
- Можно работать офлайн с уже загруженными тикетами
- Храним маппинг тикет → задача Kaizen

---

## Маппинг данных

### Системы Rivc.Connect → Продукты Kaizen

| Продукт Kaizen | rc_system_id | Система RC | Примечание |
|----------------|-------------|------------|------------|
| A-CDM | 4 (module: 49) | Кобра → Портал A-CDM | |
| РСР (КОБРА) | 4 (module: 91) | Кобра → Рабочий стол руководителя | |
| BLST | — | — | Новый продукт, нет в RC |
| SkyOps Aviation | — | — | Новый продукт, нет в RC |
| Kaizen | — | — | Внутренний инструмент |
| СУУИС | — | — | Новый продукт, нет в RC |

> **Действие**: уточнить маппинг `rc_system_id` и `rc_module_id` для каждого продукта.

### Приоритеты

| RC (`urg.id`) | RC название | Kaizen |
|---------------|-------------|--------|
| 4 | Критично | `critical` |
| 3 | Высокий | `high` |
| 1 | Обычный | `medium` |

### Типы заявок

| RC (`RequestType.id`) | RC название | Kaizen |
|----------------------|-------------|--------|
| 1 | Ошибка | `bug` |
| 2 | Доработка | `improvement` |
| 3 | Техническая | `improvement` |
| 4 | Технологическая | `improvement` |

### Статусы заявок RC — что загружаем

**Загружаем** — бэклог (ещё не реализованные):

| RC статус (status_st.id) | Название | sync_status в Kaizen |
|--------------------------|----------|---------------------|
| 1 | Новая | `new` |
| 2 | На рассмотрении | `new` |
| 3 | В работе | `new` |
| 4 | Отложена | `new` |
| 7 | Запланирована | `new` |
| 9 | В обработке | `new` |
| 10 | Передано в тестирование | `new` |
| 11 | В тестировании | `new` |
| 12 | Передана на корректировку | `new` |
| 13 | Тестирование завершено | `new` |
| 16 | В ожидании ответа клиента | `new` |
| 17 | Передана в тестирование клиенту | `new` |

**Не загружаем** — завершённые/закрытые/отклонённые:

| RC статус (status_st.id) | Название | Причина |
|--------------------------|----------|---------|
| 5 | Завершена | Уже реализована |
| 6 | Закрыта | Закрыта |
| 8 | Отклонена | Отклонена |
| 14 | Релиз | Уже в релизе |
| 15 | Архив | В архиве |

---

## Этапы реализации

### Этап 1: Подключение к MS SQL

**Зависимость**: npm-пакет `mssql` (MS SQL клиент для Node.js)

**Файл**: `server/rc-client.js`

```javascript
// Конфигурация из .env:
// RC_HOST=192.168.196.47
// RC_PORT=1433
// RC_DATABASE=Connect
// RC_USER=ggv_n8n
// RC_PASSWORD=0QPU+%;zk|UV

// Методы:
getTickets(systemId, moduleId, options)  // Список тикетов с фильтрами
getTicket(ticketId)                       // Детали тикета + переписка
getSystems()                              // Справочник систем
getModules(systemId)                      // Модули системы
getTicketComments(ticketId)               // Переписка по тикету
testConnection()                          // Проверка подключения
```

**SQL-запрос для получения тикетов:**

```sql
SELECT
    r.id AS rc_ticket_id,
    r.e_title AS title,
    r.e_message AS description,
    r.e_name AS author,
    r.e_mail AS author_email,
    r.add_date AS created_at,
    r.change_date AS updated_at,
    s.st_name AS status_name,
    r.status AS status_id,
    u.nameuser AS priority_name,
    r.urg AS priority_id,
    rt.name AS type_name,
    r.type AS type_id,
    r.system AS system_id,
    r.module AS module_id,
    sys.name AS system_name,
    m.namemod AS module_name,
    r.e_deadline AS deadline,
    r.dopinfo AS extra_info
FROM requests r
LEFT JOIN status_st s ON s.id = r.status
LEFT JOIN urg u ON u.id = r.urg
LEFT JOIN RequestType rt ON rt.id = r.type
LEFT JOIN systems sys ON sys.idsys = r.system
LEFT JOIN modules m ON m.idmod = r.module
WHERE r.system = @systemId
    AND (@moduleId IS NULL OR r.module = @moduleId)
    AND r.status NOT IN (5, 6, 8, 14, 15)  -- Исключить завершённые/закрытые/отклонённые/релиз/архив
ORDER BY r.add_date DESC
```

### Этап 2: База данных

**Миграция**: `013_rc_tickets.sql`

```sql
-- Добавляем rc_ticket_id в существующую таблицу задач
ALTER TABLE opii.kaizen_issues
    ADD COLUMN rc_ticket_id INTEGER;

CREATE INDEX idx_kaizen_issues_rc_ticket
    ON opii.kaizen_issues(rc_ticket_id);

-- Таблица-кэш тикетов RC
CREATE TABLE opii.kaizen_rc_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    rc_ticket_id INTEGER NOT NULL,
    rc_system_id INTEGER,
    rc_module_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    rc_status TEXT,
    rc_status_id SMALLINT,
    rc_priority TEXT,
    rc_priority_id SMALLINT,
    rc_type TEXT,
    rc_type_id SMALLINT,
    rc_author TEXT,
    rc_author_email TEXT,
    rc_created_at TIMESTAMPTZ,
    rc_updated_at TIMESTAMPTZ,
    rc_deadline DATE,
    issue_id UUID REFERENCES opii.kaizen_issues(id) ON DELETE SET NULL,
    sync_status TEXT DEFAULT 'new'
        CHECK (sync_status IN ('new', 'imported', 'ignored', 'closed_in_rc')),
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_kaizen_rc_tickets_unique
    ON opii.kaizen_rc_tickets(rc_ticket_id, product_id);
CREATE INDEX idx_kaizen_rc_tickets_product
    ON opii.kaizen_rc_tickets(product_id);
CREATE INDEX idx_kaizen_rc_tickets_sync
    ON opii.kaizen_rc_tickets(sync_status);

CREATE TRIGGER trg_kaizen_rc_tickets_updated
    BEFORE UPDATE ON opii.kaizen_rc_tickets
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_set_updated_at();
```

**Файл**: `server/db/rc-tickets.js` — CRUD: getByProduct, getById, upsert, updateSyncStatus, remove

### Этап 3: Логика синхронизации

**Файл**: `server/rc-sync.js`

**Процесс загрузки** (`syncTickets(productId)`) — запускается **вручную** по кнопке:

1. Загрузить продукт, проверить `rc_system_id`
2. Подключиться к MS SQL (Connect)
3. Запросить тикеты-бэклог по `system = rc_system_id` (+ `module = rc_module_id` если задан), `status NOT IN (5,6,8,14,15)`
4. Для каждого тикета:
   - Если уже есть в `kaizen_rc_tickets` → обновить поля (статус, дата, описание)
   - Если новый → вставить с `sync_status = 'new'`
5. Вернуть статистику: `{ new: N, updated: N, total: N }`

**Процесс импорта** (`importTicket(ticketId)` / `importBulk(ticketIds)`) — запускается **вручную**:

1. Взять тикет из `kaizen_rc_tickets`
2. Маппинг: priority_id → Kaizen priority, type_id → Kaizen type
3. Создать `kaizen_issues`: title, description, type, priority, status='open', **rc_ticket_id = тикет.rc_ticket_id**
4. Обновить `rc_ticket.issue_id` и `sync_status = 'imported'`
5. Вернуть созданную задачу

### Этап 4: API-эндпоинты (7 новых)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/rc/test` | Проверка подключения к MS SQL |
| GET | `/api/rc/systems` | Справочник систем RC |
| GET | `/api/rc/systems/:id/modules` | Модули системы RC |
| POST | `/api/products/:id/rc-sync` | Синхронизировать тикеты из RC |
| GET | `/api/products/:id/rc-tickets` | Список кэшированных тикетов (?sync_status=, ?since=) |
| POST | `/api/rc-tickets/:id/import` | Импортировать тикет → создать задачу |
| POST | `/api/rc-tickets/import-bulk` | Массовый импорт тикетов (?ticket_ids[]) |
| POST | `/api/rc-tickets/:id/ignore` | Пометить как игнорированный |
| GET | `/api/rc-tickets/:id` | Детали тикета (включая переписку из RC) |

### Этап 5: Frontend — вкладка «Тикеты RC»

**Страница продукта** (`product.html`) — новая 5-я вкладка:

```
[Задачи] [Релизы] [Процессы] [Планы] [Тикеты RC]
```

**Условие отображения**: только если у продукта заполнен `rc_system_id`.

**UI вкладки:**

```
┌─────────────────────────────────────────────────────────┐
│ Тикеты Rivc.Connect          [Синхронизировать]  [?/??] │
│                                                          │
│ Фильтр: [Новые] [Импортированные] [Игнорированные] [Все]│
│                                                          │
│ ☐ │ #ID    │ Тема           │ Статус RC   │ Приоритет │ …│
│ ☑ │ 139301 │ Ошибка экспорта│ В работе    │ Высокий   │  │
│ ☑ │ 139287 │ Добавить фильтр│ Новая       │ Обычный   │  │
│ ☐ │ 139265 │ Отчёт не грузит│ Завершена   │ Критично  │  │
│                                                          │
│ [Импортировать выбранные (2)]  [Игнорировать выбранные]  │
└─────────────────────────────────────────────────────────┘
```

**Поведение:**
- «Синхронизировать» → POST `/api/products/:id/rc-sync` → toast с результатом
- Чекбоксы для выбора тикетов → массовый импорт/игнорирование
- Клик на тикет → модал с деталями (описание, переписка из RC, дополнительная информация)
- Импортированные тикеты показывают ссылку на задачу Kaizen
- Бейдж на вкладке: количество новых тикетов

**Файл**: `public/js/product.js` — расширение существующей логики вкладок

### Этап 6: MCP-инструменты (4 новых)

| Tool | Описание |
|------|----------|
| `kaizen_rc_test` | Проверить подключение к Rivc.Connect |
| `kaizen_rc_sync` | Синхронизировать тикеты RC для продукта |
| `kaizen_rc_list_tickets` | Список тикетов RC (sync_status, product_id) |
| `kaizen_rc_import_tickets` | Импортировать тикеты → задачи Kaizen |

---

### Будущие доработки (v2)

- **Переписка по тикетам** — загрузка комментариев (requests_description) для просмотра истории обращения
- **Автоматическая синхронизация** — периодический sync через Scheduler (каждые 30 мин)
- **Обратная связь в RC** — обновление статусов тикетов в Rivc.Connect при закрытии в Kaizen (потребует INSERT/UPDATE права в Connect)

---

## Новые зависимости

| Пакет | Назначение |
|-------|-----------|
| `mssql` | MS SQL Server клиент для Node.js (TDS протокол) |

Устанавливается в основной package.json Kaizen (не в mcp-server).

---

## Конфигурация (.env)

Новые переменные:

```env
# Rivc.Connect MS SQL
RC_HOST=192.168.196.47
RC_PORT=1433
RC_DATABASE=Connect
RC_USER=ggv_n8n
RC_PASSWORD=0QPU+%;zk|UV
```

---

## Структура файлов (новые/изменённые)

```
server/
├── rc-client.js              # НОВЫЙ: MS SQL клиент к Rivc.Connect
├── rc-sync.js                # НОВЫЙ: Логика синхронизации и импорта
├── db/rc-tickets.js          # НОВЫЙ: CRUD для kaizen_rc_tickets
├── routes/api.js             # ИЗМЕНЁН: +7 эндпоинтов
database/migrations/
└── 013_rc_tickets.sql        # НОВЫЙ: Таблица kaizen_rc_tickets
public/
├── js/product.js             # ИЗМЕНЁН: +вкладка «Тикеты RC»
├── css/style.css             # ИЗМЕНЁН: стили вкладки
mcp-server/
├── index.js                  # ИЗМЕНЁН: +4 инструмента
└── api-client.js             # ИЗМЕНЁН: +4 метода
```

---

## Порядок реализации

| # | Задача | Зависит от | Описание |
|---|--------|------------|----------|
| 1 | Уточнить маппинг продуктов | — | Какой rc_system_id/rc_module_id у каждого продукта |
| 2 | `npm install mssql` | — | Добавить зависимость |
| 3 | `rc-client.js` | #2 | SQL-клиент, подключение, запросы |
| 4 | Миграция `013_rc_tickets.sql` | — | Таблица кэша тикетов |
| 5 | `db/rc-tickets.js` | #4 | CRUD для kaizen_rc_tickets |
| 6 | `rc-sync.js` | #3, #5 | Синхронизация + импорт |
| 7 | API-эндпоинты (7 шт.) | #6 | routes/api.js |
| 8 | Frontend: вкладка «Тикеты RC» | #7 | product.js + стили |
| 9 | MCP-инструменты (4 шт.) | #7 | mcp-server/ |
| 10 | Тестирование на реальных данных | #8 | Проверка через VPN |
| 11 | Документация | #9 | CLAUDE.md, README, USER_GUIDE, RELEASE_NOTES |

---

## Риски и ограничения

| Риск | Митигация |
|------|-----------|
| VPN недоступен → нет подключения к MS SQL | Кэш в PostgreSQL, работаем с последними данными |
| Большой объём тикетов (~93K) | Загружаем только бэклог (NOT IN 5,6,8,14,15), пагинация |
| Нет REST API у Rivc.Connect | Прямые SQL-запросы через `mssql` |
| Кодировка MS SQL (кириллица) | `mssql` поддерживает UTF-8 нативно |
| Медленные запросы к удалённому MS SQL | Таймауты, кэш, ручная загрузка по запросу |

---

## Решённые вопросы

- **Маппинг A-CDM** → Кобра (idsys=4), модуль Портал A-CDM (idmod=49) ✓
- **Маппинг РСР** → Кобра (idsys=4), модуль Рабочий стол руководителя (idmod=91) ✓
- **Глубина загрузки** → за всё время, фильтр только по статусам (бэклог) ✓
- **Импорт** → только ручной ✓
- **Обратная связь** → отложена на v2 ✓
- **Переписка** → отложена на v2 ✓
