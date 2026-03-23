// ── Shared process detail logic ──────────────────────────
// Common functions for product.js and processes.js

import { api, toast, escapeHtml, closeModal, formatDate, notifyStatusChanges } from './app.js';

// ── Process type labels ──────────────────────────────────

const PROC_TYPE_LABELS = {
  improve: 'Генерация задач',
  prepare_spec: 'Спецификация',
  develop_release: 'Разработка релиза',
  roadmap_from_doc: 'Дорожная карта',
  form_release: 'Формирование релиза',
  prepare_press_release: 'Пресс-релиз',
  run_tests: 'Тесты',
  update_docs: 'Документация',
  validate_product: 'Анализ продукта',
  deploy: 'Деплой',
};

export function procTypeLabel(type) {
  return PROC_TYPE_LABELS[type] || type;
}

// ── Format duration ──────────────────────────────────────

export function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}мс`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  return `${min}м ${sec % 60}с`;
}

// ── Render process detail HTML ───────────────────────────

/**
 * Генерирует HTML-содержимое модала деталей процесса.
 * @param {Object} proc - объект процесса из API
 * @param {Array} logs - массив логов процесса
 * @param {Object} options
 * @param {boolean} options.showProductName - показывать строку «Продукт: ...»
 * @param {boolean} options.showSpecLink - показывать блок спецификации (prepare_spec)
 * @param {boolean} options.showDevResult - показывать результат разработки (develop_release)
 * @param {string[]} options.excludeTypes - типы, для которых не показывать suggestions
 * @param {string} options.modalId - ID модала для кнопки «Закрыть»
 * @param {string} options.onShowSpecAttr - HTML-атрибут onclick для кнопки спецификации
 * @returns {string} HTML-строка
 */
export function renderProcessDetailHtml(proc, logs, options = {}) {
  const {
    showProductName = false,
    showSpecLink = false,
    showDevResult = false,
    excludeTypes = [],
    modalId = 'processDetailModal',
    onShowSpecAttr = '',
  } = options;

  // Populate header meta (outside content div)
  const metaEl = document.getElementById('processDetailMeta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="badge badge-process-${proc.status}">${proc.status}</span>
      <span class="badge badge-process-${proc.type}">${proc.type}</span>
      ${showProductName && proc.product_name ? `<span style="font-size:0.8rem;color:var(--text-dim)">${escapeHtml(proc.product_name)}</span>` : ''}`;
  }

  // Extract checkpoint logs for stepper
  const checkpointLogs = logs.filter(l => l.step === 'checkpoint');
  const isDevRelease = proc.type === 'develop_release';

  // Meta info row
  const createdAt = proc.created_at ? new Date(proc.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  let html = `
    <div class="proc-meta-row">
      ${proc.model_name ? `<div class="proc-meta-item">🤖 <b>${escapeHtml(proc.model_name)}</b></div>` : ''}
      <div class="proc-meta-item">📅 <b>${createdAt}</b></div>
      ${proc.duration_ms ? `<div class="proc-meta-item">⏱ <b>${formatDuration(proc.duration_ms)}</b></div>` : ''}
      ${proc.queue_position > 0 ? `<div class="proc-meta-item">📋 позиция в очереди: <b>${proc.queue_position}</b></div>` : ''}
    </div>`;

  // Checkpoint stepper for develop_release (horizontal)
  if (isDevRelease && checkpointLogs.length > 0) {
    html += renderCheckpointStepperH(checkpointLogs, proc.status);
  }

  // Ошибка (всегда видна)
  if (proc.error) {
    html += `
      <div style="margin-bottom:10px;padding:10px 12px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:8px;display:flex;gap:8px;align-items:flex-start">
        <span style="color:var(--red);font-size:1rem;flex-shrink:0">✗</span>
        <div style="font-size:0.85rem;color:var(--red)">${escapeHtml(proc.error)}</div>
      </div>`;
  }

  // Промпт (сворачиваемый)
  if (proc.input_prompt) {
    html += `
      <div class="collapsible" style="margin-bottom:10px">
        <div class="collapsible-toggle" onclick="this.parentElement.classList.toggle('open')">
          <span class="collapsible-arrow">&#9654;</span>
          <span style="font-size:0.82rem;font-weight:600;color:var(--text-dim)">Промпт</span>
        </div>
        <div class="collapsible-body">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:0.82rem;max-height:100px;overflow-y:auto;white-space:pre-wrap;color:var(--text-dim)">${escapeHtml(proc.input_prompt)}</div>
        </div>
      </div>`;
  }

  // Логи — timeline
  if (logs.length > 0) {
    html += `
      <div style="margin-bottom:12px">
        <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-dim);margin-bottom:6px">Лог выполнения (${logs.length})</div>
        <div class="proc-log-timeline">
          ${logs.map(l => {
            const cls = logStepClass(l.step);
            const icon = logStepIcon(l.step);
            const time = new Date(l.created_at).toLocaleTimeString('ru-RU');
            return `
            <div class="proc-log-item ${cls}">
              <div class="proc-log-icon">${icon}</div>
              <div class="proc-log-body">
                <div class="proc-log-step">${l.step}</div>
                ${l.message ? `<div class="proc-log-msg">${escapeHtml(l.message)}</div>` : ''}
              </div>
              <div class="proc-log-time">${time}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // Спецификация (для prepare_spec процессов)
  if (showSpecLink && proc.type === 'prepare_spec' && proc.status === 'completed' && proc.release_id) {
    html += `
      <div style="margin-bottom:16px">
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Спецификация</div>
        <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
          ${proc.result && proc.result.char_count ? `<span style="font-size:0.85rem;color:var(--text-dim)">${proc.result.char_count} символов</span> &middot; ` : ''}
          ${proc.result && proc.result.mode ? `<span class="badge badge-mode-${proc.result.mode}">${proc.result.mode}</span> &middot; ` : ''}
          <button class="btn btn-primary btn-sm" ${onShowSpecAttr}>Открыть спецификацию</button>
        </div>
      </div>`;
  }

  let showedDetailSection = false;

  // Результат разработки
  if (showDevResult && proc.type === 'develop_release' && proc.status === 'completed' && proc.result) {
    const r = proc.result;
    html += `
      <div>
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Результат разработки</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:0.875rem">
          <div>Ветка: <strong>${escapeHtml(r.branch || '—')}</strong></div>
          <div>Коммит: <code>${escapeHtml(r.commit_hash ? r.commit_hash.slice(0, 7) : '—')}</code></div>
          <div>Изменено файлов: <strong>${r.files_changed ?? '—'}</strong></div>
          <div>Тестов написано: <strong>${r.tests_written ?? '—'}</strong></div>
          <div>Тесты: <strong style="color:${r.tests_passed ? 'var(--green)' : 'var(--red)'}">
            ${r.tests_passed ? 'пройдены' : 'не пройдены'}</strong></div>
          ${r.summary ? `<div style="margin-top:8px;color:var(--text-dim)">${escapeHtml(r.summary)}</div>` : ''}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal('${modalId}')">Закрыть</button>
        </div>
      </div>`;
    showedDetailSection = true;
  }

  // Roadmap result (releases with issues)
  if (!showedDetailSection && !excludeTypes.includes(proc.type) &&
      proc.status === 'completed' && proc.result && proc.result.roadmap && Array.isArray(proc.result.roadmap)) {
    const roadmap = proc.result;
    html += `
      <div>
        ${roadmap.summary ? `<div style="font-size:0.85rem;color:var(--text-dim);margin-bottom:12px">${escapeHtml(roadmap.summary)}</div>` : ''}
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Релизы (${roadmap.total_releases}) &middot; Задачи (${roadmap.total_issues})</div>
        <div class="improve-actions-top">
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(true)">Выбрать все</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(false)">Снять все</button>
        </div>
        <div class="improve-suggestions-list" id="processSuggestionsList" style="max-height:400px;overflow-y:auto">
          ${roadmap.roadmap.map((release, ri) => `
            <div class="collapsible open" style="margin-bottom:8px">
              <div class="collapsible-toggle" onclick="this.parentElement.classList.toggle('open')" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;cursor:pointer">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="event.stopPropagation()">
                  <input type="checkbox" checked data-release-index="${ri}" onchange="toggleRoadmapRelease(this, ${ri})">
                  <span class="collapsible-arrow">&#9654;</span>
                  <strong>${escapeHtml(release.version)}</strong>
                  <span style="color:var(--text-dim)">${escapeHtml(release.name)}</span>
                  <span class="badge" style="margin-left:auto">${release.issues.length} задач</span>
                </label>
              </div>
              <div class="collapsible-body" style="padding-left:16px;margin-top:4px">
                ${release.description ? `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:6px">${escapeHtml(release.description)}</div>` : ''}
                ${release.issues.map((issue, ii) => `
                  <label class="improve-suggestion" style="margin-bottom:4px">
                    <input type="checkbox" checked data-release-index="${ri}" data-issue-index="${ii}" onchange="updateRoadmapApproveCount()">
                    <div class="improve-suggestion-content">
                      <div class="improve-suggestion-title">${escapeHtml(issue.title)}</div>
                      <div style="display:flex;gap:6px;margin:2px 0">
                        <span class="badge badge-${issue.type}">${issue.type}</span>
                        <span class="badge badge-${issue.priority}">${issue.priority}</span>
                      </div>
                      ${issue.description ? `<div class="improve-suggestion-desc">${escapeHtml(issue.description)}</div>` : ''}
                    </div>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal('${modalId}')">Закрыть</button>
          <button type="button" class="btn btn-primary" id="processApproveBtn" onclick="handleProcessApproveRoadmap('${proc.id}')">Утвердить (${roadmap.total_issues} задач)</button>
        </div>
      </div>`;
    showedDetailSection = true;
  }

  // Предложения (если процесс завершён — плоский список)
  if (!showedDetailSection && !excludeTypes.includes(proc.type) &&
      proc.status === 'completed' && proc.result && Array.isArray(proc.result) && proc.result.length > 0) {
    html += `
      <div>
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--text-dim)">Предложения (${proc.result.length})</div>
        <div class="improve-actions-top">
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(true)">Выбрать все</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllProcessSuggestions(false)">Снять все</button>
        </div>
        <div class="improve-suggestions-list" id="processSuggestionsList">
          ${proc.result.map((s, i) => {
            const alreadyApproved = (proc.approved_indices || []).includes(i);
            return `
            <label class="improve-suggestion" ${alreadyApproved ? 'style="opacity:0.5"' : ''}>
              <input type="checkbox" ${alreadyApproved ? 'disabled' : 'checked'} data-index="${i}" onchange="updateProcessApproveCount()">
              <div class="improve-suggestion-content">
                <div class="improve-suggestion-title">${escapeHtml(s.title)}${alreadyApproved ? ' <span style="font-size:0.75rem;color:var(--green)">&#10004; создана</span>' : ''}</div>
                <div style="display:flex;gap:6px;margin:4px 0">
                  <span class="badge badge-${s.type}">${s.type}</span>
                  <span class="badge badge-${s.priority}">${s.priority}</span>
                </div>
                ${s.description ? `<div class="improve-suggestion-desc">${escapeHtml(s.description)}</div>` : ''}
              </div>
            </label>`;
          }).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal('${modalId}')">Закрыть</button>
          <button type="button" class="btn btn-primary" id="processApproveBtn" onclick="handleProcessApprove('${proc.id}')">Создать выбранные (${proc.result.length - (proc.approved_indices || []).length})</button>
        </div>
      </div>`;
    showedDetailSection = true;
  }

  if (!showedDetailSection) {
    html += `
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal('${modalId}')">Закрыть</button>
        ${proc.status === 'failed' ? `<button type="button" class="btn btn-primary" onclick="handleProcessRestart('${proc.id}')">Перезапустить</button>` : ''}
      </div>`;
  }

  return html;
}

// ── Toggle all suggestions ───────────────────────────────

export function toggleAllSuggestions(containerId, state) {
  document.querySelectorAll(`#${containerId} input[type="checkbox"]:not(:disabled)`).forEach(cb => {
    cb.checked = state;
  });
  updateApproveCount(containerId);
}

// ── Update approve button count ──────────────────────────

export function updateApproveCount(containerId = 'processSuggestionsList', btnId = 'processApproveBtn') {
  const checked = document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked:not(:disabled)`);
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.textContent = `Создать выбранные (${checked.length})`;
    btn.disabled = checked.length === 0;
  }
}

// ── Approve process suggestions ──────────────────────────

/**
 * Утверждает выбранные предложения процесса, создаёт из них задачи.
 * @param {string} processId
 * @param {string} containerId - ID контейнера чекбоксов
 * @param {Object} options
 * @param {string} options.modalId - ID модала для закрытия
 * @param {Function} options.onSuccess - коллбэк после успешного утверждения
 */
export async function approveProcess(processId, containerId, options = {}) {
  const { modalId = 'processDetailModal', onSuccess } = options;

  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`);
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));

  if (indices.length === 0) return toast('Выберите хотя бы одну задачу', 'error');

  try {
    const result = await api(`/processes/${processId}/approve`, {
      method: 'POST',
      body: { indices },
    });
    notifyStatusChanges({
      action: 'Предложения утверждены',
      details: [`Создано ${result.count} задач(и) со статусом open`]
    });
    closeModal(modalId);
    if (onSuccess) onSuccess(result);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Log step helpers ─────────────────────────────────────

function logStepClass(step) {
  if (['request_sent'].includes(step)) return 'log-send';
  if (['response_received'].includes(step)) return 'log-receive';
  if (['error'].includes(step)) return 'log-error';
  if (['checkpoint'].includes(step)) return 'log-check';
  return 'log-success';
}

function logStepIcon(step) {
  if (step === 'request_sent') return '↑';
  if (step === 'response_received') return '↓';
  if (step === 'error') return '✗';
  if (step === 'checkpoint') return '◆';
  if (step === 'auto_approved') return '✓✓';
  return '✓';
}

// ── Horizontal checkpoint stepper ───────────────────────

const CHECKPOINT_ALL_PHASES = [
  { key: 'repo',      label: 'Репо' },
  { key: 'study',     label: 'Анализ' },
  { key: 'implement', label: 'Разработка' },
  { key: 'tests',     label: 'Тесты' },
  { key: 'test_run',  label: 'Запуск' },
  { key: 'docs',      label: 'Документы' },
  { key: 'commit',    label: 'Коммит' },
];

function renderCheckpointStepperH(checkpointLogs, processStatus) {
  const reachedPhases = new Map();
  for (const log of checkpointLogs) {
    const phase = log.data?.phase;
    if (phase) reachedPhases.set(phase, log);
  }

  const lastPhase = checkpointLogs.length > 0
    ? checkpointLogs[checkpointLogs.length - 1].data?.phase
    : null;

  const isFinished = processStatus === 'completed' || processStatus === 'failed';

  const items = CHECKPOINT_ALL_PHASES.map(({ key, label }) => {
    const log = reachedPhases.get(key);
    let cls = '';
    let dot = '';

    if (log) {
      if (key === lastPhase && !isFinished) {
        cls = 'cp-active';
        dot = '●';
      } else {
        cls = 'cp-done';
        dot = '✓';
      }
    }

    const timeStr = log ? new Date(log.created_at).toLocaleTimeString('ru-RU') : '';

    return `<div class="checkpoint-step-h ${cls}">
      <div class="checkpoint-dot-h">${dot}</div>
      <div class="checkpoint-label-h">${label}</div>
      ${timeStr ? `<div class="checkpoint-time-h">${timeStr}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="checkpoint-stepper-h">${items}</div>`;
}
