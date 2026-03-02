// ── Shared process detail logic ──────────────────────────
// Common functions for product.js and processes.js

import { api, toast, escapeHtml, closeModal, formatDate, notifyStatusChanges } from './app.js';

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

  let html = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:0.85rem;color:var(--text-dim)">
      <span class="badge badge-process-${proc.status}">${proc.status}</span>
      <span class="badge badge-process-${proc.type}">${proc.type}</span>
      ${showProductName ? `<span>&middot; ${escapeHtml(proc.product_name)}</span>` : ''}
      <span>&middot; ${escapeHtml(proc.model_name)}</span>
      ${proc.duration_ms ? `<span>&middot; ${formatDuration(proc.duration_ms)}</span>` : ''}
    </div>`;

  // Промпт (сворачиваемый)
  if (proc.input_prompt) {
    html += `
      <div class="collapsible" style="margin-bottom:8px">
        <div class="collapsible-toggle" onclick="this.parentElement.classList.toggle('open')">
          <span class="collapsible-arrow">&#9654;</span>
          <span style="font-size:0.85rem;font-weight:600;color:var(--text-dim)">Промпт</span>
        </div>
        <div class="collapsible-body">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:0.85rem;max-height:120px;overflow-y:auto">${escapeHtml(proc.input_prompt)}</div>
        </div>
      </div>`;
  }

  // Ошибка (всегда видна)
  if (proc.error) {
    html += `
      <div style="margin-bottom:8px;padding:10px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px">
        <div style="font-size:0.85rem;font-weight:600;color:var(--red);margin-bottom:4px">Ошибка</div>
        <div style="font-size:0.85rem;color:var(--red)">${escapeHtml(proc.error)}</div>
      </div>`;
  }

  // Логи (сворачиваемые)
  if (logs.length > 0) {
    html += `
      <div class="collapsible" style="margin-bottom:12px">
        <div class="collapsible-toggle" onclick="this.parentElement.classList.toggle('open')">
          <span class="collapsible-arrow">&#9654;</span>
          <span style="font-size:0.85rem;font-weight:600;color:var(--text-dim)">Логи (${logs.length})</span>
        </div>
        <div class="collapsible-body">
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

  // Предложения (если процесс завершён)
  if (!showedDetailSection && !excludeTypes.includes(proc.type) &&
      proc.status === 'completed' && proc.result && proc.result.length > 0) {
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
