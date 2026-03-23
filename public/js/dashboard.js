import { api, escapeHtml, formatDate } from './app.js';
import { procTypeLabel } from './process-detail.js';

let refreshTimer = null;

async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    renderSummary(d);
    renderDetails(d);
    renderIssuesByProduct(d);

    // Auto-refresh every 30s if there are running processes
    clearInterval(refreshTimer);
    if (d.processes.running > 0 || d.processes.queued > 0) {
      refreshTimer = setInterval(loadDashboard, 30000);
    }
  } catch (err) {
    console.warn('Dashboard load failed:', err.message);
  }
}

function renderSummary(d) {
  const el = document.getElementById('dashSummary');

  const issuesTotal = d.issues.open + d.issues.in_release + d.issues.done;
  const issuePct = (v) => issuesTotal > 0 ? Math.round((v / issuesTotal) * 100) : 0;

  const productsArchived = d.products.archived || 0;

  const successPct = Math.round(d.processes.success_rate * 100);
  const successClass = successPct >= 90 ? 'success-rate-green' : successPct >= 70 ? 'success-rate-yellow' : 'success-rate-red';

  const avgDur = d.processes.avg_duration_ms;
  const avgDurText = avgDur > 60000 ? `${Math.round(avgDur / 60000)} мин` : avgDur > 0 ? `${Math.round(avgDur / 1000)} сек` : '—';

  el.innerHTML = `
    <a href="/products.html" class="widget widget-clickable">
      <div class="widget-title">Продукты</div>
      <div class="widget-numbers">
        <div class="widget-stat">
          <span class="widget-number">${d.products.total}</span>
          <span class="widget-label">всего</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number text-green">${d.products.active}</span>
          <span class="widget-label">активных</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number" style="color:var(--text-dim)">${productsArchived}</span>
          <span class="widget-label">в архиве</span>
        </div>
      </div>
      ${d.products.total > 0 ? `
      <div class="stacked-bar">
        <div class="bar-segment bar-done" style="width:${Math.round(d.products.active / d.products.total * 100)}%" title="Активные: ${d.products.active}"></div>
        <div class="bar-segment" style="width:${Math.round(productsArchived / d.products.total * 100)}%;background:var(--text-dim)" title="Архив: ${productsArchived}"></div>
      </div>` : ''}
    </a>

    <div class="widget">
      <div class="widget-title">Задачи</div>
      <div class="widget-numbers">
        <div class="widget-stat">
          <span class="widget-number">${d.issues.open}</span>
          <span class="widget-label">открытых</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number" style="color:var(--yellow)">${d.issues.in_release}</span>
          <span class="widget-label">в релизах</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number text-green">${d.issues.done}</span>
          <span class="widget-label">готово</span>
        </div>
      </div>
      ${issuesTotal > 0 ? `
      <div class="stacked-bar">
        <div class="bar-segment bar-open" style="width:${issuePct(d.issues.open)}%" title="Открытые: ${d.issues.open}"></div>
        <div class="bar-segment bar-in-release" style="width:${issuePct(d.issues.in_release)}%" title="В релизах: ${d.issues.in_release}"></div>
        <div class="bar-segment bar-done" style="width:${issuePct(d.issues.done)}%" title="Готово: ${d.issues.done}"></div>
      </div>` : ''}
      <div class="widget-week-stats">
        <span>+${d.issues.created_this_week} создано</span>
        <span class="text-green">+${d.issues.closed_this_week} закрыто</span>
        <span>за неделю</span>
      </div>
    </div>

    <a href="/processes.html" class="widget widget-clickable">
      <div class="widget-title">Процессы</div>
      <div class="widget-numbers">
        <div class="widget-stat">
          <span class="widget-number ${d.processes.running > 0 ? 'text-green' : ''}">${d.processes.running}</span>
          <span class="widget-label">запущено</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number">${d.processes.queued}</span>
          <span class="widget-label">в очереди</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number">${d.processes.completed_today}</span>
          <span class="widget-label">сегодня</span>
        </div>
        ${d.processes.failed_today > 0 ? `
        <div class="widget-stat">
          <span class="widget-number text-red">${d.processes.failed_today}</span>
          <span class="widget-label">ошибки</span>
        </div>` : ''}
      </div>
      <div class="widget-week-stats">
        <span class="success-rate ${successClass}">${successPct}% успех</span>
        <span class="duration-badge">${avgDurText} ср.</span>
      </div>
    </a>

    <a href="/products.html" class="widget widget-clickable">
      <div class="widget-title">Релизы</div>
      <div class="widget-numbers">
        <div class="widget-stat">
          <span class="widget-number">${d.releases.draft}</span>
          <span class="widget-label">черновики</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number" style="color:var(--blue)">${d.releases.developed}</span>
          <span class="widget-label">готовы</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number text-green">${d.releases.published}</span>
          <span class="widget-label">опубл.</span>
        </div>
      </div>
      <div class="widget-week-stats">
        <span>${d.releases.this_week} за неделю</span>
        <span>${d.releases.this_month} за месяц</span>
      </div>
    </a>

    <a href="/plans.html" class="widget widget-clickable">
      <div class="widget-title">Планы</div>
      <div class="widget-numbers">
        <div class="widget-stat">
          <span class="widget-number">${d.plans.active}</span>
          <span class="widget-label">активных</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number text-green">${d.plans.completed}</span>
          <span class="widget-label">выполнено</span>
        </div>
        <div class="widget-stat">
          <span class="widget-number" style="color:var(--text-dim)">${d.plans.templates}</span>
          <span class="widget-label">шаблонов</span>
        </div>
      </div>
    </a>
  `;
}

function renderDetails(d) {
  // Top-5 active products
  const topProducts = (d.products.top_active || []).slice(0, 5);
  const maxActivity = Math.max(...topProducts.map(p => (p.recent_processes || 0) + (p.recent_releases || 0)), 1);

  document.getElementById('dashTopProducts').innerHTML = `
    <div class="widget widget-large">
      <div class="widget-title">Продукты — ТОП-5 по активности</div>
      ${topProducts.length ? `<div class="top-products">${topProducts.map(p => {
        const activity = (p.recent_processes || 0) + (p.recent_releases || 0);
        const pct = Math.round((activity / maxActivity) * 100);
        return `
        <a href="product.html?id=${p.id}" class="top-product-card">
          <div class="top-product-header">
            <span class="top-product-name">${escapeHtml(p.name)}</span>
            ${p.active_processes > 0 ? '<span class="top-product-pulse"></span>' : ''}
          </div>
          <div class="top-product-bar">
            <div class="top-product-bar-fill" style="width:${Math.max(pct, 3)}%">
              <div class="top-product-bar-proc" style="width:${activity ? Math.round((p.recent_processes || 0) / activity * 100) : 0}%"></div>
            </div>
          </div>
          <div class="top-product-stats">
            <span title="Процессы за 7 дней">${p.recent_processes || 0} проц.</span>
            <span title="Релизы за 7 дней">${p.recent_releases || 0} рел.</span>
            <span title="Активные / всего задач" ${p.active_issues > 0 ? 'style="color:var(--yellow)"' : ''}>${p.active_issues}/${p.total_issues} задач</span>
          </div>
        </a>`;
      }).join('')}</div>` : '<div class="widget-label">Нет активных продуктов</div>'}
    </div>`;

  // Heatmap
  document.getElementById('dashHeatmap').innerHTML = `
    <div class="widget">
      <div class="widget-title">Релизы по продуктам (7 дней)</div>
      ${renderReleaseHeatmap(d.releases.heatmap || [], d.releases.velocity || [])}
    </div>`;

  // Activity feed
  document.getElementById('dashActivity').innerHTML = `
    <div class="widget">
      <div class="widget-title">Лента активности</div>
      <div class="widget-activity">
        ${renderActivityFeed(d.recent_activity || [])}
      </div>
    </div>`;
}

function renderReleaseHeatmap(heatmap, velocity) {
  // Build last 7 days ending with today
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    days.push(`${yyyy}-${mm}-${dd}`);
  }

  // Build products list and data grid
  const productMap = new Map();
  for (const row of heatmap) {
    if (!productMap.has(row.product_id)) {
      productMap.set(row.product_id, { name: row.product_name, id: row.product_id, cells: {} });
    }
    const rd = new Date(row.day);
    const dayKey = `${rd.getFullYear()}-${String(rd.getMonth()+1).padStart(2,'0')}-${String(rd.getDate()).padStart(2,'0')}`;
    productMap.get(row.product_id).cells[dayKey] = { count: row.count, published: row.published };
  }

  const products = [...productMap.values()];
  if (products.length === 0) {
    return '<div style="font-size:0.85rem;color:var(--text-dim);padding:8px">Нет данных за последние 7 дней</div>';
  }

  const maxCount = Math.max(...heatmap.map(r => r.count), 1);

  const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  // Day headers
  const dayHeaders = days.map(w => {
    const d = new Date(w);
    const dayName = DAY_NAMES[d.getDay()];
    const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `<th class="heatmap-th">${dayName}<br><span style="font-weight:400;opacity:0.7">${dateStr}</span></th>`;
  }).join('');

  // Totals row from velocity
  const totalsRow = days.map(w => {
    const v = velocity.find(vv => { const d = new Date(vv.day); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === w; });
    const count = v?.count || 0;
    return `<td class="heatmap-cell"><span class="heatmap-total">${count || ''}</span></td>`;
  }).join('');

  // Product rows
  const rows = products.map(p => {
    const cells = days.map(w => {
      const cell = p.cells[w];
      if (!cell) return '<td class="heatmap-cell"><span class="heatmap-dot heatmap-dot-0"></span></td>';
      const intensity = Math.min(Math.ceil((cell.count / maxCount) * 4), 4);
      const allPublished = cell.published === cell.count;
      const cls = allPublished ? 'heatmap-dot-pub' : `heatmap-dot-${intensity}`;
      return `<td class="heatmap-cell" title="${cell.count} рел.${cell.published ? `, ${cell.published} опубл.` : ''}"><span class="heatmap-dot ${cls}">${cell.count}</span></td>`;
    }).join('');
    return `<tr>
      <td class="heatmap-product"><a href="product.html?id=${p.id}">${escapeHtml(p.name)}</a></td>
      ${cells}
    </tr>`;
  }).join('');

  return `
    <div class="heatmap-wrap">
      <table class="heatmap-table">
        <thead><tr><th class="heatmap-th"></th>${dayHeaders}</tr></thead>
        <tbody>
          ${rows}
          <tr class="heatmap-totals"><td class="heatmap-product" style="font-weight:600">Итого</td>${totalsRow}</tr>
        </tbody>
      </table>
    </div>`;
}

function renderWeeklyChart(velocity, maxVal) {
  return velocity.map(v => {
    const pct = Math.round((v.count / maxVal) * 100);
    const weekLabel = new Date(v.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `
      <div class="bar-chart-col">
        <div class="bar-chart-value">${v.count}</div>
        <div class="bar-chart-bar">
          <div class="bar-chart-fill" style="height:${Math.max(pct, 4)}%"></div>
        </div>
        <div class="bar-chart-label">${weekLabel}</div>
      </div>`;
  }).join('');
}

function activityResultSummary(a) {
  const r = a.result;
  if (!r) return '';
  if (a.type === 'release_published') {
    const name = r.release_name ? escapeHtml(r.release_name) : '';
    const issues = r.issues_count ? ` · ${r.issues_count} задач` : '';
    return `<span class="activity-result">${name}${issues}</span>`;
  }
  if (a.type === 'improve') {
    const total = Array.isArray(r) ? r.length : 0;
    if (!total) return '';
    const approved = a.approved_count || 0;
    return `<span class="activity-result">${approved > 0 ? `${approved}/${total}` : total} предл.</span>`;
  }
  if (a.type === 'develop_release' && r.branch) {
    const icon = r.tests_passed ? '✓' : '✗';
    return `<span class="activity-result" style="color:${r.tests_passed ? 'var(--green)' : 'var(--red)'}">${icon} ${escapeHtml(r.branch)}</span>`;
  }
  if (a.type === 'prepare_spec' && r.char_count) {
    return `<span class="activity-result">${r.char_count.toLocaleString()} сим.</span>`;
  }
  if (a.type === 'form_release' && r.releases) {
    return `<span class="activity-result">${r.releases.length} рел.${r.auto_approved ? ' (авто)' : ''}</span>`;
  }
  if (a.type === 'roadmap_from_doc' && r.roadmap) {
    return `<span class="activity-result">${r.total_releases || 0} р. / ${r.total_issues || 0} з.</span>`;
  }
  if (a.type === 'prepare_press_release' && r.channels) {
    return `<span class="activity-result">${r.channels.length} кан.</span>`;
  }
  return '';
}

function activityDuration(sec) {
  if (!sec || sec < 2) return '';
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s > 0 ? `${m}м ${s}с` : `${m}м`;
}

function renderActivityFeed(items) {
  items = items.slice(0, 10);
  if (!items.length) return '<div class="widget-label">Нет активности</div>';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const groups = [
    { label: 'Сегодня', items: [] },
    { label: 'Вчера', items: [] },
    { label: 'Ранее', items: [] },
  ];

  for (const a of items) {
    const d = new Date(a.updated_at); d.setHours(0, 0, 0, 0);
    if (d >= today) groups[0].items.push(a);
    else if (d >= yesterday) groups[1].items.push(a);
    else groups[2].items.push(a);
  }

  return groups.filter(g => g.items.length).map(g => `
    <div class="activity-group-label">${g.label}</div>
    ${g.items.map(a => {
      const ok = a.status === 'completed';
      const isRelease = a.type === 'release_published';
      const icon = isRelease ? '🚀' : (ok ? '<span class="activity-ok">✓</span>' : '<span class="activity-err">✗</span>');
      const label = isRelease ? 'Релиз опубликован' : procTypeLabel(a.type);
      const dur = activityDuration(a.duration_sec);
      const result = activityResultSummary(a);
      const href = a.product_id ? `product.html?id=${a.product_id}` : '#';
      return `
      <a href="${href}" class="activity-item activity-item-link">
        <span class="activity-icon">${icon}</span>
        <div class="activity-body">
          <div class="activity-row1">
            <span class="activity-type">${label}</span>
            ${result}
          </div>
          <div class="activity-row2">
            ${a.product_name ? `<span class="activity-product">${escapeHtml(a.product_name)}</span>` : ''}
            <span class="activity-time">${formatDate(a.updated_at)}</span>
            ${dur ? `<span class="activity-dur">${dur}</span>` : ''}
          </div>
        </div>
      </a>`;
    }).join('')}
  `).join('');
}

function renderIssuesByProduct(d) {
  const el = document.getElementById('dashIssues');
  if (!el) return;

  const items = (d.issues.by_product || []);
  const total = d.issues.open || 0;

  if (!items.length) {
    el.innerHTML = `<div class="widget"><div class="widget-title">Задачи по продуктам</div><div class="widget-label">Нет открытых задач</div></div>`;
    return;
  }

  const maxTotal = Math.max(...items.map(p => p.total), 1);

  const rows = items.map(p => {
    const bugPct   = Math.round((p.bugs        / p.total) * 100);
    const impPct   = Math.round((p.improvements / p.total) * 100);
    const featPct  = Math.round((p.features    / p.total) * 100);
    const barWidth = Math.round((p.total / maxTotal) * 100);

    const critBadge = p.critical ? `<span class="ip-badge ip-crit">${p.critical}</span>` : `<span class="ip-badge ip-empty">—</span>`;
    const highBadge = p.high     ? `<span class="ip-badge ip-high">${p.high}</span>`     : `<span class="ip-badge ip-empty">—</span>`;
    const medBadge  = p.medium   ? `<span class="ip-badge ip-med">${p.medium}</span>`    : `<span class="ip-badge ip-empty">—</span>`;
    const lowBadge  = p.low      ? `<span class="ip-badge ip-low">${p.low}</span>`       : `<span class="ip-badge ip-empty">—</span>`;

    const typeParts = [
      p.bugs         ? `<span class="ip-type-dot ip-type-bug"></span>${p.bugs} баг${p.bugs > 1 ? 'а' : ''}` : '',
      p.improvements ? `<span class="ip-type-dot ip-type-imp"></span>${p.improvements} улучш.` : '',
      p.features     ? `<span class="ip-type-dot ip-type-feat"></span>${p.features} фич${p.features > 1 ? 'и' : 'а'}` : '',
    ].filter(Boolean).join(' ');

    return `
    <a href="product.html?id=${p.product_id}#issues" class="ip-row">
      <div class="ip-name">${escapeHtml(p.product_name)}</div>
      <div class="ip-bar-wrap">
        <div class="ip-bar-track">
          <div class="ip-bar" style="width:${barWidth}%">
            <div class="ip-bar-bug"  style="width:${bugPct}%"></div>
            <div class="ip-bar-imp"  style="width:${impPct}%"></div>
            <div class="ip-bar-feat" style="width:${featPct}%"></div>
          </div>
        </div>
        <span class="ip-total">${p.total}</span>
        <span class="ip-types">${typeParts}</span>
      </div>
      <div class="ip-priorities">
        ${critBadge}${highBadge}${medBadge}${lowBadge}
      </div>
    </a>`;
  }).join('');

  el.innerHTML = `
    <div class="widget widget-full">
      <div class="widget-title">Задачи по продуктам <span class="widget-title-count">${total} открытых</span></div>
      <div class="ip-header">
        <span class="ip-col-name"></span>
        <span class="ip-col-bar"></span>
        <span class="ip-col-pri">CRIT</span>
        <span class="ip-col-pri">HIGH</span>
        <span class="ip-col-pri">MED</span>
        <span class="ip-col-pri">LOW</span>
      </div>
      <div class="ip-list">${rows}</div>
    </div>`;
}

function renderHealth(d) {
  const el = document.getElementById('dashHealth');

  // Automation stats
  const pipelineRuns = (d.automation.last_pipeline_runs || []).map(r =>
    `<span class="health-tag">${escapeHtml(r.product_name)} — ${formatDate(r.last_pipeline_at)}</span>`
  ).join('');

  // Processes by type - horizontal bars
  const processByType = d.processes.by_type || [];
  const maxProc = Math.max(...processByType.map(t => t.count), 1);
  const processTypeBars = processByType.map(t => `
    <div class="health-bar-row">
      <span class="health-bar-label">${escapeHtml(t.type)}</span>
      <div class="health-bar-track">
        <div class="health-bar-fill" style="width:${Math.round(t.count / maxProc * 100)}%;background:var(--accent)"></div>
      </div>
      <span class="health-bar-count">${t.count}</span>
    </div>`).join('');

  // Issues by type
  const issueByType = d.issues.by_type || [];
  const maxIssueType = Math.max(...issueByType.map(t => t.count), 1);
  const issueTypeBars = issueByType.map(t => {
    const colors = { bug: 'var(--red)', improvement: 'var(--accent)', feature: 'var(--green)' };
    return `
    <div class="health-bar-row">
      <span class="health-bar-label">${escapeHtml(t.type)}</span>
      <div class="health-bar-track">
        <div class="health-bar-fill" style="width:${Math.round(t.count / maxIssueType * 100)}%;background:${colors[t.type] || 'var(--blue)'}"></div>
      </div>
      <span class="health-bar-count">${t.count}</span>
    </div>`;
  }).join('');

  // Issues by priority
  const issueByPriority = d.issues.by_priority || [];
  const maxIssuePri = Math.max(...issueByPriority.map(t => t.count), 1);
  const issuePriorityBars = issueByPriority.map(t => {
    const colors = { critical: 'var(--red)', high: 'var(--yellow)', medium: 'var(--accent)', low: 'var(--text-dim)' };
    return `
    <div class="health-bar-row">
      <span class="health-bar-label">${escapeHtml(t.priority)}</span>
      <div class="health-bar-track">
        <div class="health-bar-fill" style="width:${Math.round(t.count / maxIssuePri * 100)}%;background:${colors[t.priority] || 'var(--blue)'}"></div>
      </div>
      <span class="health-bar-count">${t.count}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="widget">
      <div class="widget-title">Автоматизация</div>
      <div class="health-stats">
        <div class="health-row">
          <span class="health-metric-label">Pipeline</span>
          <span class="health-metric-value">${d.automation.products_with_pipeline}</span>
        </div>
        <div class="health-row">
          <span class="health-metric-label">RC-sync</span>
          <span class="health-metric-value">${d.automation.products_with_rc_sync}</span>
        </div>
      </div>
      ${pipelineRuns ? `<div style="margin-top:6px" class="health-tags">${pipelineRuns}</div>` : ''}
    </div>

    <div class="widget">
      <div class="widget-title">Процессы по типам</div>
      ${processTypeBars || '<div class="widget-label">Нет данных</div>'}
    </div>

    <div class="widget">
      <div class="widget-title">Задачи</div>
      ${issueTypeBars ? `<div style="margin-bottom:6px">${issueTypeBars}</div>` : ''}
      ${issuePriorityBars || ''}
    </div>
  `;
}

loadDashboard();
