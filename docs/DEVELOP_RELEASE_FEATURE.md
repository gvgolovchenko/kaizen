# Спецификация: Функция «Разработка релиза»

> Версия: 1.0
> Дата: 2026-03-01
> Статус: На согласовании
> Тип процесса: `develop_release`

---

## 1. Описание функции

Пользователь нажимает **«Разработать релиз»** на карточке релиза (кнопка активна только при наличии готовой спецификации). Система создаёт асинхронный процесс типа `develop_release` и запускает Claude Code в рабочей директории проекта. Claude самостоятельно: подготавливает git-ветку, изучает кодовую базу, реализует все задачи релиза, пишет тесты, добиваетсяих прохождения, делает коммит и пушит ветку. Пользователь может уйти заниматься другими делами и вернуться к готовой ветке.

---

## 2. Предусловия запуска (все обязательны)

| Условие | Проверка | Ошибка |
|---|---|---|
| У продукта задан `project_path` | `product.project_path` не пустой | `400 project_path is required` |
| Релиз имеет спецификацию | `release.spec` не null и не пустой | `400 Release spec is required` |
| Релиз не опубликован | `release.status !== 'released'` | `400 Release already published` |
| Релиз содержит задачи | `issues.length > 0` | `400 Release has no issues` |
| Модель — Claude Code | `model.provider === 'claude-code'` | `400 Only claude-code models are supported` |

---

## 3. Пользовательский сценарий

```
1. Страница продукта → карточка релиза
2. Кнопка «Разработать» активна (есть spec, статус draft)
3. Клик → модал: выбор модели, ветка, тест-команда, таймаут
4. Нажать «Запустить разработку» → процесс создан, модал закрыт
5. В карточке релиза: «⏳ Разработка...» + polling каждые 4с
6. Пользователь может закрыть страницу и вернуться
7. По завершении → карточка показывает «✅ kaizen/release-1.0.0 · abc1234 · тесты ✓»
```

---

## 4. Что делает Claude Code (строгий порядок)

```
Шаг 1 — Подготовка репозитория
  git pull
  git checkout -b {branch}
  (если ветка существует: git checkout {branch})

Шаг 2 — Изучение кодовой базы
  Glob/Read: структура проекта, ключевые файлы
  Понять паттерны и стиль кода перед написанием

Шаг 3 — Реализация всех задач
  Реализовать каждую задачу из спецификации
  Писать в стиле существующего проекта
  Не пропускать задачи

Шаг 4 — Написание тестов
  Написать тесты для каждого реализованного компонента
  Покрыть основные сценарии и граничные случаи

Шаг 5 — Проверка тестов (до 3 итераций)
  Запустить: {test_command}
  Если упали → проанализировать → исправить код → повторить
  После 3 неудачных итераций → зафиксировать ошибку, продолжить

Шаг 6 — Коммит и пуш
  git add -A
  git commit -m "feat: {version} — {name}"
  git push origin {branch}
  (если отклонён: git push --set-upstream origin {branch})

Шаг 7 — Итоговый JSON (последняя строка ответа)
  {"branch":"...","commit_hash":"...","files_changed":N,
   "tests_written":N,"tests_passed":true,"summary":"..."}
```

---

## 5. Параметры процесса

### Вводимые пользователем в модале

| Параметр | По умолчанию | Ограничения |
|---|---|---|
| `model_id` | — (обязателен) | Только `provider === 'claude-code'` |
| `git_branch` | `kaizen/release-{version}` | Строка, max 100 символов |
| `test_command` | Автоопределение по стеку | Строка, max 200 символов |
| `timeout_min` | `60` | 10–480 минут |

### Автоопределение `test_command` по `product.tech_stack`

```javascript
function detectTestCommand(techStack) {
  const s = (techStack || '').toLowerCase();
  if (s.includes('node') || s.includes('express') || s.includes('react') || s.includes('vue'))
    return 'npm test';
  if (s.includes('python') || s.includes('fastapi') || s.includes('django') || s.includes('flask'))
    return 'pytest';
  if (s.includes('go'))
    return 'go test ./...';
  if (s.includes('dotnet') || s.includes('c#') || s.includes('asp'))
    return 'dotnet test';
  if (s.includes('rust'))
    return 'cargo test';
  if (s.includes('java') || s.includes('spring'))
    return 'mvn test';
  return 'npm test'; // fallback
}
```

### Хранение конфигурации

Параметры `git_branch` и `test_command` сохраняются в `processes.input_prompt` как JSON:
```json
{
  "git_branch": "kaizen/release-1.0.0",
  "test_command": "npm test"
}
```

---

## 6. Изменения в базе данных

### Миграция: `006_develop_release.sql`

```sql
-- Новые поля в kaizen_releases для отслеживания разработки
ALTER TABLE opii.kaizen_releases
    ADD COLUMN IF NOT EXISTS dev_branch  TEXT,
    ADD COLUMN IF NOT EXISTS dev_commit  TEXT,
    ADD COLUMN IF NOT EXISTS dev_status  VARCHAR(20) DEFAULT 'none'
        CHECK (dev_status IN ('none', 'in_progress', 'done', 'failed'));

-- Trigger на updated_at уже есть (из 001_initial_schema.sql)

-- Индекс для поиска релизов в разработке
CREATE INDEX IF NOT EXISTS idx_kaizen_releases_dev_status
    ON opii.kaizen_releases(dev_status)
    WHERE dev_status != 'none';
```

**Зависимость**: Требует применения миграции `005` (release_id в kaizen_processes).

**Новые поля `kaizen_releases`**:

| Поле | Тип | Описание |
|---|---|---|
| `dev_branch` | TEXT | Имя созданной git-ветки |
| `dev_commit` | TEXT | Хэш коммита |
| `dev_status` | VARCHAR(20) | `none` / `in_progress` / `done` / `failed` |

---

## 7. Изменения в `server/ai-caller.js`

### Единственное изменение: параметризация `--tools`

Текущий код (строка 114) жёстко задаёт инструменты:
```javascript
'--tools', 'Read,Glob,Grep',
```

Заменить на:
```javascript
'--tools', (opts.allowedTools || ['Read', 'Glob', 'Grep']).join(','),
```

И добавить поддержку увеличенного буфера:
```javascript
const maxBuffer = (opts.maxBufferMb || 10) * 1024 * 1024;
const execOpts = { timeout, env, maxBuffer };
```

**Полная функция `callClaudeCode` после изменения:**
```javascript
async function callClaudeCode(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const tools = (opts.allowedTools || ['Read', 'Glob', 'Grep']).join(',');

    const args = [
      '-p',
      '--output-format', 'text',
      '--model', modelId,
      '--dangerously-skip-permissions',
      '--tools', tools,
      '--system-prompt', systemPrompt,
      '--',
      userPrompt,
    ];

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) delete env[key];
    }

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const maxBuffer = (opts.maxBufferMb || 10) * 1024 * 1024;
    const execOpts = { timeout, env, maxBuffer };
    if (opts.cwd) execOpts.cwd = opts.cwd;

    const child = execFile('claude', args, execOpts, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Claude Code error: ${err.message}`));
      resolve(stdout || '');
    });
    child.stdin.end();
  });
}
```

**Обратная совместимость**: полная — `allowedTools` и `maxBufferMb` необязательны, дефолты прежние.

---

## 8. Изменения в `server/db/releases.js`

Добавить функцию `updateDevInfo()`:

```javascript
export async function updateDevInfo(id, { dev_branch, dev_commit, dev_status }) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (dev_branch  !== undefined) { sets.push(`dev_branch  = $${i++}`); vals.push(dev_branch); }
  if (dev_commit  !== undefined) { sets.push(`dev_commit  = $${i++}`); vals.push(dev_commit); }
  if (dev_status  !== undefined) { sets.push(`dev_status  = $${i++}`); vals.push(dev_status); }
  if (sets.length === 0) return null;
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE opii.kaizen_releases SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0] || null;
}
```

---

## 9. Изменения в `server/process-runner.js`

### 9.1 Новая ветка по типу процесса

```javascript
if (proc.type === 'develop_release') {
  await runDevelopRelease(processId, proc, product, model, startTime, timeoutMs);
  return;
}
```

### 9.2 Вспомогательная функция `detectTestCommand()`

```javascript
function detectTestCommand(techStack) {
  const s = (techStack || '').toLowerCase();
  if (s.includes('node') || s.includes('express') || s.includes('react') || s.includes('vue'))
    return 'npm test';
  if (s.includes('python') || s.includes('fastapi') || s.includes('django') || s.includes('flask'))
    return 'pytest';
  if (s.includes('go'))    return 'go test ./...';
  if (s.includes('dotnet') || s.includes('c#')) return 'dotnet test';
  if (s.includes('rust'))  return 'cargo test';
  if (s.includes('java'))  return 'mvn test';
  return 'npm test';
}
```

### 9.3 Функция `runDevelopRelease()` — полный алгоритм

```javascript
async function runDevelopRelease(processId, proc, product, model, startTime, timeoutMs) {

  // 1. Загрузить релиз + задачи
  const release = await releases.getById(proc.release_id);
  if (!release)       throw new Error('Release not found');
  if (!release.spec)  throw new Error('Release spec is required for development');
  if (!product.project_path) throw new Error('product.project_path is required');

  // 2. Распарсить конфиг из input_prompt
  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const branchName  = config.git_branch   || `kaizen/release-${release.version}`;
  const testCommand = config.test_command || detectTestCommand(product.tech_stack);

  // 3. Пометить релиз как "в разработке"
  await releases.updateDevInfo(release.id, { dev_status: 'in_progress' });

  // 4. Системный промпт
  const systemPrompt = `Ты — опытный разработчик. Твоя задача — полностью реализовать релиз программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack  ? `Стек: ${product.tech_stack}`       : ''}
Путь к проекту: ${product.project_path}

СТРОГИЙ ПОРЯДОК ДЕЙСТВИЙ:

Шаг 1 — ПОДГОТОВКА РЕПОЗИТОРИЯ
  Выполни: git pull
  Создай ветку: git checkout -b ${branchName}
  (если ветка существует: git checkout ${branchName})

Шаг 2 — ИЗУЧЕНИЕ КОДОВОЙ БАЗЫ
  Изучи структуру проекта, ключевые файлы, архитектурные паттерны.
  Пойми стиль кода прежде чем писать.

Шаг 3 — РЕАЛИЗАЦИЯ ВСЕХ ЗАДАЧ
  Реализуй каждую задачу из спецификации полностью.
  Пиши код в стиле существующего проекта.
  Не пропускай задачи — реализуй все.

Шаг 4 — НАПИСАНИЕ ТЕСТОВ
  Напиши тесты для каждого реализованного компонента / функции / эндпоинта.
  Покрой основные сценарии использования и граничные случаи.

Шаг 5 — ПРОВЕРКА ТЕСТОВ (максимум 3 итерации)
  Запусти: ${testCommand}
  Если тесты упали:
    - Проанализируй ошибки
    - Исправь код (не тест, если только тест не содержит явную ошибку)
    - Запусти снова
  После 3 неудачных итераций: зафикисруй причину в summary и переходи к шагу 6.

Шаг 6 — КОММИТ И ПУШ
  git add -A
  git commit -m "feat: ${release.version} — ${release.name}"
  git push origin ${branchName}
  (если отклонён: git push --set-upstream origin ${branchName})
  Получи хэш коммита: git rev-parse HEAD

Шаг 7 — ИТОГОВЫЙ JSON
  Последней строкой ответа выведи ТОЛЬКО этот JSON (без пояснений):
  {"branch":"${branchName}","commit_hash":"<хэш>","files_changed":<N>,"tests_written":<N>,"tests_passed":<true|false>,"summary":"<краткое описание>"}

ПРАВИЛА:
- Не выходи за пределы ${product.project_path}
- Не создавай Pull Request
- При непреодолимой ошибке: опиши в summary, верни JSON с tests_passed: false`;

  // 5. Пользовательский промпт
  const issuesList = release.issues.map((iss, i) =>
    `### ${i + 1}. ${iss.title} (${iss.type}, ${iss.priority})\n${iss.description || '—'}`
  ).join('\n\n');

  const userPrompt = `Реализуй релиз:

ВЕТКА: ${branchName}
ТЕСТ-КОМАНДА: ${testCommand}

=== СПЕЦИФИКАЦИЯ ===
${release.spec}

=== ЗАДАЧИ РЕЛИЗА (${release.issues.length} шт.) ===
${issuesList}`;

  // 6. Лог: request_sent
  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: `Запрос отправлен Claude Code. Ветка: ${branchName}, задач: ${release.issues.length}`,
    data: { branch: branchName, test_command: testCommand, issues_count: release.issues.length,
            cwd: product.project_path },
  });

  // 7. Вызов Claude Code с полными инструментами
  const rawResponse = await callAI(model, systemPrompt, userPrompt, {
    cwd: product.project_path,
    timeoutMs,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
    maxBufferMb: 50,
  });

  // 8. Лог: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 9. Парсинг JSON из последней строки ответа
  const parsed = parseJsonFromAI(rawResponse);
  const result = parsed ? {
    branch:        parsed.branch        || branchName,
    commit_hash:   parsed.commit_hash   || null,
    files_changed: parsed.files_changed || null,
    tests_written: parsed.tests_written || null,
    tests_passed:  parsed.tests_passed  !== false,
    summary:       parsed.summary       || '',
  } : {
    branch:       branchName,
    commit_hash:  null,
    tests_passed: false,
    summary:      'Не удалось распарсить итоговый JSON',
    raw_tail:     rawResponse.slice(-2000),
  };

  // 10. Лог: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Ветка: ${result.branch} · коммит: ${result.commit_hash || '—'} · тесты: ${result.tests_passed ? 'пройдены' : 'не пройдены'}`,
    data: result,
  });

  // 11. Обновить процесс → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  // 12. Обновить релиз
  await releases.updateDevInfo(release.id, {
    dev_branch: result.branch,
    dev_commit: result.commit_hash,
    dev_status: result.tests_passed ? 'done' : 'failed',
  });
}
```

### 9.4 Обработка ошибок

В блоке `catch` основной функции `runProcess()` — добавить сброс `dev_status` на `failed`:

```javascript
// После стандартного логирования ошибки:
if (proc?.type === 'develop_release' && proc?.release_id) {
  await releases.updateDevInfo(proc.release_id, { dev_status: 'failed' }).catch(() => {});
}
```

---

## 10. Изменения в `server/routes/api.js`

### Новый импорт

```javascript
import { updateDevInfo } from '../db/releases.js'; // добавить к существующему import
```

### Новый роут

```javascript
// ── Release Development ───────────────────────────────────

router.post('/releases/:id/develop', async (req, res) => {
  try {
    const { model_id, git_branch, test_command, timeout_min } = req.body;

    // Загрузить релиз
    const release = await releases.getById(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });

    // Предусловия
    if (release.status === 'released')
      return res.status(400).json({ error: 'Release already published' });
    if (!release.spec)
      return res.status(400).json({ error: 'Release spec is required. Run prepare-spec first.' });
    if (!release.issues || release.issues.length === 0)
      return res.status(400).json({ error: 'Release has no issues' });

    if (!model_id) return res.status(400).json({ error: 'model_id is required' });

    const model = await aiModels.getById(model_id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (model.provider !== 'claude-code')
      return res.status(400).json({ error: 'Only claude-code models are supported for development' });

    const product = await products.getById(release.product_id);
    if (!product?.project_path)
      return res.status(400).json({ error: 'product.project_path is required for development' });

    // Определить параметры
    const branchName  = git_branch   || `kaizen/release-${release.version}`;
    const testCmd     = test_command || detectTestCommand(product.tech_stack);
    const timeoutMs   = Math.min(Math.max(parseInt(timeout_min) || 60, 10), 480) * 60 * 1000;

    // Создать процесс
    const proc = await processes.create({
      product_id:  release.product_id,
      model_id,
      type:        'develop_release',
      input_prompt: JSON.stringify({ git_branch: branchName, test_command: testCmd }),
      release_id:  release.id,
    });

    // Fire-and-forget
    runProcess(proc.id, { timeoutMs });

    res.status(201).json(proc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Примечание**: `detectTestCommand` нужно экспортировать из `process-runner.js` или продублировать в `api.js` (лучше — вынести в `utils.js`).

---

## 11. Frontend — `product.html`

### Новый модал

```html
<!-- Develop Release Modal -->
<div class="modal-overlay" id="developModal">
  <div class="modal" style="max-width:560px">
    <h2 id="developModalTitle">Разработать релиз</h2>

    <div class="form-group" style="padding:10px;background:rgba(251,191,36,0.08);
         border:1px solid rgba(251,191,36,0.3);border-radius:8px;margin-bottom:16px">
      <div style="font-size:0.85rem;color:var(--text-dim)">
        ⚠️ Claude Code будет изменять файлы в
        <code id="developProjectPath" style="color:var(--text)"></code>
      </div>
    </div>

    <div class="form-group">
      <label>Модель (только Claude Code) *</label>
      <select id="developModel" required onchange="handleDevelopModelChange()"></select>
    </div>

    <div class="form-group">
      <label>Ветка Git</label>
      <input type="text" id="developBranch" placeholder="kaizen/release-1.0.0">
    </div>

    <div class="form-group">
      <label>Команда для тестов</label>
      <input type="text" id="developTestCmd" placeholder="npm test">
      <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">
        Claude напишет тесты и проверит их этой командой
      </div>
    </div>

    <div class="form-group">
      <label>Таймаут (мин, 10–480)</label>
      <input type="number" id="developTimeout" value="60" min="10" max="480">
    </div>

    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal('developModal')">Отмена</button>
      <button type="button" class="btn btn-primary" onclick="handleDevelopStart()">
        🚀 Запустить разработку
      </button>
    </div>
  </div>
</div>
```

---

## 12. Frontend — `product.js`

### 12.1 Обновить `renderReleases()`

Для каждой карточки релиза добавить блок статуса разработки:

```javascript
function renderDevStatus(r) {
  const hasSpec = !!r.spec;

  if (r.dev_status === 'in_progress') {
    return `<div class="dev-status dev-status-running">
      ⏳ Разработка в процессе...
    </div>`;
  }

  if (r.dev_status === 'done') {
    const short = r.dev_commit ? r.dev_commit.slice(0, 7) : '';
    return `<div class="dev-status dev-status-done">
      ✅ <strong>${escapeHtml(r.dev_branch || '')}</strong>
      ${short ? `· <code>${short}</code>` : ''}
      · тесты ✓
    </div>`;
  }

  if (r.dev_status === 'failed') {
    return `<div class="dev-status dev-status-failed">
      ❌ Ошибка разработки
      ${r.status !== 'released'
        ? `<button class="btn btn-ghost btn-sm" onclick="showDevelopModal('${r.id}')">Повторить</button>`
        : ''}
    </div>`;
  }

  // dev_status === 'none'
  if (r.status === 'released') return '';

  return hasSpec
    ? `<button class="btn btn-primary btn-sm" onclick="showDevelopModal('${r.id}')">
         Разработать
       </button>`
    : `<button class="btn btn-ghost btn-sm" disabled title="Сначала подготовьте спецификацию">
         Разработать
       </button>`;
}
```

В `renderReleases()` вставить вызов `renderDevStatus(r)` в тело карточки релиза.

### 12.2 `showDevelopModal(releaseId)`

```javascript
window.showDevelopModal = async function (releaseId) {
  // Сохранить текущий releaseId для submit
  window._developReleaseId = releaseId;

  // Загрузить данные
  const release = await api(`/releases/${releaseId}`);
  const version = release.version;

  document.getElementById('developModalTitle').textContent =
    `Разработать: ${release.version} — ${release.name}`;
  document.getElementById('developProjectPath').textContent =
    product?.project_path || '—';
  document.getElementById('developBranch').value =
    `kaizen/release-${version}`;
  document.getElementById('developTestCmd').value =
    detectTestCommandFE(product?.tech_stack || '');
  document.getElementById('developTimeout').value = '60';

  // Загрузить только claude-code модели
  const models = await api('/ai-models');
  const ccModels = models.filter(m => m.provider === 'claude-code');
  const sel = document.getElementById('developModel');
  sel.innerHTML = ccModels.length === 0
    ? '<option value="">Нет Claude Code моделей</option>'
    : ccModels.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  openModal('developModal');
};
```

### 12.3 `handleDevelopStart()`

```javascript
window.handleDevelopStart = async function () {
  const releaseId  = window._developReleaseId;
  const modelId    = document.getElementById('developModel').value;
  const gitBranch  = document.getElementById('developBranch').value.trim();
  const testCmd    = document.getElementById('developTestCmd').value.trim();
  const timeoutMin = parseInt(document.getElementById('developTimeout').value) || 60;

  if (!modelId)   return toast('Выберите модель', 'error');
  if (!gitBranch) return toast('Укажите имя ветки', 'error');

  try {
    await api(`/releases/${releaseId}/develop`, {
      method: 'POST',
      body: { model_id: modelId, git_branch: gitBranch,
              test_command: testCmd, timeout_min: timeoutMin },
    });
    toast('Разработка запущена');
    closeModal('developModal');
    loadReleases();
    loadProcesses(); // запустит polling
  } catch (err) {
    toast(err.message, 'error');
  }
};
```

### 12.4 `detectTestCommandFE()` (клиентская версия)

```javascript
function detectTestCommandFE(techStack) {
  const s = techStack.toLowerCase();
  if (s.includes('node') || s.includes('express') || s.includes('react') || s.includes('vue'))
    return 'npm test';
  if (s.includes('python') || s.includes('fastapi') || s.includes('django'))
    return 'pytest';
  if (s.includes('go'))      return 'go test ./...';
  if (s.includes('dotnet') || s.includes('c#')) return 'dotnet test';
  if (s.includes('rust'))    return 'cargo test';
  if (s.includes('java'))    return 'mvn test';
  return 'npm test';
}
```

### 12.5 Обновить `showProcessDetail()` для типа `develop_release`

Для завершённого `develop_release` вместо списка предложений — показывать итог разработки:

```javascript
if (proc.type === 'develop_release' && proc.status === 'completed' && proc.result) {
  const r = proc.result;
  html += `
    <div>
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Результат разработки</div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:0.875rem">
        <div>Ветка: <strong>${escapeHtml(r.branch || '—')}</strong></div>
        <div>Коммит: <code>${escapeHtml(r.commit_hash?.slice(0, 7) || '—')}</code></div>
        <div>Изменено файлов: <strong>${r.files_changed ?? '—'}</strong></div>
        <div>Тестов написано: <strong>${r.tests_written ?? '—'}</strong></div>
        <div>Тесты: <strong style="color:${r.tests_passed ? 'var(--green)' : 'var(--red)'}">
          ${r.tests_passed ? '✅ пройдены' : '❌ не пройдены'}</strong></div>
        ${r.summary ? `<div style="margin-top:8px;color:var(--text-dim)">${escapeHtml(r.summary)}</div>` : ''}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
      </div>
    </div>`;
}
```

### 12.6 Обновить polling

Polling в `loadProcesses()` уже срабатывает при `pending`/`running`. После завершения `develop_release` нужно дополнительно перезагрузить релизы:

```javascript
function updateProcessPolling() {
  const hasActive = processesList.some(p => p.status === 'pending' || p.status === 'running');
  const hadActive = !!processPollingTimer;

  if (hasActive && !processPollingTimer) {
    processPollingTimer = setInterval(async () => {
      await loadProcesses();
      // Если только что завершился develop_release — обновить релизы
      const justDone = processesList.find(
        p => p.type === 'develop_release' && p.status === 'completed'
      );
      if (justDone) loadReleases();
    }, 4000);
  } else if (!hasActive && processPollingTimer) {
    clearInterval(processPollingTimer);
    processPollingTimer = null;
    if (hadActive) loadReleases(); // финальное обновление
  }
}
```

---

## 13. Порядок реализации

| # | Задача | Файл | Зависит от |
|---|---|---|---|
| 1 | Применить миграцию | `database/migrations/006_develop_release.sql` | 005 |
| 2 | Параметризовать `allowedTools` и `maxBufferMb` | `server/ai-caller.js` | — |
| 3 | Добавить `updateDevInfo()` | `server/db/releases.js` | 1 |
| 4 | Вынести `detectTestCommand()` в `server/utils.js` | `server/utils.js` | — |
| 5 | Добавить `runDevelopRelease()` в process-runner | `server/process-runner.js` | 3, 4 |
| 6 | Добавить роут `POST /releases/:id/develop` | `server/routes/api.js` | 5 |
| 7 | Добавить модал в HTML | `public/product.html` | — |
| 8 | Добавить функции + `renderDevStatus()` | `public/js/product.js` | 6, 7 |
| 9 | Обновить polling | `public/js/product.js` | 8 |

---

## 14. Ограничения и edge cases

| Ситуация | Поведение |
|---|---|
| Ветка уже существует в репозитории | Claude делает `git checkout {branch}` вместо `-b` |
| Тесты не проходят после 3 итераций | `tests_passed: false`, ветка всё равно пушится |
| `git push` провалился (нет прав, нет remote) | `tests_passed: false`, в summary описание ошибки |
| Claude не вернул JSON в последней строке | `result.commit_hash = null`, `dev_status = 'failed'` |
| Таймаут процесса (execFile timeout) | Process `failed`, `dev_status = 'failed'` |
| В проекте нет тестового фреймворка | Claude создаёт базовую тест-структуру с нуля |
| Параллельный запуск двух `develop_release` | Оба изменяют один `project_path` — конфликт. Кнопка не блокирует. Пользователь отвечает сам. |
| `dev_status = 'in_progress'`, сервер упал | Статус зависает. Решение: при рестарте сервера сбрасывать `in_progress → failed` (за рамками v1). |

---

## 15. Что НЕ входит в эту версию

- Pull Request (только ветка)
- Параллельная разработка нескольких релизов одновременно с блокировкой
- Просмотр `git diff` до или после
- Rollback (откат изменений из UI)
- Поддержка локальных/облачных моделей (только Claude Code)
- Сброс зависших `in_progress` при рестарте сервера

---

## Приложение A — Пример итогового JSON от Claude Code

```json
{
  "branch": "kaizen/release-2.0.0",
  "commit_hash": "a3f9c12d8e1b4567890abcdef1234567890abcd",
  "files_changed": 23,
  "tests_written": 14,
  "tests_passed": true,
  "summary": "Реализованы: JWT-авторизация (AuthService, AuthController, 3 эндпоинта), регистрация с email-верификацией, восстановление пароля. Написаны unit-тесты для AuthService (8 тестов) и integration-тесты для API (6 тестов). Все 14 тестов прошли успешно."
}
```

---

## Приложение B — Визуальные состояния карточки релиза

```
── dev_status: none, spec есть ─────────────────────────────
  [ 1.0.0 — MVP ]  [draft]
  Задач: 5
  [Показать задачи]  [Подготовить спецификацию ✓]  [Разработать ▶]

── dev_status: in_progress ─────────────────────────────────
  [ 1.0.0 — MVP ]  [draft]
  Задач: 5
  ⏳ Разработка в процессе...

── dev_status: done ─────────────────────────────────────────
  [ 1.0.0 — MVP ]  [draft]
  Задач: 5
  ✅ kaizen/release-1.0.0 · a3f9c12 · тесты ✓
  [Опубликовать]

── dev_status: failed ───────────────────────────────────────
  [ 1.0.0 — MVP ]  [draft]
  Задач: 5
  ❌ Ошибка разработки  [Повторить]
  [Опубликовать]

── dev_status: none, spec НЕТ ──────────────────────────────
  [ 1.0.0 — MVP ]  [draft]
  Задач: 5
  [Разработать] ← задизейблена, тултип: "Сначала подготовьте спецификацию"
```
