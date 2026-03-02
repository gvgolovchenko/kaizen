import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate } from './app.js';

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.href = '/';

let product = null;
let issues = [];
let releases = [];
let processesList = [];
let currentFilter = '';
let processPollingTimer = null;

// ── Tabs ────────────────────────────────────────────────

function switchTab(tabName) {
  document.querySelectorAll('#productTabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tabName}`));
}

document.getElementById('productTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) switchTab(tab.dataset.tab);
});

function updateTabCounts() {
  document.getElementById('tabIssuesCount').textContent = `(${issues.length})`;
  document.getElementById('tabReleasesCount').textContent = `(${releases.length})`;
  const active = processesList.filter(p => p.status === 'pending' || p.status === 'running').length;
  const procText = active > 0 ? `(${processesList.length} · ${active} акт.)` : `(${processesList.length})`;
  document.getElementById('tabProcessesCount').textContent = procText;
}

// ── Load data ──────────────────────────────────────────

async function loadProduct() {
  try {
    product = await api(`/products/${productId}`);
    renderProductHeader();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadIssues() {
  try {
    const path = currentFilter
      ? `/products/${productId}/issues?status=${currentFilter}`
      : `/products/${productId}/issues`;
    issues = await api(path);
    renderIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadReleases() {
  try {
    releases = await api(`/products/${productId}/releases`);
    renderReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadProcesses() {
  try {
    const prevActive = processesList.filter(p => p.status === 'pending' || p.status === 'running').length;
    processesList = await api(`/products/${productId}/processes`);
    renderProcesses();
    renderReleases(); // Re-render release cards to update spec buttons
    updateProcessPolling();

    // If active processes decreased — a process just completed, reload releases to get fresh spec
    const nowActive = processesList.filter(p => p.status === 'pending' || p.status === 'running').length;
    if (prevActive > 0 && nowActive < prevActive) {
      loadReleases();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadAll() {
  await Promise.all([loadProduct(), loadIssues(), loadReleases(), loadProcesses()]);
}

// ── Render product header ──────────────────────────────

function renderProductHeader() {
  if (!product) return;
  document.title = `Kaizen — ${product.name}`;
  document.getElementById('prodName').textContent = product.name;
  document.getElementById('prodDesc').textContent = product.description || '';

  const meta = [];
  if (product.tech_stack) meta.push(`<span>${escapeHtml(product.tech_stack)}</span>`);
  if (product.owner) meta.push(`<span>${escapeHtml(product.owner)}</span>`);
  if (product.repo_url) meta.push(`<span><a href="${escapeHtml(product.repo_url)}" target="_blank">Репозиторий</a></span>`);
  if (product.project_path) meta.push(`<span style="font-family:monospace;font-size:0.8rem">${escapeHtml(product.project_path)}</span>`);
  meta.push(`<span class="badge badge-${product.status}">${product.status}</span>`);
  document.getElementById('prodMeta').innerHTML = meta.join('');
}

// ── Render issues ──────────────────────────────────────

function renderIssues() {
  const tbody = document.getElementById('issuesBody');
  const empty = document.getElementById('issuesEmpty');

  if (issues.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = issues.map(i => `
    <tr>
      <td>${escapeHtml(i.title)}</td>
      <td><span class="badge badge-${i.type}">${i.type}</span></td>
      <td><span class="badge badge-${i.priority}">${i.priority}</span></td>
      <td><span class="badge badge-${i.status}">${i.status}</span></td>
      <td style="white-space:nowrap">${formatDate(i.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="showEditIssue('${i.id}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteIssue('${i.id}')">Уд.</button>
      </td>
    </tr>
  `).join('');
  updateTabCounts();
}

// ── Dev status helpers ──────────────────────────────────

function detectTestCommandFE(techStack) {
  const s = (techStack || '').toLowerCase();
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

function findActiveDevProcess(releaseId) {
  return processesList.find(p =>
    p.type === 'develop_release' && p.release_id === releaseId &&
    (p.status === 'pending' || p.status === 'running')
  );
}

function renderDevStatus(r) {
  const activeProc = findActiveDevProcess(r.id);

  if (activeProc || r.dev_status === 'in_progress') {
    return `<div class="dev-status dev-status-running">
      &#9203; Разработка в процессе...
    </div>`;
  }

  if (r.dev_status === 'done') {
    const short = r.dev_commit ? r.dev_commit.slice(0, 7) : '';
    return `<div class="dev-status dev-status-done">
      &#10004; <strong>${escapeHtml(r.dev_branch || '')}</strong>
      ${short ? ` &middot; <code>${short}</code>` : ''}
      &middot; тесты &#10004;
    </div>`;
  }

  if (r.dev_status === 'failed') {
    return `<div class="dev-status dev-status-failed">
      &#10060; Ошибка разработки
      ${r.status !== 'released'
        ? ` <button class="btn btn-ghost btn-sm" onclick="showDevelopModal('${r.id}')">Повторить</button>`
        : ''}
    </div>`;
  }

  return '';
}

function getDevButton(r) {
  if (r.dev_status === 'in_progress' || findActiveDevProcess(r.id)) return '';
  if (r.dev_status === 'done') return '';
  if (r.dev_status === 'failed') return '';
  if (r.status === 'released') return '';

  const hasSpec = !!r.spec;
  if (hasSpec) {
    return `<button class="btn btn-primary btn-sm" onclick="showDevelopModal('${r.id}')">Разработать</button>`;
  }
  return `<button class="btn btn-ghost btn-sm" disabled title="Сначала подготовьте спецификацию">Разработать</button>`;
}

// ── Render releases ────────────────────────────────────

function renderReleases() {
  const el = document.getElementById('releasesList');
  const empty = document.getElementById('releasesEmpty');

  if (releases.length === 0) {
    el.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  el.innerHTML = releases.map(r => {
    const specBtn = getSpecButton(r);
    const devBtn = getDevButton(r);
    const devStatus = renderDevStatus(r);
    return `
    <div class="release-card">
      <div class="release-card-header">
        <h3>
          <span class="badge badge-${r.status}">${r.status}</span>
          ${escapeHtml(r.version)} — ${escapeHtml(r.name)}
        </h3>
        <div style="display:flex;gap:6px">
          ${r.status === 'draft' ? `<button class="btn btn-green btn-sm" onclick="publishRelease('${r.id}')">Опубликовать</button>` : ''}
          ${r.status !== 'released' ? `<button class="btn btn-danger btn-sm" onclick="deleteRelease('${r.id}')">Удалить</button>` : ''}
        </div>
      </div>
      ${r.description ? `<p style="color:var(--text-dim);font-size:0.875rem;margin-bottom:8px">${escapeHtml(r.description)}</p>` : ''}
      <div style="font-size:0.85rem;color:var(--text-dim)">
        Задач: ${r.issue_count || 0}
        ${r.released_at ? ` &middot; Выпущен: ${formatDate(r.released_at)}` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
        <button class="btn btn-ghost btn-sm" onclick="toggleReleaseDetails('${r.id}', this)">Показать задачи</button>
        ${specBtn}
        ${devBtn}
      </div>
      ${devStatus}
      <div class="release-issues" id="release-${r.id}" style="display:none"></div>
    </div>`;
  }).join('');
  updateTabCounts();
}

function findActiveSpecProcess(releaseId) {
  return processesList.find(p =>
    p.type === 'prepare_spec' && p.release_id === releaseId &&
    (p.status === 'pending' || p.status === 'running')
  );
}

function getSpecButton(r) {
  const activeProc = findActiveSpecProcess(r.id);
  if (activeProc) {
    return `<button class="btn btn-ghost btn-sm" disabled style="opacity:0.7;color:var(--yellow)">Генерация спецификации...</button>`;
  }
  if (r.spec) {
    return `<button class="btn btn-ghost btn-sm" onclick="showSpecView('${r.id}')" style="color:var(--accent)">Открыть спецификацию</button>`;
  }
  if (r.status === 'draft' && parseInt(r.issue_count) > 0) {
    return `<button class="btn btn-primary btn-sm" onclick="showPrepareSpecModal('${r.id}')">Подготовить спецификацию</button>`;
  }
  return '';
}

// ── Render processes ───────────────────────────────────

function renderProcesses() {
  const tbody = document.getElementById('processesBody');
  const empty = document.getElementById('processesEmpty');

  if (processesList.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = processesList.map(p => {
    const isRoadmapDone = p.type === 'roadmap_from_doc' && p.status === 'completed';
    return `
    <tr style="cursor:pointer" onclick="showProcessDetail('${p.id}')">
      <td><span class="badge badge-process-${p.type}">${p.type}</span></td>
      <td>${escapeHtml(p.model_name)}</td>
      <td><span class="badge badge-process-${p.status}">${p.status}</span></td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">${liveDuration(p)}</td>
      <td style="white-space:nowrap">${suggestionsInfo(p)}</td>
      <td style="white-space:nowrap">
        ${isRoadmapDone ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.location.href='/roadmap.html?process_id=${p.id}&product_id=${productId}'">Дорожная карта</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
  updateTabCounts();
}

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}мс`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  return `${min}м ${sec % 60}с`;
}

function liveDuration(p) {
  if (p.duration_ms) return formatDuration(p.duration_ms);
  if ((p.status === 'running' || p.status === 'pending') && p.started_at) {
    const elapsed = Date.now() - new Date(p.started_at).getTime();
    return `<span style="color:var(--yellow)">${formatDuration(elapsed)}…</span>`;
  }
  return '—';
}

function suggestionsInfo(p) {
  if (p.type === 'develop_release' && p.result) {
    const r = p.result;
    if (r.branch) return `${r.tests_passed ? '&#10004;' : '&#10060;'} ${escapeHtml(r.branch)}`;
    return '—';
  }
  if (p.type === 'roadmap_from_doc' && p.result && p.result.roadmap) {
    const r = p.result;
    const info = `${r.total_releases || 0} р. / ${r.total_issues || 0} з.`;
    return p.approved_count ? `${p.approved_count} созд. (${info})` : info;
  }
  if (p.type === 'prepare_spec' && p.result && p.result.char_count) {
    return `${p.result.char_count} сим.`;
  }
  const total = p.result ? p.result.length : 0;
  if (!total) return '—';
  const approved = p.approved_count || 0;
  if (approved > 0) return `${approved}/${total}`;
  return `${total}`;
}

const POLL_FAST = 4000;
const POLL_SLOW = 10000;

function updateProcessPolling() {
  const hasActive = processesList.some(p => p.status === 'pending' || p.status === 'running');
  const interval = hasActive ? POLL_FAST : POLL_SLOW;

  if (processPollingTimer) clearInterval(processPollingTimer);
  processPollingTimer = setInterval(loadProcesses, interval);
}

// ── Toggle release details ─────────────────────────────

window.toggleReleaseDetails = async function (releaseId, btn) {
  const el = document.getElementById(`release-${releaseId}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    btn.textContent = 'Показать задачи';
    return;
  }

  try {
    const release = await api(`/releases/${releaseId}`);
    if (!release.issues || release.issues.length === 0) {
      el.innerHTML = '<p style="color:var(--text-dim);padding:8px;font-size:0.85rem">Нет задач</p>';
    } else {
      el.innerHTML = release.issues.map(i => `
        <div class="release-issue">
          <span>
            <span class="badge badge-${i.type}">${i.type}</span>
            ${escapeHtml(i.title)}
          </span>
          <span class="badge badge-${i.status}">${i.status}</span>
        </div>
      `).join('');
    }
    el.style.display = '';
    btn.textContent = 'Скрыть задачи';
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Filters ────────────────────────────────────────────

document.getElementById('issueFilters').addEventListener('click', (e) => {
  if (!e.target.matches('.btn')) return;
  document.querySelectorAll('#issueFilters .btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.status;
  loadIssues();
});

// ── Edit product ───────────────────────────────────────

window.showEditProductModal = function () {
  if (!product) return;
  document.getElementById('epName').value = product.name;
  document.getElementById('epDesc').value = product.description || '';
  document.getElementById('epRepo').value = product.repo_url || '';
  document.getElementById('epStack').value = product.tech_stack || '';
  document.getElementById('epOwner').value = product.owner || '';
  document.getElementById('epPath').value = product.project_path || '';
  openModal('editProductModal');
};

window.handleEditProduct = async function (e) {
  e.preventDefault();
  try {
    await api(`/products/${productId}`, {
      method: 'PUT',
      body: {
        name: document.getElementById('epName').value,
        description: document.getElementById('epDesc').value,
        repo_url: document.getElementById('epRepo').value,
        tech_stack: document.getElementById('epStack').value,
        owner: document.getElementById('epOwner').value,
        project_path: document.getElementById('epPath').value,
      },
    });
    toast('Продукт обновлён');
    closeModal('editProductModal');
    loadProduct();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

// ── Issues CRUD ────────────────────────────────────────

window.showIssueModal = function () {
  document.getElementById('issueModalTitle').textContent = 'Новая задача';
  document.getElementById('issueId').value = '';
  document.getElementById('issueForm').reset();
  openModal('issueModal');
};

window.showEditIssue = function (id) {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  document.getElementById('issueModalTitle').textContent = 'Редактировать задачу';
  document.getElementById('issueId').value = issue.id;
  document.getElementById('issueTitle').value = issue.title;
  document.getElementById('issueDesc').value = issue.description || '';
  document.getElementById('issueType').value = issue.type;
  document.getElementById('issuePriority').value = issue.priority;
  openModal('issueModal');
};

window.handleIssueSubmit = async function (e) {
  e.preventDefault();
  const id = document.getElementById('issueId').value;
  const body = {
    product_id: productId,
    title: document.getElementById('issueTitle').value,
    description: document.getElementById('issueDesc').value,
    type: document.getElementById('issueType').value,
    priority: document.getElementById('issuePriority').value,
  };

  try {
    if (id) {
      await api(`/issues/${id}`, { method: 'PUT', body });
      toast('Задача обновлена');
    } else {
      await api('/issues', { method: 'POST', body });
      toast('Задача создана');
    }
    closeModal('issueModal');
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window.deleteIssue = async function (id) {
  const ok = await confirm('Удалить задачу?');
  if (!ok) return;
  try {
    await api(`/issues/${id}`, { method: 'DELETE' });
    toast('Задача удалена');
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Releases CRUD ──────────────────────────────────────

window.showReleaseModal = async function () {
  document.getElementById('releaseForm').reset();

  // Load open issues for checkboxes
  try {
    const openIssues = await api(`/products/${productId}/issues?status=open`);
    const list = document.getElementById('releaseIssuesList');
    if (openIssues.length === 0) {
      list.innerHTML = '<p style="color:var(--text-dim);padding:8px;font-size:0.85rem">Нет открытых задач</p>';
    } else {
      list.innerHTML = openIssues.map(i => `
        <label class="checkbox-item">
          <input type="checkbox" value="${i.id}">
          <span class="badge badge-${i.type}">${i.type}</span>
          <span class="badge badge-${i.priority}">${i.priority}</span>
          <span>${escapeHtml(i.title)}</span>
        </label>
      `).join('');
    }
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('releaseModal');
};

window.handleReleaseSubmit = async function (e) {
  e.preventDefault();

  const issueCheckboxes = document.querySelectorAll('#releaseIssuesList input[type="checkbox"]:checked');
  const issue_ids = Array.from(issueCheckboxes).map(cb => cb.value);

  const body = {
    product_id: productId,
    version: document.getElementById('releaseVersion').value,
    name: document.getElementById('releaseName').value,
    description: document.getElementById('releaseDesc').value,
    issue_ids,
  };

  try {
    await api('/releases', { method: 'POST', body });
    toast('Релиз создан');
    closeModal('releaseModal');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window.publishRelease = async function (id) {
  try {
    await api(`/releases/${id}/publish`, { method: 'POST' });
    toast('Релиз опубликован');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deleteRelease = async function (id) {
  const ok = await confirm('Удалить релиз? Задачи вернутся в статус open.');
  if (!ok) return;
  try {
    await api(`/releases/${id}`, { method: 'DELETE' });
    toast('Релиз удалён');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Improve (create process) ────────────────────────────

window.showImproveModal = async function () {
  document.getElementById('improvePrompt').value = '';
  document.getElementById('improveCount').value = '5';
  document.getElementById('improveTimeout').value = '20';

  try {
    // Load templates
    const templates = await api('/improve-templates');
    const tplSelect = document.getElementById('improveTemplate');
    tplSelect.innerHTML = '<option value="">— Свой промпт —</option>' +
      templates.map(t => `<option value="${t.id}" data-prompt="${escapeHtml(t.prompt)}">${escapeHtml(t.name)}</option>`).join('');

    // Load models
    const models = await api('/ai-models');
    const modelSelect = document.getElementById('improveModel');
    modelSelect.innerHTML = models.length === 0
      ? '<option value="">Нет моделей</option>'
      : models.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('improveModal');
};

window.handleTemplateChange = function () {
  const sel = document.getElementById('improveTemplate');
  const opt = sel.options[sel.selectedIndex];
  const prompt = opt?.dataset?.prompt || '';
  if (prompt) {
    document.getElementById('improvePrompt').value = prompt;
  }
};

window.handleImproveGenerate = async function () {
  const prompt = document.getElementById('improvePrompt').value.trim();
  const modelId = document.getElementById('improveModel').value;
  const count = document.getElementById('improveCount').value;
  const templateId = document.getElementById('improveTemplate').value;
  const timeoutMin = parseInt(document.getElementById('improveTimeout').value) || 20;

  if (!prompt) return toast('Введите промпт', 'error');
  if (!modelId) return toast('Выберите модель', 'error');

  try {
    await api('/processes', {
      method: 'POST',
      body: {
        product_id: productId,
        model_id: modelId,
        type: 'improve',
        prompt,
        template_id: templateId || null,
        count: parseInt(count) || 5,
        timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
      },
    });

    toast('Процесс запущен');
    closeModal('improveModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Process detail (on product page) ────────────────────

window.showProcessDetail = async function (id) {
  // Roadmap processes open in a separate page
  const cachedProc = processesList.find(p => p.id === id);
  if (cachedProc && cachedProc.type === 'roadmap_from_doc') {
    window.location.href = `/roadmap.html?process_id=${id}&product_id=${productId}`;
    return;
  }

  try {
    const [proc, logs] = await Promise.all([
      api(`/processes/${id}`),
      api(`/processes/${id}/logs`),
    ]);

    // Also redirect if loaded proc is roadmap
    if (proc.type === 'roadmap_from_doc') {
      window.location.href = `/roadmap.html?process_id=${id}&product_id=${productId}`;
      return;
    }

    document.getElementById('processDetailTitle').textContent = `Процесс: ${proc.type}`;

    let html = `
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <span class="badge badge-process-${proc.status}">${proc.status}</span>
          <span class="badge badge-process-${proc.type}">${proc.type}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text-dim);display:flex;flex-direction:column;gap:4px">
          <span>Модель: <strong style="color:var(--text)">${escapeHtml(proc.model_name)}</strong></span>
          <span>Создан: ${formatDate(proc.created_at)}</span>
          ${proc.duration_ms ? `<span>Длительность: ${formatDuration(proc.duration_ms)}</span>` : ''}
        </div>
      </div>`;

    if (proc.input_prompt) {
      html += `
        <div style="margin-bottom:16px">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:4px;color:var(--text-dim)">Промпт</div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:0.85rem;max-height:120px;overflow-y:auto">${escapeHtml(proc.input_prompt)}</div>
        </div>`;
    }

    if (proc.error) {
      html += `
        <div style="margin-bottom:16px;padding:10px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px">
          <div style="font-size:0.85rem;font-weight:600;color:var(--red);margin-bottom:4px">Ошибка</div>
          <div style="font-size:0.85rem;color:var(--red)">${escapeHtml(proc.error)}</div>
        </div>`;
    }

    // Logs
    if (logs.length > 0) {
      html += `
        <div style="margin-bottom:16px">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Логи</div>
          <div class="process-logs-list">
            ${logs.map(l => `
              <div class="process-log-entry ${l.step === 'error' ? 'process-log-error' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                  <span class="badge badge-process-log">${l.step}</span>
                  <span style="font-size:0.75rem;color:var(--text-dim)">${new Date(l.created_at).toLocaleTimeString('ru-RU')}</span>
                </div>
                ${l.message ? `<div style="font-size:0.85rem">${escapeHtml(l.message)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>`;
    }

    // Spec link (for prepare_spec processes)
    if (proc.type === 'prepare_spec' && proc.status === 'completed' && proc.release_id) {
      html += `
        <div style="margin-bottom:16px">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Спецификация</div>
          <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
            ${proc.result && proc.result.char_count ? `<span style="font-size:0.85rem;color:var(--text-dim)">${proc.result.char_count} символов</span> &middot; ` : ''}
            ${proc.result && proc.result.mode ? `<span class="badge badge-mode-${proc.result.mode}">${proc.result.mode}</span> &middot; ` : ''}
            <button class="btn btn-primary btn-sm" onclick="showSpecView('${proc.release_id}')">Открыть спецификацию</button>
          </div>
        </div>`;
    }

    // Develop release result
    if (proc.type === 'develop_release' && proc.status === 'completed' && proc.result) {
      const r = proc.result;
      html += `
        <div>
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Результат разработки</div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:0.875rem">
            <div>Ветка: <strong>${escapeHtml(r.branch || '—')}</strong></div>
            <div>Коммит: <code>${escapeHtml(r.commit_hash ? r.commit_hash.slice(0, 7) : '—')}</code></div>
            <div>Изменено файлов: <strong>${r.files_changed ?? '—'}</strong></div>
            <div>Тестов написано: <strong>${r.tests_written ?? '—'}</strong></div>
            <div>Тесты: <strong style="color:${r.tests_passed ? 'var(--green)' : 'var(--red)'}">
              ${r.tests_passed ? 'пройдены' : 'не пройдены'}</strong></div>
            ${r.summary ? `<div style="margin-top:8px;color:var(--text-dim)">${escapeHtml(r.summary)}</div>` : ''}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
          </div>
        </div>`;
    }

    // Suggestions (if completed)
    else if (proc.type !== 'prepare_spec' && proc.status === 'completed' && proc.result && proc.result.length > 0) {
      html += `
        <div>
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Предложения (${proc.result.length})</div>
          <div class="improve-actions-top">
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(true)">Выбрать все</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(false)">Снять все</button>
          </div>
          <div class="improve-suggestions-list" id="processSuggestionsList">
            ${proc.result.map((s, i) => `
              <label class="improve-suggestion">
                <input type="checkbox" checked data-index="${i}" onchange="updateProcessApproveCount()">
                <div class="improve-suggestion-content">
                  <div class="improve-suggestion-title">${escapeHtml(s.title)}</div>
                  <div style="display:flex;gap:6px;margin:4px 0">
                    <span class="badge badge-${s.type}">${s.type}</span>
                    <span class="badge badge-${s.priority}">${s.priority}</span>
                  </div>
                  ${s.description ? `<div class="improve-suggestion-desc">${escapeHtml(s.description)}</div>` : ''}
                </div>
              </label>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
            <button type="button" class="btn btn-primary" id="processApproveBtn" onclick="handleProcessApprove('${proc.id}')">Создать выбранные (${proc.result.length})</button>
          </div>
        </div>`;
    } else {
      html += `
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
        </div>`;
    }

    document.getElementById('processDetailContent').innerHTML = html;
    openModal('processDetailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.toggleAllProcessSuggestions = function (state) {
  document.querySelectorAll('#processSuggestionsList input[type="checkbox"]').forEach(cb => {
    cb.checked = state;
  });
  updateProcessApproveCount();
};

window.updateProcessApproveCount = function () {
  const checked = document.querySelectorAll('#processSuggestionsList input[type="checkbox"]:checked');
  const btn = document.getElementById('processApproveBtn');
  if (btn) {
    btn.textContent = `Создать выбранные (${checked.length})`;
    btn.disabled = checked.length === 0;
  }
};

window.handleProcessApprove = async function (processId) {
  const checkboxes = document.querySelectorAll('#processSuggestionsList input[type="checkbox"]:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));

  if (indices.length === 0) return toast('Выберите хотя бы одну задачу', 'error');

  try {
    const result = await api(`/processes/${processId}/approve`, {
      method: 'POST',
      body: { indices },
    });
    toast(`Создано задач: ${result.count}`);
    closeModal('processDetailModal');
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Delete process ──────────────────────────────────────

window.deleteProcess = async function (id) {
  const ok = await confirm('Удалить процесс?');
  if (!ok) return;
  try {
    await api(`/processes/${id}`, { method: 'DELETE' });
    toast('Процесс удалён');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Prepare spec ────────────────────────────────────────

let specModels = [];
let currentSpecReleaseId = null;
let currentSpecText = '';
let currentSpecRelease = null;

window.showPrepareSpecModal = async function (releaseId) {
  currentSpecReleaseId = releaseId;
  const release = releases.find(r => r.id === releaseId);
  document.getElementById('specReleaseId').value = releaseId;
  document.getElementById('specReleaseName').textContent = release
    ? `${release.version} — ${release.name}`
    : releaseId;
  document.getElementById('specTimeout').value = '20';

  try {
    specModels = await api('/ai-models');
    const sel = document.getElementById('specModel');
    sel.innerHTML = specModels.length === 0
      ? '<option value="">Нет моделей</option>'
      : specModels.map(m => `<option value="${m.id}" data-provider="${m.provider}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    updateSpecModeBadge();
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('prepareSpecModal');
};

window.updateSpecModeBadge = function () {
  const sel = document.getElementById('specModel');
  const opt = sel.options[sel.selectedIndex];
  const provider = opt?.dataset?.provider || '';
  const hasPath = product && !!product.project_path;
  const isClaudeCode = provider === 'claude-code';
  const mode = (isClaudeCode && hasPath) ? 'claude-code' : 'standalone';
  const badge = document.getElementById('specModeBadge');
  badge.innerHTML = mode === 'claude-code'
    ? `<span class="badge badge-mode-claude-code">claude-code</span> <span style="font-size:0.8rem;color:var(--text-dim);margin-left:4px">Модель изучит проект через CLI</span>`
    : `<span class="badge badge-mode-standalone">standalone</span> <span style="font-size:0.8rem;color:var(--text-dim);margin-left:4px">${hasPath ? 'Контекст проекта будет собран автоматически' : 'Без доступа к файлам проекта'}</span>`;
};

window.handlePrepareSpec = async function () {
  const releaseId = document.getElementById('specReleaseId').value;
  const modelId = document.getElementById('specModel').value;
  const timeoutMin = parseInt(document.getElementById('specTimeout').value) || 20;

  if (!modelId) return toast('Выберите модель', 'error');

  try {
    await api(`/releases/${releaseId}/prepare-spec`, {
      method: 'POST',
      body: {
        model_id: modelId,
        timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
      },
    });
    toast('Процесс генерации спецификации запущен');
    closeModal('prepareSpecModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.showSpecView = async function (releaseId) {
  try {
    const data = await api(`/releases/${releaseId}/spec`);
    const release = releases.find(r => r.id === releaseId);
    currentSpecText = data.spec || '';
    currentSpecRelease = release;

    document.getElementById('specViewTitle').textContent = release
      ? `Спецификация: ${release.version} — ${release.name}`
      : 'Спецификация';

    let meta = '';
    if (data.process) {
      meta += `<span>Модель: <strong style="color:var(--text)">${escapeHtml(data.process.model_name || '')}</strong></span>`;
      if (data.process.duration_ms) meta += `<span>Длительность: ${formatDuration(data.process.duration_ms)}</span>`;
      if (data.process.result && data.process.result.mode) meta += `<span class="badge badge-mode-${data.process.result.mode}">${data.process.result.mode}</span>`;
      if (data.process.result && data.process.result.char_count) meta += `<span>${data.process.result.char_count} символов</span>`;
    }
    document.getElementById('specViewMeta').innerHTML = meta;

    document.getElementById('specViewContent').textContent = currentSpecText || 'Спецификация пуста';
    openModal('specViewModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleCopySpec = async function () {
  try {
    await navigator.clipboard.writeText(currentSpecText);
    toast('Спецификация скопирована');
  } catch {
    toast('Не удалось скопировать', 'error');
  }
};

window.handleDownloadSpec = function () {
  const release = currentSpecRelease;
  const filename = release
    ? `RELEASE_SPEC_${release.version.replace(/\./g, '_')}.md`
    : 'RELEASE_SPEC.md';
  const blob = new Blob([currentSpecText], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast('Файл скачан');
};

// ── Roadmap from document ────────────────────────────────

window.showRoadmapModal = async function () {
  document.getElementById('roadmapDocText').value = '';
  document.getElementById('roadmapTimeout').value = '30';
  document.getElementById('roadmapCharCount').textContent = '0 символов';
  document.getElementById('roadmapCharCount').className = 'char-counter';

  try {
    const models = await api('/ai-models');
    const sel = document.getElementById('roadmapModel');
    sel.innerHTML = models.length === 0
      ? '<option value="">Нет моделей</option>'
      : models.map(m => `<option value="${m.id}" data-provider="${m.provider}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    updateRoadmapModeInfo();
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('roadmapModal');
};

// Char counter with warning
document.getElementById('roadmapDocText')?.addEventListener('input', function () {
  const len = this.value.length;
  const el = document.getElementById('roadmapCharCount');
  el.textContent = `${len.toLocaleString('ru-RU')} символов`;
  el.className = 'char-counter' + (len > 100000 ? ' danger' : len > 50000 ? ' warning' : '');
});

window.updateRoadmapModeInfo = function () {
  const sel = document.getElementById('roadmapModel');
  const opt = sel.options[sel.selectedIndex];
  const provider = opt?.dataset?.provider || '';
  const hasPath = product && !!product.project_path;
  const isClaudeCode = provider === 'claude-code';
  const el = document.getElementById('roadmapModeInfo');

  if (isClaudeCode && hasPath) {
    el.innerHTML = `<span class="badge badge-mode-claude-code">claude-code</span> <span style="margin-left:4px">Модель изучит проект через CLI</span>`;
  } else {
    el.innerHTML = `<span class="badge badge-mode-standalone">standalone</span> <span style="margin-left:4px">${hasPath ? 'Контекст проекта будет собран автоматически' : 'Без доступа к файлам проекта'}</span>`;
  }
};

window.handleRoadmapGenerate = async function () {
  const docText = document.getElementById('roadmapDocText').value.trim();
  const modelId = document.getElementById('roadmapModel').value;
  const timeoutMin = parseInt(document.getElementById('roadmapTimeout').value) || 30;

  if (!docText) return toast('Вставьте текст документа', 'error');
  if (!modelId) return toast('Выберите модель', 'error');

  try {
    await api('/processes', {
      method: 'POST',
      body: {
        product_id: productId,
        model_id: modelId,
        type: 'roadmap_from_doc',
        prompt: docText,
        timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
      },
    });
    toast('Анализ запущен. Следите за статусом в таблице процессов.');
    closeModal('roadmapModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Develop release ──────────────────────────────────────

window.showDevelopModal = async function (releaseId) {
  window._developReleaseId = releaseId;

  const release = releases.find(r => r.id === releaseId) || await api(`/releases/${releaseId}`);
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

  // Load only claude-code models
  try {
    const models = await api('/ai-models');
    const ccModels = models.filter(m => m.provider === 'claude-code');
    const sel = document.getElementById('developModel');
    sel.innerHTML = ccModels.length === 0
      ? '<option value="">Нет Claude Code моделей</option>'
      : ccModels.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('developModal');
};

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
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// Expose closeModal globally for inline onclick handlers
window.closeModal = closeModal;

// ── Init ───────────────────────────────────────────────

loadAll();
