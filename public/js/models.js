import { api, toast, confirm, escapeHtml, openModal, closeModal, restoreFilterFromUrl, syncFilterToUrl } from './app.js';

window.closeModal = closeModal;

let models = [];

// ── Load & Render ────────────────────────────────────────

async function loadModels() {
  const deployment = document.getElementById('filterDeployment').value;
  const params = new URLSearchParams();
  if (deployment) params.set('deployment', deployment);
  const qs = params.toString();
  models = await api(`/ai-models${qs ? '?' + qs : ''}`);
  renderModels();
}

function renderModels() {
  const tbody = document.getElementById('modelsBody');
  const empty = document.getElementById('modelsEmpty');

  if (models.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = models.map(m => `
    <tr>
      <td><strong>${escapeHtml(m.name)}</strong>${m.description ? `<br><span style="font-size:0.8rem;color:var(--text-dim)">${escapeHtml(m.description)}</span>` : ''}</td>
      <td>${escapeHtml(m.provider)}</td>
      <td class="model-id">${escapeHtml(m.model_id)}</td>
      <td>${deploymentBadge(m.deployment)}</td>
      <td>${m.parameters_size || '—'}</td>
      <td>${formatCtx(m.context_length)}</td>
      <td>${statusBadge(m.status)}</td>
      <td>
        <div class="inline-actions">
          ${m.deployment === 'local' ? `<button class="warmup-btn" id="warmup-${m.id}" onclick="window._warmup('${m.id}')">Загрузить</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="window._editModel('${m.id}')">&#9998;</button>
          <button class="btn btn-danger btn-sm" onclick="window._deleteModel('${m.id}')">&#10005;</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function deploymentBadge(d) {
  if (d === 'local') return '<span class="badge badge-local">Local</span>';
  return '<span class="badge badge-cloud">Cloud</span>';
}

function statusBadge(s) {
  const map = {
    loaded: '<span class="badge badge-model-loaded">Loaded</span>',
    unloaded: '<span class="badge badge-model-unloaded">Unloaded</span>',
    unknown: '<span class="badge badge-model-unknown">Unknown</span>',
  };
  return map[s] || `<span class="badge">${escapeHtml(s || 'unknown')}</span>`;
}

function formatCtx(n) {
  if (!n) return '—';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

// ── Discover ─────────────────────────────────────────────

let discoveredModels = []; // flat list: { model_id, name, provider, parameters_size, context_length }

function formatModelName(modelId) {
  // "qwen3-coder:30b" → "Qwen3 Coder 30b"
  return modelId
    .replace(/:/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function toggleDiscoverSection() {
  const deployment = document.getElementById('modelDeployment').value;
  const section = document.getElementById('discoverSection');
  section.style.display = deployment === 'local' ? '' : 'none';
  document.getElementById('apiKeyGroup').style.display = deployment === 'cloud' ? '' : 'none';
}

window._discoverModels = async function () {
  const btn = document.getElementById('discoverBtn');
  const select = document.getElementById('discoverSelect');

  btn.classList.add('loading');
  btn.textContent = 'Поиск...';
  btn.disabled = true;

  try {
    const data = await api('/ai-models/discover');
    discoveredModels = [];

    // Collect ollama models
    if (data.ollama?.models?.length) {
      for (const m of data.ollama.models) {
        discoveredModels.push({
          model_id: m.model_id,
          name: m.name,
          provider: 'ollama',
          parameters_size: m.parameters_size || null,
          context_length: m.context_length || null,
        });
      }
    }

    // Collect mlx models
    if (data.mlx?.models?.length) {
      for (const m of data.mlx.models) {
        discoveredModels.push({
          model_id: m.model_id,
          name: m.name,
          provider: 'mlx',
          parameters_size: m.parameters_size || null,
          context_length: m.context_length || null,
        });
      }
    }

    // Build select options
    select.innerHTML = '<option value="">— Выберите модель —</option>';

    if (discoveredModels.length === 0) {
      select.innerHTML = '<option value="">Модели не найдены</option>';
      select.disabled = true;
      toast('Локальные модели не найдены', 'error');
      return;
    }

    const ollamaModels = discoveredModels.filter(m => m.provider === 'ollama');
    const mlxModels = discoveredModels.filter(m => m.provider === 'mlx');

    if (ollamaModels.length) {
      const group = document.createElement('optgroup');
      group.label = `Ollama (${ollamaModels.length})`;
      for (const m of ollamaModels) {
        const opt = document.createElement('option');
        opt.value = m.model_id + '|ollama';
        opt.textContent = m.model_id + (m.parameters_size ? ` (${m.parameters_size})` : '');
        group.appendChild(opt);
      }
      select.appendChild(group);
    }

    if (mlxModels.length) {
      const group = document.createElement('optgroup');
      group.label = `MLX (${mlxModels.length})`;
      for (const m of mlxModels) {
        const opt = document.createElement('option');
        opt.value = m.model_id + '|mlx';
        opt.textContent = m.model_id;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }

    select.disabled = false;
    toast(`Найдено моделей: ${discoveredModels.length}`);
  } catch (err) {
    toast(`Ошибка обнаружения: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'Обнаружить установленные';
    btn.disabled = false;
  }
};

window._onDiscoverSelect = function (val) {
  if (!val) return;
  const [modelId, provider] = val.split('|');
  const m = discoveredModels.find(x => x.model_id === modelId && x.provider === provider);
  if (!m) return;

  document.getElementById('modelName').value = formatModelName(m.model_id);
  document.getElementById('modelModelId').value = m.model_id;
  document.getElementById('modelProvider').value = m.provider;
  if (m.parameters_size) document.getElementById('modelParamsSize').value = m.parameters_size;
  if (m.context_length) document.getElementById('modelContextLength').value = m.context_length;
};

// ── Modal ────────────────────────────────────────────────

window.showModelModal = function () {
  document.getElementById('modelModalTitle').textContent = 'Новая модель';
  document.getElementById('modelSubmitBtn').textContent = 'Создать';
  document.getElementById('modelEditId').value = '';
  document.getElementById('modelForm').reset();
  document.getElementById('modelApiKey').value = '';
  // Reset discover section
  document.getElementById('discoverSelect').innerHTML = '<option value="">— Выберите модель —</option>';
  document.getElementById('discoverSelect').disabled = true;
  toggleDiscoverSection();
  openModal('modelModal');
};

window._editModel = function (id) {
  const m = models.find(x => x.id === id);
  if (!m) return;
  document.getElementById('modelModalTitle').textContent = 'Редактировать модель';
  document.getElementById('modelSubmitBtn').textContent = 'Сохранить';
  document.getElementById('modelEditId').value = m.id;
  document.getElementById('modelName').value = m.name || '';
  document.getElementById('modelModelId').value = m.model_id || '';
  document.getElementById('modelProvider').value = m.provider || 'ollama';
  document.getElementById('modelDeployment').value = m.deployment || 'local';
  document.getElementById('modelDescription').value = m.description || '';
  document.getElementById('modelParamsSize').value = m.parameters_size || '';
  document.getElementById('modelContextLength').value = m.context_length || '';
  document.getElementById('modelApiKey').value = m.api_key || '';
  // Reset discover section
  document.getElementById('discoverSelect').innerHTML = '<option value="">— Выберите модель —</option>';
  document.getElementById('discoverSelect').disabled = true;
  toggleDiscoverSection();
  openModal('modelModal');
};

window.handleModelSubmit = async function (e) {
  e.preventDefault();
  const editId = document.getElementById('modelEditId').value;
  const data = {
    name: document.getElementById('modelName').value.trim(),
    model_id: document.getElementById('modelModelId').value.trim(),
    provider: document.getElementById('modelProvider').value,
    deployment: document.getElementById('modelDeployment').value,
    description: document.getElementById('modelDescription').value.trim(),
    parameters_size: document.getElementById('modelParamsSize').value.trim() || null,
    context_length: parseInt(document.getElementById('modelContextLength').value) || null,
    api_key: document.getElementById('modelApiKey').value.trim() || null,
  };

  try {
    if (editId) {
      await api(`/ai-models/${editId}`, { method: 'PUT', body: data });
      toast('Модель обновлена');
    } else {
      await api('/ai-models', { method: 'POST', body: data });
      toast('Модель создана');
    }
    closeModal('modelModal');
    await loadModels();
  } catch (err) {
    toast(err.message, 'error');
  }
  return false;
};

window._deleteModel = async function (id) {
  const m = models.find(x => x.id === id);
  if (!m) return;
  const ok = await confirm(`Удалить модель «${m.name}»?`);
  if (!ok) return;
  try {
    await api(`/ai-models/${id}`, { method: 'DELETE' });
    toast('Модель удалена');
    await loadModels();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Warmup ───────────────────────────────────────────────

window._warmup = async function (id) {
  const btn = document.getElementById(`warmup-${id}`);
  if (!btn) return;
  btn.classList.add('loading');
  btn.textContent = 'Загрузка...';
  btn.disabled = true;

  try {
    const result = await api(`/ai-models/${id}/warmup`, { method: 'POST' });
    if (result.status === 'loaded') {
      toast('Модель загружена в GPU');
    } else {
      toast(`Статус: ${result.status}`, 'error');
    }
    await loadModels();
  } catch (err) {
    toast(`Ошибка: ${err.message}`, 'error');
    btn.classList.remove('loading');
    btn.textContent = 'Загрузить';
    btn.disabled = false;
  }
};

// ── Init ─────────────────────────────────────────────────

restoreFilterFromUrl('filterDeployment', 'deployment');
syncFilterToUrl('filterDeployment', 'deployment');
document.getElementById('filterDeployment').addEventListener('change', loadModels);
document.getElementById('modelDeployment').addEventListener('change', toggleDiscoverSection);

// Close modal on overlay click
document.getElementById('modelModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modelModal');
});

loadModels();
