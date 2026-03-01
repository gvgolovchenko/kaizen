# Спецификация: Функция «Подготовка спецификации релиза»

> Версия: 1.0
> Дата: 2026-03-01
> Статус: На согласовании

---

## 1. Описание функции

Пользователь выбирает задачи (issues) для релиза и нажимает **«Подготовить спецификацию»**. Система запускает асинхронный AI-процесс, который формирует Markdown-документ — полноценную спецификацию разработки. Готовый документ сохраняется в БД и доступен для просмотра, копирования и скачивания. Этот документ затем передаётся AI-модели (Claude Code или другой) для непосредственной разработки.

---

## 2. Два режима генерации

### Режим A — `claude-code`
**Когда активен**: выбранная AI-модель имеет `provider = 'claude-code'` И у продукта заполнено `project_path`.

**Принцип**: Claude Code сам читает файлы проекта через инструменты `Read`, `Glob`, `Grep`. Промпт компактный — даём задачи и контекст продукта, остальное Claude находит в коде.

**Что генерирует**: краткую спецификацию с акцентом на «что делать», без полного цитирования кода. Документ предполагает, что читатель имеет доступ к проекту.

### Режим B — `standalone`
**Когда активен**: любой другой провайдер (ollama, mlx, anthropic, openai, google) ИЛИ `project_path` не заполнен.

**Принцип**: файлы недоступны модели — сервер сам читает ключевые файлы (`CLAUDE.md`, `README.md`, структуру директорий) и вкладывает их содержимое в промпт. Документ должен быть **самодостаточным**.

**Что генерирует**: расширенную спецификацию с полным контекстом архитектуры, техтребованиями и критериями приёмки по каждой задаче.

---

## 3. Изменения в базе данных

### Миграция: `005_release_spec.sql`

```sql
-- 1. Добавить поле spec в таблицу релизов
ALTER TABLE opii.kaizen_releases
    ADD COLUMN IF NOT EXISTS spec TEXT;

-- 2. Добавить release_id в процессы (nullable — не все процессы связаны с релизом)
ALTER TABLE opii.kaizen_processes
    ADD COLUMN IF NOT EXISTS release_id UUID
        REFERENCES opii.kaizen_releases(id) ON DELETE SET NULL;

-- 3. Индекс для поиска процессов по релизу
CREATE INDEX IF NOT EXISTS idx_kaizen_processes_release
    ON opii.kaizen_processes(release_id)
    WHERE release_id IS NOT NULL;
```

**Затронутые таблицы**:
- `opii.kaizen_releases` — новое поле `spec TEXT` (nullable)
- `opii.kaizen_processes` — новое поле `release_id UUID` (nullable, FK)

**Обратная совместимость**: оба поля nullable, существующие процессы и релизы не затронуты.

---

## 4. Backend — новые эндпоинты

### 4.1 `POST /api/releases/:id/prepare-spec`

Создаёт процесс типа `prepare_spec` и запускает его fire-and-forget.

**Тело запроса:**
```json
{
  "model_id": "uuid-модели"
}
```

**Валидация:**
- Релиз существует → иначе `404`
- Релиз не опубликован (`status != 'released'`) → иначе `400 Release already published`
- `model_id` указан и модель существует → иначе `400`
- Релиз содержит хотя бы одну задачу → иначе `400 Release has no issues`

**Поведение:**
1. Создать запись в `kaizen_processes` с `type = 'prepare_spec'`, `release_id = id`, `product_id = release.product_id`
2. Запустить `runProcess(proc.id, { timeoutMs })` — fire-and-forget
3. Вернуть `201` с объектом процесса

**Ответ `201`:**
```json
{
  "id": "proc-uuid",
  "type": "prepare_spec",
  "status": "pending",
  "release_id": "release-uuid",
  "product_id": "product-uuid",
  "model_id": "model-uuid",
  "created_at": "..."
}
```

---

### 4.2 `GET /api/releases/:id/spec`

Возвращает текущую спецификацию релиза и статус последнего связанного процесса.

**Ответ `200`:**
```json
{
  "release_id": "uuid",
  "spec": "# Спецификация...",
  "process": {
    "id": "proc-uuid",
    "status": "completed",
    "completed_at": "...",
    "duration_ms": 45000,
    "model_name": "claude-sonnet-4-6"
  }
}
```

Если спецификации нет: `spec: null`, `process: null` (или последний процесс если он running/failed).

---

## 5. Backend — изменения в `process-runner.js`

### Структура

Добавить новую ветку в `runProcess()` по условию `proc.type === 'prepare_spec'`:

```
if (proc.type === 'prepare_spec') {
  await runPrepareSpec(processId, proc, product, model, startTime, timeoutMs);
  return;
}
// существующий код improve...
```

### Функция `runPrepareSpec()` — алгоритм

**Шаг 1 — Загрузить данные**
- Загрузить релиз с задачами: `releases.getById(proc.release_id)`
- Загрузить 3 последних опубликованных релиза продукта (для контекста истории)
- Определить режим: `isClaudeCode = model.provider === 'claude-code'`

**Шаг 2 — Собрать файловый контекст (только для режима B)**

Если НЕ claude-code И заполнен `product.project_path`:
```
fileContext = ''
Попробовать прочитать: project_path/CLAUDE.md   → если есть, добавить в fileContext
Попробовать прочитать: project_path/README.md   → если есть, добавить в fileContext
Получить список файлов верхнего уровня (readdir) → добавить структуру в fileContext
```
Ограничение: суммарный объём fileContext не более 8000 символов (обрезать README если длинный).

**Шаг 3 — Сформировать системный промпт**

Режим A (claude-code):
```
Ты — старший разработчик. Тебе предстоит разработать релиз продукта.
У тебя есть доступ к файлам проекта через инструменты Read, Glob, Grep.

Продукт: {product.name}
{product.description}
Стек: {product.tech_stack}
Путь к проекту: {product.project_path}

Изучи кодовую базу и сформируй подробную спецификацию разработки для задач релиза.
Верни ТОЛЬКО Markdown-документ. Никакого вводного текста.
```

Режим B (standalone):
```
Ты — старший разработчик. Тебе предстоит разработать релиз продукта.
Ниже весь контекст, необходимый для разработки.

Продукт: {product.name}
{product.description}
Стек: {product.tech_stack}
Репозиторий: {product.repo_url}

=== ДОКУМЕНТАЦИЯ ПРОЕКТА ===
{fileContext если есть}

Сформируй подробную самодостаточную спецификацию разработки для задач релиза.
Верни ТОЛЬКО Markdown-документ. Никакого вводного текста.
```

**Шаг 4 — Сформировать пользовательский промпт**

Одинаков для обоих режимов:
```
Подготовь спецификацию разработки для релиза:

Релиз: {release.name} v{release.version}
{release.description если есть}
Задач: {issues.length}

ЗАДАЧИ РЕЛИЗА:
{для каждой issue:}
### {i+1}. {issue.title} ({issue.type}, {issue.priority})
{issue.description}

ИСТОРИЯ РЕЛИЗОВ (последние {N}):
{для каждого прошлого релиза: version, name, количество задач}

Структура документа:
1. Заголовок и метаданные
2. Краткое резюме релиза
3. По каждой задаче: техтребования, место в коде, критерии приёмки
4. Общие замечания и зависимости между задачами
5. Порядок реализации
```

**Шаг 5 — Вызвать AI**

```javascript
const aiOptions = {};
if (isClaudeCode && product.project_path) aiOptions.cwd = product.project_path;
if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
const specText = await callAI(model, systemPrompt, userPrompt, aiOptions);
```

**Шаг 6 — Сохранить результат**

```javascript
// Сохранить spec в релиз
await pool.query(
  'UPDATE opii.kaizen_releases SET spec = $1 WHERE id = $2',
  [specText, proc.release_id]
);

// Сохранить в process.result
await processes.update(processId, {
  status: 'completed',
  result: { text: specText, mode: isClaudeCode ? 'claude-code' : 'standalone', char_count: specText.length },
  completed_at: new Date().toISOString(),
  duration_ms: Date.now() - startTime,
});
```

**Шаги логирования** (через `processLogs.create`):

| Шаг (step) | Сообщение |
|---|---|
| `request_sent` | `Запрос отправлен модели {name}, режим: {claude-code\|standalone}, задач: N` |
| `response_received` | `Ответ получен ({N} символов)` |
| `spec_saved` | `Спецификация сохранена в релиз {release.name}` |

---

## 6. Изменения в `server/db/releases.js`

Добавить функцию `saveSpec(releaseId, specText)`:
```javascript
export async function saveSpec(id, spec) {
  const { rows } = await pool.query(
    `UPDATE opii.kaizen_releases SET spec = $1 WHERE id = $2 RETURNING id, spec`,
    [spec, id]
  );
  return rows[0] || null;
}
```

---

## 7. Изменения в `server/db/processes.js`

Обновить функцию `create()` — добавить `release_id` в параметры и INSERT:
```javascript
export async function create({ product_id, model_id, type, input_prompt,
                               input_template_id, input_count, release_id }) {
  const { rows } = await pool.query(
    `INSERT INTO opii.kaizen_processes
       (product_id, model_id, type, input_prompt, input_template_id, input_count, release_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [product_id, model_id, type || 'improve', input_prompt || null,
     input_template_id || null, input_count || 5, release_id || null]
  );
  return rows[0];
}
```

---

## 8. Frontend — изменения в `public/product.html` + `public/js/product.js`

### 8.1 UI на карточке релиза

В каждой карточке релиза (рядом с кнопкой «Опубликовать») добавить:

**Если `spec` пустой** — кнопка:
```
[ 📋 Подготовить спецификацию ]
```

**Если процесс `prepare_spec` running/pending** — индикатор:
```
[ ⏳ Генерация спецификации... ]
```

**Если `spec` заполнен** — кнопка:
```
[ 📄 Открыть спецификацию ]
```

### 8.2 Модальное окно — выбор модели

При клике «Подготовить спецификацию» — показать модал:

```
┌─────────────────────────────────┐
│  Подготовить спецификацию       │
│                                 │
│  Модель: [выпадающий список]    │
│                                 │
│  Режим: claude-code / standalone│
│  (определяется автоматически)   │
│                                 │
│  [Отмена]   [Запустить]         │
└─────────────────────────────────┘
```

Режим показывается как информационный бейдж (не выбирается вручную — определяется по провайдеру выбранной модели и наличию `project_path`).

### 8.3 Polling

После запуска — polling каждые 4 секунды на `GET /api/processes/:id` (тот же механизм, что и для `improve`). По завершению — обновить карточку релиза.

### 8.4 Просмотр спецификации

При клике «Открыть спецификацию» — показать модал с:
- Заголовок: «Спецификация: {release.name}»
- Контент: `<pre>` с Markdown-текстом (моноширинный шрифт, прокрутка)
- Кнопка **«Скопировать»** — копирует текст в clipboard
- Кнопка **«Скачать .md»** — скачивает файл `spec-{release.version}.md`
- Метаинфо: дата генерации, модель, режим, количество символов

---

## 9. Изменения в `server/routes/api.js`

Добавить два новых роута (после блока Releases):

```javascript
// ── Release Spec ──────────────────────────────────────────

router.post('/releases/:id/prepare-spec', async (req, res) => { ... });
router.get('/releases/:id/spec', async (req, res) => { ... });
```

И добавить импорт `releases.saveSpec` в `process-runner.js`.

---

## 10. Порядок реализации

| # | Задача | Файл | Зависит от |
|---|---|---|---|
| 1 | Написать и применить миграцию | `database/migrations/005_release_spec.sql` | — |
| 2 | Обновить `db/processes.js` — добавить `release_id` | `server/db/processes.js` | 1 |
| 3 | Добавить `releases.saveSpec()` | `server/db/releases.js` | 1 |
| 4 | Добавить `runPrepareSpec()` в process-runner | `server/process-runner.js` | 2, 3 |
| 5 | Добавить роуты в api.js | `server/routes/api.js` | 4 |
| 6 | Frontend: кнопки и модал выбора модели | `public/js/product.js` | 5 |
| 7 | Frontend: polling и обновление карточки | `public/js/product.js` | 6 |
| 8 | Frontend: модал просмотра спецификации | `public/js/product.js` | 7 |

---

## 11. Ограничения и edge cases

| Ситуация | Поведение |
|---|---|
| Запустить повторно, когда spec уже есть | Разрешено — spec перезапишется новой версией |
| Релиз опубликован (`released`) | Кнопка «Подготовить» скрыта, только «Открыть» |
| Релиз без задач | `400 Release has no issues`, кнопка задизейблена |
| `project_path` не задан для claude-code | Fallback на standalone (без cwd) |
| Ответ модели пустой | `failed`, лог с ошибкой `Empty response from model` |
| Таймаут | Как у improve: настраиваемый, по умолчанию 20 мин |
| Параллельный запуск двух процессов для одного релиза | Разрешено — оба завершатся, последний перезапишет spec |

---

## 12. Что НЕ входит в эту версию

- Сохранение spec как файла в `project_path` (возможное развитие)
- Версионирование спецификаций (история изменений)
- Редактирование spec вручную в UI
- Рендеринг Markdown как HTML (показ в `<pre>`, не красивый рендер)

---

## Приложение A — Пример промпта (режим standalone)

```
[SYSTEM]
Ты — старший разработчик. Тебе предстоит разработать релиз продукта.
Ниже весь контекст, необходимый для разработки.

Продукт: Kaizen — система непрерывного улучшения продуктов
Описание: Отслеживает продукты компании, собирает задачи на улучшение...
Стек: Node.js, Express 5.1, Vanilla JS, PostgreSQL (Supabase)

=== ДОКУМЕНТАЦИЯ ПРОЕКТА ===
[содержимое CLAUDE.md]
[содержимое README.md — первые 3000 символов]

Сформируй подробную самодостаточную спецификацию разработки для задач релиза.
Верни ТОЛЬКО Markdown-документ. Никакого вводного текста.

[USER]
Подготовь спецификацию разработки для релиза:

Релиз: Деплой и Docker v2.0.0
Задач: 3

ЗАДАЧИ РЕЛИЗА:
### 1. Добавить Dockerfile (feature, high)
Создать Dockerfile для production-деплоя. Должен включать multi-stage build...

### 2. Настроить docker-compose.yml (feature, high)
...

### 3. Описать процедуру деплоя в README (improvement, medium)
...

ИСТОРИЯ РЕЛИЗОВ:
- v1.1.0 «AI-генерация задач» (5 задач, опубликован 2026-02-28)
- v1.0.0 «MVP» (12 задач, опубликован 2026-02-15)
```

---

## Приложение B — Ожидаемый формат выходного документа

```markdown
# Спецификация релиза: Деплой и Docker v2.0.0

> Продукт: Kaizen | Дата: 2026-03-01 | Задач: 3 | Режим: standalone

## Резюме
Данный релиз добавляет поддержку контейнеризации через Docker...

## Задача 1: Добавить Dockerfile

### Техническое требование
...

### Место реализации
- Создать файл `/Dockerfile` в корне проекта
- Изменить `/package.json` — добавить скрипт `start:prod`

### Критерии приёмки
- [ ] Docker build завершается без ошибок
- [ ] Контейнер запускается на порту 3034
- [ ] Переменные окружения передаются через .env

## Задача 2: ...

## Порядок реализации
1. Dockerfile (нет зависимостей)
2. docker-compose.yml (зависит от Dockerfile)
3. README (зависит от 1 и 2)

## Замечания
- Не забыть добавить .dockerignore
```
