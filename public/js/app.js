// ── API helper ─────────────────────────────────────────

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── Date formatting ────────────────────────────────────

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Toast notifications ────────────────────────────────

let toastContainer;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

export function toast(message, type = 'success') {
  ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// ── Confirm dialog ─────────────────────────────────────

export function confirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay active';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" data-action="cancel">Отмена</button>
          <button class="btn btn-danger" data-action="ok">Удалить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'ok') { overlay.remove(); resolve(true); }
      else if (action === 'cancel' || e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

// ── Escape HTML ────────────────────────────────────────

export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Modal helpers ──────────────────────────────────────

export function openModal(id) {
  document.getElementById(id).classList.add('active');
}

export function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}
