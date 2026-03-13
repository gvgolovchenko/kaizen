import { api, toast, confirm, escapeHtml, formatDate } from './app.js';

let plansList = [];
let pollingTimer = null;

// ── Load & render ────────────────────────────────────────

async function loadPlans() {
  try {
    const filter = document.getElementById('filterStatus').value;
    let qs = '';
    if (filter === 'template') {
      // Filter templates client-side (no server param for is_template)
      plansList = (await api('/plans')).filter(p => p.is_template);
    } else {
      qs = filter ? `?status=${filter}` : '';
      plansList = await api(`/plans${qs}`);
    }
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
        ${p.is_template ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); clonePlan('${p.id}', '${escapeHtml(p.name)}')">Клонировать</button>` : ''}
        ${!p.is_template && ['draft', 'scheduled'].includes(p.status) ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); startPlan('${p.id}')">Запустить</button>` : ''}
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

window.clonePlan = async function (id, name) {
  try {
    // Load products for selection
    const products = await api('/products');
    if (products.length === 0) return toast('Нет продуктов для клонирования', 'error');

    const options = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    const html = `
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;color:var(--text-dim)">Продукт *</label>
        <select id="cloneProductId" style="width:100%;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;color:var(--text)">${options}</select>
      </div>
      <div>
        <label style="display:block;margin-bottom:4px;color:var(--text-dim)">Название</label>
        <input id="cloneName" type="text" value="${escapeHtml(name)}" style="width:100%;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;color:var(--text)">
      </div>`;

    const ok = await confirm(html, 'Клонировать шаблон');
    if (!ok) return;

    const productId = document.getElementById('cloneProductId').value;
    const newName = document.getElementById('cloneName').value.trim() || name;

    const cloned = await api(`/plans/${id}/clone`, {
      method: 'POST',
      body: { product_id: productId, name: newName },
    });
    toast('План создан из шаблона');
    window.location.href = `/plan-edit.html?id=${cloned.id}`;
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
