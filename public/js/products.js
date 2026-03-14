import { api, toast, confirm, escapeHtml, openModal, closeModal } from './app.js';

let products = [];

function sortProducts() {
  const sort = document.getElementById('sortProducts').value;
  products.sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name, 'ru');
      case 'issues': return (parseInt(b.open_issues) || 0) - (parseInt(a.open_issues) || 0);
      case 'activity': return (parseInt(b.active_processes) || 0) - (parseInt(a.active_processes) || 0);
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });
}

function syncSortToUrl() {
  const url = new URL(location.href);
  const sort = document.getElementById('sortProducts').value;
  if (sort && sort !== 'date') url.searchParams.set('sort', sort);
  else url.searchParams.delete('sort');
  history.replaceState(null, '', url);
}

function restoreSortFromUrl() {
  const sort = new URLSearchParams(location.search).get('sort');
  if (sort) document.getElementById('sortProducts').value = sort;
}

async function loadProducts() {
  try {
    products = await api('/products');
    sortProducts();
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

restoreSortFromUrl();
document.getElementById('sortProducts').addEventListener('change', () => {
  syncSortToUrl();
  sortProducts();
  render();
});

function render() {
  const el = document.getElementById('productsList');
  if (products.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">改</div>
        <p>Нет продуктов</p>
        <p style="margin-top:8px;font-size:0.85rem">Создайте первый продукт, чтобы начать</p>
      </div>`;
    return;
  }

  el.innerHTML = products.map(p => {
    const total = parseInt(p.total_issues) || 0;
    const done = parseInt(p.done_issues) || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const active = parseInt(p.active_processes) || 0;
    const rels = parseInt(p.releases_count) || 0;

    return `
    <div class="card" onclick="location.href='product.html?id=${p.id}'">
      <div class="card-header">
        <div class="card-title">${escapeHtml(p.name)}</div>
        ${active > 0 ? `<span class="card-active-badge">${active} процесс${active > 1 ? (active < 5 ? 'а' : 'ов') : ''}</span>` : ''}
      </div>
      ${p.description ? `<div class="card-desc">${escapeHtml(p.description)}</div>` : ''}
      ${total > 0 ? `
      <div class="card-progress-row">
        <div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>
        <span class="card-progress-text">${done}/${total} задач</span>
      </div>` : ''}
      <div class="card-meta">
        ${p.tech_stack ? `<span>${escapeHtml(p.tech_stack)}</span>` : ''}
        ${p.owner ? `<span>${escapeHtml(p.owner)}</span>` : ''}
        <span>${p.open_issues || 0} открытых</span>
        ${rels > 0 ? `<span>${rels} релиз${rels > 1 ? (rels < 5 ? 'а' : 'ов') : ''}</span>` : ''}
        <span class="badge badge-${p.status}">${p.status}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); location.href='product.html?id=${p.id}&action=improve'">Improve</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); location.href='product.html?id=${p.id}&action=add_issue'">+ Задача</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); showEditModal('${p.id}')">Редактировать</button>
        ${p.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); archiveProduct('${p.id}')">Архив</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); activateProduct('${p.id}')">Активировать</button>`}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteProduct('${p.id}')">Удалить</button>
      </div>
    </div>`;
  }).join('');
}

window.showCreateModal = function () {
  document.getElementById('productModalTitle').textContent = 'Новый продукт';
  document.getElementById('productId').value = '';
  document.getElementById('productForm').reset();
  openModal('productModal');
};

window.showEditModal = function (id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('productModalTitle').textContent = 'Редактировать продукт';
  document.getElementById('productId').value = p.id;
  document.getElementById('productName').value = p.name;
  document.getElementById('productDesc').value = p.description || '';
  document.getElementById('productRepo').value = p.repo_url || '';
  document.getElementById('productStack').value = p.tech_stack || '';
  document.getElementById('productOwner').value = p.owner || '';
  document.getElementById('productPath').value = p.project_path || '';
  document.getElementById('productRcSystemId').value = p.rc_system_id || '';
  document.getElementById('productRcModuleId').value = p.rc_module_id || '';
  openModal('productModal');
};

window.closeProductModal = function () {
  closeModal('productModal');
};

window.handleProductSubmit = async function (e) {
  e.preventDefault();
  const id = document.getElementById('productId').value;
  const body = {
    name: document.getElementById('productName').value,
    description: document.getElementById('productDesc').value,
    repo_url: document.getElementById('productRepo').value,
    tech_stack: document.getElementById('productStack').value,
    owner: document.getElementById('productOwner').value,
    project_path: document.getElementById('productPath').value,
    rc_system_id: parseInt(document.getElementById('productRcSystemId').value) || null,
    rc_module_id: parseInt(document.getElementById('productRcModuleId').value) || null,
  };

  try {
    if (id) {
      await api(`/products/${id}`, { method: 'PUT', body });
      toast('Продукт обновлён');
    } else {
      await api('/products', { method: 'POST', body });
      toast('Продукт создан');
    }
    closeProductModal();
    loadProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window.archiveProduct = async function (id) {
  try {
    await api(`/products/${id}`, { method: 'PUT', body: { status: 'archived' } });
    toast('Продукт архивирован');
    loadProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.activateProduct = async function (id) {
  try {
    await api(`/products/${id}`, { method: 'PUT', body: { status: 'active' } });
    toast('Продукт активирован');
    loadProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.deleteProduct = async function (id) {
  const ok = await confirm('Удалить продукт? Все задачи и релизы будут удалены.');
  if (!ok) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    toast('Продукт удалён');
    loadProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
};

loadProducts();
