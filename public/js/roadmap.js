import { api, toast, escapeHtml, formatDate, renderBreadcrumbs } from './app.js';

const params = new URLSearchParams(location.search);
const processId = params.get('process_id');
const productId = params.get('product_id');

if (!processId || !productId) location.href = '/';

let proc = null;
let product = null;
let pollingTimer = null;

// ── Init ─────────────────────────────────────────────────

async function init() {
  try {
    [product, proc] = await Promise.all([
      api(`/products/${productId}`),
      api(`/processes/${processId}`),
    ]);

    document.getElementById('pageTitle').textContent = `Дорожная карта: ${product.name}`;
    document.title = `Kaizen — Дорожная карта: ${product.name}`;
    renderBreadcrumbs('breadcrumbs', [
      { label: 'Продукты', href: '/' },
      { label: product.name, href: `/product.html?id=${productId}` },
      { label: 'Дорожная карта' },
    ]);

    renderState();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Render state ─────────────────────────────────────────

function renderState() {
  document.getElementById('stateLoading').style.display = 'none';
  document.getElementById('stateFailed').style.display = 'none';
  document.getElementById('stateCompleted').style.display = 'none';

  renderMeta();

  if (proc.status === 'pending' || proc.status === 'running') {
    document.getElementById('stateLoading').style.display = '';
    document.getElementById('loadingMsg').textContent =
      proc.status === 'pending' ? 'Ожидание запуска...' : 'Анализ выполняется...';
    loadLogs();
    startPolling();
  } else if (proc.status === 'failed') {
    document.getElementById('stateFailed').style.display = '';
    document.getElementById('failedError').innerHTML = `
      <div style="font-size:0.85rem;font-weight:600;color:var(--red);margin-bottom:8px">Ошибка</div>
      <div style="font-size:0.85rem;color:var(--red)">${escapeHtml(proc.error || 'Неизвестная ошибка')}</div>`;
    loadLogs();
  } else if (proc.status === 'completed') {
    stopPolling();
    document.getElementById('stateCompleted').style.display = '';
    renderRoadmap(proc.result);
  }
}

function renderMeta() {
  const meta = [];
  meta.push(`<span>Модель: <strong style="color:var(--text)">${escapeHtml(proc.model_name || '')}</strong></span>`);
  meta.push(`<span class="badge badge-process-${proc.status}">${proc.status}</span>`);
  if (proc.duration_ms) meta.push(`<span>Длительность: ${formatDuration(proc.duration_ms)}</span>`);
  meta.push(`<span>Создан: ${formatDate(proc.created_at)}</span>`);
  document.getElementById('pageMeta').innerHTML = meta.join('');
}

// ── Logs (shown during loading/failed) ───────────────────

async function loadLogs() {
  try {
    const logs = await api(`/processes/${processId}/logs`);
    const container = document.getElementById('loadingLogs');
    if (!container || logs.length === 0) return;

    container.innerHTML = `
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Логи</div>
      <div class="process-logs-list">
        ${logs.map(l => `
          <div class="process-log-entry ${l.step === 'error' ? 'process-log-error' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
              <span class="badge badge-process-log">${l.step}</span>
              <span style="font-size:0.75rem;color:var(--text-dim)">${new Date(l.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
            </div>
            ${l.message ? `<div style="font-size:0.85rem">${escapeHtml(l.message)}</div>` : ''}
          </div>
        `).join('')}
      </div>`;
  } catch { /* ignore */ }
}

// ── Polling ──────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    try {
      proc = await api(`/processes/${processId}`);
      renderState();
    } catch { /* ignore */ }
  }, 4000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ── Render roadmap ───────────────────────────────────────

function renderRoadmap(result) {
  if (!result || !result.roadmap) return;

  // Summary
  if (result.summary) {
    document.getElementById('summaryBlock').innerHTML = `
      <div style="padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);font-size:0.9rem;color:var(--text-dim);line-height:1.6">
        ${escapeHtml(result.summary)}
      </div>`;
  }

  // Releases
  document.getElementById('roadmapList').innerHTML = result.roadmap.map((release, ri) => `
    <div class="release-card" style="margin-bottom:16px">
      <div class="release-card-header">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1">
          <input type="checkbox" class="release-checkbox" data-release-index="${ri}"
                 checked onchange="onReleaseToggle(${ri}, this.checked)"
                 style="accent-color:var(--accent);width:18px;height:18px">
          <h3 style="margin:0">
            ${escapeHtml(release.version)} — ${escapeHtml(release.name)}
          </h3>
        </label>
        <span style="font-size:0.85rem;color:var(--text-dim)">${release.issues.length} задач</span>
      </div>
      ${release.description ? `
        <p style="color:var(--text-dim);font-size:0.875rem;margin:8px 0 8px 28px">${escapeHtml(release.description)}</p>
      ` : ''}
      <div class="release-issues" style="display:block;margin-left:28px" id="release-issues-${ri}">
        ${release.issues.map((issue, ii) => `
          <label class="release-issue" style="cursor:pointer;display:flex;align-items:flex-start;gap:10px;padding:8px 10px">
            <input type="checkbox" class="issue-checkbox"
                   data-release-index="${ri}" data-issue-index="${ii}"
                   checked onchange="updateCount()"
                   style="accent-color:var(--accent);width:16px;height:16px;margin-top:2px;flex-shrink:0">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <span class="badge badge-${issue.type}">${issue.type}</span>
                <span class="badge badge-${issue.priority}">${issue.priority}</span>
                <span style="font-size:0.9rem">${escapeHtml(issue.title)}</span>
              </div>
              ${issue.description ? `
                <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;line-height:1.4">
                  ${escapeHtml(issue.description.length > 200 ? issue.description.slice(0, 200) + '...' : issue.description)}
                </div>
              ` : ''}
            </div>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  updateCount();
}

// ── Selection logic ──────────────────────────────────────

window.onReleaseToggle = function (releaseIndex, checked) {
  document.querySelectorAll(`.issue-checkbox[data-release-index="${releaseIndex}"]`).forEach(cb => {
    cb.checked = checked;
  });
  updateCount();
};

window.toggleAll = function (state) {
  document.querySelectorAll('.release-checkbox, .issue-checkbox').forEach(cb => {
    cb.checked = state;
  });
  updateCount();
};

window.updateCount = function () {
  const releaseChecks = document.querySelectorAll('.release-checkbox:checked');
  const issueChecks = document.querySelectorAll('.issue-checkbox:checked');
  const rCount = releaseChecks.length;
  const iCount = issueChecks.length;
  document.getElementById('selectionCount').textContent = `Выбрано: ${rCount} р. / ${iCount} з.`;
  const btn = document.getElementById('applyBtn');
  btn.textContent = `Применить дорожную карту (${rCount} р. / ${iCount} з.)`;
  btn.disabled = rCount === 0;
};

// ── Apply roadmap ────────────────────────────────────────

window.handleApply = async function () {
  const roadmap = proc.result.roadmap;
  const selectedReleases = [];

  roadmap.forEach((release, ri) => {
    const releaseCheckbox = document.querySelector(`.release-checkbox[data-release-index="${ri}"]`);
    if (!releaseCheckbox?.checked) return;

    const issueIndices = [];
    document.querySelectorAll(`.issue-checkbox[data-release-index="${ri}"]:checked`)
      .forEach(cb => issueIndices.push(parseInt(cb.dataset.issueIndex)));

    selectedReleases.push({
      release_index: ri,
      version: release.version,
      name: release.name,
      description: release.description,
      issue_indices: issueIndices,
    });
  });

  if (selectedReleases.length === 0) return toast('Выберите хотя бы один релиз', 'error');

  const btn = document.getElementById('applyBtn');
  btn.disabled = true;
  btn.textContent = 'Применение...';

  try {
    const result = await api(`/processes/${processId}/approve-roadmap`, {
      method: 'POST',
      body: { releases: selectedReleases },
    });
    toast(`Создано: ${result.created_releases} релизов, ${result.created_issues} задач`);
    window.location.href = `/product.html?id=${productId}`;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    updateCount();
  }
};

// ── Navigation ───────────────────────────────────────────

window.goBack = function () {
  window.location.href = `/product.html?id=${productId}`;
};

// ── Helpers ──────────────────────────────────────────────

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}мс`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  return `${min}м ${sec % 60}с`;
}

// ── Start ────────────────────────────────────────────────

init();
