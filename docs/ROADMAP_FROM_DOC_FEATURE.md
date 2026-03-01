# Спецификация: Функция «Дорожная карта из документа»

> Версия: 1.0
> Дата: 2026-03-01
> Статус: На согласовании
> Подход: C — Умный однопроходный с точкой согласования

---

## 1. Описание функции

Пользователь вставляет текст документа (функциональные требования, BRD, ТЗ) и выбирает AI-модель. Система создаёт **асинхронный процесс** типа `roadmap_from_doc` и запускает его в фоне. Пользователь может закрыть страницу и вернуться позже. Когда процесс завершён — в таблице процессов появляется кнопка «Открыть дорожную карту», которая ведёт на **отдельную страницу** `roadmap.html`. На этой странице пользователь видит предложенную AI структуру (релизы + задачи), может выбрать что применить, и одним кликом создаёт всё в системе.

---

## 2. Пользовательский сценарий (user flow)

```
1. Пользователь открывает страницу продукта (product.html?id=...)
2. Нажимает кнопку «Дорожная карта из документа»
3. Вставляет текст документа в textarea
4. Выбирает AI-модель + таймаут
5. Нажимает «Запустить анализ» → процесс создан, модал закрыт
6. Пользователь занимается своими делами (polling в фоне)
7. Когда процесс завершён — в таблице процессов статус «completed»
8. Пользователь кликает по строке процесса → открывается roadmap.html?process_id=...
9. Видит предложенную дорожную карту: N релизов, каждый с M задачами
10. Снимает/отмечает чекбоксы по своему усмотрению
11. Нажимает «Применить дорожную карту»
12. Система создаёт релизы + задачи в одной транзакции → редирект на product.html
```

---

## 3. Два режима генерации

Идентичны механизму из RELEASE_SPEC_FEATURE.md:

| Условие | Режим | Принцип |
|---|---|---|
| `model.provider === 'claude-code'` И `product.project_path` заполнен | **claude-code** | Claude читает файлы сам через `cwd`. Промпт компактный. |
| Любой другой провайдер ИЛИ нет `project_path` | **standalone** | Сервер читает `CLAUDE.md` + `README.md` + структуру директорий, вкладывает в промпт. Документ самодостаточный. |

---

## 4. Изменения в базе данных

### Миграция: `005_roadmap.sql`

Нет новых таблиц. Используются существующие. Единственное изменение — добавить `release_id` в `kaizen_processes` (если это не было сделано в миграции 005 из RELEASE_SPEC_FEATURE):

```sql
-- Добавить release_id в processes (если ещё не добавлен)
ALTER TABLE opii.kaizen_processes
    ADD COLUMN IF NOT EXISTS release_id UUID
        REFERENCES opii.kaizen_releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kaizen_processes_release
    ON opii.kaizen_processes(release_id)
    WHERE release_id IS NOT NULL;
```

**Примечание**: Если миграция `005_release_spec.sql` уже применена — этот файл не нужен. Разработчик должен проверить наличие колонки перед применением.

### Хранение документа

Текст документа сохраняется в существующее поле `kaizen_processes.input_prompt` (TEXT, без ограничений длины). Специального поля не нужно.

### Хранение результата

Результат AI сохраняется в `kaizen_processes.result` (JSONB) в следующем формате:

```json
{
  "summary": "Краткое резюме дорожной карты (1–3 предложения)",
  "total_releases": 3,
  "total_issues": 14,
  "roadmap": [
    {
      "version": "1.0.0",
      "name": "MVP",
      "description": "Базовая функциональность для первого запуска",
      "issues": [
        {
          "title": "Авторизация пользователей",
          "description": "Реализовать вход по email/паролю с JWT-токенами",
          "type": "feature",
          "priority": "critical"
        }
      ]
    }
  ]
}
```

---

## 5. Backend — новые эндпоинты

### 5.1 `POST /api/processes` (существующий, расширение)

Используется существующий эндпоинт без изменений — только передаётся `type: 'roadmap_from_doc'` и `prompt` = текст документа. Валидация в `api.js` уже допускает любой тип.

**Тело запроса:**
```json
{
  "product_id": "uuid",
  "model_id": "uuid",
  "type": "roadmap_from_doc",
  "prompt": "# Функциональные требования\n\n## Модуль авторизации...",
  "timeout_min": 30
}
```

Поля `template_id` и `count` не используются для этого типа (игнорируются).

---

### 5.2 `POST /api/processes/:id/approve-roadmap` (новый)

Создаёт выбранные релизы и задачи из предложенной дорожной карты в одной транзакции.

**Тело запроса:**
```json
{
  "releases": [
    {
      "release_index": 0,
      "version": "1.0.0",
      "name": "MVP",
      "description": "...",
      "issue_indices": [0, 2]
    },
    {
      "release_index": 1,
      "version": "1.1.0",
      "name": "Расширение",
      "description": "...",
      "issue_indices": [0, 1, 2]
    }
  ]
}
```

**Поля:**
- `release_index` — индекс релиза в `process.result.roadmap[]`
- `issue_indices` — индексы выбранных задач в `roadmap[release_index].issues[]`
- Если `releases` содержит релиз без задач (`issue_indices: []`) — релиз всё равно создаётся, но без задач

**Валидация:**
- Процесс существует → иначе `404`
- `proc.type === 'roadmap_from_doc'` → иначе `400 Wrong process type`
- `proc.status === 'completed'` → иначе `400 Process not completed`
- `releases` — непустой массив → иначе `400`
- Индексы не выходят за границы `roadmap[]` и `issues[]` → выходящие за границы пропускаются молча

**Транзакционная логика:**
```
BEGIN
  для каждого release в releases[]:
    1. Создать релиз: INSERT INTO kaizen_releases (product_id, version, name, description)
    2. для каждого issue_index в release.issue_indices:
       a. Создать задачу: INSERT INTO kaizen_issues (product_id, title, description, type, priority)
       b. Связать с релизом: INSERT INTO kaizen_release_issues (release_id, issue_id)
       c. Обновить статус задачи: UPDATE kaizen_issues SET status = 'in_release'
COMMIT
```

**Ответ `201`:**
```json
{
  "created_releases": 2,
  "created_issues": 5,
  "releases": [
    { "id": "uuid", "version": "1.0.0", "name": "MVP", "issue_count": 2 },
    { "id": "uuid", "version": "1.1.0", "name": "Расширение", "issue_count": 3 }
  ]
}
```

---

## 6. Backend — изменения в `process-runner.js`

### Структура

Добавить ветку по типу процесса:

```javascript
if (proc.type === 'roadmap_from_doc') {
  await runRoadmapFromDoc(processId, proc, product, model, startTime, timeoutMs);
  return;
}
```

### Функция `runRoadmapFromDoc()` — алгоритм

**Шаг 1 — Определить режим**
```javascript
const isClaudeCode = model.provider === 'claude-code';
const hasPath = isClaudeCode && product.project_path;
```

**Шаг 2 — Собрать файловый контекст (только режим standalone)**

Если не claude-code И `product.project_path` есть:
```
fileContext = ''
Попробовать прочитать: project_path/CLAUDE.md   → добавить (max 4000 символов)
Попробовать прочитать: project_path/README.md   → добавить (max 3000 символов)
Попробовать получить fs.readdirSync(project_path) → добавить список файлов верхнего уровня
Итого fileContext: max 8000 символов
```

**Шаг 3 — Системный промпт**

Режим claude-code:
```
Ты — опытный технический аналитик и архитектор. Тебе предстоит создать дорожную карту
разработки на основе документа с требованиями.

Продукт: {product.name}
{product.description ? `Описание: ${product.description}` : ''}
{product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
Путь к проекту: {product.project_path}

У тебя есть доступ к файлам проекта (Read, Glob, Grep). Используй их для понимания
текущего состояния кодовой базы перед составлением дорожной карты.

ВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON.
Не используй <think> блоки.
```

Режим standalone:
```
Ты — опытный технический аналитик и архитектор. Тебе предстоит создать дорожную карту
разработки на основе документа с требованиями.

Продукт: {product.name}
{product.description}
Стек: {product.tech_stack}
Репозиторий: {product.repo_url}

{fileContext.length > 0 ? `=== ДОКУМЕНТАЦИЯ И АРХИТЕКТУРА ПРОЕКТА ===\n${fileContext}` : ''}

ВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON.
Не используй <think> блоки.
```

**Шаг 4 — Пользовательский промпт** (одинаков для обоих режимов)

```
Проанализируй следующий документ с требованиями и создай дорожную карту разработки.

=== ДОКУМЕНТ ===
{proc.input_prompt}
=== КОНЕЦ ДОКУМЕНТА ===

Разбей требования на логические этапы (релизы) и задачи. Каждый релиз должен быть
самодостаточным и приносить ценность. Учитывай зависимости между задачами при определении
порядка релизов.

Верни JSON строго в следующем формате:
{
  "summary": "Краткое описание дорожной карты (2-4 предложения)",
  "total_releases": <число>,
  "total_issues": <число>,
  "roadmap": [
    {
      "version": "1.0.0",
      "name": "Название релиза",
      "description": "Что войдёт в этот релиз и какую ценность принесёт",
      "issues": [
        {
          "title": "Краткое название задачи (до 150 символов)",
          "description": "Подробное описание что нужно сделать и зачем",
          "type": "feature | improvement | bug",
          "priority": "critical | high | medium | low"
        }
      ]
    }
  ]
}
```

**Шаг 5 — Вызов AI**
```javascript
const aiOptions = {};
if (hasPath) aiOptions.cwd = product.project_path;
if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
const rawResponse = await callAI(model, systemPrompt, userPrompt, aiOptions);
```

**Шаг 6 — Парсинг и валидация**
```javascript
const parsed = parseJsonFromAI(rawResponse);

// Структурная валидация
if (!parsed || !Array.isArray(parsed.roadmap) || parsed.roadmap.length === 0) {
  throw new Error('Invalid roadmap structure in AI response');
}

const validTypes = ['feature', 'improvement', 'bug'];
const validPriorities = ['critical', 'high', 'medium', 'low'];

const roadmap = parsed.roadmap.map(release => ({
  version: String(release.version || '').slice(0, 20),
  name: String(release.name || '').slice(0, 100),
  description: String(release.description || ''),
  issues: Array.isArray(release.issues) ? release.issues
    .map(i => ({
      title: String(i.title || '').slice(0, 200),
      description: String(i.description || ''),
      type: validTypes.includes(i.type) ? i.type : 'feature',
      priority: validPriorities.includes(i.priority) ? i.priority : 'medium',
    }))
    .filter(i => i.title.length > 0) : [],
})).filter(r => r.version.length > 0 && r.name.length > 0);

const result = {
  summary: String(parsed.summary || ''),
  total_releases: roadmap.length,
  total_issues: roadmap.reduce((sum, r) => sum + r.issues.length, 0),
  roadmap,
};
```

**Шаг 7 — Сохранить результат**
```javascript
await processes.update(processId, {
  status: 'completed',
  result, // JSONB
  completed_at: new Date().toISOString(),
  duration_ms: Date.now() - startTime,
});
```

**Шаги логирования:**

| step | Сообщение |
|---|---|
| `request_sent` | `Запрос отправлен модели {name}, режим: {mode}, документ: {N} символов` |
| `response_received` | `Ответ получен ({N} символов)` |
| `parse_result` | `Дорожная карта: {N} релизов, {M} задач` |

---

## 7. Изменения в `server/routes/api.js`

### 7.1 Добавить новый роут `approve-roadmap`

После блока `processes`:
```javascript
// ── Roadmap ───────────────────────────────────────────────

router.post('/processes/:id/approve-roadmap', async (req, res) => {
  // Полная логика с транзакцией
});
```

### 7.2 Обновить логику создания процесса

В `POST /api/processes` — убрать проверку `if (!prompt && !template_id)` ИЛИ добавить исключение для типа `roadmap_from_doc`:

```javascript
// Для roadmap_from_doc prompt = текст документа, template_id не нужен
if (type !== 'roadmap_from_doc' && !prompt && !template_id) {
  return res.status(400).json({ error: 'prompt or template_id is required' });
}
if (type === 'roadmap_from_doc' && !prompt) {
  return res.status(400).json({ error: 'prompt (document text) is required for roadmap_from_doc' });
}
```

---

## 8. Frontend — изменения в `product.html` + `product.js`

### 8.1 Новая кнопка в заголовке продукта

Добавить рядом с кнопкой «Улучшение продукта»:
```html
<button class="btn btn-ghost btn-sm" onclick="showRoadmapModal()">
  Дорожная карта из документа
</button>
```

### 8.2 Новый модал — запуск процесса

```html
<!-- Roadmap from Doc Modal -->
<div class="modal-overlay" id="roadmapModal">
  <div class="modal" style="max-width:680px">
    <h2>Дорожная карта из документа</h2>

    <div class="form-group">
      <label>Текст документа *</label>
      <textarea id="roadmapDocText" rows="10" required
        placeholder="Вставьте текст документа: функциональные требования, BRD, ТЗ..."></textarea>
      <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">
        Поддерживается обычный текст и Markdown
      </div>
    </div>

    <div class="form-group">
      <label>Модель ИИ *</label>
      <select id="roadmapModel" required></select>
    </div>

    <div class="form-group">
      <label>Режим</label>
      <div id="roadmapModeInfo"
        style="font-size:0.85rem;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text-dim)">
        Выберите модель для определения режима
      </div>
    </div>

    <div class="form-group">
      <label>Таймаут (минуты, 3–60)</label>
      <input type="number" id="roadmapTimeout" value="30" min="3" max="60">
    </div>

    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal('roadmapModal')">Отмена</button>
      <button type="button" class="btn btn-primary" onclick="handleRoadmapGenerate()">
        Запустить анализ
      </button>
    </div>
  </div>
</div>
```

### 8.3 Логика в `product.js`

**`showRoadmapModal()`** — загружает модели, заполняет select, открывает модал.

**`handleRoadmapModelChange()`** — при смене модели обновляет `#roadmapModeInfo`:
- Если провайдер `claude-code` И у продукта заполнен `project_path` → показать бейдж `🤖 claude-code — читает файлы проекта`
- Иначе → `📄 standalone — самодостаточный контекст`

**`handleRoadmapGenerate()`**:
```javascript
const docText = document.getElementById('roadmapDocText').value.trim();
const modelId = document.getElementById('roadmapModel').value;
const timeoutMin = parseInt(document.getElementById('roadmapTimeout').value) || 30;

if (!docText) return toast('Вставьте текст документа', 'error');
if (!modelId) return toast('Выберите модель', 'error');

await api('/processes', {
  method: 'POST',
  body: {
    product_id: productId,
    model_id: modelId,
    type: 'roadmap_from_doc',
    prompt: docText,
    timeout_min: timeoutMin,
  },
});

toast('Анализ запущен. Следите за статусом в таблице процессов.');
closeModal('roadmapModal');
loadProcesses();
```

### 8.4 Переопределить поведение клика на процессе

В функции `showProcessDetail()` — добавить в начало проверку:
```javascript
// Roadmap processes open in a separate page
if (proc.type === 'roadmap_from_doc') {
  window.location.href = `/roadmap.html?process_id=${id}&product_id=${productId}`;
  return;
}
```

### 8.5 Обновить `renderProcesses()` — визуальный маркер

Для строки с типом `roadmap_from_doc` и статусом `completed` — добавить кнопку-ссылку в последней колонке:
```javascript
const isRoadmapDone = p.type === 'roadmap_from_doc' && p.status === 'completed';
// ...
<td>
  ${isRoadmapDone
    ? `<button class="btn btn-primary btn-sm"
         onclick="event.stopPropagation(); window.location.href='/roadmap.html?process_id=${p.id}&product_id=${productId}'">
         Открыть дорожную карту
       </button>`
    : ''
  }
  <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Уд.</button>
</td>
```

---

## 9. Новая страница `public/roadmap.html`

Полностью новый файл. URL: `/roadmap.html?process_id=...&product_id=...`

### 9.1 Структура страницы

```
[Nav — стандартный]
[← Назад к продукту]

[Заголовок: "Дорожная карта: {product.name}"]
[Метаданные: модель, режим, статус, длительность]

--- Состояния ---

[PENDING/RUNNING]:
  Спиннер + "Анализ выполняется..." + автообновление каждые 4с

[FAILED]:
  Блок с ошибкой + кнопка "Назад"

[COMPLETED]:
  [Блок резюме от AI]

  [Блок управления: "Выбрать все" / "Снять все" | Счётчик: N релизов, M задач]

  [Карточки релизов]:
  ┌─────────────────────────────────────────────────────┐
  │ ☑ 1.0.0 — MVP                                       │
  │   Базовая функциональность для первого запуска      │
  │                                                     │
  │   ☑ [feature] [critical] Авторизация пользователей  │
  │     Реализовать вход по email/паролю...             │
  │   ☑ [feature] [high]     Регистрация                │
  │   ☐ [improvement] [low]  Документация API           │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │ ☑ 1.1.0 — Расширение                                │
  │   ...                                               │
  └─────────────────────────────────────────────────────┘

  [Итого выбрано: 2 релиза, 5 задач]

  [Отмена]   [✓ Применить дорожную карту (2 р. / 5 з.)]
```

### 9.2 Файл `public/roadmap.html`

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Kaizen — Дорожная карта</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-inner">
      <a href="/" class="nav-logo"><span>改</span> Kaizen</a>
      <div class="nav-links">
        <a href="/">Продукты</a>
        <a href="/processes.html">Процессы</a>
        <a href="/models.html">Модели ИИ</a>
      </div>
    </div>
  </nav>

  <div class="container">
    <a id="backLink" href="/" class="back-link">&larr; К продукту</a>

    <div id="pageHeader" class="product-header">
      <h1 id="pageTitle">Дорожная карта</h1>
      <div id="pageMeta" class="product-meta"></div>
    </div>

    <div id="stateLoading" class="section" style="display:none">
      <div class="empty">
        <div class="spinner"></div>
        <p id="loadingMsg">Загрузка...</p>
      </div>
    </div>

    <div id="stateFailed" class="section" style="display:none">
      <div id="failedError"
        style="padding:16px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px">
      </div>
    </div>

    <div id="stateCompleted" style="display:none">
      <div id="summaryBlock" class="section"></div>
      <div class="section">
        <div class="section-header">
          <h2 id="roadmapTitle">Предложенная дорожная карта</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="toggleAll(true)">Выбрать все</button>
            <button class="btn btn-ghost btn-sm" onclick="toggleAll(false)">Снять все</button>
            <span id="selectionCount" style="font-size:0.85rem;color:var(--text-dim)"></span>
          </div>
        </div>
        <div id="roadmapList"></div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 0 32px">
        <button class="btn btn-ghost" onclick="goBack()">Отмена</button>
        <button class="btn btn-primary" id="applyBtn" onclick="handleApply()">
          Применить дорожную карту
        </button>
      </div>
    </div>
  </div>

  <script type="module" src="/js/roadmap.js"></script>
</body>
</html>
```

### 9.3 Файл `public/js/roadmap.js`

**Инициализация:**
```javascript
const params = new URLSearchParams(location.search);
const processId = params.get('process_id');
const productId = params.get('product_id');

if (!processId || !productId) location.href = '/';
document.getElementById('backLink').href = `/product.html?id=${productId}`;

let proc = null;
let product = null;
let pollingTimer = null;
```

**`init()`** — загружает продукт + процесс, определяет начальное состояние.

**`renderState(proc)`**:
- `pending` / `running` → показать `#stateLoading`, запустить polling (4с)
- `failed` → показать `#stateFailed` с текстом ошибки + логами
- `completed` → показать `#stateCompleted`, вызвать `renderRoadmap(proc.result)`

**Polling**: стандартный `setInterval(loadProcess, 4000)`, при смене статуса — очистить таймер и перерендерить.

**`renderRoadmap(result)`**:
```javascript
// Показать summary
document.getElementById('summaryBlock').innerHTML = `
  <div style="..."> ${escapeHtml(result.summary)} </div>
`;

// Рендер релизов
document.getElementById('roadmapList').innerHTML = result.roadmap.map((release, ri) => `
  <div class="release-card" style="margin-bottom:16px">
    <div class="release-card-header">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1">
        <input type="checkbox" class="release-checkbox" data-release-index="${ri}"
               checked onchange="onReleaseToggle(${ri}, this.checked)">
        <h3 style="margin:0">
          ${escapeHtml(release.version)} — ${escapeHtml(release.name)}
        </h3>
      </label>
      <span style="font-size:0.85rem;color:var(--text-dim)">${release.issues.length} задач</span>
    </div>
    ${release.description ? `
      <p style="color:var(--text-dim);font-size:0.875rem;margin:8px 0">${escapeHtml(release.description)}</p>
    ` : ''}
    <div class="release-issues" style="display:block" id="release-issues-${ri}">
      ${release.issues.map((issue, ii) => `
        <label class="release-issue" style="cursor:pointer">
          <input type="checkbox" class="issue-checkbox"
                 data-release-index="${ri}" data-issue-index="${ii}"
                 checked onchange="updateCount()">
          <span>
            <span class="badge badge-${issue.type}">${issue.type}</span>
            <span class="badge badge-${issue.priority}">${issue.priority}</span>
            ${escapeHtml(issue.title)}
          </span>
          ${issue.description ? `
            <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;padding-left:4px">
              ${escapeHtml(issue.description.slice(0, 200))}${issue.description.length > 200 ? '...' : ''}
            </div>
          ` : ''}
        </label>
      `).join('')}
    </div>
  </div>
`).join('');

updateCount();
```

**`onReleaseToggle(releaseIndex, checked)`** — при клике на чекбокс релиза переключает все задачи этого релиза + вызывает `updateCount()`.

**`toggleAll(state)`** — переключает все чекбоксы (релизы + задачи) + `updateCount()`.

**`updateCount()`** — считает выбранные релизы и задачи, обновляет `#selectionCount` и текст кнопки `#applyBtn`:
```javascript
function updateCount() {
  const releaseChecks = document.querySelectorAll('.release-checkbox:checked');
  const issueChecks = document.querySelectorAll('.issue-checkbox:checked');
  const rCount = releaseChecks.length;
  const iCount = issueChecks.length;
  document.getElementById('selectionCount').textContent = `Выбрано: ${rCount} р. / ${iCount} з.`;
  const btn = document.getElementById('applyBtn');
  btn.textContent = `Применить дорожную карту (${rCount} р. / ${iCount} з.)`;
  btn.disabled = rCount === 0;
}
```

**`handleApply()`** — собирает выбранное и отправляет:
```javascript
async function handleApply() {
  const roadmap = proc.result.roadmap;
  const releases = [];

  roadmap.forEach((release, ri) => {
    const releaseCheckbox = document.querySelector(`.release-checkbox[data-release-index="${ri}"]`);
    if (!releaseCheckbox?.checked) return;

    const issueIndices = [];
    document.querySelectorAll(`.issue-checkbox[data-release-index="${ri}"]:checked`)
      .forEach(cb => issueIndices.push(parseInt(cb.dataset.issueIndex)));

    releases.push({
      release_index: ri,
      version: release.version,
      name: release.name,
      description: release.description,
      issue_indices: issueIndices,
    });
  });

  if (releases.length === 0) return toast('Выберите хотя бы один релиз', 'error');

  try {
    const result = await api(`/processes/${processId}/approve-roadmap`, {
      method: 'POST',
      body: { releases },
    });
    toast(`Создано: ${result.created_releases} релизов, ${result.created_issues} задач`);
    window.location.href = `/product.html?id=${productId}`;
  } catch (err) {
    toast(err.message, 'error');
  }
}
```

**`goBack()`** — `window.location.href = /product.html?id=${productId}`.

---

## 10. Порядок реализации

| # | Задача | Файл | Зависит от |
|---|---|---|---|
| 1 | Написать и применить миграцию | `database/migrations/005_roadmap.sql` | — |
| 2 | Добавить `runRoadmapFromDoc()` в process-runner | `server/process-runner.js` | — |
| 3 | Добавить роут `approve-roadmap` | `server/routes/api.js` | 2 |
| 4 | Обновить валидацию в `POST /api/processes` | `server/routes/api.js` | — |
| 5 | Создать `roadmap.html` | `public/roadmap.html` | — |
| 6 | Создать `roadmap.js` | `public/js/roadmap.js` | 3, 5 |
| 7 | Добавить модал и кнопку на product.html | `public/product.html` | — |
| 8 | Добавить функции в product.js | `public/js/product.js` | 3, 7 |
| 9 | Добавить навигацию на roadmap.html при клике | `public/js/product.js` | 5, 8 |
| 10 | Добавить CSS для спиннера (если нет) | `public/css/style.css` | — |

---

## 11. Ограничения и edge cases

| Ситуация | Поведение |
|---|---|
| AI вернул невалидный JSON | `failed`, лог `parse_error` с первыми 2000 символами ответа |
| AI вернул пустой roadmap (`roadmap: []`) | `failed`, лог `Empty roadmap in response` |
| Релиз без задач в approve-roadmap | Релиз создаётся без задач (допустимо, как placeholder) |
| Повторный approve одного и того же процесса | Разрешено — создадутся дублирующие релизы, пользователь сам отвечает за повторный запуск |
| Пользователь открывает roadmap.html с pending процессом | Показывается экран ожидания с автополлингом — дожидается завершения |
| Очень длинный документ (>100k символов) | Принимается (input_prompt TEXT без ограничений), но модель может обрезать — это зона ответственности пользователя |
| product_id не совпадает с process.product_id | `approve-roadmap` проверяет соответствие → `403` |

---

## 12. Что НЕ входит в эту версию

- Загрузка файла (upload .docx/.pdf) — только текстовое поле
- Редактирование предложенных релизов/задач перед применением (только выбор чекбоксами)
- Drag & drop задач между релизами
- Сохранение частичного выбора без применения
- История применённых roadmap-процессов

---

## Приложение A — Пример входного документа

```markdown
# Требования: Система управления задачами

## Авторизация
- Вход по email/паролю
- Регистрация с подтверждением email
- Восстановление пароля
- JWT-токены с refresh

## Задачи
- Создание задач с полями: название, описание, приоритет, исполнитель
- Статусы: открыта, в работе, на проверке, закрыта
- Фильтрация и поиск
- Комментарии к задачам

## Уведомления
- Email при назначении задачи
- Push-уведомления (PWA)
```

---

## Приложение B — Ожидаемый JSON-ответ AI

```json
{
  "summary": "Дорожная карта включает 3 релиза. MVP охватывает авторизацию и базовую работу с задачами. Второй релиз добавляет расширенные возможности. Третий релиз внедряет систему уведомлений.",
  "total_releases": 3,
  "total_issues": 9,
  "roadmap": [
    {
      "version": "1.0.0",
      "name": "MVP: Авторизация и задачи",
      "description": "Базовая функциональность: регистрация, вход и управление задачами.",
      "issues": [
        {
          "title": "Авторизация по email/паролю с JWT",
          "description": "Реализовать endpoint POST /auth/login, выдача access + refresh токенов.",
          "type": "feature",
          "priority": "critical"
        },
        {
          "title": "Регистрация с подтверждением email",
          "description": "Форма регистрации, отправка письма с ссылкой-подтверждением.",
          "type": "feature",
          "priority": "high"
        },
        {
          "title": "CRUD задач (создание, редактирование, удаление)",
          "description": "Полный цикл управления задачами с полями: название, описание, приоритет.",
          "type": "feature",
          "priority": "critical"
        }
      ]
    },
    {
      "version": "1.1.0",
      "name": "Расширение: статусы и фильтрация",
      "description": "Углублённая работа с задачами.",
      "issues": [
        {
          "title": "Статусная машина задач",
          "description": "Переходы: открыта → в работе → на проверке → закрыта.",
          "type": "feature",
          "priority": "high"
        },
        {
          "title": "Фильтрация и поиск задач",
          "description": "Фильтры по статусу, исполнителю, приоритету. Full-text поиск по названию.",
          "type": "feature",
          "priority": "medium"
        },
        {
          "title": "Комментарии к задачам",
          "description": "Пользователи могут оставлять комментарии с поддержкой Markdown.",
          "type": "feature",
          "priority": "medium"
        }
      ]
    },
    {
      "version": "1.2.0",
      "name": "Уведомления",
      "description": "Система оповещений пользователей.",
      "issues": [
        {
          "title": "Email-уведомление при назначении задачи",
          "description": "Отправка письма через SMTP при смене исполнителя задачи.",
          "type": "feature",
          "priority": "high"
        },
        {
          "title": "Push-уведомления (PWA)",
          "description": "Web Push API: регистрация subscription, отправка через service worker.",
          "type": "feature",
          "priority": "medium"
        },
        {
          "title": "Восстановление пароля",
          "description": "Форма запроса восстановления, письмо с one-time ссылкой, форма смены пароля.",
          "type": "feature",
          "priority": "medium"
        }
      ]
    }
  ]
}
```
