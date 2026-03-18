import { api, escapeHtml, formatDate } from './app.js';

let refreshTimer = null;

async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    renderSummary(d);
    renderDetails(d);
    renderHealth(d);

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
  const el = document.getElementById('dashDetails');

  // Top-5 active products table
  const topRows = (d.products.top_active || []).slice(0, 3).map(p => `
    <tr onclick="location.href='product.html?id=${p.id}'" style="cursor:pointer">
      <td>${escapeHtml(p.name)}</td>
      <td>${p.recent_processes || 0}</td>
      <td>${p.recent_releases || 0}</td>
      <td>${p.open_issues}</td>
    </tr>`).join('');

  // Weekly bar chart
  const velocityData = d.releases.velocity || [];
  const maxVel = Math.max(...velocityData.map(v => v.count), 1);
  const barChart = renderWeeklyChart(velocityData, maxVel);

  // Activity feed
  const activityList = (d.recent_activity || []).slice(0, 5).map(a => `
    <div class="activity-item">
      <span class="badge badge-${a.status === 'completed' ? 'done' : 'failed'}" style="font-size:0.65rem">${a.status === 'completed' ? 'OK' : 'ERR'}</span>
      <span class="activity-type">${escapeHtml(a.type)}</span>
      ${a.product_name ? `<a href="product.html?id=${a.product_id}" class="activity-product" onclick="event.stopPropagation()">${escapeHtml(a.product_name)}</a>` : ''}
      <span class="activity-time">${formatDate(a.updated_at)}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="widget widget-large">
      <div class="widget-title">Продукты — ТОП-5 по активности</div>
      ${topRows ? `
      <div class="mini-table-wrap">
        <table class="mini-table">
          <thead>
            <tr><th>Продукт</th><th>Проц. 7д</th><th>Рел. 7д</th><th>Задачи</th></tr>
          </thead>
          <tbody>${topRows}</tbody>
        </table>
      </div>` : '<div class="widget-label">Нет активных продуктов</div>'}
    </div>

    <div class="widget">
      <div class="widget-title">Динамика релизов (8 недель)</div>
      <div style="height:90px;position:relative">
        <canvas id="velocityChart"></canvas>
      </div>
    </div>

    <div class="widget">
      <div class="widget-title">Лента активности</div>
      <div class="widget-activity">
        ${activityList || '<div class="widget-label">Нет активности</div>'}
      </div>
    </div>
  `;

  // Render Chart.js velocity chart
  if (typeof Chart !== 'undefined' && velocityData.length > 0) {
    requestAnimationFrame(() => {
      const ctx = document.getElementById('velocityChart');
      if (!ctx) return;
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: velocityData.map(v => new Date(v.week).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })),
          datasets: [
            {
              label: 'Опубликовано',
              data: velocityData.map(v => v.published || 0),
              backgroundColor: 'rgba(52,211,153,0.6)',
              borderRadius: 4,
            },
            {
              label: 'Готовы',
              data: velocityData.map(v => v.developed || 0),
              backgroundColor: 'rgba(96,165,250,0.6)',
              borderRadius: 4,
            },
            {
              label: 'Прочие',
              data: velocityData.map(v => (v.count || 0) - (v.published || 0) - (v.developed || 0)),
              backgroundColor: 'rgba(136,144,164,0.4)',
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { color: '#8890a4', boxWidth: 10, font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, stacked: true, ticks: { color: '#8890a4', stepSize: 1 }, grid: { color: '#2e313d' } },
            x: { stacked: true, ticks: { color: '#8890a4' }, grid: { display: false } },
          },
        },
      });
    });
  }
}

function renderWeeklyChart(velocity, maxVal) {
  return velocity.map(v => {
    const pct = Math.round((v.count / maxVal) * 100);
    const weekLabel = new Date(v.week).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
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
