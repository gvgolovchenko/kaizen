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

// ── Status change notifications ───────────────────────

/**
 * Показывает детальный toast о произошедших автоматических изменениях статусов.
 * @param {Object} params - { action: string, details: string[] }
 */
export function notifyStatusChanges({ action, details }) {
  ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast toast-info';
  el.innerHTML = `
    <div class="toast-title">${escapeHtml(action)}</div>
    ${details.map(d => `<div class="toast-detail">${escapeHtml(d)}</div>`).join('')}
  `;
  toastContainer.appendChild(el);
  setTimeout(() => { el.remove(); }, 5000);
}

// ── Modal helpers ──────────────────────────────────────

export function openModal(id) {
  document.getElementById(id).classList.add('active');
}

export function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Close topmost modal on ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modals = document.querySelectorAll('.modal-overlay.active');
    if (modals.length > 0) {
      modals[modals.length - 1].classList.remove('active');
    }
  }
});

// Close modal on click outside (on overlay)
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
    e.target.classList.remove('active');
  }
});

// ── URL filter sync ──────────────────────────────────

/**
 * Restore select value from URL query param on page load.
 * @param {string} selectId - DOM id of <select>
 * @param {string} paramName - URL query parameter name
 */
export function restoreFilterFromUrl(selectId, paramName) {
  const val = new URLSearchParams(location.search).get(paramName);
  if (val) {
    const el = document.getElementById(selectId);
    if (el) el.value = val;
  }
}

/**
 * Sync select value to URL query param on change (replaceState, no reload).
 * @param {string} selectId - DOM id of <select>
 * @param {string} paramName - URL query parameter name
 */
export function syncFilterToUrl(selectId, paramName) {
  const el = document.getElementById(selectId);
  if (!el) return;
  el.addEventListener('change', () => {
    const url = new URL(location.href);
    if (el.value) url.searchParams.set(paramName, el.value);
    else url.searchParams.delete(paramName);
    history.replaceState(null, '', url);
  });
}

// ── Breadcrumbs ──────────────────────────────────────

/**
 * Render breadcrumbs into a container.
 * @param {string} containerId - DOM id of breadcrumb container
 * @param {Array<{label: string, href?: string}>} items - breadcrumb items (last one has no href)
 */
export function renderBreadcrumbs(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = 'breadcrumbs';
  el.innerHTML = items.map((item, i) => {
    if (i < items.length - 1) {
      return `<a href="${item.href}" class="breadcrumb-link">${escapeHtml(item.label)}</a><span class="breadcrumb-sep">›</span>`;
    }
    return `<span class="breadcrumb-current">${escapeHtml(item.label)}</span>`;
  }).join('');
}

// ── Navbar auto-active ───────────────────────────────

(function initNavbar() {
  const path = location.pathname;
  const navMap = {
    '/': '/',
    '/index.html': '/',
    '/products.html': '/products.html',
    '/product.html': '/products.html',
    '/roadmap.html': '/products.html',
    '/processes.html': '/processes.html',
    '/plans.html': '/plans.html',
    '/plan-edit.html': '/plans.html',
    '/models.html': '/models.html',
  };
  const activeHref = navMap[path] || '/';
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === activeHref);
  });

  // Search hint in navbar
  const navBar = document.querySelector('.nav-inner');
  if (!navBar) return;
  const links = navBar.querySelector('.nav-links');
  if (!links) return;

  const searchBtn = document.createElement('button');
  searchBtn.className = 'nav-search-btn';
  searchBtn.innerHTML = '<span class="nav-search-icon">&#128269;</span><span class="nav-search-hint">⌘K</span>';
  searchBtn.addEventListener('click', () => openSearchPalette());
  links.after(searchBtn);

  // Mobile hamburger
  const burger = document.createElement('button');
  burger.className = 'nav-burger';
  burger.innerHTML = '&#9776;';
  burger.addEventListener('click', () => links.classList.toggle('nav-open'));
  navBar.appendChild(burger);
})();

// ── Keyboard shortcuts ───────────────────────────────

(function initShortcuts() {
  let gPressed = false;
  let gTimer = null;

  document.addEventListener('keydown', (e) => {
    // Skip when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

    // Cmd+K / Ctrl+K — global search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearchPalette();
      return;
    }

    // ? — show shortcuts help
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      showShortcutsHelp();
      return;
    }

    // Two-key navigation: g then p/r/l/m
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      gPressed = true;
      clearTimeout(gTimer);
      gTimer = setTimeout(() => { gPressed = false; }, 1000);
      return;
    }

    if (gPressed) {
      gPressed = false;
      clearTimeout(gTimer);
      const navKeys = { h: '/', p: '/products.html', r: '/processes.html', l: '/plans.html', m: '/models.html' };
      if (navKeys[e.key]) {
        e.preventDefault();
        location.href = navKeys[e.key];
      }
    }
  });
})();

function showShortcutsHelp() {
  // Remove existing
  const existing = document.getElementById('shortcutsModal');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'shortcutsModal';
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="shortcuts-modal">
      <h3>Горячие клавиши</h3>
      <div class="shortcuts-grid">
        <div class="shortcut-row"><kbd>⌘K</kbd><span>Глобальный поиск</span></div>
        <div class="shortcut-row"><kbd>?</kbd><span>Справка по клавишам</span></div>
        <div class="shortcut-row"><kbd>g</kbd> <kbd>h</kbd><span>Главная</span></div>
        <div class="shortcut-row"><kbd>g</kbd> <kbd>p</kbd><span>Продукты</span></div>
        <div class="shortcut-row"><kbd>g</kbd> <kbd>r</kbd><span>Процессы</span></div>
        <div class="shortcut-row"><kbd>g</kbd> <kbd>l</kbd><span>Планы</span></div>
        <div class="shortcut-row"><kbd>g</kbd> <kbd>m</kbd><span>Модели ИИ</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd><span>Закрыть модал</span></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ── Search palette ───────────────────────────────────

let searchDebounceTimer = null;

function openSearchPalette() {
  // Remove existing
  const existing = document.getElementById('searchPalette');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'searchPalette';
  overlay.className = 'search-overlay active';
  overlay.innerHTML = `
    <div class="search-box">
      <input type="text" class="search-input" placeholder="Поиск продуктов, задач, релизов..." autofocus>
      <div class="search-results"></div>
      <div class="search-hint">Esc — закрыть · Enter — перейти · ↑↓ — выбрать</div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.search-input');
  const results = overlay.querySelector('.search-results');
  let activeIdx = -1;
  let items = [];

  input.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; items = []; activeIdx = -1; return; }
    searchDebounceTimer = setTimeout(async () => {
      try {
        items = await api(`/search?q=${encodeURIComponent(q)}`);
        activeIdx = -1;
        renderSearchResults();
      } catch { results.innerHTML = '<div class="search-empty">Ошибка поиска</div>'; }
    }, 300);
  });

  function renderSearchResults() {
    if (items.length === 0) {
      results.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
      return;
    }
    const typeLabels = { product: 'Продукт', issue: 'Задача', release: 'Релиз' };
    results.innerHTML = items.map((item, i) => `
      <a href="${item.url}" class="search-item${i === activeIdx ? ' active' : ''}">
        <span class="search-type">${typeLabels[item.type] || item.type}</span>
        <span class="search-title">${escapeHtml(item.title)}</span>
        ${item.meta ? `<span class="search-meta">${escapeHtml(item.meta)}</span>` : ''}
      </a>`).join('');
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); renderSearchResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderSearchResults(); }
    else if (e.key === 'Enter' && items[activeIdx]) { e.preventDefault(); location.href = items[activeIdx].url; }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Focus input
  requestAnimationFrame(() => input.focus());
}

export { openSearchPalette };
