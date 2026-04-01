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

// ── Schedule display helpers ─────────────────────────────

const DOW_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function isOneTimeCron(cron) {
  if (!cron) return false;
  const p = cron.trim().split(/\s+/);
  return p.length === 5 && /^\d+$/.test(p[2]) && /^\d+$/.test(p[3]);
}

function cronToHuman(cron) {
  if (!cron) return '';
  const [minSpec, hourSpec, domSpec, monSpec, dowSpec] = cron.trim().split(/\s+/);
  const h = hourSpec.padStart(2, '0');
  const m = minSpec.padStart(2, '0');
  const time = `${h}:${m}`;

  // Конкретная дата (one-time)
  if (/^\d+$/.test(domSpec) && /^\d+$/.test(monSpec)) {
    return `${domSpec} ${MONTH_NAMES[parseInt(monSpec) - 1]}, ${time}`;
  }
  // День недели
  if (dowSpec !== '*' && domSpec === '*') {
    const days = dowSpec.split(',').map(d => DOW_NAMES[parseInt(d)] || d).join(', ');
    if (dowSpec === '1-5') return `Будни ${time}`;
    if (dowSpec === '0,6') return `Выходные ${time}`;
    return `${days} ${time}`;
  }
  // Конкретный день месяца
  if (/^\d+$/.test(domSpec) && monSpec === '*') {
    return `${domSpec}-е число, ${time}`;
  }
  // Каждый день
  if (domSpec === '*' && monSpec === '*' && dowSpec === '*') {
    return `Ежедневно ${time}`;
  }
  return `${time} (${cron})`;
}

function formatScheduleCell(s) {
  // Ручной запуск (нет cron)
  if (!s.cron) {
    if (s.run_count > 0 && s.last_run_completed_at) {
      return `<span class="badge badge-plan-draft" style="font-size:0.7rem">РУЧНОЙ</span>` +
        `<br><span style="font-size:0.75rem;color:var(--text-dim)">${formatDate(s.last_run_completed_at)}</span>`;
    }
    return '<span class="badge badge-plan-draft" style="font-size:0.7rem">РУЧНОЙ</span>';
  }

  const oneTime = isOneTimeCron(s.cron);
  const humanTime = cronToHuman(s.cron);

  if (oneTime) {
    // Разовый — уже выполнен или ожидает
    const hasRun = s.run_count > 0;
    if (hasRun) {
      return `<span class="badge badge-plan-draft" style="font-size:0.7rem">РАЗОВЫЙ</span>` +
        `<br><span style="font-size:0.75rem;color:var(--text-dim)">${humanTime}</span>`;
    }
    return `<span class="badge badge-plan-draft" style="font-size:0.7rem">РАЗОВЫЙ</span>` +
      `<br><span style="font-size:0.75rem">${humanTime}</span>`;
  }

  // Регулярный
  let html = `<span class="badge badge-improvement" style="font-size:0.7rem">РЕГУЛЯРНЫЙ</span>` +
    `<br><span style="font-size:0.75rem">${humanTime}</span>`;
  if (s.next_run_at) {
    html += `<br><span style="font-size:0.7rem;color:var(--text-dim)">след: ${formatDate(s.next_run_at)}</span>`;
  }
  return html;
}

function renderSummary() {
  document.getElementById('sumTotal').textContent = scenariosList.length;
  document.getElementById('sumEnabled').textContent = scenariosList.filter(s => s.enabled).length;
  document.getElementById('sumRunning').textContent = scenariosList.filter(s => s.active_runs > 0).length;
  document.getElementById('sumScheduled').textContent = scenariosList.filter(s => s.cron && !isOneTimeCron(s.cron)).length;
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

    // Schedule column — human-readable
    const scheduleHtml = formatScheduleCell(s);

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
    <tr data-scenario-id="${s.id}" ${enabledCls} style="cursor:pointer" onclick="viewScenario('${s.id}')">
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
      <td style="white-space:nowrap">${buildActionButtons(s)}</td>
    </tr>`;
  }).join('');
}

function buildActionButtons(s) {
  const isRunning = s.active_runs > 0;
  const oneTime = isOneTimeCron(s.cron);
  const isManual = !s.cron;
  const isRegular = s.cron && !oneTime;
  const hasRun = s.run_count > 0;
  const oneTimeDone = oneTime && hasRun;

  const btns = [];

  // Run button
  if (isRunning) {
    btns.push(`<button class="btn btn-sm" disabled>Выполняется...</button>`);
  } else if (oneTimeDone) {
    btns.push(`<button class="btn btn-sm" onclick="event.stopPropagation(); runScenario('${s.id}')" style="opacity:0.6" title="Повторный запуск завершённого сценария">Повторить</button>`);
  } else {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); runScenario('${s.id}')">Запустить</button>`);
  }

  // Enable/disable button — only for regular and pending one-time
  if (isRegular) {
    btns.push(`<button class="btn btn-sm" onclick="event.stopPropagation(); toggleEnabled('${s.id}', ${s.enabled})">${s.enabled ? 'Выкл' : 'Вкл'}</button>`);
  } else if (oneTime && !oneTimeDone) {
    btns.push(`<button class="btn btn-sm" onclick="event.stopPropagation(); toggleEnabled('${s.id}', ${s.enabled})" title="${s.enabled ? 'Отменить запланированный запуск' : 'Возобновить запуск'}">${s.enabled ? 'Отменить' : 'Вкл'}</button>`);
  }
  // Manual and oneTimeDone — no enable/disable button

  // Delete — always
  btns.push(`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteScenario('${s.id}')">Уд.</button>`);

  return btns.join(' ');
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

    // Product
    document.getElementById('fProduct').value = s.product_id || '';

    // Preset
    document.getElementById('fPreset').value = s.preset;
    onPresetChange();

    // Model
    document.getElementById('fModel').value = config.model_id || '';

    // Launch mode
    const launchSel = document.getElementById('fLaunchMode');
    if (s.cron) {
      const cronOneTime = isOneTimeCron(s.cron);
      if (cronOneTime) {
        launchSel.value = 'scheduled';
        const parts = s.cron.split(/\s+/);
        const min = parseInt(parts[0]) || 0;
        const hour = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        const month = parseInt(parts[3]);
        const year = new Date().getFullYear();
        onLaunchModeChange();
        document.getElementById('fSchedDate').value = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        document.getElementById('fSchedHour').value = hour;
        document.getElementById('fSchedMin').value = min;
        updateSchedulePreview();
      } else {
        launchSel.value = 'cron';
        onLaunchModeChange();
        // Parse cron and set freq fields
        const parts = s.cron.split(/\s+/);
        const [cronMin, cronHour, cronDom, cronMon, cronDow] = parts;
        const freqSel = document.getElementById('fCronFreq');
        if (cronDow === '1-5' && cronDom === '*') { freqSel.value = 'weekdays'; }
        else if (cronDow !== '*' && cronDom === '*') { freqSel.value = 'weekly'; document.getElementById('fCronDow').value = cronDow; }
        else if (cronDom !== '*' && cronDow === '*') { freqSel.value = 'monthly'; document.getElementById('fCronDom').value = cronDom; }
        else if (cronDom === '*' && cronDow === '*') { freqSel.value = 'daily'; }
        else { freqSel.value = 'custom'; }
        onCronFreqChange();
        if (freqSel.value === 'custom') {
          document.getElementById('fCronMin').value = cronMin;
          document.getElementById('fCronHourRaw').value = cronHour;
          document.getElementById('fCronDomRaw').value = cronDom;
          document.getElementById('fCronMon').value = cronMon;
          document.getElementById('fCronDowRaw').value = cronDow;
        } else {
          document.getElementById('fCronHour').value = cronHour;
          document.getElementById('fCronMinute').value = cronMin;
        }
        updateCronPreview();
      }
    } else {
      launchSel.value = 'now';
      onLaunchModeChange();
    }

    // Restore stage states from config
    if (PRESET_VISIBLE[s.preset]) {
      if (config.run_tests !== undefined) stageStates.tests = config.run_tests;
      if (config.update_docs !== undefined) stageStates.docs = config.update_docs;
      if (config.auto_publish !== undefined) stageStates.publish = config.auto_publish;
      if (config.deploy !== undefined) stageStates.deploy = config.deploy;
      if (config.develop !== undefined) {
        if (typeof config.develop === 'object') stageStates.develop = config.develop.enabled !== false;
        else stageStates.develop = config.develop;
      }
      drawStages();
    }

    // Preset-specific fields
    if (s.preset === 'batch_develop') {
      await loadReleasesForProduct();
      setTimeout(() => {
        document.querySelectorAll('.release-checkbox').forEach(cb => {
          cb.checked = (config.release_ids || []).includes(cb.value);
        });
        autoGenerateName();
      }, 300);
      if (config.on_failure) document.getElementById('fOnFailure').value = config.on_failure;
      if (config.timeout_min) document.getElementById('fTimeout').value = config.timeout_min;
    } else if (s.preset === 'auto_release') {
      if (config.max_issues) document.getElementById('fMaxIssues').value = config.max_issues;
      if (config.auto_approve) document.getElementById('fAutoApproveAR').value = config.auto_approve;
    } else if (s.preset === 'nightly_audit') {
      if (config.template_id) document.getElementById('fTemplate').value = config.template_id;
      if (config.count) document.getElementById('fCount').value = config.count;
      if (config.auto_approve) document.getElementById('fAutoApproveNA').value = config.auto_approve;
    } else if (s.preset === 'full_cycle' || s.preset === 'analysis') {
      if (config.auto_approve) document.getElementById('fAutoApproveFC').value = config.auto_approve;
      if (config.timeout_min) document.getElementById('fTimeoutFC').value = config.timeout_min;
    }

    // Name + description last (after autoGenerate may have run)
    document.getElementById('fName').value = s.name || '';
    document.getElementById('fName').dataset.userEdited = 'true'; // preserve existing name
    document.getElementById('fDesc').value = s.description || '';

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
  productSel.innerHTML = '<option value="">Все продукты (только для аудита)</option>'
    + sortedProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  const modelSel = document.getElementById('fModel');
  modelSel.innerHTML = '<option value="">Не выбрана</option>'
    + modelsList.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.provider})</option>`).join('');
}

// ── Stages pipeline ──────────────────────────────────────

// All possible stages with dependencies
const ALL_STAGES = [
  { id: 'improve',  label: 'Улучшение',        icon: '💡', requires: [],          locked: true },
  { id: 'approve',  label: 'Утверждение',       icon: '✅', requires: ['improve'], locked: true },
  { id: 'release',  label: 'Форм. релиза',      icon: '📦', requires: ['approve'], locked: true },
  { id: 'spec',     label: 'Спецификация',      icon: '📋', requires: ['release'], locked: true },
  { id: 'develop',  label: 'Разработка',        icon: '⚙️', requires: ['spec'],    locked: false },
  { id: 'tests',    label: 'Тестирование',      icon: '🧪', requires: ['develop'], locked: false },
  { id: 'docs',     label: 'Документирование',  icon: '📝', requires: ['develop'], locked: false },
  { id: 'publish',  label: 'Публикация',        icon: '🚀', requires: ['develop'], locked: false },
  { id: 'deploy',   label: 'Деплой',            icon: '🖥️', requires: ['publish'], locked: false },
];

// Which stages are visible per preset
const PRESET_VISIBLE = {
  batch_develop: ['spec', 'develop', 'tests', 'docs', 'publish', 'deploy'],
  full_cycle:    ['improve', 'approve', 'release', 'spec', 'develop', 'tests', 'docs', 'publish', 'deploy'],
  analysis:      ['improve', 'approve', 'release', 'spec'],
  auto_release:  ['release', 'spec', 'develop', 'publish'],
};

// Default on/off per preset (only for unlocked stages)
const PRESET_DEFAULTS = {
  batch_develop: { develop: true, tests: false, docs: true, publish: false, deploy: false },
  full_cycle:    { develop: true, tests: true, docs: true, publish: true, deploy: false },
  analysis:      {},
  auto_release:  { develop: true, publish: false },
};

let stageStates = {};
let visibleStages = [];

function renderStages() {
  const preset = document.getElementById('fPreset').value;
  const section = document.getElementById('stagesSection');
  const stageIds = PRESET_VISIBLE[preset];
  if (!stageIds) { section.style.display = 'none'; return; }

  section.style.display = '';
  visibleStages = stageIds.map(id => ALL_STAGES.find(s => s.id === id)).filter(Boolean);

  // Init states: locked stages always on, others from defaults
  stageStates = {};
  const defaults = PRESET_DEFAULTS[preset] || {};
  for (const s of visibleStages) {
    if (s.locked) stageStates[s.id] = true;
    else stageStates[s.id] = defaults[s.id] !== undefined ? defaults[s.id] : false;
  }
  drawStages();
}

function drawStages() {
  const container = document.getElementById('stagesPipeline');
  container.innerHTML = visibleStages.map((s, i) => {
    const on = stageStates[s.id];
    const isLocked = s.locked;
    const cls = on ? 'stage-on' : 'stage-off';
    const lockIcon = isLocked ? ' 🔒' : '';
    // Arrow between stages
    const prevOn = i > 0 ? stageStates[visibleStages[i - 1].id] : true;
    const arrow = i > 0 ? `<span class="stage-arrow ${on && prevOn ? '' : 'stage-arrow-dim'}">→</span>` : '';
    const click = isLocked ? '' : `onclick="toggleStage('${s.id}')"`;
    const cursor = isLocked ? 'cursor:default;opacity:0.9' : 'cursor:pointer';
    return `${arrow}<div class="stage-chip ${cls}" data-stage="${s.id}" ${click} title="${s.label}${isLocked ? ' (обязательный)' : ' (кликните для вкл/выкл)'}" style="${cursor}">
      <span>${s.icon}</span><span style="font-size:0.72rem">${s.label}</span>
    </div>`;
  }).join('');
  autoGenerateName();
}

window.toggleStage = function (stageId) {
  const newVal = !stageStates[stageId];
  stageStates[stageId] = newVal;

  if (!newVal) {
    // Turning off → cascade disable all dependents
    const disableDependents = (id) => {
      for (const s of visibleStages) {
        if (!s.locked && s.requires.includes(id) && stageStates[s.id]) {
          stageStates[s.id] = false;
          disableDependents(s.id);
        }
      }
    };
    disableDependents(stageId);
  } else {
    // Turning on → cascade enable all requirements
    const enableRequirements = (id) => {
      const stage = visibleStages.find(s => s.id === id);
      if (!stage) return;
      for (const reqId of stage.requires) {
        const req = visibleStages.find(s => s.id === reqId);
        if (req && !req.locked && !stageStates[reqId]) {
          stageStates[reqId] = true;
          enableRequirements(reqId);
        }
      }
    };
    enableRequirements(stageId);
  }
  drawStages();
};

// ── Auto-generate name ───────────────────────────────────

function autoGenerateName() {
  const nameInput = document.getElementById('fName');
  // Don't overwrite user-edited name
  if (nameInput.dataset.userEdited === 'true') return;

  const preset = document.getElementById('fPreset').value;
  const productId = document.getElementById('fProduct').value;
  const product = productsList.find(p => p.id === productId);
  const productName = product ? product.name : '';

  const presetNames = {
    batch_develop: 'Пакетная разработка',
    auto_release: 'Авто-релиз',
    nightly_audit: 'Ночной аудит',
    full_cycle: 'Полный цикл',
    analysis: 'Анализ',
  };

  let name = presetNames[preset] || preset;
  if (productName) name += ` ${productName}`;

  // For batch_develop — add version range
  if (preset === 'batch_develop') {
    const checked = [...document.querySelectorAll('.release-checkbox:checked')];
    if (checked.length > 0) {
      const versions = checked.map(cb => {
        const label = cb.closest('label')?.textContent || '';
        return label.match(/v?([\d.]+)/)?.[1] || '';
      }).filter(Boolean).sort();
      if (versions.length === 1) name += ` v${versions[0]}`;
      else if (versions.length > 1) name += ` v${versions[0]}–v${versions[versions.length - 1]}`;
    }
  }

  nameInput.value = name;
}

// ── Launch mode ──────────────────────────────────────────

window.onLaunchModeChange = function () {
  const mode = document.getElementById('fLaunchMode').value;
  document.getElementById('launchScheduled').style.display = mode === 'scheduled' ? '' : 'none';
  document.getElementById('launchCron').style.display = mode === 'cron' ? '' : 'none';
  if (mode === 'scheduled') initScheduledPicker();
  if (mode === 'cron') initCronPicker();
  autoGenerateName();
};

function initScheduledPicker() {
  const hourSel = document.getElementById('fSchedHour');
  if (hourSel.options.length === 0) {
    hourSel.innerHTML = Array.from({ length: 24 }, (_, i) =>
      `<option value="${i}" ${i === 23 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`
    ).join('');
  }
  const dateSel = document.getElementById('fSchedDate');
  if (!dateSel.value) {
    const today = new Date();
    dateSel.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  }
  updateSchedulePreview();
}

window.updateSchedulePreview = function () {
  const dateStr = document.getElementById('fSchedDate').value;
  const hour = parseInt(document.getElementById('fSchedHour').value);
  const min = parseInt(document.getElementById('fSchedMin').value) || 0;
  const preview = document.getElementById('schedPreview');
  if (!dateStr || isNaN(hour)) { preview.textContent = ''; return; }
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d, hour, min);
  const diff = Math.round((target - new Date()) / 60000);
  const timeStr = `${d} ${MONTH_NAMES[m - 1]}, ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} MSK`;
  if (diff > 0) {
    const h = Math.floor(diff / 60), mm = diff % 60;
    preview.textContent = `Запуск: ${timeStr} (через ${h > 0 ? h + 'ч ' : ''}${mm}мин)`;
  } else {
    preview.textContent = `Запуск: ${timeStr} (время уже прошло!)`;
    preview.style.color = 'var(--red)';
  }
};

// ── Cron visual constructor ──────────────────────────────

function initCronPicker() {
  const hourSel = document.getElementById('fCronHour');
  if (hourSel.options.length === 0) {
    hourSel.innerHTML = Array.from({ length: 24 }, (_, i) =>
      `<option value="${i}" ${i === 21 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`
    ).join('');
  }
  const domSel = document.getElementById('fCronDom');
  if (domSel.options.length === 0) {
    domSel.innerHTML = Array.from({ length: 28 }, (_, i) =>
      `<option value="${i + 1}">${i + 1}</option>`
    ).join('');
  }
  onCronFreqChange();
}

window.onCronFreqChange = function () {
  const freq = document.getElementById('fCronFreq').value;
  const dowSel = document.getElementById('fCronDow');
  const domSel = document.getElementById('fCronDom');
  const freqFields = document.getElementById('cronFreqFields');
  const cronCustom = document.getElementById('cronCustom');
  const label = document.getElementById('cronFreqLabel');

  dowSel.style.display = 'none';
  domSel.style.display = 'none';
  freqFields.style.display = '';
  cronCustom.style.display = 'none';

  if (freq === 'daily') { label.textContent = 'Время:'; }
  else if (freq === 'weekdays') { label.textContent = 'Время:'; }
  else if (freq === 'weekly') { label.textContent = 'День:'; dowSel.style.display = ''; }
  else if (freq === 'monthly') { label.textContent = 'Число:'; domSel.style.display = ''; }
  else if (freq === 'custom') { freqFields.style.display = 'none'; cronCustom.style.display = ''; }

  updateCronPreview();
};

window.updateCronPreview = function () {
  const preview = document.getElementById('cronPreview');
  const cron = buildCronValue();
  if (!cron) { preview.textContent = ''; return; }
  preview.textContent = cronToHuman(cron);
};

function buildCronValue() {
  const freq = document.getElementById('fCronFreq').value;
  if (freq === 'custom') {
    const min = document.getElementById('fCronMin').value.trim() || '0';
    const hour = document.getElementById('fCronHourRaw').value.trim() || '*';
    const dom = document.getElementById('fCronDomRaw').value.trim() || '*';
    const mon = document.getElementById('fCronMon').value.trim() || '*';
    const dow = document.getElementById('fCronDowRaw').value.trim() || '*';
    return `${min} ${hour} ${dom} ${mon} ${dow}`;
  }
  const hour = document.getElementById('fCronHour').value;
  const minute = document.getElementById('fCronMinute').value || '0';
  if (freq === 'daily') return `${minute} ${hour} * * *`;
  if (freq === 'weekdays') return `${minute} ${hour} * * 1-5`;
  if (freq === 'weekly') return `${minute} ${hour} * * ${document.getElementById('fCronDow').value}`;
  if (freq === 'monthly') return `${minute} ${hour} ${document.getElementById('fCronDom').value} * *`;
  return null;
}

function buildCronFromLaunchMode() {
  const mode = document.getElementById('fLaunchMode').value;
  if (mode === 'now') return { cron: null, runImmediately: true };

  if (mode === 'scheduled') {
    const dateStr = document.getElementById('fSchedDate').value;
    const hourMsk = parseInt(document.getElementById('fSchedHour').value);
    const minMsk = parseInt(document.getElementById('fSchedMin').value) || 0;
    if (!dateStr || isNaN(hourMsk)) return { cron: null, error: 'Укажите дату и время' };
    let y, m, d;
    if (dateStr.includes('-')) [y, m, d] = dateStr.split('-').map(Number);
    else if (dateStr.includes('.')) [d, m, y] = dateStr.split('.').map(Number);
    else return { cron: null, error: 'Неверный формат даты' };
    if (!y || !m || !d) return { cron: null, error: 'Неверная дата' };
    return { cron: `${minMsk} ${hourMsk} ${d} ${m} *`, oneTime: true };
  }

  if (mode === 'cron') {
    const cron = buildCronValue();
    if (!cron) return { cron: null, error: 'Заполните расписание' };
    // Validate hour is set
    const parts = cron.split(/\s+/);
    if (parts[1] === '*') return { cron: null, error: 'Укажите час запуска' };
    return { cron };
  }
  return { cron: null };
}

// ── Preset change ────────────────────────────────────────

window.onPresetChange = function () {
  const preset = document.getElementById('fPreset').value;
  // Hide all config sections
  document.querySelectorAll('.scenario-config-section').forEach(el => el.style.display = 'none');
  const map = { batch_develop: 'cfgBatchDevelop', auto_release: 'cfgAutoRelease', nightly_audit: 'cfgNightlyAudit', full_cycle: 'cfgPipeline', analysis: 'cfgPipeline' };
  const sectionId = map[preset];
  if (sectionId) document.getElementById(sectionId).style.display = '';
  if (preset === 'batch_develop') loadReleasesForProduct();
  renderStages(); // works for all presets that have PRESET_VISIBLE
  autoGenerateName();
};

// ── Modal show/hide ──────────────────────────────────────

window.showCreateModal = function () {
  editingScenarioId = null;
  document.getElementById('createModalTitle').textContent = 'Новый сценарий';
  document.getElementById('createSubmitBtn').textContent = 'Создать';
  document.getElementById('createForm').reset();
  document.getElementById('fName').dataset.userEdited = 'false';
  document.getElementById('createModal').style.display = 'flex';
  onPresetChange();
  onLaunchModeChange();
};

window.hideCreateModal = function () {
  document.getElementById('createModal').style.display = 'none';
};

// ── Load releases ────────────────────────────────────────

async function loadReleasesForProduct() {
  const productId = document.getElementById('fProduct').value;
  const container = document.getElementById('fReleasesList');
  if (!productId) {
    container.innerHTML = '<em style="color:var(--text-dim)">Выберите продукт</em>';
    return;
  }
  try {
    const releases = await api(`/products/${productId}/releases`);
    const drafts = releases.filter(r => r.status === 'draft').sort((a, b) => {
      const va = (a.version || '0').split('.').map(Number);
      const vb = (b.version || '0').split('.').map(Number);
      for (let i = 0; i < 3; i++) { if ((va[i]||0) !== (vb[i]||0)) return (va[i]||0) - (vb[i]||0); }
      return 0;
    });
    if (drafts.length === 0) {
      container.innerHTML = '<em style="color:var(--text-dim)">Нет draft-релизов</em>';
      return;
    }
    container.innerHTML = drafts.map(r => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" class="release-checkbox" value="${r.id}" checked onchange="autoGenerateName()">
        <span style="font-family:monospace;min-width:50px">v${escapeHtml(r.version)}</span>
        <span>${escapeHtml(r.name)}</span>
        <span style="margin-left:auto;font-size:0.8rem;color:var(--text-dim)">${r.issue_count || '?'} задач</span>
      </label>
    `).join('');
    autoGenerateName();
  } catch (err) {
    container.innerHTML = `<em style="color:var(--danger)">${escapeHtml(err.message)}</em>`;
  }
}

// ── Create / update scenario ─────────────────────────────

window.createScenario = async function (e) {
  e.preventDefault();
  const name = document.getElementById('fName').value.trim();
  const product_id = document.getElementById('fProduct').value || null;
  const preset = document.getElementById('fPreset').value;
  const model_id = document.getElementById('fModel').value || null;
  const description = document.getElementById('fDesc').value.trim() || null;

  if (!name) { toast('Укажите название', 'error'); return false; }
  if (!model_id) { toast('Выберите AI-модель', 'error'); return false; }

  const launch = buildCronFromLaunchMode();
  if (launch.error) { toast(launch.error, 'error'); return false; }

  const config = { model_id };

  if (preset === 'batch_develop') {
    const checked = [...document.querySelectorAll('.release-checkbox:checked')].map(cb => cb.value);
    if (checked.length === 0) { toast('Выберите хотя бы один релиз', 'error'); return false; }
    const releaseMap = {};
    document.querySelectorAll('.release-checkbox').forEach(cb => {
      const label = cb.closest('label')?.textContent || '';
      releaseMap[cb.value] = label.match(/v?([\d.]+)/)?.[1] || '0';
    });
    checked.sort((a, b) => {
      const va = (releaseMap[a] || '0').split('.').map(Number);
      const vb = (releaseMap[b] || '0').split('.').map(Number);
      for (let i = 0; i < 3; i++) { if ((va[i]||0) !== (vb[i]||0)) return (va[i]||0) - (vb[i]||0); }
      return 0;
    });
    config.release_ids = checked;
    config.on_failure = document.getElementById('fOnFailure').value;
    config.timeout_min = parseInt(document.getElementById('fTimeout').value) || 60;
    // Read from stage states
    config.run_tests = stageStates.tests || false;
    config.update_docs = stageStates.docs || false;
    config.auto_publish = stageStates.publish || false;
    config.deploy = stageStates.deploy || false;
  } else if (preset === 'auto_release') {
    config.max_issues = parseInt(document.getElementById('fMaxIssues').value) || 10;
    config.auto_approve = document.getElementById('fAutoApproveAR').value;
  } else if (preset === 'nightly_audit') {
    config.template_id = document.getElementById('fTemplate').value;
    config.count = parseInt(document.getElementById('fCount').value) || 5;
    config.auto_approve = document.getElementById('fAutoApproveNA').value;
  } else if (preset === 'full_cycle' || preset === 'analysis') {
    config.auto_approve = document.getElementById('fAutoApproveFC').value;
    config.timeout_min = parseInt(document.getElementById('fTimeoutFC').value) || 20;
    if (preset === 'full_cycle') {
      config.develop = { enabled: stageStates.develop || true, auto_publish: stageStates.publish || false };
      config.press_release = { enabled: false };
      config.run_tests = stageStates.tests || false;
      config.update_docs = stageStates.docs || false;
      config.deploy = stageStates.deploy || false;
    }
  }

  try {
    if (editingScenarioId) {
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
    console.error('createScenario error:', err);
    toast(err.message, 'error');
  }
  return false;
};

// ── Init ─────────────────────────────────────────────────

document.getElementById('filterPreset').addEventListener('change', renderScenarios);
document.getElementById('createForm').addEventListener('submit', (e) => { e.preventDefault(); createScenario(e); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCreateModal(); hideDetailModal(); } });
document.getElementById('fProduct').addEventListener('change', () => {
  if (document.getElementById('fPreset').value === 'batch_develop') loadReleasesForProduct();
  autoGenerateName();
});
document.getElementById('fName').addEventListener('input', () => { document.getElementById('fName').dataset.userEdited = 'true'; });
loadAll().then(() => {
  // Auto-open create modal if redirected from product page
  const urlParams = new URLSearchParams(window.location.search);
  const presetProductId = urlParams.get('product_id');
  const autoCreate = urlParams.get('create');
  if (presetProductId && autoCreate === '1') {
    showCreateModal();
    // Set product AFTER modal opens (form.reset() inside showCreateModal clears it)
    const productSelect = document.getElementById('fProduct');
    if (productSelect) {
      productSelect.value = presetProductId;
      productSelect.dispatchEvent(new Event('change'));
    }
    window.history.replaceState({}, '', window.location.pathname);
  }
  // Highlight scenario if requested
  const highlightId = urlParams.get('highlight');
  if (highlightId) {
    const row = document.querySelector(`[data-scenario-id="${highlightId}"]`);
    if (row) {
      row.style.outline = '2px solid var(--accent)';
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { row.style.outline = ''; }, 3000);
    }
    window.history.replaceState({}, '', window.location.pathname);
  }
});
