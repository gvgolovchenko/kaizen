import { api, toast, confirm, escapeHtml, formatDate } from './app.js';

let plansList = [];
let pollingTimer = null;

// ── Load & render ────────────────────────────────────────

async function loadPlans() {
  try {
    const filter = document.getElementById('filterStatus').value;
    const qs = filter ? `?status=${filter}` : '';
    plansList = await api(`/plans${qs}`);
    renderPlans();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPlans() {
  const tbody = document.getElementById('plansBody');
  const empty = document.getElementById('plansEmpty');

  if (plansList.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = plansList.map(p => `
    <tr style="cursor:pointer" onclick="window.location.href='/plan-edit.html?id=${p.id}'">
      <td>${escapeHtml(p.product_name || '—')}</td>
      <td>${escapeHtml(p.name)}${p.is_template ? ' <span class="badge badge-improvement">шаблон</span>' : ''}</td>
      <td><span class="badge badge-plan-${p.status}">${p.status}</span></td>
      <td>${p.step_count || '—'}</td>
      <td>${renderProgress(p)}</td>
      <td style="white-space:nowrap">${p.scheduled_at ? formatDate(p.scheduled_at) : '—'}</td>
      <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
      <td style="white-space:nowrap">
        ${['draft', 'scheduled'].includes(p.status) ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); startPlan('${p.id}')">Запустить</button>` : ''}
        ${['active', 'scheduled'].includes(p.status) ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); cancelPlan('${p.id}')">Отменить</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deletePlan('${p.id}')">Уд.</button>
      </td>
    </tr>
  `).join('');
}

function renderProgress(plan) {
  if (!plan.step_count) return '—';
  const completed = plan.completed_steps || 0;
  const pct = Math.round((completed / plan.step_count) * 100);
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div class="plan-progress" style="width:80px">
        <div class="plan-progress-fill" style="width:${pct}%"></div>
      </div>
      <span style="font-size:0.8rem;color:var(--text-dim)">${completed}/${plan.step_count}</span>
    </div>`;
}

// ── Polling ──────────────────────────────────────────────

function updatePolling() {
  const hasActive = plansList.some(p => ['active', 'scheduled'].includes(p.status));
  const interval = hasActive ? 5000 : 15000;
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(loadPlans, interval);
}

// ── Actions ─────────────────────────────────────────────

window.startPlan = async function (id) {
  try {
    await api(`/plans/${id}/start`, { method: 'POST' });
    toast('План запущен');
    loadPlans();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.cancelPlan = async function (id) {
  const ok = await confirm('Отменить план?');
  if (!ok) return;
  try {
    await api(`/plans/${id}/cancel`, { method: 'POST' });
    toast('План отменён');
    loadPlans();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deletePlan = async function (id) {
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

// ── Filter ───────────────────────────────────────────────

document.getElementById('filterStatus').addEventListener('change', loadPlans);

// ── Init ─────────────────────────────────────────────────

loadPlans();
