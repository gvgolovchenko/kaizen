import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate } from './app.js';
import { formatDuration, renderProcessDetailHtml, toggleAllSuggestions, updateApproveCount, approveProcess } from './process-detail.js';

let processesList = [];
let pollingTimer = null;

// ── Load & render ────────────────────────────────────────

async function loadProcesses() {
  try {
    const filter = document.getElementById('filterStatus').value;
    const qs = filter ? `?status=${filter}` : '';
    processesList = await api(`/processes${qs}`);
    renderProcesses();
    loadQueueStats();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadQueueStats() {
  try {
    const stats = await api('/queue/stats');
    const el = document.getElementById('queueStats');
    const hasAny = Object.values(stats).some(s => s.active > 0 || s.queued > 0);
    if (!hasAny) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = Object.entries(stats)
      .filter(([, s]) => s.active > 0 || s.queued > 0)
      .map(([provider, s]) => `
        <div class="queue-stats-item">
          <span class="provider-name">${provider}</span>
          <span class="active-count">${s.active}/${s.limit}</span>
          ${s.queued > 0 ? `<span class="queued-count">(${s.queued} ждут)</span>` : ''}
        </div>`).join('<span style="color:var(--border)">|</span>');
  } catch {}
}

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
      <td>${escapeHtml(p.product_name)}</td>
      <td><span class="badge badge-process-${p.type}">${p.type}</span></td>
      <td>${escapeHtml(p.model_name)}</td>
      <td><span class="badge badge-process-${p.status}">${p.status}</span>${isQueued ? `<span class="queue-position" data-id="${p.id}"></span>` : ''}</td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">${liveDuration(p)}</td>
      <td style="white-space:nowrap">${suggestionsInfo(p)}</td>
      <td style="white-space:nowrap">
        ${isRoadmapDone ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.location.href='/roadmap.html?process_id=${p.id}&product_id=${p.product_id}'">Дорожная карта</button>` : ''}
        ${isQueued ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); cancelProcess('${p.id}')">Отменить</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
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

// ── Polling ──────────────────────────────────────────────

const POLL_FAST = 4000;   // при активных процессах
const POLL_SLOW = 10000;  // фоновое обновление

function updatePolling() {
  const hasActive = processesList.some(p => ['pending', 'queued', 'running'].includes(p.status));
  const interval = hasActive ? POLL_FAST : POLL_SLOW;

  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(loadProcesses, interval);
}

// ── Process detail ───────────────────────────────────────

window.showProcessDetail = async function (id) {
  const cachedProc = processesList.find(p => p.id === id);
  if (cachedProc && cachedProc.type === 'roadmap_from_doc') {
    window.location.href = `/roadmap.html?process_id=${id}&product_id=${cachedProc.product_id}`;
    return;
  }

  try {
    const [proc, logs] = await Promise.all([
      api(`/processes/${id}`),
      api(`/processes/${id}/logs`),
    ]);

    if (proc.type === 'roadmap_from_doc') {
      window.location.href = `/roadmap.html?process_id=${id}&product_id=${proc.product_id}`;
      return;
    }

    document.getElementById('processDetailTitle').textContent = `Процесс: ${proc.type}`;
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

window.handleProcessApprove = (processId) => approveProcess(processId, 'processSuggestionsList', {
  modalId: 'processDetailModal',
});

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

// ── Delete ───────────────────────────────────────────────

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

// ── Filter ───────────────────────────────────────────────

document.getElementById('filterStatus').addEventListener('change', loadProcesses);

// Expose closeModal globally
window.closeModal = closeModal;

// ── Init ─────────────────────────────────────────────────

loadProcesses();
