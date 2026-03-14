import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate, renderBreadcrumbs } from './app.js';
import { formatDuration } from './process-detail.js';

const params = new URLSearchParams(location.search);
const planId = params.get('id');
const productId = params.get('product_id');  // для создания нового плана

let plan = null;
let steps = [];
let models = [];
let editingStepId = null;
let pollingTimer = null;

// ── Load ─────────────────────────────────────────────────

async function loadPlan() {
  try {
    if (planId) {
      const data = await api(`/plans/${planId}`);
      plan = data;
      steps = data.steps || [];
    }
    models = await api('/ai-models');
    render();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  renderHeader();
  renderForm();
  renderSteps();
  populateModelSelect();
}

// ── Header ───────────────────────────────────────────────

function renderHeader() {
  // Breadcrumbs
  if (plan) {
    renderBreadcrumbs('breadcrumbs', [
      { label: 'Продукты', href: '/' },
      { label: plan.product_name || 'Продукт', href: `/product.html?id=${plan.product_id}` },
      { label: plan.name || 'План' },
    ]);
  } else if (productId) {
    renderBreadcrumbs('breadcrumbs', [
      { label: 'Продукты', href: '/' },
      { label: 'Продукт', href: `/product.html?id=${productId}` },
      { label: 'Новый план' },
    ]);
  } else {
    renderBreadcrumbs('breadcrumbs', [
      { label: 'Планы', href: '/plans.html' },
      { label: 'Новый план' },
    ]);
  }

  if (!plan) {
    document.getElementById('planTitle').textContent = 'Новый план';
    document.getElementById('planStatus').innerHTML = '';
    document.getElementById('planDesc').textContent = '';
    document.getElementById('planMeta').innerHTML = '';
    document.getElementById('planActions').innerHTML = '';
    document.getElementById('planForm').style.display = '';
    document.getElementById('addStepBtn').style.display = '';
    return;
  }

  document.getElementById('planTitle').textContent = plan.name;
  document.getElementById('planStatus').innerHTML =
    `<span class="badge badge-plan-${plan.status}">${plan.status}</span>`;
  document.getElementById('planDesc').textContent = plan.description || '';

  let meta = '';
  if (plan.scheduled_at) meta += `<span>Запуск: ${formatDate(plan.scheduled_at)}</span>`;
  if (plan.started_at) meta += `<span>Начат: ${formatDate(plan.started_at)}</span>`;
  if (plan.completed_at) meta += `<span>Завершён: ${formatDate(plan.completed_at)}</span>`;
  meta += `<span>При ошибке: ${plan.on_failure === 'skip' ? 'пропустить' : 'остановить'}</span>`;
  if (plan.is_template) meta += `<span class="badge badge-improvement">Шаблон</span>`;
  document.getElementById('planMeta').innerHTML = meta;

  const isEditable = ['draft', 'scheduled'].includes(plan.status);
  document.getElementById('planForm').style.display = isEditable ? '' : 'none';
  document.getElementById('addStepBtn').style.display = isEditable ? '' : 'none';

  // Actions
  let actions = '';
  if (isEditable) {
    actions += `<button class="btn btn-primary btn-sm" onclick="startPlan()">Запустить</button>`;
  }
  if (['active', 'scheduled'].includes(plan.status)) {
    actions += `<button class="btn btn-danger btn-sm" onclick="cancelPlan()">Отменить</button>`;
  }
  actions += `<button class="btn btn-ghost btn-sm" onclick="clonePlan()">Клонировать</button>`;
  if (['draft', 'completed', 'failed', 'cancelled'].includes(plan.status)) {
    actions += `<button class="btn btn-danger btn-sm" onclick="deletePlan()">Удалить</button>`;
  }
  document.getElementById('planActions').innerHTML = actions;
}

// ── Form ─────────────────────────────────────────────────

function renderForm() {
  if (!plan && !productId) return;

  if (plan) {
    document.getElementById('planName').value = plan.name;
    document.getElementById('planDescription').value = plan.description || '';
    document.getElementById('planOnFailure').value = plan.on_failure || 'stop';
    document.getElementById('planIsTemplate').checked = plan.is_template || false;
    if (plan.scheduled_at) {
      const dt = new Date(plan.scheduled_at);
      const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('planScheduledAt').value = local;
    }
  }
}

// ── Steps ────────────────────────────────────────────────

function renderSteps() {
  const list = document.getElementById('stepsList');
  const empty = document.getElementById('stepsEmpty');

  if (steps.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  const isEditable = !plan || ['draft', 'scheduled'].includes(plan.status);

  list.innerHTML = steps.map((s, i) => {
    const statusClass = s.status !== 'pending' ? `step-${s.status}` : '';
    const depNames = (s.depends_on || []).map(depId => {
      const dep = steps.find(st => st.id === depId);
      return dep ? (dep.name || `Шаг ${steps.indexOf(dep) + 1}`) : '?';
    }).join(', ');

    const modelName = s.model_id
      ? (models.find(m => m.id === s.model_id)?.name || s.model_id)
      : 'Локальный';

    return `
    <div class="plan-step-card ${statusClass}">
      <div class="plan-step-order">${i + 1}</div>
      <div class="plan-step-content">
        <div class="plan-step-name">${escapeHtml(s.name || s.process_type)}</div>
        <div class="plan-step-meta">
          <span class="badge badge-process-${s.process_type}">${s.process_type}</span>
          ${escapeHtml(modelName)}
          · ${s.timeout_min || 20} мин
          ${depNames ? `· ждёт: ${escapeHtml(depNames)}` : ''}
          ${s.process_id ? `· <a href="#" onclick="event.preventDefault(); showProcess('${s.process_id}')">процесс</a>` : ''}
          ${s.error ? `· <span style="color:var(--red)">${escapeHtml(s.error)}</span>` : ''}
        </div>
      </div>
      <span class="badge badge-process-${s.status}">${s.status}</span>
      ${isEditable ? `
        <button class="btn btn-ghost btn-sm" onclick="editStep('${s.id}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStep('${s.id}')">Уд.</button>
      ` : ''}
    </div>`;
  }).join('');
}

function populateModelSelect() {
  const sel = document.getElementById('stepModel');
  sel.innerHTML = models.length === 0
    ? '<option value="">Нет моделей</option>'
    : models.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');

  // Populate depends_on select
  const depSel = document.getElementById('stepDependsOn');
  depSel.innerHTML = '<option value="">Нет зависимости</option>' +
    steps.map((s, i) => `<option value="${s.id}">Шаг ${i + 1}: ${escapeHtml(s.name || s.process_type)}</option>`).join('');
}

// ── Step form ────────────────────────────────────────────

window.showAddStep = function () {
  editingStepId = null;
  document.getElementById('stepFormTitle').textContent = 'Новый шаг';
  document.getElementById('stepName').value = '';
  document.getElementById('stepProcessType').value = 'improve';
  document.getElementById('stepTimeout').value = '20';
  document.getElementById('stepPrompt').value = '';
  document.getElementById('stepCount').value = '5';
  document.getElementById('stepDependsOn').value = '';
  document.getElementById('stepFormContainer').style.display = '';
  populateModelSelect();
  onProcessTypeChange();
};

window.editStep = function (stepId) {
  const step = steps.find(s => s.id === stepId);
  if (!step) return;
  editingStepId = stepId;
  document.getElementById('stepFormTitle').textContent = 'Редактировать шаг';
  document.getElementById('stepFormContainer').style.display = '';
  populateModelSelect();
  document.getElementById('stepName').value = step.name || '';
  document.getElementById('stepModel').value = step.model_id || '';
  document.getElementById('stepProcessType').value = step.process_type || 'improve';
  document.getElementById('stepTimeout').value = step.timeout_min || 20;
  document.getElementById('stepPrompt').value = step.input_prompt || '';
  document.getElementById('stepCount').value = step.input_count || 5;
  document.getElementById('stepDependsOn').value = (step.depends_on || [])[0] || '';
  onProcessTypeChange();
};

window.hideStepForm = function () {
  document.getElementById('stepFormContainer').style.display = 'none';
  editingStepId = null;
};

window.onProcessTypeChange = function () {
  const type = document.getElementById('stepProcessType').value;
  const isRunTests = type === 'run_tests';
  document.getElementById('stepModelGroup').style.display = isRunTests ? 'none' : '';
  document.getElementById('stepCountGroup').style.display = isRunTests ? 'none' : '';
  const promptEl = document.getElementById('stepPrompt');
  promptEl.placeholder = isRunTests
    ? 'JSON конфиг: {"test_command":"npm test"} (необязательно, auto-detect по стеку)'
    : 'Промпт для AI...';
};

window.saveStep = async function () {
  const processType = document.getElementById('stepProcessType').value;
  const modelId = document.getElementById('stepModel').value;
  if (processType !== 'run_tests' && !modelId) return toast('Выберите модель', 'error');

  const body = {
    name: document.getElementById('stepName').value.trim() || null,
    model_id: processType === 'run_tests' ? null : modelId,
    process_type: processType,
    timeout_min: parseInt(document.getElementById('stepTimeout').value) || 20,
    input_prompt: document.getElementById('stepPrompt').value.trim() || null,
    input_count: parseInt(document.getElementById('stepCount').value) || 5,
    step_order: editingStepId ? undefined : steps.length,
    depends_on: document.getElementById('stepDependsOn').value
      ? [document.getElementById('stepDependsOn').value] : null,
  };

  try {
    if (editingStepId) {
      await api(`/plans/${plan.id}/steps/${editingStepId}`, { method: 'PUT', body });
      toast('Шаг обновлён');
    } else {
      if (!plan) {
        // Сначала создать план
        await savePlanInternal();
        if (!plan) return;
      }
      await api(`/plans/${plan.id}/steps`, { method: 'POST', body });
      toast('Шаг добавлен');
    }
    hideStepForm();
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deleteStep = async function (stepId) {
  const ok = await confirm('Удалить шаг?');
  if (!ok) return;
  try {
    await api(`/plans/${plan.id}/steps/${stepId}`, { method: 'DELETE' });
    toast('Шаг удалён');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Save plan ────────────────────────────────────────────

async function savePlanInternal() {
  const name = document.getElementById('planName').value.trim();
  if (!name) { toast('Введите название', 'error'); return; }

  const body = {
    name,
    description: document.getElementById('planDescription').value.trim() || null,
    on_failure: document.getElementById('planOnFailure').value,
    is_template: document.getElementById('planIsTemplate').checked,
    scheduled_at: document.getElementById('planScheduledAt').value || null,
    product_id: plan ? plan.product_id : productId,
  };

  if (plan) {
    plan = await api(`/plans/${plan.id}`, { method: 'PUT', body });
  } else {
    plan = await api('/plans', { method: 'POST', body });
    // Обновить URL чтобы отражал id
    window.history.replaceState(null, '', `/plan-edit.html?id=${plan.id}`);
  }
}

window.savePlan = async function () {
  try {
    await savePlanInternal();
    toast('План сохранён');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Plan actions ─────────────────────────────────────────

window.startPlan = async function () {
  if (!plan) return;
  if (steps.length === 0) return toast('Добавьте хотя бы один шаг', 'error');
  try {
    await api(`/plans/${plan.id}/start`, { method: 'POST' });
    toast('План запущен');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.cancelPlan = async function () {
  if (!plan) return;
  const ok = await confirm('Отменить план?');
  if (!ok) return;
  try {
    await api(`/plans/${plan.id}/cancel`, { method: 'POST' });
    toast('План отменён');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.clonePlan = async function () {
  if (!plan) return;
  try {
    const cloned = await api(`/plans/${plan.id}/clone`, { method: 'POST' });
    toast('План клонирован');
    window.location.href = `/plan-edit.html?id=${cloned.id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deletePlan = async function () {
  if (!plan) return;
  const ok = await confirm('Удалить план?');
  if (!ok) return;
  try {
    await api(`/plans/${plan.id}`, { method: 'DELETE' });
    toast('План удалён');
    window.location.href = `/product.html?id=${plan.product_id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.showProcess = function (processId) {
  // Redirect to processes page or open modal — for now just redirect
  window.open(`/processes.html#${processId}`, '_blank');
};

// ── Polling ──────────────────────────────────────────────

function updatePolling() {
  if (!plan) return;
  const isActive = ['active'].includes(plan.status);
  if (!isActive && pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; return; }
  if (isActive && !pollingTimer) {
    pollingTimer = setInterval(loadPlan, 5000);
  }
}

// ── Init ─────────────────────────────────────────────────

if (!planId && !productId) {
  window.location.href = '/plans.html';
} else {
  loadPlan();
}
