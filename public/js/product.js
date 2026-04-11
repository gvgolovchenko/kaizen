import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate, notifyStatusChanges, renderBreadcrumbs } from './app.js';
import { formatDuration, renderProcessDetailHtml, renderFormReleaseHtml, toggleAllSuggestions, updateApproveCount, approveProcess, procTypeLabel } from './process-detail.js';

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.href = '/';

// ── Model select localStorage helpers ─────────────────
function saveModel(key, selectId) {
  const val = document.getElementById(selectId)?.value;
  if (val) localStorage.setItem(key, val);
}
function restoreModel(key, selectId) {
  const saved = localStorage.getItem(key);
  if (!saved) return;
  const sel = document.getElementById(selectId);
  if (sel && [...sel.options].some(o => o.value === saved)) sel.value = saved;
}

let product = null;
let allIssues = [];
let issues = [];
let releases = [];
let processesList = [];
let plansList = [];
let rcTicketsList = [];
let rcCurrentFilter = '';
let rcSelectedIds = new Set();
let currentFilter = '';
let currentPriorityFilter = '';
let currentView = 'table';
let processPollingTimer = null;

// ── Tabs ────────────────────────────────────────────────

function switchTab(tabName) {
  document.querySelectorAll('#productTabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tabName}`));
  // Persist tab in URL
  const url = new URL(location.href);
  if (tabName && tabName !== 'issues') url.searchParams.set('tab', tabName);
  else url.searchParams.delete('tab');
  history.replaceState(null, '', url);
}

// Restore tab from URL
const savedTab = new URLSearchParams(location.search).get('tab');
if (savedTab) switchTab(savedTab);

document.getElementById('productTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) switchTab(tab.dataset.tab);
});

function updateTabCounts() {
  document.getElementById('tabIssuesCount').textContent = `(${issues.length})`;
  document.getElementById('tabReleasesCount').textContent = `(${releases.length})`;
  const active = processesList.filter(p => ['pending', 'queued', 'running'].includes(p.status)).length;
  const procText = active > 0 ? `(${processesList.length} · ${active} акт.)` : `(${processesList.length})`;
  document.getElementById('tabProcessesCount').textContent = procText;
  // Обновить счётчик планов если вкладка есть
  const plansCountEl = document.getElementById('tabPlansCount');
  if (plansCountEl && typeof plansList !== 'undefined') {
    plansCountEl.textContent = `(${plansList.length})`;
  }
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
    allIssues = await api(`/products/${productId}/issues`);
    issues = currentFilter ? allIssues.filter(i => i.status === currentFilter) : allIssues;
    renderIssues();
    updateIssueFilterBadges();
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
  await Promise.all([loadProduct(), loadIssues(), loadReleases(), loadProcesses(), loadPlans()]);
  // Show RC tab if product has rc_system_id
  if (product && product.rc_system_id) {
    document.getElementById('tabRcTickets').style.display = '';
    loadRcTickets();
  }
  // Show GitLab Issues tab if deploy.gitlab is configured OR repo_url points to GitLab
  if (product?.deploy?.gitlab?.project_id || (product?.repo_url && product.repo_url.includes('192.168.206.48'))) {
    document.getElementById('tabGitlabIssues').style.display = '';
    loadGlIssues();
  }
  // Load automation settings
  loadAutomationSettings();
  loadProductScenarios();
  // Load deploy settings
  loadDeploySettings();
  // Handle quick actions from product cards (?action=improve|add_issue)
  const action = new URLSearchParams(location.search).get('action');
  if (action === 'improve') showImproveModal();
  else if (action === 'add_issue') showIssueModal();
}

// ── Render product header ──────────────────────────────

function renderProductHeader() {
  if (!product) return;
  document.title = `Kaizen — ${product.name}`;
  renderBreadcrumbs('breadcrumbs', [
    { label: 'Продукты', href: '/' },
    { label: product.name },
  ]);
  document.getElementById('prodName').textContent = product.name;
  document.getElementById('prodDesc').textContent = product.description || '';

  const meta = [];
  if (product.tech_stack) meta.push(`<span>${escapeHtml(product.tech_stack)}</span>`);
  if (product.owner) meta.push(`<span>${escapeHtml(product.owner)}</span>`);
  if (product.repo_url) meta.push(`<span><a href="${escapeHtml(product.repo_url)}" target="_blank">Репозиторий</a></span>`);
  if (product.project_path) meta.push(`<span style="font-family:monospace;font-size:0.8rem">${escapeHtml(product.project_path)}</span>`);
  if (product.deploy?.urls) {
    const urls = product.deploy.urls;
    const links = [];
    if (urls.frontend) links.push(`<a href="${escapeHtml(urls.frontend)}" target="_blank">Frontend</a>`);
    if (urls.backend) links.push(`<a href="${escapeHtml(urls.backend)}" target="_blank">Backend</a>`);
    if (links.length) meta.push(`<span>${links.join(' &middot; ')}</span>`);
  }
  if (product.rc_system_id || product.rc_module_id) {
    const parts = [];
    if (product.rc_system_id) parts.push(`система ${product.rc_system_id}`);
    if (product.rc_module_id) parts.push(`модуль ${product.rc_module_id}`);
    meta.push(`<span>RC: ${parts.join(' / ')}</span>`);
  }
  meta.push(`<span class="badge badge-${product.status}">${product.status}</span>`);
  document.getElementById('prodMeta').innerHTML = meta.join('');
}

// ── Labels helper ─────────────────────────────────────

function renderLabels(labels) {
  if (!labels || !Array.isArray(labels) || labels.length === 0) return '';
  return labels.map(l => `<span class="badge badge-label">${escapeHtml(l)}</span>`).join('');
}

// ── Render issues ──────────────────────────────────────

function renderIssues() {
  if (currentView === 'kanban') {
    // Apply kanban view after load
    const tableWrap = document.getElementById('issuesTableWrap');
    const kanbanBoard = document.getElementById('kanbanBoard');
    tableWrap.style.display = 'none';
    kanbanBoard.style.display = '';
    document.querySelectorAll('#viewToggle .btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === 'kanban'));
    renderKanban();
  } else {
    renderFilteredTable();
  }

  const empty = document.getElementById('issuesEmpty');
  const filtered = getFilteredIssues();
  if (issues.length === 0) {
    empty.style.display = '';
  } else if (filtered.length > 0) {
    empty.style.display = 'none';
  }
  updateTabCounts();
  updateFormReleaseButton();
}

// ── Kanban view ────────────────────────────────────────

function getFilteredIssues() {
  if (!currentPriorityFilter) return issues;
  return issues.filter(i => i.priority === currentPriorityFilter);
}

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  const filtered = getFilteredIssues();
  const columns = [
    { status: 'open', label: 'Open' },
    { status: 'in_release', label: 'In Release' },
    { status: 'done', label: 'Done' },
  ];

  board.innerHTML = columns.map(col => {
    const colIssues = filtered.filter(i => i.status === col.status);
    return `
      <div class="kanban-column" data-status="${col.status}">
        <div class="kanban-column-header">
          <span>${col.label}</span>
          <span class="count">${colIssues.length}</span>
        </div>
        <div class="kanban-cards">
          ${colIssues.length === 0 ? '<div class="kanban-empty">Нет задач</div>' :
            colIssues.map(i => `
            <div class="kanban-card" draggable="true" data-issue-id="${i.id}">
              <div class="kanban-card-title">${escapeHtml(i.title)}</div>
              <div class="kanban-card-meta">
                <span class="badge badge-${i.type}">${i.type}</span>
                <span class="badge badge-${i.priority}">${i.priority}</span>
                ${renderLabels(i.labels)}
              </div>
              <div class="kanban-card-actions">
                <button class="btn btn-ghost btn-sm" onclick="showEditIssue('${i.id}')">Ред.</button>
                <button class="btn btn-danger btn-sm" onclick="deleteIssue('${i.id}')">Уд.</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  initDragAndDrop();
}

function initDragAndDrop() {
  const board = document.getElementById('kanbanBoard');

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.issueId);
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (card) card.classList.remove('dragging');
    board.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
  });

  board.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const issueId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      const issue = issues.find(i => i.id === issueId);
      if (!issue || issue.status === newStatus) return;

      // Optimistic update
      const oldStatus = issue.status;
      issue.status = newStatus;
      renderKanban();

      try {
        await api(`/issues/${issueId}`, { method: 'PUT', body: { status: newStatus } });
        toast(`Статус → ${newStatus}`);
        updateTabCounts();
      } catch (err) {
        // Rollback
        issue.status = oldStatus;
        renderKanban();
        toast(err.message, 'error');
      }
    });
  });
}

function switchView(view) {
  currentView = view;
  const tableWrap = document.getElementById('issuesTableWrap');
  const kanbanBoard = document.getElementById('kanbanBoard');

  document.querySelectorAll('#viewToggle .btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));

  if (view === 'kanban') {
    tableWrap.style.display = 'none';
    kanbanBoard.style.display = '';
    renderKanban();
  } else {
    tableWrap.style.display = '';
    kanbanBoard.style.display = 'none';
  }

  // Persist in URL
  const url = new URL(location.href);
  if (view !== 'table') url.searchParams.set('view', view);
  else url.searchParams.delete('view');
  history.replaceState(null, '', url);
}

// Restore view from URL
const savedView = new URLSearchParams(location.search).get('view');
if (savedView === 'kanban') {
  currentView = 'kanban';
  // Will apply after DOM ready and issues load
}

// View toggle click handler
document.getElementById('viewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (btn && btn.dataset.view) switchView(btn.dataset.view);
});

// Priority filter handler (chips)
document.getElementById('issuePriorityFilter').addEventListener('click', (e) => {
  if (!e.target.matches('.btn')) return;
  document.querySelectorAll('#issuePriorityFilter .btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentPriorityFilter = e.target.dataset.priority || '';
  if (currentView === 'kanban') renderKanban();
  else renderFilteredTable();
  updateIssueFilterBadges();
});

let issueSortCol = 'created_at';
let issueSortAsc = false;

window.sortIssues = function (col) {
  if (issueSortCol === col) {
    issueSortAsc = !issueSortAsc;
  } else {
    issueSortCol = col;
    issueSortAsc = true;
  }
  renderFilteredTable();
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function renderFilteredTable() {
  const tbody = document.getElementById('issuesBody');
  const empty = document.getElementById('issuesEmpty');
  const filtered = getFilteredIssues();

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let va = a[issueSortCol], vb = b[issueSortCol];
    if (issueSortCol === 'priority') {
      va = PRIORITY_ORDER[va] ?? 99;
      vb = PRIORITY_ORDER[vb] ?? 99;
    } else if (issueSortCol === 'labels') {
      va = (Array.isArray(va) ? va : []).join(',');
      vb = (Array.isArray(vb) ? vb : []).join(',');
    }
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return issueSortAsc ? -1 : 1;
    if (va > vb) return issueSortAsc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map(i => `
    <tr>
      <td>${escapeHtml(i.title)}</td>
      <td><span class="badge badge-${i.type}">${i.type}</span></td>
      <td><span class="badge badge-${i.priority}">${i.priority}</span></td>
      <td>${i.release_version ? `<span class="badge badge-release" title="${escapeHtml(i.release_name || '')}">${escapeHtml(i.release_version)}</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
      <td>${renderLabels(i.labels)}</td>
      <td><span class="badge badge-${i.status}">${i.status}</span></td>
      <td style="white-space:nowrap">${formatDate(i.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="showEditIssue('${i.id}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteIssue('${i.id}')">Уд.</button>
      </td>
    </tr>
  `).join('');

  // Update sort indicators
  document.querySelectorAll('#panel-issues th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === issueSortCol) {
      if (arrow) arrow.textContent = issueSortAsc ? ' ▲' : ' ▼';
    } else {
      if (arrow) arrow.textContent = '';
    }
  });
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

function renderDevStatus(r) {
  if (r.status === 'developing') {
    return `<div class="dev-status dev-status-running">&#9203; Разработка в процессе...</div>`;
  }
  if (r.status === 'developed') {
    const short = r.dev_commit ? r.dev_commit.slice(0, 7) : '';
    return `<div class="dev-status dev-status-done">
      &#10004; <strong>${escapeHtml(r.dev_branch || '')}</strong>
      ${short ? ` &middot; <code>${short}</code>` : ''}
      &middot; тесты &#10004;
    </div>`;
  }
  if (r.status === 'failed') {
    return `<div class="dev-status dev-status-failed">
      &#10060; Ошибка разработки
      <button class="btn btn-ghost btn-sm" onclick="showDevelopModal('${r.id}')">Повторить</button>
    </div>`;
  }
  return '';
}

function getDevButton(r) {
  if (['developing', 'developed', 'failed', 'published'].includes(r.status)) return '';
  if (r.status === 'spec') {
    return `<button class="btn btn-primary btn-sm" onclick="showDevelopModal('${r.id}')">Разработать</button>`;
  }
  return `<button class="btn btn-ghost btn-sm" disabled title="Сначала подготовьте спецификацию">Разработать</button>`;
}

// ── Render releases ────────────────────────────────────

let currentReleaseFilter = '';

// Release status filter handler
document.getElementById('releaseStatusFilter')?.addEventListener('click', (e) => {
  if (!e.target.matches('.btn')) return;
  document.querySelectorAll('#releaseStatusFilter .btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentReleaseFilter = e.target.dataset.status || '';
  renderReleases();
});

function renderReleases() {
  const el = document.getElementById('releasesList');
  const empty = document.getElementById('releasesEmpty');

  // Update filter badges
  const openCount = releases.filter(r => r.status !== 'published').length;
  const pubCount = releases.filter(r => r.status === 'published').length;
  document.querySelectorAll('#releaseStatusFilter .btn').forEach(btn => {
    const s = btn.dataset.status;
    let badge = btn.querySelector('.tab-count');
    const count = s === '' ? releases.length : s === 'open' ? openCount : pubCount;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-count';
      btn.appendChild(badge);
    }
    badge.textContent = count > 0 ? count : '';
  });

  const filtered = currentReleaseFilter === 'open'
    ? releases.filter(r => r.status !== 'published')
    : currentReleaseFilter
      ? releases.filter(r => r.status === currentReleaseFilter)
      : releases;

  if (filtered.length === 0) {
    el.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const STATUS_LABELS = { draft: 'Черновик', spec: 'Спецификация', developing: 'Разработка', developed: 'Готов', failed: 'Ошибка', published: 'Опубликован' };

  el.innerHTML = filtered.map(r => {
    const specBtn = getSpecButton(r);
    const devBtn = getDevButton(r);
    const prBtn = getPressReleaseButton(r);
    const devStatus = renderDevStatus(r);
    const canPublish = r.status === 'developed';
    const canDelete = r.status !== 'published';
    const statusLabel = STATUS_LABELS[r.status] || r.status;
    return `
    <div class="release-card">
      <div class="release-card-header">
        <h3>
          <span class="badge badge-${r.status}">${statusLabel}</span>
          ${escapeHtml(r.version)} — ${escapeHtml(r.name)}
          ${r.press_release ? '<span class="badge badge-process-prepare_press_release" style="font-size:0.6rem;margin-left:4px">PR</span>' : ''}
        </h3>
        <div style="display:flex;gap:6px">
          ${canPublish ? `<button class="btn btn-green btn-sm" onclick="publishRelease('${r.id}')">Опубликовать</button>` : ''}
          ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteRelease('${r.id}')">Удалить</button>` : ''}
        </div>
      </div>
      ${r.description ? `<p style="color:var(--text-dim);font-size:0.875rem;margin-bottom:8px">${escapeHtml(r.description)}</p>` : ''}
      <div style="font-size:0.85rem;color:var(--text-dim)">
        Задач: ${r.issue_count || 0}
        ${r.released_at ? ` &middot; Выпущен: ${formatDate(r.released_at)}` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="toggleReleaseDetails('${r.id}', this)">Показать задачи</button>
        ${specBtn}
        ${devBtn}
        ${prBtn}
        ${r.dev_branch ? `<button class="btn btn-ghost btn-sm" onclick="showReleaseDiff('${r.id}')">Diff</button>` : ''}
        ${r.dev_branch ? `<button class="btn btn-ghost btn-sm" onclick="createReleaseMR('${r.id}')">MR</button>` : ''}
        ${r.dev_branch && r.status !== 'published' ? `<button class="btn btn-danger btn-sm" onclick="rollbackRelease('${r.id}')">Откатить</button>` : ''}
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

function findActivePressReleaseProcess(releaseId) {
  return processesList.find(p =>
    p.type === 'prepare_press_release' && p.release_id === releaseId &&
    (p.status === 'pending' || p.status === 'running')
  );
}

function getPressReleaseButton(r) {
  const activeProc = findActivePressReleaseProcess(r.id);
  if (activeProc) {
    return `<button class="btn btn-ghost btn-sm" disabled style="opacity:0.7;color:var(--yellow)">Генерация пресс-релиза...</button>`;
  }
  if (r.press_release) {
    return `<button class="btn btn-ghost btn-sm" onclick="showPressReleaseView('${r.id}')" style="color:var(--accent)">Открыть пресс-релиз</button>`;
  }
  if (r.status === 'published') {
    return `<button class="btn btn-primary btn-sm" onclick="showPreparePressReleaseModal('${r.id}')">Пресс-релиз</button>`;
  }
  return '';
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
    const isQueued = p.status === 'queued';
    return `
    <tr style="cursor:pointer" onclick="showProcessDetail('${p.id}')">
      <td><span class="badge badge-process-${p.type}">${p.type}</span></td>
      <td>${escapeHtml(p.model_name)}</td>
      <td><span class="badge badge-process-${p.status}">${p.status}</span>${isQueued ? `<span class="queue-position" data-id="${p.id}"></span>` : ''}</td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">${liveDuration(p)}</td>
      <td style="white-space:nowrap">${suggestionsInfo(p)}</td>
      <td style="white-space:nowrap">
        ${isRoadmapDone ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.location.href='/roadmap.html?process_id=${p.id}&product_id=${productId}'">Дорожная карта</button>` : ''}
        ${isQueued ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); cancelProcess('${p.id}')">Отменить</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
  updateTabCounts();
}

function liveDuration(p) {
  if (p.duration_ms) return formatDuration(p.duration_ms);
  if (p.status === 'queued') return '<span style="color:#fb923c">в очереди</span>';
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
  if (p.type === 'prepare_press_release' && p.result && p.result.channels) {
    return `${p.result.channels.length} кан.`;
  }
  if (p.type === 'form_release' && p.result && p.result.releases) {
    const r = p.result;
    const info = `${r.releases.length} р.`;
    if (r.auto_approved) return `${info} (авто)`;
    if (p.approved_count) return `${p.approved_count} созд. (${info})`;
    return info;
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
  const hasActive = processesList.some(p => ['pending', 'queued', 'running'].includes(p.status));
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
  issues = currentFilter ? allIssues.filter(i => i.status === currentFilter) : allIssues;
  renderIssues();
  updateIssueFilterBadges();
});

function updateIssueFilterBadges() {
  const counts = { '': allIssues.length };
  for (const i of allIssues) {
    counts[i.status] = (counts[i.status] || 0) + 1;
  }
  document.querySelectorAll('#issueFilters .btn').forEach(btn => {
    const s = btn.dataset.status;
    let badge = btn.querySelector('.tab-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-count';
      btn.appendChild(badge);
    }
    const count = counts[s] || 0;
    badge.textContent = count > 0 ? count : '';
  });

  // Priority badges too
  const pCounts = { '': issues.length };
  for (const i of issues) {
    pCounts[i.priority] = (pCounts[i.priority] || 0) + 1;
  }
  document.querySelectorAll('#issuePriorityFilter .btn').forEach(btn => {
    const p = btn.dataset.priority;
    let badge = btn.querySelector('.tab-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-count';
      btn.appendChild(badge);
    }
    const count = pCounts[p] || 0;
    badge.textContent = count > 0 ? count : '';
  });
}

// ── Edit product ───────────────────────────────────────

window.showEditProductModal = function () {
  if (!product) return;
  document.getElementById('epName').value = product.name;
  document.getElementById('epDesc').value = product.description || '';
  document.getElementById('epRepo').value = product.repo_url || '';
  document.getElementById('epStack').value = product.tech_stack || '';
  document.getElementById('epOwner').value = product.owner || '';
  document.getElementById('epPath').value = product.project_path || '';
  document.getElementById('epRcSystemId').value = product.rc_system_id || '';
  document.getElementById('epRcModuleId').value = product.rc_module_id || '';
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
        rc_system_id: parseInt(document.getElementById('epRcSystemId').value) || null,
        rc_module_id: parseInt(document.getElementById('epRcModuleId').value) || null,
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
  document.getElementById('issueStatusGroup').style.display = 'none';
  document.getElementById('issueReleaseGroup').style.display = 'none';
  openModal('issueModal');
};

window.showEditIssue = async function (id) {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  document.getElementById('issueModalTitle').textContent = 'Редактировать задачу';
  document.getElementById('issueId').value = issue.id;
  document.getElementById('issueTitle').value = issue.title;
  document.getElementById('issueDesc').value = issue.description || '';
  document.getElementById('issueType').value = issue.type;
  document.getElementById('issuePriority').value = issue.priority;
  document.getElementById('issueStatus').value = issue.status;
  document.getElementById('issueStatusGroup').style.display = '';
  document.getElementById('issueReleaseGroup').style.display = '';

  // Load releases for dropdown
  try {
    const rels = await api(`/products/${productId}/releases`);
    const sel = document.getElementById('issueRelease');
    sel.innerHTML = '<option value="">— Без релиза —</option>' +
      rels.filter(r => r.status !== 'published').map(r =>
        `<option value="${r.id}">${escapeHtml(r.version)} — ${escapeHtml(r.name)}</option>`
      ).join('');
    // Select current release if any
    const currentRelease = rels.find(r => r.version === issue.release_version);
    sel.value = currentRelease ? currentRelease.id : '';
  } catch { /* ignore */ }

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
  if (id) {
    body.status = document.getElementById('issueStatus').value;
  }

  try {
    if (id) {
      await api(`/issues/${id}`, { method: 'PUT', body });

      // Handle release assignment change
      const newReleaseId = document.getElementById('issueRelease').value;
      const issue = issues.find(i => i.id === id);
      const currentRelease = releases.find(r => r.version === issue?.release_version);
      const currentReleaseId = currentRelease?.id || '';

      if (newReleaseId !== currentReleaseId) {
        // Remove from old release
        if (currentReleaseId) {
          await api(`/releases/${currentReleaseId}`, {
            method: 'PUT',
            body: { remove_issue_ids: [id] },
          });
        }
        // Add to new release
        if (newReleaseId) {
          await api(`/releases/${newReleaseId}`, {
            method: 'PUT',
            body: { add_issue_ids: [id] },
          });
        }
      }

      toast('Задача обновлена');
    } else {
      await api('/issues', { method: 'POST', body });
      toast('Задача создана');
    }
    closeModal('issueModal');
    loadIssues();
    loadReleases();
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
    const result = await api('/releases', { method: 'POST', body });
    const changes = result.status_changes || {};
    notifyStatusChanges({
      action: 'Релиз создан',
      details: [
        changes.issues_to_in_release ? `${changes.issues_to_in_release} задач(и) → in_release` : null,
      ].filter(Boolean)
    });
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
    const result = await api(`/releases/${id}/publish`, { method: 'POST' });
    const changes = result.status_changes || {};
    notifyStatusChanges({
      action: 'Релиз опубликован',
      details: [
        'Статус релиза → published',
        changes.issues_to_done ? `${changes.issues_to_done} задач(и) → done` : null,
      ].filter(Boolean)
    });
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
    const result = await api(`/releases/${id}`, { method: 'DELETE' });
    const changes = result.status_changes || {};
    notifyStatusChanges({
      action: 'Релиз удалён',
      details: [
        changes.issues_to_open ? `${changes.issues_to_open} задач(и) → open` : null,
      ].filter(Boolean)
    });
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Release Diff / MR / Rollback ────────────────────────

window.showReleaseDiff = async function (releaseId) {
  try {
    const diff = await api(`/releases/${releaseId}/diff`);
    const content = document.getElementById('processDetailContent');
    document.getElementById('processDetailTitle').textContent = `Diff: ${diff.branch} ← ${diff.base}`;
    const metaDiff = document.getElementById('processDetailMeta'); if (metaDiff) metaDiff.innerHTML = '';
    content.innerHTML = `
      <div style="margin-bottom:12px">
        <strong>${diff.files.length} файлов изменено</strong>
        <div style="margin-top:6px;font-size:0.8rem;color:var(--text-dim)">
          ${diff.files.map(f => `<div><span class="badge badge-${f.status === 'A' ? 'done' : f.status === 'D' ? 'failed' : 'in_progress'}" style="font-size:0.6rem;width:20px;text-align:center;display:inline-block">${f.status}</span> ${escapeHtml(f.path)}</div>`).join('')}
        </div>
      </div>
      <div style="margin-top:8px">
        <strong>Stat</strong>
        <pre style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:0.8rem;overflow-x:auto;margin-top:4px">${escapeHtml(diff.stat)}</pre>
      </div>
      <div style="margin-top:12px">
        <strong>Diff</strong>
        <pre style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:0.75rem;overflow-x:auto;margin-top:4px;max-height:60vh;overflow-y:auto">${escapeHtml(diff.diff)}</pre>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
      </div>`;
    openModal('processDetailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.createReleaseMR = async function (releaseId) {
  try {
    const mr = await api(`/releases/${releaseId}/create-mr`, { method: 'POST' });
    toast(`MR #${mr.id} создан`);
    if (mr.url) window.open(mr.url, '_blank');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.rollbackRelease = async function (releaseId) {
  const ok = await confirm('Откатить изменения? Ветка разработки будет удалена.');
  if (!ok) return;
  try {
    await api(`/releases/${releaseId}/rollback`, { method: 'POST' });
    toast('Ветка удалена, dev_status сброшен');
    loadData();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Plans ───────────────────────────────────────────────

async function loadPlans() {
  try {
    plansList = await api(`/products/${productId}/plans`);
    renderPlans();
    updateTabCounts();
  } catch (err) {
    // Тихо — таблица может не существовать до миграции
    plansList = [];
  }
}

function renderPlans() {
  const tbody = document.getElementById('plansBody');
  const empty = document.getElementById('plansEmpty');
  if (!tbody) return;

  if (plansList.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = plansList.map(p => {
    const completed = p.completed_steps || 0;
    const total = p.step_count || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return `
    <tr style="cursor:pointer" onclick="window.location.href='/plan-edit.html?id=${p.id}'">
      <td>${escapeHtml(p.name)}${p.is_template ? ' <span class="badge badge-improvement">шаблон</span>' : ''}</td>
      <td><span class="badge badge-plan-${p.status}">${p.status}</span></td>
      <td>${total}</td>
      <td>
        ${total > 0 ? `<div style="display:flex;align-items:center;gap:8px">
          <div class="plan-progress" style="width:60px">
            <div class="plan-progress-fill" style="width:${pct}%"></div>
          </div>
          <span style="font-size:0.8rem;color:var(--text-dim)">${completed}/${total}</span>
        </div>` : '—'}
      </td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">
        ${['draft', 'scheduled'].includes(p.status) ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); startPlanFromProduct('${p.id}')">Запустить</button>` : ''}
        ${['active', 'scheduled'].includes(p.status) ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); cancelPlanFromProduct('${p.id}')">Отменить</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deletePlanFromProduct('${p.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
}

window.createNewPlan = function () {
  window.location.href = `/plan-edit.html?product_id=${productId}`;
};

window.startPlanFromProduct = async function (id) {
  try {
    await api(`/plans/${id}/start`, { method: 'POST' });
    toast('План запущен');
    loadPlans();
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.cancelPlanFromProduct = async function (id) {
  try {
    await api(`/plans/${id}/cancel`, { method: 'POST' });
    toast('План отменён');
    loadPlans();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deletePlanFromProduct = async function (id) {
  const ok = await confirm('Удалить план?');
  if (!ok) return;
  try {
    await api(`/plans/${id}`, { method: 'DELETE' });
    toast('План удалён');
    loadPlans();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Create Tasks (unified modal: AI-анализ + Из документа) ──

let createTasksActiveTab = 'ai';

window.showCreateTasksModal = async function () {
  // Reset form
  document.getElementById('createTasksPrompt').value = '';
  document.getElementById('createTasksCount').value = '5';
  document.getElementById('createTasksTimeout').value = '20';
  document.getElementById('createTasksDocText').value = '';
  document.getElementById('createTasksCharCount').textContent = '0 символов';
  document.getElementById('createTasksCharCount').className = 'char-counter';
  document.querySelector('input[name="createTasksOutputMode"][value="tasks"]').checked = true;

  // Reset tab to AI
  switchCreateTasksTab('ai');

  try {
    // Load templates
    const templates = await api('/improve-templates');
    const tplSelect = document.getElementById('createTasksTemplate');
    tplSelect.innerHTML = '<option value="">— Свой промпт —</option>' +
      templates.map(t => `<option value="${t.id}" data-prompt="${escapeHtml(t.prompt)}">${escapeHtml(t.name)}</option>`).join('');

    // Load models
    const models = await api('/ai-models');
    const modelSelect = document.getElementById('createTasksModel');
    modelSelect.innerHTML = models.length === 0
      ? '<option value="">Нет моделей</option>'
      : models.map(m => `<option value="${m.id}" data-provider="${m.provider}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    restoreModel('kaizen_model_improve', 'createTasksModel');
    updateCreateTasksModeInfo();
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('createTasksModal');
};

window.switchCreateTasksTab = function (tab) {
  createTasksActiveTab = tab;
  document.getElementById('createTasksTabAI').style.display = tab === 'ai' ? '' : 'none';
  document.getElementById('createTasksTabDoc').style.display = tab === 'doc' ? '' : 'none';
  document.querySelectorAll('[data-create-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.createTab === tab);
  });
  // Default output mode per tab
  if (tab === 'ai') {
    document.querySelector('input[name="createTasksOutputMode"][value="tasks"]').checked = true;
  } else {
    document.querySelector('input[name="createTasksOutputMode"][value="releases"]').checked = true;
  }
  // Show/hide count field (only relevant for AI tab)
  const countGroup = document.getElementById('createTasksCountGroup');
  if (countGroup) countGroup.style.display = tab === 'ai' ? '' : 'none';
};

window.handleCreateTasksTemplateChange = function () {
  const sel = document.getElementById('createTasksTemplate');
  const opt = sel.options[sel.selectedIndex];
  const prompt = opt?.dataset?.prompt || '';
  if (prompt) {
    document.getElementById('createTasksPrompt').value = prompt;
  }
};

window.updateCreateTasksModeInfo = function () {
  const sel = document.getElementById('createTasksModel');
  const opt = sel.options[sel.selectedIndex];
  const provider = opt?.dataset?.provider || '';
  const hasPath = product && !!product.project_path;
  const isCodeAgent = ['claude-code', 'qwen-code', 'kilo-code'].includes(provider);
  const el = document.getElementById('createTasksModeInfo');

  if (isCodeAgent && hasPath) {
    el.innerHTML = `<span class="badge badge-mode-claude-code" title="Модель изучит проект через CLI">${provider}</span>`;
  } else if (provider) {
    el.innerHTML = `<span class="badge badge-mode-standalone" title="${hasPath ? 'Контекст проекта будет собран автоматически' : 'Без доступа к файлам проекта'}">standalone</span>`;
  } else {
    el.innerHTML = '';
  }
};

// Char counter for doc text
document.getElementById('createTasksDocText')?.addEventListener('input', function () {
  const len = this.value.length;
  const el = document.getElementById('createTasksCharCount');
  el.textContent = `${len.toLocaleString('ru-RU')} символов`;
  el.className = 'char-counter' + (len > 100000 ? ' danger' : len > 50000 ? ' warning' : '');
});

window.handleCreateTasksGenerate = async function () {
  const modelId = document.getElementById('createTasksModel').value;
  const timeoutMin = parseInt(document.getElementById('createTasksTimeout').value) || 20;
  const outputMode = document.querySelector('input[name="createTasksOutputMode"]:checked').value;

  if (!modelId) return toast('Выберите модель', 'error');
  saveModel('kaizen_model_improve', 'createTasksModel');

  const body = {
    product_id: productId,
    model_id: modelId,
    timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
  };

  if (createTasksActiveTab === 'ai') {
    const prompt = document.getElementById('createTasksPrompt').value.trim();
    const templateId = document.getElementById('createTasksTemplate').value;
    const count = document.getElementById('createTasksCount').value;
    if (!prompt) return toast('Введите промпт', 'error');

    body.type = 'improve';
    body.prompt = prompt;
    body.template_id = templateId || null;
    body.count = parseInt(count) || 5;
    if (outputMode !== 'tasks') body.config = { output_mode: outputMode };
  } else {
    const docText = document.getElementById('createTasksDocText').value.trim();
    if (!docText) return toast('Вставьте текст документа', 'error');

    body.type = 'roadmap_from_doc';
    body.prompt = docText;
    if (outputMode !== 'releases') body.config = { output_mode: outputMode };
  }

  try {
    await api('/processes', { method: 'POST', body });
    toast('Процесс запущен');
    closeModal('createTasksModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Process detail (on product page) ────────────────────

window.showProcessDetail = async function (id) {
  const cachedProc = processesList.find(p => p.id === id);

  // form_release completed — show review modal
  if (cachedProc && isFormReleaseProcess(cachedProc)) {
    const proc = await api(`/processes/${id}`);
    showFormReleaseReview(proc);
    return;
  }

  try {
    const [proc, logs] = await Promise.all([
      api(`/processes/${id}`),
      api(`/processes/${id}/logs`),
    ]);

    document.getElementById('processDetailTitle').textContent = procTypeLabel(proc.type);
    document.getElementById('processDetailContent').innerHTML = renderProcessDetailHtml(proc, logs, {
      showProductName: false,
      showSpecLink: true,
      showDevResult: true,
      excludeTypes: ['prepare_spec'],
      modalId: 'processDetailModal',
      onShowSpecAttr: `onclick="showSpecView('${proc.release_id}')"`,
    });
    openModal('processDetailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.toggleAllProcessSuggestions = (state) => toggleAllSuggestions('processSuggestionsList', state);

window.updateProcessApproveCount = () => updateApproveCount('processSuggestionsList', 'processApproveBtn');

window.handleProcessApprove = (processId) => approveProcess(processId, 'processSuggestionsList', {
  modalId: 'processDetailModal',
  onSuccess: () => loadIssues(),
});

// ── Roadmap approval in process detail modal ─────────────

window.toggleRoadmapRelease = function (checkbox, releaseIndex) {
  const checked = checkbox.checked;
  document.querySelectorAll(`#processSuggestionsList input[data-release-index="${releaseIndex}"][data-issue-index]`)
    .forEach(cb => { cb.checked = checked; });
  updateRoadmapApproveCount();
};

window.updateRoadmapApproveCount = function () {
  const all = document.querySelectorAll('#processSuggestionsList input[data-issue-index]');
  const checked = document.querySelectorAll('#processSuggestionsList input[data-issue-index]:checked');
  const btn = document.getElementById('processApproveBtn');
  if (btn) {
    btn.textContent = `Утвердить (${checked.length} задач)`;
    btn.disabled = checked.length === 0;
  }
  // Update release-level checkboxes
  const releaseCheckboxes = document.querySelectorAll('#processSuggestionsList input[data-release-index]:not([data-issue-index])');
  releaseCheckboxes.forEach(rcb => {
    const ri = rcb.dataset.releaseIndex;
    const issuesInRelease = document.querySelectorAll(`#processSuggestionsList input[data-release-index="${ri}"][data-issue-index]`);
    const checkedInRelease = document.querySelectorAll(`#processSuggestionsList input[data-release-index="${ri}"][data-issue-index]:checked`);
    rcb.checked = checkedInRelease.length === issuesInRelease.length;
    rcb.indeterminate = checkedInRelease.length > 0 && checkedInRelease.length < issuesInRelease.length;
  });
};

window.handleProcessApproveRoadmap = async function (processId) {
  // Collect selected releases and issues
  const selectedReleases = [];
  const releaseCheckboxes = document.querySelectorAll('#processSuggestionsList input[data-release-index]:not([data-issue-index])');

  releaseCheckboxes.forEach(rcb => {
    const ri = parseInt(rcb.dataset.releaseIndex);
    const issueCheckboxes = document.querySelectorAll(`#processSuggestionsList input[data-release-index="${ri}"][data-issue-index]:checked`);
    if (issueCheckboxes.length > 0) {
      selectedReleases.push({
        release_index: ri,
        issue_indices: Array.from(issueCheckboxes).map(cb => parseInt(cb.dataset.issueIndex)),
      });
    }
  });

  if (selectedReleases.length === 0) return toast('Выберите хотя бы одну задачу', 'error');

  try {
    const result = await api(`/processes/${processId}/approve-roadmap`, {
      method: 'POST',
      body: { selected_releases: selectedReleases },
    });
    const totalIssues = selectedReleases.reduce((s, r) => s + r.issue_indices.length, 0);
    notifyStatusChanges({
      action: 'Дорожная карта утверждена',
      details: [`Создано ${result.releases_created || selectedReleases.length} релизов, ${result.issues_created || totalIssues} задач`],
    });
    closeModal('processDetailModal');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleProcessRestart = async function (processId) {
  try {
    await api(`/processes/${processId}/restart`, { method: 'POST' });
    toast('Процесс перезапущен');
    closeModal('processDetailModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Cancel queued process ────────────────────────────────

window.cancelProcess = async function (id) {
  try {
    await api(`/processes/${id}/cancel`, { method: 'POST' });
    toast('Процесс отменён');
    loadProcesses();
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
    restoreModel('kaizen_model_spec', 'specModel');
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
  const isCodeAgent = ['claude-code', 'qwen-code', 'kilo-code'].includes(provider);
  const mode = (isCodeAgent && hasPath) ? 'code-agent' : 'standalone';
  const badge = document.getElementById('specModeBadge');
  badge.innerHTML = mode === 'code-agent'
    ? `<span class="badge badge-mode-claude-code">${provider}</span> <span style="font-size:0.8rem;color:var(--text-dim);margin-left:4px">Модель изучит проект через CLI</span>`
    : `<span class="badge badge-mode-standalone">standalone</span> <span style="font-size:0.8rem;color:var(--text-dim);margin-left:4px">${hasPath ? 'Контекст проекта будет собран автоматически' : 'Без доступа к файлам проекта'}</span>`;
};

window.handlePrepareSpec = async function () {
  const releaseId = document.getElementById('specReleaseId').value;
  const modelId = document.getElementById('specModel').value;
  const timeoutMin = parseInt(document.getElementById('specTimeout').value) || 20;

  if (!modelId) return toast('Выберите модель', 'error');
  saveModel('kaizen_model_spec', 'specModel');

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

    const specEl = document.getElementById('specViewContent');
    if (currentSpecText && typeof marked !== 'undefined') {
      specEl.innerHTML = marked.parse(currentSpecText);
    } else {
      specEl.textContent = currentSpecText || 'Спецификация пуста';
    }
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

  // Load code-agent models (claude-code, qwen-code, kilo-code)
  try {
    const models = await api('/ai-models');
    const codeAgentProviders = ['claude-code', 'qwen-code', 'kilo-code'];
    const ccModels = models.filter(m => codeAgentProviders.includes(m.provider));
    const sel = document.getElementById('developModel');
    sel.innerHTML = ccModels.length === 0
      ? '<option value="">Нет Code Agent моделей</option>'
      : ccModels.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    restoreModel('kaizen_model_develop', 'developModel');
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
  saveModel('kaizen_model_develop', 'developModel');
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

// ── Prepare press release ──────────────────────────────────

let currentPressRelease = null;
let currentPressReleaseRelease = null;
let currentPressReleaseTab = null;

window.showPreparePressReleaseModal = async function (releaseId) {
  const release = releases.find(r => r.id === releaseId);
  document.getElementById('prReleaseId').value = releaseId;
  document.getElementById('prReleaseName').textContent = release
    ? `${release.version} — ${release.name}`
    : releaseId;
  document.getElementById('prTimeout').value = '20';
  document.getElementById('prKeyPoints').value = '';

  // Reset checkboxes
  document.querySelectorAll('#preparePressReleaseModal input[name="prChannel"]').forEach(cb => cb.checked = true);
  document.querySelectorAll('#preparePressReleaseModal input[name="prAudience"]').forEach(cb => cb.checked = false);
  document.querySelector('#preparePressReleaseModal input[name="prAudience"][value="employees"]').checked = true;
  document.getElementById('prGenerateImages').checked = true;
  document.getElementById('prTone').value = 'official';

  try {
    const models = await api('/ai-models');
    const sel = document.getElementById('prModel');
    sel.innerHTML = models.length === 0
      ? '<option value="">Нет моделей</option>'
      : models.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    restoreModel('kaizen_model_pr', 'prModel');
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('preparePressReleaseModal');
};

window.handlePreparePressRelease = async function () {
  const releaseId = document.getElementById('prReleaseId').value;
  const modelId = document.getElementById('prModel').value;
  const timeoutMin = parseInt(document.getElementById('prTimeout').value) || 20;
  const tone = document.getElementById('prTone').value;
  const generateImages = document.getElementById('prGenerateImages').checked;
  const keyPoints = document.getElementById('prKeyPoints').value.trim();
  saveModel('kaizen_model_pr', 'prModel');

  const channels = Array.from(document.querySelectorAll('#preparePressReleaseModal input[name="prChannel"]:checked')).map(cb => cb.value);
  const audiences = Array.from(document.querySelectorAll('#preparePressReleaseModal input[name="prAudience"]:checked')).map(cb => cb.value);

  if (channels.length === 0) return toast('Выберите хотя бы один канал', 'error');
  if (!modelId) return toast('Выберите модель', 'error');

  try {
    await api(`/releases/${releaseId}/prepare-press-release`, {
      method: 'POST',
      body: {
        model_id: modelId,
        channels,
        tone,
        audiences,
        generate_images: generateImages,
        key_points: keyPoints || null,
        timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
      },
    });
    toast('Генерация пресс-релиза запущена');
    closeModal('preparePressReleaseModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Press release view ─────────────────────────────────────

window.showPressReleaseView = async function (releaseId) {
  try {
    const data = await api(`/releases/${releaseId}/press-release`);
    const release = releases.find(r => r.id === releaseId);
    currentPressRelease = data.press_release;
    currentPressReleaseRelease = release;

    document.getElementById('prViewTitle').textContent = release
      ? `Пресс-релиз: ${release.version} — ${release.name}`
      : 'Пресс-релиз';

    let meta = '';
    if (data.process) {
      meta += `<span>Модель: <strong style="color:var(--text)">${escapeHtml(data.process.model_name || '')}</strong></span>`;
      if (data.process.duration_ms) meta += `<span>Длительность: ${formatDuration(data.process.duration_ms)}</span>`;
      if (data.process.result && data.process.result.mode) meta += `<span class="badge badge-mode-${data.process.result.mode}">${data.process.result.mode}</span>`;
    }
    document.getElementById('prViewMeta').innerHTML = meta;

    if (!currentPressRelease || !currentPressRelease.channels) {
      document.getElementById('prViewTabs').innerHTML = '';
      document.getElementById('prViewContent').innerHTML = '<p style="color:var(--text-dim)">Пресс-релиз пуст</p>';
      openModal('pressReleaseViewModal');
      return;
    }

    // Build tabs
    const channelNames = { social: 'Соцсети', website: 'Сайт', bitrix24: 'Битрикс24', media: 'СМИ' };
    const availableChannels = Object.keys(currentPressRelease.channels);
    let tabs = availableChannels.map(ch =>
      `<div class="pr-tab" data-tab="${ch}" onclick="switchPressReleaseTab('${ch}')">${channelNames[ch] || ch}</div>`
    );
    if (currentPressRelease.image_prompts || currentPressRelease.screenshots_needed) {
      tabs.push(`<div class="pr-tab" data-tab="images" onclick="switchPressReleaseTab('images')">Изображения</div>`);
    }
    document.getElementById('prViewTabs').innerHTML = tabs.join('');

    // Show first tab
    const firstTab = availableChannels[0] || 'images';
    switchPressReleaseTab(firstTab);

    openModal('pressReleaseViewModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.switchPressReleaseTab = function (tabName) {
  currentPressReleaseTab = tabName;
  document.querySelectorAll('#prViewTabs .pr-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));

  const content = document.getElementById('prViewContent');
  const pr = currentPressRelease;

  if (tabName === 'social' && pr.channels.social) {
    const s = pr.channels.social;
    content.innerHTML = `
      <div class="pr-channel-block">
        <h4>ВКонтакте</h4>
        <pre class="pr-text">${escapeHtml(s.platform_vk || '')}</pre>
      </div>
      <div class="pr-channel-block">
        <h4>Telegram</h4>
        <pre class="pr-text">${escapeHtml(s.platform_telegram || '')}</pre>
      </div>
      ${s.hashtags && s.hashtags.length ? `<div class="pr-channel-block"><h4>Хештеги</h4><p>${s.hashtags.map(h => `<span class="badge badge-improvement">${escapeHtml(h)}</span>`).join(' ')}</p></div>` : ''}`;
  } else if (tabName === 'website' && pr.channels.website) {
    const w = pr.channels.website;
    content.innerHTML = `
      <div class="pr-channel-block">
        <h4>${escapeHtml(w.title || '')}</h4>
        ${w.subtitle ? `<p style="color:var(--text-dim);font-style:italic;margin-bottom:12px">${escapeHtml(w.subtitle)}</p>` : ''}
        <pre class="pr-text">${escapeHtml(w.body || '')}</pre>
      </div>
      ${w.seo_keywords && w.seo_keywords.length ? `<div class="pr-channel-block"><h4>SEO-ключи</h4><p>${w.seo_keywords.map(k => `<span class="badge badge-feature">${escapeHtml(k)}</span>`).join(' ')}</p></div>` : ''}
      ${w.meta_description ? `<div class="pr-channel-block"><h4>Meta Description</h4><p style="color:var(--text-dim)">${escapeHtml(w.meta_description)}</p></div>` : ''}`;
  } else if (tabName === 'bitrix24' && pr.channels.bitrix24) {
    const b = pr.channels.bitrix24;
    content.innerHTML = `
      <div class="pr-channel-block">
        <h4>${escapeHtml(b.title || '')}</h4>
        <pre class="pr-text">${escapeHtml(b.body || '')}</pre>
      </div>
      ${b.mentions && b.mentions.length ? `<div class="pr-channel-block"><h4>Упоминания</h4><p>${b.mentions.map(m => `<span class="badge badge-improvement">${escapeHtml(m)}</span>`).join(' ')}</p></div>` : ''}`;
  } else if (tabName === 'media' && pr.channels.media) {
    const m = pr.channels.media;
    content.innerHTML = `
      <div class="pr-channel-block">
        <h4>${escapeHtml(m.title || '')}</h4>
        ${m.lead ? `<p style="font-weight:600;margin-bottom:12px">${escapeHtml(m.lead)}</p>` : ''}
        <pre class="pr-text">${escapeHtml(m.body || '')}</pre>
      </div>
      ${m.quotes && m.quotes.length ? `<div class="pr-channel-block"><h4>Цитаты</h4>${m.quotes.map(q => `<blockquote style="border-left:3px solid var(--accent);padding-left:12px;color:var(--text-dim);margin:8px 0">${escapeHtml(q)}</blockquote>`).join('')}</div>` : ''}
      ${m.boilerplate ? `<div class="pr-channel-block"><h4>О компании</h4><p style="color:var(--text-dim)">${escapeHtml(m.boilerplate)}</p></div>` : ''}`;
  } else if (tabName === 'images') {
    let html = '';
    if (pr.image_prompts && pr.image_prompts.length) {
      html += `<div class="pr-channel-block"><h4>Промпты для генерации изображений</h4>`;
      html += pr.image_prompts.map((ip, i) => `
        <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div style="font-weight:600;margin-bottom:4px">${i + 1}. ${escapeHtml(ip.description || '')}</div>
          ${ip.purpose ? `<div style="font-size:0.85rem;color:var(--text-dim)">Назначение: ${escapeHtml(ip.purpose)}</div>` : ''}
          ${ip.style ? `<div style="font-size:0.85rem;color:var(--text-dim)">Стиль: ${escapeHtml(ip.style)}</div>` : ''}
          ${ip.dimensions ? `<div style="font-size:0.85rem;color:var(--text-dim)">Размеры: ${escapeHtml(ip.dimensions)}</div>` : ''}
        </div>
      `).join('');
      html += `</div>`;
    }
    if (pr.screenshots_needed && pr.screenshots_needed.length) {
      html += `<div class="pr-channel-block"><h4>Необходимые скриншоты</h4>`;
      html += pr.screenshots_needed.map((ss, i) => `
        <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div style="font-weight:600;margin-bottom:4px">${i + 1}. ${escapeHtml(ss.what || '')}</div>
          ${ss.why ? `<div style="font-size:0.85rem;color:var(--text-dim)">Зачем: ${escapeHtml(ss.why)}</div>` : ''}
          ${ss.annotations ? `<div style="font-size:0.85rem;color:var(--text-dim)">Подписи: ${escapeHtml(ss.annotations)}</div>` : ''}
        </div>
      `).join('');
      html += `</div>`;
    }
    content.innerHTML = html || '<p style="color:var(--text-dim)">Нет данных об изображениях</p>';
  } else {
    content.innerHTML = '<p style="color:var(--text-dim)">Нет данных для этого канала</p>';
  }
};

window.handleCopyPressReleaseChannel = async function () {
  if (!currentPressRelease || !currentPressReleaseTab) return;
  const pr = currentPressRelease;
  const tab = currentPressReleaseTab;
  let text = '';

  if (tab === 'social' && pr.channels.social) {
    const s = pr.channels.social;
    text = `ВКонтакте:\n${s.platform_vk || ''}\n\nTelegram:\n${s.platform_telegram || ''}`;
    if (s.hashtags) text += `\n\nХештеги: ${s.hashtags.join(' ')}`;
  } else if (tab === 'website' && pr.channels.website) {
    const w = pr.channels.website;
    text = `${w.title || ''}\n${w.subtitle || ''}\n\n${w.body || ''}`;
    if (w.seo_keywords) text += `\n\nSEO: ${w.seo_keywords.join(', ')}`;
    if (w.meta_description) text += `\nMeta: ${w.meta_description}`;
  } else if (tab === 'bitrix24' && pr.channels.bitrix24) {
    const b = pr.channels.bitrix24;
    text = `${b.title || ''}\n\n${b.body || ''}`;
  } else if (tab === 'media' && pr.channels.media) {
    const m = pr.channels.media;
    text = `${m.title || ''}\n\n${m.lead || ''}\n\n${m.body || ''}`;
    if (m.quotes) text += `\n\nЦитаты:\n${m.quotes.join('\n')}`;
    if (m.boilerplate) text += `\n\nО компании:\n${m.boilerplate}`;
  }

  try {
    await navigator.clipboard.writeText(text);
    toast('Канал скопирован');
  } catch {
    toast('Не удалось скопировать', 'error');
  }
};

window.handleDownloadPressRelease = function () {
  if (!currentPressRelease) return;
  const pr = currentPressRelease;
  const release = currentPressReleaseRelease;
  let md = `# Пресс-релиз ${release ? `${release.version} — ${release.name}` : ''}\n\n`;

  if (pr.channels.social) {
    const s = pr.channels.social;
    md += `## Соцсети\n\n### ВКонтакте\n\n${s.platform_vk || ''}\n\n### Telegram\n\n${s.platform_telegram || ''}\n\n`;
    if (s.hashtags) md += `**Хештеги:** ${s.hashtags.join(' ')}\n\n`;
  }
  if (pr.channels.website) {
    const w = pr.channels.website;
    md += `## Сайт\n\n### ${w.title || ''}\n\n`;
    if (w.subtitle) md += `*${w.subtitle}*\n\n`;
    md += `${w.body || ''}\n\n`;
    if (w.seo_keywords) md += `**SEO:** ${w.seo_keywords.join(', ')}\n\n`;
    if (w.meta_description) md += `**Meta:** ${w.meta_description}\n\n`;
  }
  if (pr.channels.bitrix24) {
    const b = pr.channels.bitrix24;
    md += `## Битрикс24\n\n### ${b.title || ''}\n\n${b.body || ''}\n\n`;
    if (b.mentions) md += `**Упоминания:** ${b.mentions.join(', ')}\n\n`;
  }
  if (pr.channels.media) {
    const m = pr.channels.media;
    md += `## СМИ\n\n### ${m.title || ''}\n\n**Лид:** ${m.lead || ''}\n\n${m.body || ''}\n\n`;
    if (m.quotes) md += `**Цитаты:**\n${m.quotes.map(q => `> ${q}`).join('\n')}\n\n`;
    if (m.boilerplate) md += `**О компании:** ${m.boilerplate}\n\n`;
  }
  if (pr.image_prompts) {
    md += `## Промпты для изображений\n\n`;
    pr.image_prompts.forEach((ip, i) => {
      md += `${i + 1}. ${ip.description || ''} (${ip.purpose || ''}, ${ip.style || ''}, ${ip.dimensions || ''})\n`;
    });
    md += `\n`;
  }
  if (pr.screenshots_needed) {
    md += `## Необходимые скриншоты\n\n`;
    pr.screenshots_needed.forEach((ss, i) => {
      md += `${i + 1}. ${ss.what || ''} — ${ss.why || ''}\n`;
    });
    md += `\n`;
  }

  const filename = release
    ? `PRESS_RELEASE_v${release.version.replace(/\./g, '_')}.md`
    : 'PRESS_RELEASE.md';
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast('Файл скачан');
};

// ── RC Tickets ──────────────────────────────────────────

async function loadRcTickets() {
  try {
    const path = rcCurrentFilter
      ? `/products/${productId}/rc-tickets?sync_status=${rcCurrentFilter}`
      : `/products/${productId}/rc-tickets`;
    rcTicketsList = await api(path);
    renderRcTickets();
  } catch (err) {
    // Silently handle — tab may not be active
  }
}

function renderRcTickets() {
  const body = document.getElementById('rcTicketsBody');
  const empty = document.getElementById('rcTicketsEmpty');

  if (rcTicketsList.length === 0) {
    body.innerHTML = '';
    empty.style.display = '';
    document.getElementById('tabRcTicketsCount').textContent = '(0)';
    return;
  }
  empty.style.display = 'none';

  const newCount = rcTicketsList.filter(t => t.sync_status === 'new').length;
  document.getElementById('tabRcTicketsCount').textContent = newCount > 0 ? `(${newCount})` : `(${rcTicketsList.length})`;

  body.innerHTML = rcTicketsList.map(t => {
    const checked = rcSelectedIds.has(t.id) ? 'checked' : '';
    const disabled = t.sync_status !== 'new' ? 'disabled' : '';
    const statusBadge = t.sync_status === 'imported'
      ? '<span class="badge badge-done">импортирован</span>'
      : t.sync_status === 'ignored'
        ? '<span class="badge badge-closed">игнорирован</span>'
        : '<span class="badge badge-open">новый</span>';
    const priorityClass = t.rc_priority_id === 4 ? 'priority-critical'
      : t.rc_priority_id === 3 ? 'priority-high' : '';
    return `<tr class="rc-ticket-row" onclick="showRcTicketDetail('${t.id}')" style="cursor:pointer">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${checked} ${disabled} onchange="handleRcCheckbox('${t.id}', this.checked)"></td>
      <td style="font-family:monospace;font-size:0.85rem">${t.rc_ticket_id}</td>
      <td>${escapeHtml(t.title || '')}</td>
      <td>${escapeHtml(t.rc_type || '')}</td>
      <td>${escapeHtml(t.rc_status || '')}</td>
      <td class="${priorityClass}">${escapeHtml(t.rc_priority || '')}</td>
      <td>${t.rc_created_at ? formatDate(t.rc_created_at) : ''}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  updateRcActionButtons();
}

function updateRcActionButtons() {
  const count = rcSelectedIds.size;
  document.getElementById('rcImportBtn').style.display = count > 0 ? '' : 'none';
  document.getElementById('rcIgnoreBtn').style.display = count > 0 ? '' : 'none';
  document.getElementById('rcSelectedCount').textContent = count;
}

window.handleRcCheckbox = function (id, checked) {
  if (checked) rcSelectedIds.add(id);
  else rcSelectedIds.delete(id);
  updateRcActionButtons();
};

window.handleRcSelectAll = function (checked) {
  rcSelectedIds.clear();
  if (checked) {
    rcTicketsList.filter(t => t.sync_status === 'new').forEach(t => rcSelectedIds.add(t.id));
  }
  renderRcTickets();
};

window.handleRcSync = async function () {
  const btn = document.getElementById('rcSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Загрузка...';
  try {
    const stats = await api(`/products/${productId}/rc-sync`, { method: 'POST' });
    toast(`Синхронизация: ${stats.new} новых, ${stats.updated} обновлённых (всего ${stats.total})`);
    rcSelectedIds.clear();
    await loadRcTickets();
  } catch (err) {
    toast(err.message || 'Ошибка подключения к Rivc.Connect', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Синхронизировать';
  }
};

window.handleRcImportSelected = async function () {
  if (rcSelectedIds.size === 0) return;
  try {
    const ids = Array.from(rcSelectedIds);
    const created = await api('/rc-tickets/import-bulk', {
      method: 'POST',
      body: { ticket_ids: ids },
    });
    toast(`Импортировано ${created.length} задач`);
    rcSelectedIds.clear();
    await Promise.all([loadRcTickets(), loadIssues()]);
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleRcIgnoreSelected = async function () {
  if (rcSelectedIds.size === 0) return;
  try {
    for (const id of rcSelectedIds) {
      await api(`/rc-tickets/${id}/ignore`, { method: 'POST' });
    }
    toast(`${rcSelectedIds.size} тикетов помечены как игнорированные`);
    rcSelectedIds.clear();
    await loadRcTickets();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.showRcTicketDetail = async function (id) {
  const ticket = rcTicketsList.find(t => t.id === id);
  if (!ticket) return;

  document.getElementById('rcTicketDetailTitle').textContent = `Тикет #${ticket.rc_ticket_id}`;

  const html = `
    <div style="margin-bottom:16px">
      <h3 style="margin:0 0 8px">${escapeHtml(ticket.title || '')}</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.85rem;color:var(--text-dim);margin-bottom:12px">
        <span>Тип: <b>${escapeHtml(ticket.rc_type || '—')}</b></span>
        <span>Приоритет: <b>${escapeHtml(ticket.rc_priority || '—')}</b></span>
        <span>Статус RC: <b>${escapeHtml(ticket.rc_status || '—')}</b></span>
        <span>Автор: <b>${escapeHtml(ticket.rc_author || '—')}</b></span>
      </div>
      ${ticket.rc_created_at ? `<div style="font-size:0.85rem;color:var(--text-dim)">Создан: ${formatDate(ticket.rc_created_at)}</div>` : ''}
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;max-height:40vh;overflow-y:auto;white-space:pre-wrap;font-size:0.9rem;line-height:1.5">
      ${ticket.description || 'Нет описания'}
    </div>
    ${ticket.issue_id ? `<div style="margin-top:12px;font-size:0.9rem">Импортирован как задача Kaizen</div>` : ''}
  `;
  document.getElementById('rcTicketDetailContent').innerHTML = html;

  const importBtn = document.getElementById('rcTicketImportBtn');
  importBtn.style.display = ticket.sync_status === 'new' ? '' : 'none';
  window._rcDetailTicketId = id;

  openModal('rcTicketDetailModal');
};

window.handleRcImportSingle = async function () {
  const id = window._rcDetailTicketId;
  if (!id) return;
  try {
    const issue = await api(`/rc-tickets/${id}/import`, { method: 'POST' });
    toast(`Тикет импортирован как задача: ${issue.title}`);
    closeModal('rcTicketDetailModal');
    await Promise.all([loadRcTickets(), loadIssues()]);
  } catch (err) {
    toast(err.message, 'error');
  }
};

// RC ticket filters
document.getElementById('rcTicketFilters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#rcTicketFilters button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  rcCurrentFilter = btn.dataset.syncStatus;
  rcSelectedIds.clear();
  loadRcTickets();
});

// ── Form Release (AI) ────────────────────────────────────

let formReleaseProcessId = null;
let formReleaseResult = null;
let formReleasePollingTimer = null;

function updateFormReleaseButton() {
  const openCount = issues.filter(i => i.status === 'open').length;
  const btn = document.getElementById('formReleaseBtn');
  btn.style.display = openCount >= 2 ? '' : 'none';
}

window.showFormReleaseModal = async function () {
  const openCount = issues.filter(i => i.status === 'open').length;
  document.getElementById('frOpenCount').textContent = openCount;
  document.getElementById('frStrategy').value = openCount < 5 ? 'single' : 'balanced';
  document.getElementById('frMaxReleases').value = '3';
  document.getElementById('frTimeout').value = '20';
  document.getElementById('frAutoApprove').checked = false;

  try {
    const models = await api('/ai-models');
    const sel = document.getElementById('frModel');
    sel.innerHTML = models.length === 0
      ? '<option value="">Нет моделей</option>'
      : models.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
    restoreModel('kaizen_model_fr', 'frModel');
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('formReleaseModal');
};

window.handleFormReleaseStart = async function () {
  const modelId = document.getElementById('frModel').value;
  const strategy = document.getElementById('frStrategy').value;
  const maxReleases = parseInt(document.getElementById('frMaxReleases').value) || 3;
  const timeoutMin = parseInt(document.getElementById('frTimeout').value) || 20;
  const autoApprove = document.getElementById('frAutoApprove').checked;

  if (!modelId) return toast('Выберите модель', 'error');
  saveModel('kaizen_model_fr', 'frModel');

  try {
    const proc = await api('/processes', {
      method: 'POST',
      body: {
        product_id: productId,
        model_id: modelId,
        type: 'form_release',
        prompt: '',
        config: { strategy, max_releases: maxReleases, auto_approve: autoApprove },
        timeout_min: Math.min(Math.max(timeoutMin, 3), 60),
      },
    });

    formReleaseProcessId = proc.id;
    toast(autoApprove ? 'Процесс запущен (авто-утверждение)' : 'Процесс запущен');
    closeModal('formReleaseModal');
    loadProcesses();

    // If not auto-approve, poll and show review modal when done
    if (!autoApprove) {
      pollFormRelease(proc.id);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
};

function pollFormRelease(processId) {
  if (formReleasePollingTimer) clearInterval(formReleasePollingTimer);
  formReleasePollingTimer = setInterval(async () => {
    try {
      const proc = await api(`/processes/${processId}`);
      if (proc.status === 'completed') {
        clearInterval(formReleasePollingTimer);
        formReleasePollingTimer = null;
        if (proc.result && !proc.result.auto_approved) {
          showFormReleaseReview(proc);
        } else {
          // Auto-approved — just reload
          loadReleases();
          loadIssues();
        }
      } else if (proc.status === 'failed') {
        clearInterval(formReleasePollingTimer);
        formReleasePollingTimer = null;
        toast('Процесс формирования релиза завершился с ошибкой', 'error');
      }
    } catch {
      // ignore polling errors
    }
  }, 4000);
}

function showFormReleaseReview(proc) {
  formReleaseProcessId = proc.id;
  formReleaseResult = proc.result;

  // Проверить: созданы ли уже релизы с предложенными версиями
  let procForRender = proc;
  if (!proc.approved_count && !proc.result?.auto_approved) {
    const existingVersions = new Set((releases || []).map(r => r.version));
    const proposedVersions = (proc.result?.releases || []).map(r => r.version);
    if (proposedVersions.length > 0 && proposedVersions.every(v => existingVersions.has(v))) {
      procForRender = { ...proc, approved_count: proposedVersions.length };
    }
  }

  document.getElementById('frReviewTitle').textContent = 'Формирование релиза';
  document.getElementById('frReviewContent').innerHTML = renderFormReleaseHtml(procForRender, {
    modalId: 'formReleaseReviewModal',
    onApprove: 'handleFormReleaseApprove()',
    onSelectAll: 'frSelectAll(true)',
    onSelectNone: 'frSelectAll(false)',
    onToggleRelease: 'frToggleReleaseProduct',
    onToggleIssue: 'frUpdateCount',
  });

  // Hide the external approve button — new UI has its own inside frReviewContent
  document.getElementById('frApproveBtn').style.display = 'none';

  openModal('formReleaseReviewModal');
}

window.handleFormReleaseApprove = async function () {
  if (!formReleaseProcessId || !formReleaseResult) return;

  const releasesArr = formReleaseResult.releases || [];
  // Group checked issue checkboxes by rel-idx
  const byRel = {};
  document.querySelectorAll('input.fr-issue-cb:checked').forEach(cb => {
    const idx = cb.dataset.relIdx;
    if (!byRel[idx]) byRel[idx] = [];
    byRel[idx].push(cb.dataset.issueId);
  });

  const toCreate = releasesArr
    .map((rel, idx) => ({ rel, ids: byRel[String(idx)] || [] }))
    .filter(({ ids }) => ids.length > 0)
    .map(({ rel, ids }) => ({
      version: rel.version,
      name: rel.name,
      description: rel.description || null,
      issue_ids: ids,
    }));

  if (toCreate.length === 0) return toast('Нет задач для создания релизов', 'error');

  try {
    const result = await api(`/processes/${formReleaseProcessId}/approve-releases`, {
      method: 'POST',
      body: { releases: toCreate },
    });
    toast(`Создано ${result.created_releases} релиз(ов), ${result.total_issues} задач`);
    closeModal('formReleaseReviewModal');
    await Promise.all([loadReleases(), loadIssues(), loadProcesses()]);
  } catch (err) {
    toast(err.message, 'error');
  }
};

// Show review for completed form_release when clicking on process
function isFormReleaseProcess(proc) {
  return proc.type === 'form_release' && proc.status === 'completed' && proc.result && !proc.result.auto_approved;
}

// ── FR helpers (product page) ────────────────────────────

window.frToggleRelease = function (idx) {
  document.getElementById(`fr-rel-${idx}`)?.classList.toggle('open');
};

window.frToggleReleaseProduct = function (checkbox, idx) {
  const checked = checkbox.checked;
  document.querySelectorAll(`input.fr-issue-cb[data-rel-idx="${idx}"]`)
    .forEach(cb => { cb.checked = checked; });
  frUpdateCount();
};

window.frSelectAll = function (state) {
  document.querySelectorAll('input.fr-issue-cb').forEach(cb => { cb.checked = state; });
  document.querySelectorAll('input.fr-release-cb').forEach(cb => { cb.checked = state; });
  frUpdateCount();
};

window.frUpdateCount = function () {
  const issues = document.querySelectorAll('input.fr-issue-cb:checked');
  const rels = new Set(Array.from(issues).map(cb => cb.dataset.relIdx));
  const btn = document.getElementById('frApproveBtnModal');
  if (btn) {
    btn.innerHTML = `Создать релизы (${rels.size})<span class="fr-approve-sub">· ${issues.length} задач</span>`;
    btn.disabled = issues.length === 0;
  }
};

// Expose closeModal globally for inline onclick handlers
window.closeModal = closeModal;

// ══════════════════════════════════════════════════════════
//  Automation Settings
// ══════════════════════════════════════════════════════════

window.toggleAutoSection = function (section, enabled) {
  const map = {
    rcSync: 'autoRcSyncSettings',
    autoImport: 'autoImportSettings',
    gitlabSync: 'autoGitlabSyncSettings',
    gitlabImport: 'autoGitlabImportSettings',
    notify: 'autoNotifySettings',
  };
  const el = document.getElementById(map[section]);
  if (el) el.style.display = enabled ? 'block' : 'none';
};

function loadAutomationSettings() {
  if (!product) return;
  const auto = product.automation || {};

  // RC Auto-Sync
  const rcSync = auto.rc_auto_sync || {};
  document.getElementById('autoRcSyncEnabled').checked = !!rcSync.enabled;
  document.getElementById('autoRcSyncInterval').value = rcSync.interval_hours || 24;
  toggleAutoSection('rcSync', !!rcSync.enabled);

  const autoImport = rcSync.auto_import || {};
  document.getElementById('autoImportEnabled').checked = !!autoImport.enabled;
  toggleAutoSection('autoImport', !!autoImport.enabled);

  const rules = autoImport.rules || ['critical', 'high'];
  document.getElementById('autoImportCritical').checked = rules.includes('critical');
  document.getElementById('autoImportHigh').checked = rules.includes('high');
  document.getElementById('autoImportMedium').checked = rules.includes('medium');

  if (product.last_rc_sync_at) {
    document.getElementById('autoRcSyncStatus').textContent =
      `Последняя синхронизация: ${new Date(product.last_rc_sync_at).toLocaleString('ru', { timeZone: 'Europe/Moscow' })}`;
  }

  // GitLab Auto-Sync
  const gitlabSync = auto.gitlab_auto_sync || {};
  document.getElementById('autoGitlabSyncEnabled').checked = !!gitlabSync.enabled;
  document.getElementById('autoGitlabSyncInterval').value = gitlabSync.interval_hours || 0.5;
  toggleAutoSection('gitlabSync', !!gitlabSync.enabled);

  const gitlabImport = gitlabSync.auto_import || {};
  document.getElementById('autoGitlabImportEnabled').checked = !!gitlabImport.enabled;
  toggleAutoSection('gitlabImport', !!gitlabImport.enabled);
  document.getElementById('autoGitlabLabelRules').value = (gitlabImport.label_rules || []).join(', ');

  if (product.last_gitlab_sync_at) {
    document.getElementById('autoGitlabSyncStatus').textContent =
      `Последняя синхронизация: ${new Date(product.last_gitlab_sync_at).toLocaleString('ru', { timeZone: 'Europe/Moscow' })}`;
  }

  // Notifications
  const notif = auto.notifications || {};
  document.getElementById('autoNotifyEnabled').checked = !!notif.enabled;
  toggleAutoSection('notify', !!notif.enabled);
  document.getElementById('autoNotifyUserId').value = notif.bitrix24_user_id || 9;
  document.getElementById('autoNotifyGroupId').value = notif.b24_group_id || '';
  const notifEvents = notif.events || ['pipeline_completed', 'pipeline_failed', 'release_published', 'develop_completed', 'develop_failed'];
  document.querySelectorAll('.autoNotifyEvent').forEach(cb => {
    cb.checked = notifEvents.includes(cb.value);
  });
}


window.handleSaveAutomation = async function () {
  const notifyEvents = [...document.querySelectorAll('.autoNotifyEvent:checked')].map(cb => cb.value);

  const labelRulesRaw = document.getElementById('autoGitlabLabelRules').value.trim();
  const labelRules = labelRulesRaw ? labelRulesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const automation = {
    notifications: {
      enabled: document.getElementById('autoNotifyEnabled').checked,
      bitrix24_user_id: parseInt(document.getElementById('autoNotifyUserId').value) || 9,
      b24_group_id: document.getElementById('autoNotifyGroupId').value.trim() || undefined,
      events: notifyEvents,
    },
    rc_auto_sync: {
      enabled: document.getElementById('autoRcSyncEnabled').checked,
      interval_hours: parseInt(document.getElementById('autoRcSyncInterval').value) || 24,
      auto_import: {
        enabled: document.getElementById('autoImportEnabled').checked,
        rules: [
          ...(document.getElementById('autoImportCritical').checked ? ['critical'] : []),
          ...(document.getElementById('autoImportHigh').checked ? ['high'] : []),
          ...(document.getElementById('autoImportMedium').checked ? ['medium'] : []),
        ],
      },
    },
    gitlab_auto_sync: {
      enabled: document.getElementById('autoGitlabSyncEnabled').checked,
      interval_hours: parseFloat(document.getElementById('autoGitlabSyncInterval').value) || 0.5,
      auto_import: {
        enabled: document.getElementById('autoGitlabImportEnabled').checked,
        label_rules: labelRules,
      },
    },
  };

  try {
    const updated = await api(`/products/${productId}`, { method: 'PUT', body: { automation } });
    product = updated;
    toast('Настройки автоматизации сохранены');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.testNotification = async function () {
  try {
    await api('/notify', {
      method: 'POST',
      body: {
        event: 'pipeline_completed',
        data: {
          product: product?.name || 'Тестовый продукт',
          version: '0.0.0-test',
          release_id: '',
          stages_count: 5,
          preset: 'analysis',
        },
        product_id: productId,
      },
    });
    toast('Тестовое уведомление отправлено');
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Product Scenarios ────────────────────────────────────

async function loadProductScenarios() {
  const listEl = document.getElementById('productScenariosList');
  const createBtn = document.getElementById('createScenarioBtn');
  createBtn.href = `/scenarios.html?product_id=${productId}&create=1`;

  try {
    const scenarios = await api(`/products/${productId}/scenarios`);
    if (!scenarios.length) {
      listEl.textContent = 'Нет сценариев. Создайте первый.';
      return;
    }

    const presetLabels = { batch_develop: 'batch', auto_release: 'auto', nightly_audit: 'аудит', full_cycle: 'полный', analysis: 'анализ' };
    listEl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
      <tr style="border-bottom:1px solid var(--border);color:var(--text-dim)">
        <th style="text-align:left;padding:4px 8px">Название</th>
        <th style="text-align:left;padding:4px 8px">Пресет</th>
        <th style="text-align:left;padding:4px 8px">Расписание</th>
        <th style="text-align:center;padding:4px 8px">Статус</th>
        <th style="text-align:right;padding:4px 8px"></th>
      </tr>
      ${scenarios.map(s => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:4px 8px"><a href="/scenarios.html?highlight=${s.id}" style="color:var(--accent)">${escapeHtml(s.name)}</a></td>
        <td style="padding:4px 8px">${presetLabels[s.preset] || s.preset}</td>
        <td style="padding:4px 8px;color:var(--text-dim)">${s.cron || '—'}</td>
        <td style="text-align:center;padding:4px 8px">${s.enabled ? '<span style="color:var(--green)">●</span>' : '<span style="color:var(--text-dim)">○</span>'}</td>
        <td style="text-align:right;padding:4px 8px">
          <button class="btn btn-sm" onclick="runProductScenario('${s.id}','${escapeHtml(s.name)}')" style="font-size:0.75rem;padding:2px 8px">▶</button>
        </td>
      </tr>`).join('')}
    </table>`;
  } catch {
    listEl.textContent = 'Ошибка загрузки сценариев';
  }
}

window.runProductScenario = async function (id, name) {
  if (!await confirm(`Запустить сценарий «${name}»?`)) return;
  try {
    await api(`/scenarios/${id}/run`, { method: 'POST' });
    toast(`Сценарий «${name}» запущен`);
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Deploy ──────────────────────────────────────────────

function loadDeploySettings() {
  const d = product?.deploy || {};
  const gl = d.gitlab || {};
  const tgt = d.target || {};
  const ad = d.auto_deploy || {};

  document.getElementById('deployGitlabUrl').value = gl.url || '';
  document.getElementById('deployGitlabProjectId').value = gl.project_id || '';
  document.getElementById('deployGitlabRemoteUrl').value = gl.remote_url || '';
  document.getElementById('deployGitlabDefaultBranch').value = gl.default_branch || 'main';
  document.getElementById('deployGitlabToken').value = gl.access_token || '';

  document.getElementById('deployTargetHost').value = tgt.host || '';
  document.getElementById('deployTargetPort').value = tgt.port || 22;
  document.getElementById('deployTargetUser').value = tgt.user || '';
  document.getElementById('deployTargetMethod').value = tgt.method || 'docker';
  document.getElementById('deployDockerComposePath').value = tgt.docker_compose_path || '';
  document.getElementById('deployServiceName').value = tgt.service_name || '';
  document.getElementById('deployProjectPathServer').value = tgt.project_path_on_server || '';
  document.getElementById('deployPm2Name').value = tgt.pm2_name || '';
  document.getElementById('deployAutoOnPublish').checked = ad.on_publish || false;
  const ap = d.auto_publish || {};
  document.getElementById('deployAutoPublishOnSuccess').checked = ap.on_deploy_success || false;

  const urls = d.urls || {};
  document.getElementById('deployUrlFrontend').value = urls.frontend || '';
  document.getElementById('deployUrlBackend').value = urls.backend || '';

  const dev = d.dev_ports || {};
  document.getElementById('devPortFrontend').value = dev.frontend || '';
  document.getElementById('devPortBackend').value = dev.backend || '';
  document.getElementById('devStartCommand').value = dev.start_command || '';

  toggleDeployMethodFields();
  loadSmokeSettings();
}

function loadSmokeSettings() {
  const s = product?.smoke_test || {};
  document.getElementById('smokeEnabled').checked = s.enabled || false;
  document.getElementById('smokeStartCommand').value = s.start_command || 'npm run dev';
  document.getElementById('smokeUrl').value = s.url || '';
  document.getElementById('smokePages').value = (s.pages || ['/']).join(' ');
  document.getElementById('smokeReadyTimeout').value = s.ready_timeout_ms || 20000;
  document.getElementById('smokeCheckTimeout').value = s.check_timeout_ms || 10000;
}

window.toggleDeployMethodFields = function () {
  const method = document.getElementById('deployTargetMethod').value;
  document.getElementById('deployDockerFields').style.display = method === 'docker' ? '' : 'none';
  document.getElementById('deployNativeFields').style.display = method === 'native' ? '' : 'none';
};

window.handleSaveDeploy = async function () {
  const deploy = {
    gitlab: {
      url: document.getElementById('deployGitlabUrl').value.trim() || null,
      project_id: parseInt(document.getElementById('deployGitlabProjectId').value) || null,
      remote_url: document.getElementById('deployGitlabRemoteUrl').value.trim() || null,
      default_branch: document.getElementById('deployGitlabDefaultBranch').value.trim() || 'main',
      access_token: document.getElementById('deployGitlabToken').value.trim() || null,
    },
    target: {
      host: document.getElementById('deployTargetHost').value.trim() || null,
      port: parseInt(document.getElementById('deployTargetPort').value) || 22,
      user: document.getElementById('deployTargetUser').value.trim() || null,
      method: document.getElementById('deployTargetMethod').value,
      docker_compose_path: document.getElementById('deployDockerComposePath').value.trim() || null,
      service_name: document.getElementById('deployServiceName').value.trim() || null,
      project_path_on_server: document.getElementById('deployProjectPathServer').value.trim() || null,
      pm2_name: document.getElementById('deployPm2Name').value.trim() || null,
    },
    auto_deploy: {
      on_publish: document.getElementById('deployAutoOnPublish').checked,
    },
    auto_publish: {
      on_deploy_success: document.getElementById('deployAutoPublishOnSuccess').checked,
    },
    urls: {
      frontend: document.getElementById('deployUrlFrontend').value.trim() || null,
      backend: document.getElementById('deployUrlBackend').value.trim() || null,
    },
    dev_ports: {
      frontend: parseInt(document.getElementById('devPortFrontend').value) || null,
      backend: parseInt(document.getElementById('devPortBackend').value) || null,
      start_command: document.getElementById('devStartCommand').value.trim() || null,
    },
  };

  const smoke_test = {
    enabled: document.getElementById('smokeEnabled').checked,
    start_command: document.getElementById('smokeStartCommand').value.trim() || 'npm run dev',
    url: document.getElementById('smokeUrl').value.trim() || null,
    pages: document.getElementById('smokePages').value.trim().split(/[\s\n]+/).map(s => s.trim()).filter(Boolean),
    ready_timeout_ms: parseInt(document.getElementById('smokeReadyTimeout').value) || 20000,
    check_timeout_ms: parseInt(document.getElementById('smokeCheckTimeout').value) || 10000,
  };

  try {
    product = await api('PUT', `/products/${productId}`, { deploy, smoke_test });
    toast('Настройки деплоя сохранены');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleGenerateCI = async function () {
  try {
    const res = await api('POST', `/products/${productId}/generate-ci`);
    const pre = document.getElementById('deployGeneratedFile');
    pre.style.display = '';
    pre.textContent = `# ${res.filename}\n\n${res.content}`;
    toast('.gitlab-ci.yml сгенерирован');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleGenerateDockerfile = async function () {
  try {
    const res = await api('POST', `/products/${productId}/generate-dockerfile`);
    const pre = document.getElementById('deployGeneratedFile');
    pre.style.display = '';
    pre.textContent = `# Dockerfile\n\n${res.dockerfile}\n# docker-compose.yml\n\n${res.docker_compose}\n# .dockerignore\n\n${res.dockerignore}`;
    toast('Dockerfile сгенерирован');
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Validate Product ────────────────────────────────────

window.showValidateModal = async function () {
  // Populate model select
  const select = document.getElementById('valModelId');
  try {
    const models = await api('/ai-models');
    select.innerHTML = '<option value="">Без AI (только базовые)</option>' +
      models.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
  } catch {}
  openModal('validateModal');
};

window.handleValidateProduct = async function () {
  const checks = [];
  if (document.getElementById('valCheckBuild').checked) checks.push('build');
  if (document.getElementById('valCheckTests').checked) checks.push('tests');
  if (document.getElementById('valCheckSmoke').checked) checks.push('smoke');
  if (document.getElementById('valCheckLint').checked) checks.push('lint');
  if (document.getElementById('valCheckAiReview').checked) checks.push('ai_review');

  const model_id = document.getElementById('valModelId').value || null;

  try {
    const result = await api(`/products/${productId}/validate`, {
      method: 'POST',
      body: { model_id, checks },
    });
    toast('Проверка запущена');
    closeModal('validateModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── GitLab Issues ───────────────────────────────────────

let glIssuesData = [];
let glSortCol = 'gitlab_issue_iid';
let glSortAsc = false;

function renderGlIssuesTable() {
  const tbody = document.getElementById('glIssuesBody');
  const empty = document.getElementById('glIssuesEmpty');

  if (!glIssuesData.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // Sort
  const sorted = [...glIssuesData].sort((a, b) => {
    let va = a[glSortCol], vb = b[glSortCol];
    if (glSortCol === 'labels') {
      va = (Array.isArray(va) ? va : []).join(',');
      vb = (Array.isArray(vb) ? vb : []).join(',');
    }
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return glSortAsc ? -1 : 1;
    if (va > vb) return glSortAsc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map(gi => {
    const labels = Array.isArray(gi.labels) ? gi.labels : JSON.parse(gi.labels || '[]');
    const isNew = gi.sync_status === 'new';
    const stateClass = gi.state === 'closed' ? 'done' : 'open';
    const stateLabel = gi.state === 'closed' ? 'closed' : 'open';
    const syncClass = gi.sync_status === 'imported' ? 'done' : gi.sync_status === 'ignored' ? 'closed' : 'open';
    return `
    <tr style="cursor:pointer" onclick="showGlIssueDetail('${gi.id}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="gl-issue-checkbox" data-id="${gi.id}" ${!isNew ? 'disabled' : ''} onchange="updateGlSelectionUI()"></td>
      <td style="font-family:monospace;font-size:0.85rem">#${gi.gitlab_issue_iid}</td>
      <td>${escapeHtml(gi.title)}</td>
      <td>${renderLabels(labels)}</td>
      <td><span class="badge badge-${stateClass}">${stateLabel}</span></td>
      <td>${gi.author ? escapeHtml(gi.author) : '—'}</td>
      <td style="white-space:nowrap">${formatDate(gi.gl_created_at)}</td>
      <td><span class="badge badge-${syncClass}">${gi.sync_status}</span></td>
    </tr>`;
  }).join('');

  // Update sort indicators
  document.querySelectorAll('#panel-gitlab-issues th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === glSortCol) {
      if (arrow) arrow.textContent = glSortAsc ? ' ▲' : ' ▼';
    } else {
      if (arrow) arrow.textContent = '';
    }
  });
}

window.sortGlIssues = function (col) {
  if (glSortCol === col) {
    glSortAsc = !glSortAsc;
  } else {
    glSortCol = col;
    glSortAsc = true;
  }
  renderGlIssuesTable();
};

async function loadGlIssues() {
  const filter = document.querySelector('#glIssueFilters .active')?.dataset.syncStatus || '';
  const qs = filter ? `?sync_status=${filter}` : '';
  try {
    const data = await api(`/products/${productId}/gitlab-issues${qs}`);
    const { issues: glIssues, stats } = data;
    glIssuesData = glIssues;
    document.getElementById('tabGitlabIssuesCount').textContent = `(${stats.total})`;
    renderGlIssuesTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

window.handleGlSync = async function () {
  const btn = document.getElementById('glSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Синхронизация...';
  try {
    const result = await api(`/products/${productId}/gitlab-sync`, { method: 'POST' });
    toast(`Синхронизировано: ${result.new} новых, ${result.updated} обновлено`);
    loadGlIssues();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Синхронизировать';
  }
};

function updateGlSelectionUI() {
  const checked = document.querySelectorAll('.gl-issue-checkbox:checked');
  const count = checked.length;
  document.getElementById('glImportBtn').style.display = count > 0 ? '' : 'none';
  document.getElementById('glIgnoreBtn').style.display = count > 0 ? '' : 'none';
  document.getElementById('glSelectedCount').textContent = count;
}

window.handleGlSelectAll = function (checked) {
  document.querySelectorAll('.gl-issue-checkbox:not(:disabled)').forEach(cb => { cb.checked = checked; });
  updateGlSelectionUI();
};

window.handleGlImportSelected = async function () {
  const ids = Array.from(document.querySelectorAll('.gl-issue-checkbox:checked')).map(cb => cb.dataset.id);
  try {
    const result = await api('/gitlab-issues/import-bulk', { method: 'POST', body: { issue_ids: ids } });
    toast(`Импортировано ${result.count} задач`);
    loadGlIssues();
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.handleGlIgnoreSelected = async function () {
  const ids = Array.from(document.querySelectorAll('.gl-issue-checkbox:checked')).map(cb => cb.dataset.id);
  for (const id of ids) {
    await api(`/gitlab-issues/${id}/ignore`, { method: 'POST' }).catch(() => {});
  }
  toast(`${ids.length} issues игнорировано`);
  loadGlIssues();
};

window.showGlIssueDetail = async function (id) {
  try {
    const gi = await api(`/gitlab-issues/${id}`);
    const labels = Array.isArray(gi.labels) ? gi.labels : JSON.parse(gi.labels || '[]');
    document.getElementById('processDetailTitle').textContent = `GitLab Issue #${gi.gitlab_issue_iid}`;
    const metaGi = document.getElementById('processDetailMeta'); if (metaGi) metaGi.innerHTML = '';
    document.getElementById('processDetailContent').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div><strong>${escapeHtml(gi.title)}</strong></div>
        ${gi.description ? `<div style="font-size:0.85rem;color:var(--text-dim);max-height:200px;overflow-y:auto;white-space:pre-wrap">${escapeHtml(gi.description)}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">${labels.map(l => `<span class="badge">${escapeHtml(l)}</span>`).join('')}</div>
        ${gi.milestone ? `<div>Milestone: <strong>${escapeHtml(gi.milestone)}</strong></div>` : ''}
        <div style="font-size:0.85rem;color:var(--text-dim)">Автор: ${gi.author || '—'} | Создан: ${formatDate(gi.gl_created_at)}</div>
        ${gi.web_url ? `<a href="${gi.web_url}" target="_blank" style="font-size:0.85rem">Открыть в GitLab</a>` : ''}
        <div style="font-size:0.85rem">Синхронизация: <span class="badge badge-${gi.sync_status === 'imported' ? 'done' : gi.sync_status === 'ignored' ? 'closed' : 'open'}">${gi.sync_status}</span></div>
      </div>
      <div class="modal-actions">
        ${gi.sync_status === 'new' ? `
          <button class="btn btn-primary" onclick="importGlIssue('${gi.id}')">Импортировать</button>
          <button class="btn btn-ghost" onclick="ignoreGlIssue('${gi.id}')">Игнорировать</button>
        ` : ''}
        <button class="btn btn-ghost" onclick="closeModal('processDetailModal')">Закрыть</button>
      </div>`;
    openModal('processDetailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.importGlIssue = async function (id) {
  try {
    await api(`/gitlab-issues/${id}/import`, { method: 'POST' });
    toast('Задача создана');
    closeModal('processDetailModal');
    loadGlIssues();
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.ignoreGlIssue = async function (id) {
  try {
    await api(`/gitlab-issues/${id}/ignore`, { method: 'POST' });
    toast('Issue игнорирован');
    closeModal('processDetailModal');
    loadGlIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// GitLab Issues filter click handler
document.addEventListener('click', e => {
  const btn = e.target.closest('#glIssueFilters .btn');
  if (btn) {
    document.querySelector('#glIssueFilters .active')?.classList.remove('active');
    btn.classList.add('active');
    loadGlIssues();
  }
});

// ── Init ───────────────────────────────────────────────

loadAll();
