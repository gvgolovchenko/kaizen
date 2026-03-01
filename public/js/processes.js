import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate } from './app.js';

let processesList = [];
let pollingTimer = null;

// ── Load & render ────────────────────────────────────────

async function loadProcesses() {
  try {
    const filter = document.getElementById('filterStatus').value;
    const qs = filter ? `?status=${filter}` : '';
    processesList = await api(`/processes${qs}`);
    renderProcesses();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
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
    return `
    <tr style="cursor:pointer" onclick="showProcessDetail('${p.id}')">
      <td>${escapeHtml(p.product_name)}</td>
      <td><span class="badge badge-process-${p.type}">${p.type}</span></td>
      <td>${escapeHtml(p.model_name)}</td>
      <td><span class="badge badge-process-${p.status}">${p.status}</span></td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">${liveDuration(p)}</td>
      <td style="white-space:nowrap">${suggestionsInfo(p)}</td>
      <td style="white-space:nowrap">
        ${isRoadmapDone ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.location.href='/roadmap.html?process_id=${p.id}&product_id=${p.product_id}'">Дорожная карта</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProcess('${p.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
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
  const hasActive = processesList.some(p => p.status === 'pending' || p.status === 'running');
  const interval = hasActive ? POLL_FAST : POLL_SLOW;

  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(loadProcesses, interval);
}

// ── Process detail ───────────────────────────────────────

window.showProcessDetail = async function (id) {
  // Roadmap processes open in a separate page
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

    let html = `
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <span class="badge badge-process-${proc.status}">${proc.status}</span>
          <span class="badge badge-process-${proc.type}">${proc.type}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text-dim);display:flex;flex-direction:column;gap:4px">
          <span>Продукт: <strong style="color:var(--text)">${escapeHtml(proc.product_name)}</strong></span>
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

    // Suggestions (if completed)
    if (proc.status === 'completed' && proc.result && proc.result.length > 0) {
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
