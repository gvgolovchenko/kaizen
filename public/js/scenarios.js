import { api, toast, confirm, escapeHtml, formatDate } from './app.js';

let scenariosList = [];
let productsList = [];
let modelsList = [];
let pollingTimer = null;

const PRESET_LABELS = {
  batch_develop: 'Пакетная разработка',
  auto_release: 'Авто-релиз',
  nightly_audit: 'Ночной аудит',
  full_cycle: 'Полный цикл',
  analysis: 'Анализ',
  custom: 'Кастом',
};

const PRESET_BADGES = {
  batch_develop: 'badge-plan-active',
  auto_release: 'badge-plan-scheduled',
  nightly_audit: 'badge-improvement',
  full_cycle: 'badge-plan-completed',
  analysis: 'badge-feature',
  custom: 'badge-plan-draft',
};

// ── Load & render ────────────────────────────────────────

async function loadAll() {
  try {
    const [scenarios, products, models] = await Promise.all([
      api('/scenarios'),
      api('/products'),
      api('/ai-models'),
    ]);
    scenariosList = scenarios;
    productsList = products;
    modelsList = models;
    populateSelects();
    renderScenarios();
    renderSummary();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadScenarios() {
  try {
    scenariosList = await api('/scenarios');
    renderScenarios();
    renderSummary();
    updatePolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSummary() {
  document.getElementById('sumTotal').textContent = scenariosList.length;
  document.getElementById('sumEnabled').textContent = scenariosList.filter(s => s.enabled).length;
  document.getElementById('sumRunning').textContent = scenariosList.filter(s => s.active_runs > 0).length;
  document.getElementById('sumScheduled').textContent = scenariosList.filter(s => s.cron).length;
}

function renderScenarios() {
  const filter = document.getElementById('filterPreset').value;
  let filtered = scenariosList;
  if (filter) filtered = filtered.filter(s => s.preset === filter);

  const tbody = document.getElementById('scenariosBody');
  const empty = document.getElementById('scenariosEmpty');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(s => {
    const isRunning = s.active_runs > 0;
    const enabledCls = s.enabled ? '' : 'style="opacity:0.5"';

    // Schedule column
    let scheduleHtml;
    if (s.cron) {
      const nextRun = s.next_run_at ? formatDate(s.next_run_at) : '';
      scheduleHtml = `<span style="font-family:monospace;font-size:0.8rem">${s.cron}</span>${nextRun ? `<br><span style="font-size:0.72rem;color:var(--text-dim)">след: ${nextRun}</span>` : ''}`;
    } else {
      scheduleHtml = '<span class="badge badge-plan-draft">разовый</span>';
    }

    // Result column
    let resultHtml;
    if (isRunning) {
      resultHtml = '<span class="badge badge-plan-active">выполняется...</span>';
    } else if (s.last_run_status === 'completed') {
      const summary = s.last_run_summary ? escapeHtml(s.last_run_summary.slice(0, 50)) : 'Завершён';
      resultHtml = `<span style="color:var(--green)">&#10003;</span> <span style="font-size:0.8rem">${summary}</span>` +
        (s.last_run_completed_at ? `<br><span style="font-size:0.72rem;color:var(--text-dim)">${formatDate(s.last_run_completed_at)}</span>` : '');
    } else if (s.last_run_status === 'failed') {
      resultHtml = `<span style="color:var(--red)">&#10007;</span> <span style="font-size:0.8rem;color:var(--red)">Ошибка</span>` +
        (s.last_run_completed_at ? `<br><span style="font-size:0.72rem;color:var(--text-dim)">${formatDate(s.last_run_completed_at)}</span>` : '');
    } else if (s.run_count > 0) {
      resultHtml = `<span style="font-size:0.8rem;color:var(--text-dim)">${s.last_run_status || '—'}</span>`;
    } else {
      resultHtml = '<span style="font-size:0.8rem;color:var(--text-dim)">Ещё не запускался</span>';
    }

    return `
    <tr ${enabledCls} style="cursor:pointer" onclick="viewScenario('${s.id}')">
      <td>${escapeHtml(s.product_name || 'Все')}</td>
      <td>
        ${escapeHtml(s.name)}
        ${!s.enabled ? ' <span class="badge badge-plan-cancelled">выкл</span>' : ''}
        ${isRunning ? ' <span class="badge badge-plan-active">running</span>' : ''}
      </td>
      <td><span class="badge ${PRESET_BADGES[s.preset] || ''}">${PRESET_LABELS[s.preset] || s.preset}</span></td>
      <td style="white-space:nowrap">${scheduleHtml}</td>
      <td style="max-width:250px">${resultHtml}</td>
      <td>${s.run_count}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); runScenario('${s.id}')" ${isRunning ? 'disabled' : ''}>Запустить</button>
        <button class="btn btn-sm" onclick="event.stopPropagation(); toggleEnabled('${s.id}', ${s.enabled})">${s.enabled ? 'Выкл' : 'Вкл'}</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteScenario('${s.id}')">Уд.</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Polling ──────────────────────────────────────────────

function updatePolling() {
  const hasRunning = scenariosList.some(s => s.active_runs > 0);
  const interval = hasRunning ? 5000 : 15000;
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(loadScenarios, interval);
}

// ── Scenario Detail ──────────────────────────────────────

window.hideDetailModal = function () {
  document.getElementById('detailModal').style.display = 'none';
};

window.viewScenario = async function (id) {
  const title = document.getElementById('detailTitle');
  const content = document.getElementById('detailContent');

  title.textContent = 'Загрузка...';
  content.innerHTML = '<div class="skeleton" style="height:100px"></div>';
  document.getElementById('detailModal').style.display = 'flex';

  try {
    const s = await api(`/scenarios/${id}`);
    const config = s.config || {};

    title.textContent = s.name;

    // Resolve release names if batch_develop
    let releasesHtml = '';
    if (config.release_ids?.length) {
      const releaseRows = [];
      for (const rid of config.release_ids) {
        try {
          const rel = await api(`/releases/${rid}`);
          releaseRows.push(`<tr>
            <td style="font-family:monospace">v${escapeHtml(rel.version)}</td>
            <td>${escapeHtml(rel.name)}</td>
            <td>${rel.status}</td>
            <td>${rel.issue_count || rel.issues?.length || '?'} задач</td>
          </tr>`);
        } catch {
          releaseRows.push(`<tr><td colspan="4" style="color:var(--text-dim)">${rid.slice(0,8)}... (не найден)</td></tr>`);
        }
      }
      releasesHtml = `
        <h4 style="margin:1rem 0 0.5rem">Релизы (${config.release_ids.length})</h4>
        <table><thead><tr><th>Версия</th><th>Название</th><th>Статус</th><th>Задачи</th></tr></thead>
        <tbody>${releaseRows.join('')}</tbody></table>`;
    }

    // Model name
    let modelName = '—';
    if (config.model_id) {
      const model = modelsList.find(m => m.id === config.model_id);
      modelName = model ? `${model.name} (${model.provider})` : config.model_id.slice(0, 8) + '...';
    }

    // Config details
    const configItems = [];
    if (config.auto_approve) configItems.push(`Авто-утверждение: ${config.auto_approve}`);
    if (config.auto_publish !== undefined) configItems.push(`Авто-публикация: ${config.auto_publish ? 'да' : 'нет'}`);
    if (config.on_failure) configItems.push(`При ошибке: ${config.on_failure}`);
    if (config.timeout_min) configItems.push(`Таймаут: ${config.timeout_min} мин`);
    if (config.template_id) configItems.push(`Шаблон: ${config.template_id}`);
    if (config.count) configItems.push(`Предложений: ${config.count}`);
    if (config.max_issues) configItems.push(`Макс. задач: ${config.max_issues}`);
    if (config.develop?.enabled !== undefined) configItems.push(`Разработка: ${config.develop.enabled ? 'да' : 'нет'}`);
    if (config.press_release?.enabled) configItems.push('Пресс-релиз: да');

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 20px;margin-bottom:1rem">
        <strong>Продукт:</strong> <span>${escapeHtml(s.product_name || 'Все продукты')}</span>
        <strong>Тип:</strong> <span class="badge ${PRESET_BADGES[s.preset] || ''}">${PRESET_LABELS[s.preset] || s.preset}</span>
        <strong>Модель:</strong> <span>${escapeHtml(modelName)}</span>
        <strong>Расписание:</strong> <span style="font-family:monospace">${s.cron || 'только ручной запуск'}</span>
        <strong>Следующий:</strong> <span>${s.next_run_at ? formatDate(s.next_run_at) : '—'}</span>
        <strong>Последний:</strong> <span>${s.last_run_at ? formatDate(s.last_run_at) : '—'}</span>
        <strong>Запусков:</strong> <span>${s.runs?.length || 0}</span>
        <strong>Статус:</strong> <span>${s.enabled ? '<span class="badge badge-plan-active">включён</span>' : '<span class="badge badge-plan-cancelled">выключен</span>'}</span>
      </div>
      ${s.description ? `<p style="color:var(--text-dim);margin-bottom:1rem">${escapeHtml(s.description)}</p>` : ''}
      ${configItems.length ? `<h4 style="margin:0 0 0.5rem">Параметры</h4><ul style="margin:0 0 1rem;padding-left:1.2rem">${configItems.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
      ${releasesHtml}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
        <button class="btn btn-primary" onclick="editScenario('${s.id}')">Редактировать</button>
        <button class="btn" onclick="event.stopPropagation(); runScenario('${s.id}'); hideDetailModal();">Запустить</button>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
};

// ── Edit scenario ────────────────────────────────────────

let editingScenarioId = null;

window.editScenario = async function (id) {
  hideDetailModal();
  editingScenarioId = id;

  try {
    const s = await api(`/scenarios/${id}`);
    const config = s.config || {};

    // Fill basic fields
    document.getElementById('fName').value = s.name || '';
    document.getElementById('fDesc').value = s.description || '';

    // Product
    const productSel = document.getElementById('fProduct');
    productSel.value = s.product_id || '';

    // Preset
    document.getElementById('fPreset').value = s.preset;
    onPresetChange();

    // Model
    document.getElementById('fModel').value = config.model_id || '';

    // Launch mode
    const launchSel = document.getElementById('fLaunchMode');
    if (s.cron) {
      // Check if it's a one-time cron (has specific day+month digits)
      const isOneTime = /^\d+\s+\d+\s+\d+\s+\d+/.test(s.cron);
      if (isOneTime) {
        launchSel.value = 'scheduled';
        // Parse cron back to date — approximate
        const parts = s.cron.split(/\s+/);
        const hourUtc = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        const month = parseInt(parts[3]);
        const year = new Date().getFullYear();
        const utcDate = new Date(Date.UTC(year, month - 1, day, hourUtc, 0, 0));
        const mskDate = new Date(utcDate.getTime() + 3 * 3600000);
        const yyyy = mskDate.getFullYear();
        const mm = String(mskDate.getMonth() + 1).padStart(2, '0');
        const dd = String(mskDate.getDate()).padStart(2, '0');
        document.getElementById('fSchedDate').value = `${yyyy}-${mm}-${dd}`;
        document.getElementById('fSchedHour').value = mskDate.getHours();
      } else {
        launchSel.value = 'cron';
        // Try to match a preset
        const cronPresetSel = document.getElementById('fCronPreset');
        const matched = [...cronPresetSel.options].find(o => o.value === s.cron);
        if (matched) {
          cronPresetSel.value = s.cron;
        } else {
          cronPresetSel.value = 'custom';
          // Parse cron into fields (convert UTC hour back to MSK)
          const parts = s.cron.split(/\s+/);
          document.getElementById('fCronMin').value = parts[0] || '';
          const hourUtc = parseInt(parts[1]);
          document.getElementById('fCronHour').value = isNaN(hourUtc) ? parts[1] : String((hourUtc + 3) % 24);
          document.getElementById('fCronDom').value = parts[2] || '';
          document.getElementById('fCronMon').value = parts[3] || '';
          document.getElementById('fCronDow').value = parts[4] || '';
        }
        onCronPresetChange();
      }
    } else {
      launchSel.value = 'now';
    }
    onLaunchModeChange();
    initScheduledPicker();
    // Restore date if scheduled was set above
    if (launchSel.value === 'scheduled' && s.cron) {
      const parts = s.cron.split(/\s+/);
      const hourUtc = parseInt(parts[1]);
      const day = parseInt(parts[2]);
      const month = parseInt(parts[3]);
      const year = new Date().getFullYear();
      const utcDate = new Date(Date.UTC(year, month - 1, day, hourUtc, 0, 0));
      const mskDate = new Date(utcDate.getTime() + 3 * 3600000);
      document.getElementById('fSchedDate').value = `${mskDate.getFullYear()}-${String(mskDate.getMonth()+1).padStart(2,'0')}-${String(mskDate.getDate()).padStart(2,'0')}`;
      document.getElementById('fSchedHour').value = mskDate.getHours();
    }

    // Preset-specific fields
    if (s.preset === 'batch_develop') {
      await loadReleasesForProduct();
      // Check matching releases
      setTimeout(() => {
        const checkboxes = document.querySelectorAll('.release-checkbox');
        checkboxes.forEach(cb => { cb.checked = (config.release_ids || []).includes(cb.value); });
      }, 300);
      if (config.on_failure) document.getElementById('fOnFailure').value = config.on_failure;
      if (config.timeout_min) document.getElementById('fTimeout').value = config.timeout_min;
      document.getElementById('fAutoPublish').checked = config.auto_publish !== false;
    } else if (s.preset === 'auto_release') {
      if (config.max_issues) document.getElementById('fMaxIssues').value = config.max_issues;
      if (config.auto_approve) document.getElementById('fAutoApproveAR').value = config.auto_approve;
      document.getElementById('fARDevelop').checked = config.develop?.enabled !== false;
      document.getElementById('fARAutoPublish').checked = config.develop?.auto_publish !== false;
    } else if (s.preset === 'nightly_audit') {
      if (config.template_id) document.getElementById('fTemplate').value = config.template_id;
      if (config.count) document.getElementById('fCount').value = config.count;
      if (config.auto_approve) document.getElementById('fAutoApproveNA').value = config.auto_approve;
    } else if (s.preset === 'full_cycle' || s.preset === 'analysis') {
      if (config.auto_approve) document.getElementById('fAutoApproveFC').value = config.auto_approve;
      if (config.timeout_min) document.getElementById('fTimeoutFC').value = config.timeout_min;
      if (s.preset === 'full_cycle') {
        document.getElementById('fFCDevelop').checked = config.develop?.enabled !== false;
        document.getElementById('fFCAutoPublish').checked = config.develop?.auto_publish !== false;
        document.getElementById('fFCPressRelease').checked = config.press_release?.enabled || false;
      }
    }

    // Show modal
    document.getElementById('createModalTitle').textContent = 'Редактирование сценария';
    document.getElementById('createSubmitBtn').textContent = 'Сохранить';
    document.getElementById('createModal').style.display = 'flex';
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Actions ──────────────────────────────────────────────

window.runScenario = async function (id) {
  try {
    const run = await api(`/scenarios/${id}/run`, { method: 'POST' });
    toast(`Сценарий запущен (run: ${run.id.slice(0, 8)})`);
    loadScenarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.toggleEnabled = async function (id, currentEnabled) {
  try {
    await api(`/scenarios/${id}`, { method: 'PUT', body: { enabled: !currentEnabled } });
    toast(currentEnabled ? 'Сценарий выключен' : 'Сценарий включён');
    loadScenarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deleteScenario = async function (id) {
  const ok = await confirm('Удалить сценарий и всю историю запусков?');
  if (!ok) return;
  try {
    await api(`/scenarios/${id}`, { method: 'DELETE' });
    toast('Сценарий удалён');
    loadScenarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.viewRuns = async function (scenarioId, name) {
  const detail = document.getElementById('runDetail');
  const title = document.getElementById('runDetailTitle');
  const content = document.getElementById('runDetailContent');

  title.textContent = `История: ${name}`;
  content.innerHTML = '<div class="skeleton" style="height:100px"></div>';
  detail.style.display = '';

  try {
    const runs = await api(`/scenarios/${scenarioId}/runs?limit=10`);
    if (runs.length === 0) {
      content.innerHTML = '<p style="color:var(--text-dim)">Нет запусков</p>';
      return;
    }

    content.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Статус</th>
            <th>Триггер</th>
            <th>Начат</th>
            <th>Завершён</th>
            <th>Итог</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(r => `
            <tr>
              <td><span class="badge badge-plan-${r.status}">${r.status}</span></td>
              <td>${r.trigger === 'cron' ? 'cron' : 'ручной'}</td>
              <td style="white-space:nowrap">${formatDate(r.started_at)}</td>
              <td style="white-space:nowrap">${r.completed_at ? formatDate(r.completed_at) : '...'}</td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${r.result?.summary ? escapeHtml(r.result.summary) : (r.error ? `<span style="color:var(--danger)">${escapeHtml(r.error)}</span>` : '—')}
              </td>
              <td>
                <button class="btn btn-sm" onclick="viewRunDetail('${r.id}')">Детали</button>
                ${r.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="cancelRun('${r.id}')">Отменить</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    content.innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
};

window.viewRunDetail = async function (runId) {
  try {
    const run = await api(`/scenario-runs/${runId}`);
    const content = document.getElementById('runDetailContent');

    let html = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin-bottom:1rem">
        <strong>Статус:</strong> <span class="badge badge-plan-${run.status}">${run.status}</span>
        <strong>Триггер:</strong> <span>${run.trigger}</span>
        <strong>Начат:</strong> <span>${formatDate(run.started_at)}</span>
        <strong>Завершён:</strong> <span>${run.completed_at ? formatDate(run.completed_at) : '...'}</span>
        ${run.error ? `<strong>Ошибка:</strong> <span style="color:var(--danger)">${escapeHtml(run.error)}</span>` : ''}
      </div>`;

    if (run.result) {
      if (run.result.summary) {
        html += `<p><strong>Итог:</strong> ${escapeHtml(run.result.summary)}</p>`;
      }
      if (run.result.stages?.length) {
        html += `<h4 style="margin:1rem 0 0.5rem">Этапы</h4>
          <table><thead><tr><th>#</th><th>Этап</th><th>Детали</th></tr></thead><tbody>
          ${run.result.stages.map((s, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(s.stage || s.product || '—')}</td>
              <td style="font-size:0.8rem;max-width:400px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(stageDetail(s))}</td>
            </tr>
          `).join('')}
          </tbody></table>`;
      }
      if (run.result.processes?.length) {
        html += `<p style="margin-top:0.5rem;font-size:0.85rem;color:var(--text-dim)">Процессы: ${run.result.processes.length}</p>`;
      }
    }

    content.innerHTML = html;
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.cancelRun = async function (runId) {
  const ok = await confirm('Отменить выполнение?');
  if (!ok) return;
  try {
    await api(`/scenario-runs/${runId}/cancel`, { method: 'POST' });
    toast('Запуск отменён');
    loadScenarios();
  } catch (err) {
    toast(err.message, 'error');
  }
};

function stageDetail(stage) {
  const parts = [];
  if (stage.release) parts.push(stage.release);
  if (stage.count !== undefined) parts.push(`count: ${stage.count}`);
  if (stage.suggestions !== undefined) parts.push(`suggestions: ${stage.suggestions}`);
  if (stage.tests_passed !== undefined) parts.push(`tests: ${stage.tests_passed ? 'pass' : 'fail'}`);
  if (stage.branch) parts.push(`branch: ${stage.branch}`);
  if (stage.version) parts.push(`v${stage.version}`);
  if (stage.error) parts.push(`error: ${stage.error}`);
  if (stage.message) parts.push(stage.message);
  return parts.join(', ') || '—';
}

// ── Create Modal ─────────────────────────────────────────

function populateSelects() {
  const productSel = document.getElementById('fProduct');
  const sortedProducts = [...productsList].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  productSel.innerHTML = '<option value="">Все продукты (только для nightly_audit)</option>'
    + sortedProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  const modelSel = document.getElementById('fModel');
  modelSel.innerHTML = '<option value="">Не выбрана</option>'
    + modelsList.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
}

// ── Launch mode ──────────────────────────────────────────

window.onLaunchModeChange = function () {
  const mode = document.getElementById('fLaunchMode').value;
  document.getElementById('launchScheduled').style.display = mode === 'scheduled' ? '' : 'none';
  document.getElementById('launchCron').style.display = mode === 'cron' ? '' : 'none';
  if (mode === 'scheduled') {
    // Ensure hour picker is populated
    const hourSel = document.getElementById('fSchedHour');
    if (!hourSel.options.length) initScheduledPicker();
  }
};

window.onCronPresetChange = function () {
  const sel = document.getElementById('fCronPreset');
  const customBlock = document.getElementById('cronCustom');
  if (sel.value === 'custom') {
    customBlock.style.display = '';
    document.getElementById('fCronMin').focus();
  } else {
    customBlock.style.display = 'none';
  }
};

function initScheduledPicker() {
  const hourSel = document.getElementById('fSchedHour');
  if (!hourSel) return;
  hourSel.innerHTML = Array.from({ length: 24 }, (_, i) =>
    `<option value="${i}" ${i === 23 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`
  ).join('');
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('fSchedDate').value = `${yyyy}-${mm}-${dd}`;
}

function buildCronFromLaunchMode() {
  const mode = document.getElementById('fLaunchMode').value;

  if (mode === 'now') return { cron: null, runImmediately: true };

  if (mode === 'scheduled') {
    const dateStr = document.getElementById('fSchedDate').value;
    const hourMsk = parseInt(document.getElementById('fSchedHour').value);
    if (!dateStr || isNaN(hourMsk)) return { cron: null, error: 'Укажите дату и время' };
    const [y, m, d] = dateStr.split('-').map(Number);
    const mskDate = new Date(y, m - 1, d, hourMsk, 0, 0);
    const utcDate = new Date(mskDate.getTime() - 3 * 3600000);
    const cron = `0 ${utcDate.getUTCHours()} ${utcDate.getUTCDate()} ${utcDate.getUTCMonth() + 1} *`;
    return { cron, oneTime: true };
  }

  if (mode === 'cron') {
    const preset = document.getElementById('fCronPreset').value;
    if (preset !== 'custom') return { cron: preset };
    const min = document.getElementById('fCronMin').value.trim() || '0';
    const hourMsk = document.getElementById('fCronHour').value.trim() || '*';
    const dom = document.getElementById('fCronDom').value.trim() || '*';
    const mon = document.getElementById('fCronMon').value.trim() || '*';
    const dow = document.getElementById('fCronDow').value.trim() || '*';
    let hourUtc = hourMsk;
    if (hourMsk !== '*' && !hourMsk.includes(',') && !hourMsk.includes('-') && !hourMsk.includes('/')) {
      hourUtc = String((parseInt(hourMsk, 10) - 3 + 24) % 24);
    }
    return { cron: `${min} ${hourUtc} ${dom} ${mon} ${dow}` };
  }

  return { cron: null };
}

window.showCreateModal = function () {
  editingScenarioId = null;
  document.getElementById('createModalTitle').textContent = 'Новый сценарий';
  document.getElementById('createSubmitBtn').textContent = 'Создать';
  document.getElementById('createForm').reset();
  document.getElementById('createModal').style.display = 'flex';
  onPresetChange();
  onLaunchModeChange();
  initScheduledPicker();
};

window.hideCreateModal = function () {
  document.getElementById('createModal').style.display = 'none';
};

const PRESET_HINTS = {
  batch_develop: 'Spec + Develop + Publish для выбранных релизов последовательно. Идеально для ночной разработки.',
  auto_release: 'AI анализирует open-задачи, формирует релиз, генерирует спецификацию и запускает разработку.',
  nightly_audit: 'AI генерирует предложения по улучшению и автоматически создаёт задачи. Можно для всех продуктов.',
  full_cycle: 'Полный конвейер: improve → approve → release → spec → develop → publish → press-release.',
  analysis: 'Анализ без разработки: improve → approve → release → spec. Для оценки и планирования.',
};

window.onPresetChange = function () {
  const preset = document.getElementById('fPreset').value;
  // Hint
  document.getElementById('presetHint').textContent = PRESET_HINTS[preset] || '';
  // Hide all config sections
  document.querySelectorAll('.scenario-config-section').forEach(el => el.style.display = 'none');
  // Show relevant
  const map = {
    batch_develop: 'cfgBatchDevelop',
    auto_release: 'cfgAutoRelease',
    nightly_audit: 'cfgNightlyAudit',
    full_cycle: 'cfgPipeline',
    analysis: 'cfgPipeline',
  };
  const sectionId = map[preset];
  if (sectionId) document.getElementById(sectionId).style.display = '';
  // For analysis — hide develop options
  const devBlock = document.getElementById('cfgPipelineDevelop');
  if (devBlock) devBlock.style.display = preset === 'analysis' ? 'none' : '';
  // Load releases if batch_develop
  if (preset === 'batch_develop') loadReleasesForProduct();
};

async function loadReleasesForProduct() {
  const productId = document.getElementById('fProduct').value;
  const container = document.getElementById('fReleasesList');
  if (!productId) {
    container.innerHTML = '<em style="color:var(--text-dim)">Выберите продукт</em>';
    return;
  }
  try {
    const releases = await api(`/products/${productId}/releases`);
    const drafts = releases.filter(r => r.status === 'draft');
    if (drafts.length === 0) {
      container.innerHTML = '<em style="color:var(--text-dim)">Нет draft-релизов</em>';
      return;
    }
    container.innerHTML = drafts.map(r => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" class="release-checkbox" value="${r.id}" checked>
        <span style="font-family:monospace;min-width:50px">v${escapeHtml(r.version)}</span>
        <span>${escapeHtml(r.name)}</span>
        <span style="margin-left:auto;font-size:0.8rem;color:var(--text-dim)">${r.issue_count || '?'} задач</span>
      </label>
    `).join('');
  } catch (err) {
    container.innerHTML = `<em style="color:var(--danger)">${escapeHtml(err.message)}</em>`;
  }
}

window.createScenario = async function (e) {
  e.preventDefault();
  const name = document.getElementById('fName').value.trim();
  const product_id = document.getElementById('fProduct').value || null;
  const preset = document.getElementById('fPreset').value;
  const model_id = document.getElementById('fModel').value || null;
  const description = document.getElementById('fDesc').value.trim() || null;

  if (!model_id) { toast('Выберите AI-модель', 'error'); return false; }

  // Launch mode
  const launch = buildCronFromLaunchMode();
  if (launch.error) { toast(launch.error, 'error'); return false; }

  const config = { model_id };

  if (preset === 'batch_develop') {
    const checked = [...document.querySelectorAll('.release-checkbox:checked')].map(cb => cb.value);
    if (checked.length === 0) { toast('Выберите хотя бы один релиз', 'error'); return false; }
    config.release_ids = checked;
    config.on_failure = document.getElementById('fOnFailure').value;
    config.timeout_min = parseInt(document.getElementById('fTimeout').value) || 45;
    config.auto_publish = document.getElementById('fAutoPublish').checked;
  } else if (preset === 'auto_release') {
    config.max_issues = parseInt(document.getElementById('fMaxIssues').value) || 10;
    config.auto_approve = document.getElementById('fAutoApproveAR').value;
    config.develop = {
      enabled: document.getElementById('fARDevelop').checked,
      auto_publish: document.getElementById('fARAutoPublish').checked,
    };
  } else if (preset === 'nightly_audit') {
    config.template_id = document.getElementById('fTemplate').value;
    config.count = parseInt(document.getElementById('fCount').value) || 5;
    config.auto_approve = document.getElementById('fAutoApproveNA').value;
  } else if (preset === 'full_cycle' || preset === 'analysis') {
    config.auto_approve = document.getElementById('fAutoApproveFC').value;
    config.timeout_min = parseInt(document.getElementById('fTimeoutFC').value) || 20;
    if (preset === 'full_cycle') {
      config.develop = {
        enabled: document.getElementById('fFCDevelop').checked,
        auto_publish: document.getElementById('fFCAutoPublish').checked,
      };
      config.press_release = { enabled: document.getElementById('fFCPressRelease').checked };
    }
  }

  try {
    if (editingScenarioId) {
      // Update existing
      await api(`/scenarios/${editingScenarioId}`, {
        method: 'PUT',
        body: { name, description, product_id, preset, config, cron: launch.cron, enabled: true },
      });

      if (launch.runImmediately) {
        await api(`/scenarios/${editingScenarioId}/run`, { method: 'POST' });
        toast('Сценарий обновлён и запущен');
      } else {
        toast('Сценарий обновлён');
      }
      editingScenarioId = null;
    } else {
      // Create new
      const scenario = await api('/scenarios', {
        method: 'POST',
        body: { name, description, product_id, preset, config, cron: launch.cron },
      });

      if (launch.runImmediately) {
        await api(`/scenarios/${scenario.id}/run`, { method: 'POST' });
        toast('Сценарий создан и запущен');
      } else if (launch.oneTime) {
        toast('Сценарий создан, запуск запланирован');
      } else {
        toast('Сценарий создан');
      }
    }

    hideCreateModal();
    document.getElementById('createForm').reset();
    loadScenarios();
  } catch (err) {
    toast(err.message, 'error');
  }

  return false;
};

// ── Init ─────────────────────────────────────────────────

document.getElementById('filterPreset').addEventListener('change', renderScenarios);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideCreateModal();
    hideDetailModal();
  }
});
document.getElementById('fProduct').addEventListener('change', () => {
  if (document.getElementById('fPreset').value === 'batch_develop') loadReleasesForProduct();
});
loadAll();
