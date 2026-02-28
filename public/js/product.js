import { api, toast, confirm, escapeHtml, openModal, closeModal, formatDate } from './app.js';

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.href = '/';

let product = null;
let issues = [];
let releases = [];
let currentFilter = '';

// ── Load data ──────────────────────────────────────────

async function loadProduct() {
  try {
    product = await api(`/products/${productId}`);
    renderProductHeader();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadIssues() {
  try {
    const path = currentFilter
      ? `/products/${productId}/issues?status=${currentFilter}`
      : `/products/${productId}/issues`;
    issues = await api(path);
    renderIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadReleases() {
  try {
    releases = await api(`/products/${productId}/releases`);
    renderReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadAll() {
  await Promise.all([loadProduct(), loadIssues(), loadReleases()]);
}

// ── Render product header ──────────────────────────────

function renderProductHeader() {
  if (!product) return;
  document.title = `Kaizen — ${product.name}`;
  document.getElementById('prodName').textContent = product.name;
  document.getElementById('prodDesc').textContent = product.description || '';

  const meta = [];
  if (product.tech_stack) meta.push(`<span>${escapeHtml(product.tech_stack)}</span>`);
  if (product.owner) meta.push(`<span>${escapeHtml(product.owner)}</span>`);
  if (product.repo_url) meta.push(`<span><a href="${escapeHtml(product.repo_url)}" target="_blank">Репозиторий</a></span>`);
  if (product.project_path) meta.push(`<span style="font-family:monospace;font-size:0.8rem">${escapeHtml(product.project_path)}</span>`);
  meta.push(`<span class="badge badge-${product.status}">${product.status}</span>`);
  document.getElementById('prodMeta').innerHTML = meta.join('');
}

// ── Render issues ──────────────────────────────────────

function renderIssues() {
  const tbody = document.getElementById('issuesBody');
  const empty = document.getElementById('issuesEmpty');

  if (issues.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = issues.map(i => `
    <tr>
      <td>${escapeHtml(i.title)}</td>
      <td><span class="badge badge-${i.type}">${i.type}</span></td>
      <td><span class="badge badge-${i.priority}">${i.priority}</span></td>
      <td><span class="badge badge-${i.status}">${i.status}</span></td>
      <td style="white-space:nowrap">${formatDate(i.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="showEditIssue('${i.id}')">Ред.</button>
        <button class="btn btn-danger btn-sm" onclick="deleteIssue('${i.id}')">Уд.</button>
      </td>
    </tr>
  `).join('');
}

// ── Render releases ────────────────────────────────────

function renderReleases() {
  const el = document.getElementById('releasesList');
  const empty = document.getElementById('releasesEmpty');

  if (releases.length === 0) {
    el.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  el.innerHTML = releases.map(r => `
    <div class="release-card">
      <div class="release-card-header">
        <h3>
          <span class="badge badge-${r.status}">${r.status}</span>
          ${escapeHtml(r.version)} — ${escapeHtml(r.name)}
        </h3>
        <div style="display:flex;gap:6px">
          ${r.status === 'draft' ? `<button class="btn btn-green btn-sm" onclick="publishRelease('${r.id}')">Опубликовать</button>` : ''}
          ${r.status !== 'released' ? `<button class="btn btn-danger btn-sm" onclick="deleteRelease('${r.id}')">Удалить</button>` : ''}
        </div>
      </div>
      ${r.description ? `<p style="color:var(--text-dim);font-size:0.875rem;margin-bottom:8px">${escapeHtml(r.description)}</p>` : ''}
      <div style="font-size:0.85rem;color:var(--text-dim)">
        Задач: ${r.issue_count || 0}
        ${r.released_at ? ` &middot; Выпущен: ${formatDate(r.released_at)}` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="toggleReleaseDetails('${r.id}', this)">Показать задачи</button>
      <div class="release-issues" id="release-${r.id}" style="display:none"></div>
    </div>
  `).join('');
}

// ── Toggle release details ─────────────────────────────

window.toggleReleaseDetails = async function (releaseId, btn) {
  const el = document.getElementById(`release-${releaseId}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    btn.textContent = 'Показать задачи';
    return;
  }

  try {
    const release = await api(`/releases/${releaseId}`);
    if (!release.issues || release.issues.length === 0) {
      el.innerHTML = '<p style="color:var(--text-dim);padding:8px;font-size:0.85rem">Нет задач</p>';
    } else {
      el.innerHTML = release.issues.map(i => `
        <div class="release-issue">
          <span>
            <span class="badge badge-${i.type}">${i.type}</span>
            ${escapeHtml(i.title)}
          </span>
          <span class="badge badge-${i.status}">${i.status}</span>
        </div>
      `).join('');
    }
    el.style.display = '';
    btn.textContent = 'Скрыть задачи';
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Filters ────────────────────────────────────────────

document.getElementById('issueFilters').addEventListener('click', (e) => {
  if (!e.target.matches('.btn')) return;
  document.querySelectorAll('#issueFilters .btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.status;
  loadIssues();
});

// ── Edit product ───────────────────────────────────────

window.showEditProductModal = function () {
  if (!product) return;
  document.getElementById('epName').value = product.name;
  document.getElementById('epDesc').value = product.description || '';
  document.getElementById('epRepo').value = product.repo_url || '';
  document.getElementById('epStack').value = product.tech_stack || '';
  document.getElementById('epOwner').value = product.owner || '';
  document.getElementById('epPath').value = product.project_path || '';
  openModal('editProductModal');
};

window.handleEditProduct = async function (e) {
  e.preventDefault();
  try {
    await api(`/products/${productId}`, {
      method: 'PUT',
      body: {
        name: document.getElementById('epName').value,
        description: document.getElementById('epDesc').value,
        repo_url: document.getElementById('epRepo').value,
        tech_stack: document.getElementById('epStack').value,
        owner: document.getElementById('epOwner').value,
        project_path: document.getElementById('epPath').value,
      },
    });
    toast('Продукт обновлён');
    closeModal('editProductModal');
    loadProduct();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

// ── Issues CRUD ────────────────────────────────────────

window.showIssueModal = function () {
  document.getElementById('issueModalTitle').textContent = 'Новая задача';
  document.getElementById('issueId').value = '';
  document.getElementById('issueForm').reset();
  openModal('issueModal');
};

window.showEditIssue = function (id) {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;
  document.getElementById('issueModalTitle').textContent = 'Редактировать задачу';
  document.getElementById('issueId').value = issue.id;
  document.getElementById('issueTitle').value = issue.title;
  document.getElementById('issueDesc').value = issue.description || '';
  document.getElementById('issueType').value = issue.type;
  document.getElementById('issuePriority').value = issue.priority;
  openModal('issueModal');
};

window.handleIssueSubmit = async function (e) {
  e.preventDefault();
  const id = document.getElementById('issueId').value;
  const body = {
    product_id: productId,
    title: document.getElementById('issueTitle').value,
    description: document.getElementById('issueDesc').value,
    type: document.getElementById('issueType').value,
    priority: document.getElementById('issuePriority').value,
  };

  try {
    if (id) {
      await api(`/issues/${id}`, { method: 'PUT', body });
      toast('Задача обновлена');
    } else {
      await api('/issues', { method: 'POST', body });
      toast('Задача создана');
    }
    closeModal('issueModal');
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window.deleteIssue = async function (id) {
  const ok = await confirm('Удалить задачу?');
  if (!ok) return;
  try {
    await api(`/issues/${id}`, { method: 'DELETE' });
    toast('Задача удалена');
    loadIssues();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Releases CRUD ──────────────────────────────────────

window.showReleaseModal = async function () {
  document.getElementById('releaseForm').reset();

  // Load open issues for checkboxes
  try {
    const openIssues = await api(`/products/${productId}/issues?status=open`);
    const list = document.getElementById('releaseIssuesList');
    if (openIssues.length === 0) {
      list.innerHTML = '<p style="color:var(--text-dim);padding:8px;font-size:0.85rem">Нет открытых задач</p>';
    } else {
      list.innerHTML = openIssues.map(i => `
        <label class="checkbox-item">
          <input type="checkbox" value="${i.id}">
          <span class="badge badge-${i.type}">${i.type}</span>
          <span class="badge badge-${i.priority}">${i.priority}</span>
          <span>${escapeHtml(i.title)}</span>
        </label>
      `).join('');
    }
  } catch (err) {
    toast(err.message, 'error');
  }

  openModal('releaseModal');
};

window.handleReleaseSubmit = async function (e) {
  e.preventDefault();

  const issueCheckboxes = document.querySelectorAll('#releaseIssuesList input[type="checkbox"]:checked');
  const issue_ids = Array.from(issueCheckboxes).map(cb => cb.value);

  const body = {
    product_id: productId,
    version: document.getElementById('releaseVersion').value,
    name: document.getElementById('releaseName').value,
    description: document.getElementById('releaseDesc').value,
    issue_ids,
  };

  try {
    await api('/releases', { method: 'POST', body });
    toast('Релиз создан');
    closeModal('releaseModal');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window.publishRelease = async function (id) {
  try {
    await api(`/releases/${id}/publish`, { method: 'POST' });
    toast('Релиз опубликован');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deleteRelease = async function (id) {
  const ok = await confirm('Удалить релиз? Задачи вернутся в статус open.');
  if (!ok) return;
  try {
    await api(`/releases/${id}`, { method: 'DELETE' });
    toast('Релиз удалён');
    loadIssues();
    loadReleases();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// Expose closeModal globally for inline onclick handlers
window.closeModal = closeModal;

// ── Init ───────────────────────────────────────────────

loadAll();
