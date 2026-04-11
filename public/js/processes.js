import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate } from './app.js';
import { formatDuration, renderProcessDetailHtml, renderFormReleaseHtml, toggleAllSuggestions, updateApproveCount, approveProcess, procTypeLabel } from './process-detail.js';

let allProcesses = [];
let pollingTimer = null;
let durationTimer = null;
let historyPage = 1;
const PAGE_SIZE = 20;

// ── Load & classify ──────────────────────────────────────

async function loadProcesses() {
  try {
    allProcesses = await api('/processes');
    renderAll();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function classify() {
  const active = [];
  const queued = [];
  const failed = [];
  const history = [];

  for (const p of allProcesses) {
    if (p.status === 'running' || p.status === 'pending') active.push(p);
    else if (p.status === 'queued') queued.push(p);
    else if (p.status === 'failed') failed.push(p);
    else history.push(p);
  }

  return { active, queued, failed, history };
}

// ── Render all ───────────────────────────────────────────

function renderAll() {
  const groups = classify();
  const total = allProcesses.length;

  document.getElementById('processesEmpty').style.display = total === 0 ? '' : 'none';

  renderSummary(groups);
  renderSection('sectionActive', 'cardsActive', 'countActive', groups.active, renderActiveCard);
  renderSection('sectionQueue', 'cardsQueue', 'countQueue', groups.queued, renderQueueCard);
  renderSection('sectionAttention', 'cardsAttention', 'countAttention', groups.failed, renderFailedCard);
  populateFilters();
  renderHistory(groups.history);

  startDurationTimer(groups.active);
}

// ── Summary bar ──────────────────────────────────────────

function renderSummary({ active, queued, failed, history }) {
  document.getElementById('processSummary').innerHTML = `
    <div class="proc-stat proc-stat-active ${active.length ? 'has-items' : ''}">
      <div class="proc-stat-icon">⚙</div>
      <div class="proc-stat-info">
        <div class="proc-stat-number">${active.length}</div>
        <div class="proc-stat-label">Выполняются</div>
      </div>
    </div>
    <div class="proc-stat proc-stat-queued ${queued.length ? 'has-items' : ''}">
      <div class="proc-stat-icon">📋</div>
      <div class="proc-stat-info">
        <div class="proc-stat-number">${queued.length}</div>
        <div class="proc-stat-label">В очереди</div>
      </div>
    </div>
    <div class="proc-stat proc-stat-completed">
      <div class="proc-stat-icon">✓</div>
      <div class="proc-stat-info">
        <div class="proc-stat-number">${history.length}</div>
        <div class="proc-stat-label">Завершено</div>
      </div>
    </div>
    <div class="proc-stat proc-stat-failed ${failed.length ? 'has-items' : ''}">
      <div class="proc-stat-icon">✗</div>
      <div class="proc-stat-info">
        <div class="proc-stat-number">${failed.length}</div>
        <div class="proc-stat-label">Ошибки</div>
      </div>
    </div>`;
}

// ── Section renderer ─────────────────────────────────────

function renderSection(sectionId, cardsId, countId, items, cardFn) {
  const section = document.getElementById(sectionId);
  const cards = document.getElementById(cardsId);
  const count = document.getElementById(countId);

  if (items.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  count.textContent = items.length;
  cards.innerHTML = items.map(cardFn).join('');
}

// ── Card renderers ───────────────────────────────────────

function releaseLabel(p) {
  if (!p.release_version) return '';
  const name = p.release_name ? ` ${escapeHtml(p.release_name)}` : '';
  return `<span class="proc-card-release" title="${escapeHtml(p.release_name || '')}">v${escapeHtml(p.release_version)}${name}</span>`;
}

function renderActiveCard(p) {
  const started = p.started_at || p.created_at;
  return `
  <div class="proc-card" onclick="showProcessDetail('${p.id}')">
    <div class="proc-card-header">
      <div>
        <div class="proc-card-type">${procTypeLabel(p.type)} ${releaseLabel(p)}</div>
        <a class="proc-card-product" href="/product.html?id=${p.product_id}" onclick="event.stopPropagation()">${escapeHtml(p.product_name)}</a>
      </div>
      <span class="badge badge-process-running">running</span>
    </div>
    <div class="proc-card-meta">
      ${p.model_name ? `<span>🤖 ${escapeHtml(p.model_name)}</span>` : ''}
      <span style="margin-left:auto">⏱ <span class="proc-card-duration" data-started-at="${started}" data-type="${p.type}">${liveDuration(p)}</span></span>
    </div>
    <div class="proc-card-progress"></div>
  </div>`;
}

function renderQueueCard(p) {
  return `
  <div class="proc-card" onclick="showProcessDetail('${p.id}')">
    <div class="proc-card-header">
      <div>
        <div class="proc-card-type">${procTypeLabel(p.type)} ${releaseLabel(p)}</div>
        <a class="proc-card-product" href="/product.html?id=${p.product_id}" onclick="event.stopPropagation()">${escapeHtml(p.product_name)}</a>
      </div>
      <span class="badge badge-process-queued">в очереди</span>
    </div>
    <div class="proc-card-meta">
      ${p.model_name ? `<span>🤖 ${escapeHtml(p.model_name)}</span>` : ''}
      <span style="margin-left:auto;font-size:0.75rem">${formatDate(p.created_at)}</span>
    </div>
    <div class="proc-card-actions">
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); cancelProcess('${p.id}')">Отменить</button>
    </div>
  </div>`;
}

function renderFailedCard(p) {
  const errorMsg = extractError(p);
  return `
  <div class="proc-card" onclick="showProcessDetail('${p.id}')">
    <div class="proc-card-header">
      <div>
        <div class="proc-card-type">${procTypeLabel(p.type)} ${releaseLabel(p)}</div>
        <a class="proc-card-product" href="/product.html?id=${p.product_id}" onclick="event.stopPropagation()">${escapeHtml(p.product_name)}</a>
      </div>
      <span class="badge badge-process-failed">ошибка</span>
    </div>
    <div class="proc-card-meta">
      ${p.model_name ? `<span>🤖 ${escapeHtml(p.model_name)}</span>` : ''}
      <span style="margin-left:auto;font-size:0.75rem">${formatDate(p.updated_at)}</span>
    </div>
    ${errorMsg ? `<div class="proc-card-error" title="${escapeHtml(errorMsg)}">${escapeHtml(errorMsg)}</div>` : ''}
    <div class="proc-card-actions">
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); handleProcessRestart('${p.id}')">Перезапустить</button>
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Удалить</button>
    </div>
  </div>`;
}

function extractError(p) {
  if (p.result?.error) return p.result.error;
  if (p.result?.summary) return p.result.summary.slice(0, 120);
  if (typeof p.result === 'string') return p.result.slice(0, 120);
  return '';
}

// ── History ──────────────────────────────────────────────

function populateFilters() {
  const typeSelect = document.getElementById('filterType');
  const productSelect = document.getElementById('filterProduct');

  // Preserve current values
  const curType = typeSelect.value;
  const curProduct = productSelect.value;

  const types = [...new Set(allProcesses.map(p => p.type))].sort();
  const products = [...new Map(allProcesses.map(p => [p.product_id, p.product_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));

  typeSelect.innerHTML = '<option value="">Все типы</option>' +
    types.map(t => `<option value="${t}" ${t === curType ? 'selected' : ''}>${procTypeLabel(t)}</option>`).join('');

  productSelect.innerHTML = '<option value="">Все продукты</option>' +
    products.map(([id, name]) => `<option value="${id}" ${id === curProduct ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function getFilteredHistory(history) {
  let filtered = history;

  const search = document.getElementById('filterSearch').value.trim().toLowerCase();
  if (search) filtered = filtered.filter(p => p.product_name?.toLowerCase().includes(search));

  const typeFilter = document.getElementById('filterType').value;
  if (typeFilter) filtered = filtered.filter(p => p.type === typeFilter);

  const productFilter = document.getElementById('filterProduct').value;
  if (productFilter) filtered = filtered.filter(p => p.product_id === productFilter);

  const periodFilter = document.getElementById('filterPeriod').value;
  if (periodFilter !== 'all') {
    const days = periodFilter === '7d' ? 7 : 30;
    const cutoff = Date.now() - days * 86400000;
    filtered = filtered.filter(p => new Date(p.created_at).getTime() > cutoff);
  }

  return filtered;
}

function renderHistory(history) {
  const section = document.getElementById('sectionHistory');
  const countEl = document.getElementById('countHistory');
  const tbody = document.getElementById('historyBody');
  const paginationEl = document.getElementById('historyPagination');

  const filtered = getFilteredHistory(history);
  countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    section.style.display = history.length > 0 ? '' : 'none';
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px">Нет записей</td></tr>';
    paginationEl.innerHTML = '';
    return;
  }

  section.style.display = '';
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (historyPage > totalPages) historyPage = totalPages;

  const pageItems = filtered.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);

  tbody.innerHTML = pageItems.map(p => {
    const isOk = p.status === 'completed';
    const statusIcon = isOk
      ? `<span class="proc-history-status-done" title="Завершён">✓</span>`
      : `<span class="proc-history-status-fail" title="Ошибка">✗</span>`;
    return `
    <tr style="cursor:pointer" onclick="showProcessDetail('${p.id}')">
      <td style="text-align:center">${statusIcon}</td>
      <td>${escapeHtml(p.product_name)}</td>
      <td style="white-space:nowrap">${procTypeLabel(p.type)}</td>
      <td style="white-space:nowrap;font-size:0.82rem">${p.release_version ? `v${escapeHtml(p.release_version)}` : '—'}</td>
      <td style="color:var(--text-dim);font-size:0.82rem">${p.model_name ? escapeHtml(p.model_name) : '<span style="color:var(--text-dim)">local</span>'}</td>
      <td style="white-space:nowrap">${p.duration_ms ? formatDuration(p.duration_ms) : '—'}</td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
    </tr>`;
  }).join('');

  // Pagination
  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  let btns = '';
  if (historyPage > 1) btns += `<button class="proc-page-btn" onclick="goHistoryPage(${historyPage - 1})">‹</button>`;

  const start = Math.max(1, historyPage - 3);
  const end = Math.min(totalPages, historyPage + 3);
  for (let i = start; i <= end; i++) {
    btns += `<button class="proc-page-btn ${i === historyPage ? 'active' : ''}" onclick="goHistoryPage(${i})">${i}</button>`;
  }

  if (historyPage < totalPages) btns += `<button class="proc-page-btn" onclick="goHistoryPage(${historyPage + 1})">›</button>`;
  paginationEl.innerHTML = btns;
}

window.goHistoryPage = function (page) {
  historyPage = page;
  const { history } = classify();
  renderHistory(history);
};

// ── Live duration timer ──────────────────────────────────

// Typical duration thresholds per process type (ms)
const DURATION_THRESHOLDS = {
  improve: 5 * 60_000,
  prepare_spec: 10 * 60_000,
  develop_release: 30 * 60_000,
  form_release: 5 * 60_000,
  run_tests: 10 * 60_000,
  update_docs: 15 * 60_000,
  deploy: 10 * 60_000,
  seed_data: 15 * 60_000,
  prepare_press_release: 5 * 60_000,
  roadmap_from_doc: 5 * 60_000,
};

function getThreshold(type) {
  return DURATION_THRESHOLDS[type] || 15 * 60_000;
}

function liveDuration(p) {
  if (p.duration_ms) return formatDuration(p.duration_ms);
  if (p.status === 'queued') return '<span style="color:#fb923c">в очереди</span>';
  const startedAt = p.started_at || p.created_at;
  if ((p.status === 'running' || p.status === 'pending') && startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    const threshold = getThreshold(p.type);
    if (elapsed > threshold) {
      return `<span class="proc-hung-warning">${formatDuration(elapsed)}… ⚠ возможно завис</span>`;
    }
    return formatDuration(elapsed) + '…';
  }
  return '—';
}

function startDurationTimer(activeProcesses) {
  if (durationTimer) clearInterval(durationTimer);
  if (activeProcesses.length === 0) return;

  durationTimer = setInterval(() => {
    document.querySelectorAll('.proc-card-duration[data-started-at]').forEach(el => {
      const started = el.dataset.startedAt;
      if (!started) return;
      const elapsed = Date.now() - new Date(started).getTime();
      const type = el.dataset.type || '';
      const threshold = getThreshold(type);
      if (elapsed > threshold) {
        el.innerHTML = `<span class="proc-hung-warning">${formatDuration(elapsed)}… ⚠ завис?</span>`;
      } else {
        el.textContent = formatDuration(elapsed) + '…';
      }
    });
    // For new card structure the duration is inside a span, walk up to find data-attrs
    document.querySelectorAll('[data-started-at]').forEach(el => {
      if (el.classList.contains('proc-card-duration')) return; // already handled
      const started = el.dataset.startedAt;
      if (!started) return;
      const span = el.querySelector('.proc-card-duration');
      if (!span) return;
      const elapsed = Date.now() - new Date(started).getTime();
      const type = el.dataset.type || '';
      const threshold = getThreshold(type);
      if (elapsed > threshold) {
        span.innerHTML = `<span class="proc-hung-warning">${formatDuration(elapsed)}… ⚠ завис?</span>`;
      } else {
        span.textContent = formatDuration(elapsed) + '…';
      }
    });
  }, 1000);
}

// ── Polling ──────────────────────────────────────────────

const POLL_FAST = 4000;
const POLL_SLOW = 10000;

function updatePolling() {
  const hasActive = allProcesses.some(p => ['pending', 'queued', 'running'].includes(p.status));
  const interval = hasActive ? POLL_FAST : POLL_SLOW;
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(loadProcesses, interval);
}

// ── Section collapse ─────────────────────────────────────

window.toggleSection = function (sectionId) {
  document.getElementById(sectionId).classList.toggle('collapsed');
};

// ── Process detail ───────────────────────────────────────

let _frProcId = null;
let _frProcResult = null;

window.showProcessDetail = async function (id) {
  try {
    const [proc, logs] = await Promise.all([
      api(`/processes/${id}`),
      api(`/processes/${id}/logs`),
    ]);

    document.getElementById('processDetailTitle').textContent = procTypeLabel(proc.type);

    // form_release — special rich view
    if (proc.type === 'form_release' && proc.status === 'completed' && proc.result?.releases) {
      _frProcId = proc.id;
      _frProcResult = proc.result;

      // Проверить: созданы ли уже релизы с предложенными версиями
      let alreadyHandled = !!proc.approved_count || !!proc.result.auto_approved;
      if (!alreadyHandled && proc.product_id) {
        try {
          const existingReleases = await api(`/products/${proc.product_id}/releases`);
          const existingVersions = new Set(existingReleases.map(r => r.version));
          const proposedVersions = (proc.result.releases || []).map(r => r.version);
          if (proposedVersions.length > 0 && proposedVersions.every(v => existingVersions.has(v))) {
            alreadyHandled = true;
          }
        } catch { /* ignore */ }
      }

      // Patch approved_count locally so renderFormReleaseHtml sees it
      const procForRender = alreadyHandled && !proc.approved_count
        ? { ...proc, approved_count: (proc.result.releases || []).length }
        : proc;

      document.getElementById('processDetailMeta').innerHTML = `
        <span class="badge badge-process-completed">завершён</span>
        <span class="badge badge-process-form_release">form_release</span>
        ${proc.product_name ? `<span style="font-size:0.8rem;color:var(--text-dim)">${escapeHtml(proc.product_name)}</span>` : ''}`;
      document.getElementById('processDetailContent').innerHTML = renderFormReleaseHtml(procForRender, {
        modalId: 'processDetailModal',
        onApprove: 'handleFrApproveProcesses()',
        onSelectAll: 'frSelectAll(true)',
        onSelectNone: 'frSelectAll(false)',
        onToggleRelease: 'frToggleReleaseProcesses',
        onToggleIssue: 'frUpdateCount',
      });
      openModal('processDetailModal');
      return;
    }

    document.getElementById('processDetailContent').innerHTML = renderProcessDetailHtml(proc, logs, {
      showProductName: true,
      showSpecLink: false,
      showDevResult: false,
      excludeTypes: [],
      modalId: 'processDetailModal',
    });
    openModal('processDetailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.toggleAllProcessSuggestions = (state) => toggleAllSuggestions('processSuggestionsList', state);
window.updateProcessApproveCount = () => updateApproveCount('processSuggestionsList', 'processApproveBtn');
window.handleProcessApprove = (processId) => approveProcess(processId, 'processSuggestionsList', { modalId: 'processDetailModal' });

// ── FR helpers (processes page) ──────────────────────────

window.frToggleRelease = function (idx) {
  document.getElementById(`fr-rel-${idx}`)?.classList.toggle('open');
};

window.frToggleReleaseProcesses = function (checkbox, idx) {
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

window.handleFrApproveProcesses = async function () {
  if (!_frProcId || !_frProcResult) return;
  const releasesArr = _frProcResult.releases || [];
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
    const result = await api(`/processes/${_frProcId}/approve-releases`, {
      method: 'POST',
      body: { releases: toCreate },
    });
    toast(`Создано ${result.created_releases} релиз(ов), ${result.total_issues} задач`);
    closeModal('processDetailModal');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// Roadmap approval handlers (from processes page)
window.toggleRoadmapRelease = function (checkbox, releaseIndex) {
  const checked = checkbox.checked;
  document.querySelectorAll(`#processSuggestionsList input[data-release-index="${releaseIndex}"][data-issue-index]`)
    .forEach(cb => { cb.checked = checked; });
  updateRoadmapApproveCount();
};

window.updateRoadmapApproveCount = function () {
  const checked = document.querySelectorAll('#processSuggestionsList input[data-issue-index]:checked');
  const btn = document.getElementById('processApproveBtn');
  if (btn) {
    btn.textContent = `Утвердить (${checked.length} задач)`;
    btn.disabled = checked.length === 0;
  }
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
    await api(`/processes/${processId}/approve-roadmap`, {
      method: 'POST',
      body: { selected_releases: selectedReleases },
    });
    toast('Дорожная карта утверждена');
    closeModal('processDetailModal');
    loadProcesses();
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

// ── Delete process ───────────────────────────────────────

window.deleteProcess = async function (id) {
  if (!await confirm('Удалить процесс и все его логи?')) return;
  try {
    await api(`/processes/${id}`, { method: 'DELETE' });
    toast('Процесс удалён');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Cancel queued ────────────────────────────────────────

window.cancelProcess = async function (id) {
  try {
    await api(`/processes/${id}/cancel`, { method: 'POST' });
    toast('Процесс отменён');
    loadProcesses();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Expose closeModal ────────────────────────────────────

window.closeModal = closeModal;

// ── Filter event listeners ───────────────────────────────

document.getElementById('filterSearch').addEventListener('input', () => {
  historyPage = 1;
  const { history } = classify();
  renderHistory(history);
});
document.getElementById('filterType').addEventListener('change', () => {
  historyPage = 1;
  const { history } = classify();
  renderHistory(history);
});
document.getElementById('filterProduct').addEventListener('change', () => {
  historyPage = 1;
  const { history } = classify();
  renderHistory(history);
});
document.getElementById('filterPeriod').addEventListener('change', () => {
  historyPage = 1;
  const { history } = classify();
  renderHistory(history);
});

// ── Init ─────────────────────────────────────────────────

loadProcesses();
