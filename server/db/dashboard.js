import { pool } from './pool.js';

export async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      -- Products
      (SELECT count(*) FROM opii.kaizen_products) AS products_total,
      (SELECT count(*) FROM opii.kaizen_products WHERE status = 'active') AS products_active,
      (SELECT count(*) FROM opii.kaizen_products WHERE status = 'archived') AS products_archived,
      -- Issues
      (SELECT count(*) FROM opii.kaizen_issues WHERE status = 'open') AS issues_open,
      (SELECT count(*) FROM opii.kaizen_issues WHERE status = 'in_release') AS issues_in_release,
      (SELECT count(*) FROM opii.kaizen_issues WHERE status = 'done') AS issues_done,
      (SELECT count(*) FROM opii.kaizen_issues WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS issues_created_this_week,
      (SELECT count(*) FROM opii.kaizen_issues WHERE status = 'done' AND updated_at >= CURRENT_DATE - INTERVAL '7 days') AS issues_closed_this_week,
      -- Processes
      (SELECT count(*) FROM opii.kaizen_processes WHERE status = 'running') AS processes_running,
      (SELECT count(*) FROM opii.kaizen_processes WHERE status = 'queued') AS processes_queued,
      (SELECT count(*) FROM opii.kaizen_processes WHERE status = 'completed' AND updated_at >= CURRENT_DATE) AS processes_completed_today,
      (SELECT count(*) FROM opii.kaizen_processes WHERE status = 'failed' AND updated_at >= CURRENT_DATE) AS processes_failed_today,
      (SELECT count(*) FROM opii.kaizen_processes WHERE status = 'completed' AND updated_at >= CURRENT_DATE - INTERVAL '7 days') AS processes_completed_this_week,
      (SELECT coalesce(avg(duration_ms), 0)::int FROM opii.kaizen_processes WHERE status = 'completed' AND updated_at >= CURRENT_DATE - INTERVAL '30 days') AS processes_avg_duration_ms,
      -- Releases
      (SELECT count(*) FROM opii.kaizen_releases WHERE status IN ('draft', 'spec')) AS releases_draft,
      (SELECT count(*) FROM opii.kaizen_releases WHERE status = 'published') AS releases_published,
      (SELECT count(*) FROM opii.kaizen_releases WHERE status = 'developed') AS releases_developed,
      (SELECT count(*) FROM opii.kaizen_releases WHERE status = 'published' AND released_at >= CURRENT_DATE - INTERVAL '7 days') AS releases_this_week,
      (SELECT count(*) FROM opii.kaizen_releases WHERE status = 'published' AND released_at >= CURRENT_DATE - INTERVAL '30 days') AS releases_this_month,
      -- Plans
      (SELECT count(*) FROM opii.kaizen_plans WHERE status IN ('active', 'scheduled')) AS plans_active,
      (SELECT count(*) FROM opii.kaizen_plans WHERE status = 'completed') AS plans_completed,
      (SELECT count(*) FROM opii.kaizen_plans WHERE is_template = true) AS plans_templates,
      -- Automation
      (SELECT count(*) FROM opii.kaizen_products WHERE automation->>'auto_pipeline' IS NOT NULL AND (automation->'auto_pipeline'->>'enabled')::boolean = true) AS auto_pipeline_count,
      (SELECT count(*) FROM opii.kaizen_products WHERE automation->>'rc_auto_sync' IS NOT NULL AND (automation->'rc_auto_sync'->>'enabled')::boolean = true) AS auto_rc_sync_count
  `);

  const stats = rows[0];

  // Success rate (last 30 days)
  const { rows: rateRows } = await pool.query(`
    SELECT
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'failed') AS failed
    FROM opii.kaizen_processes
    WHERE status IN ('completed', 'failed')
      AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
  `);
  const completedCount = parseInt(rateRows[0].completed) || 0;
  const failedCount = parseInt(rateRows[0].failed) || 0;
  const successRate = (completedCount + failedCount) > 0
    ? Math.round((completedCount / (completedCount + failedCount)) * 100) / 100
    : 1;

  // Products by status
  const { rows: byStatus } = await pool.query(`
    SELECT status, count(*)::int AS count
    FROM opii.kaizen_products
    GROUP BY status ORDER BY count DESC
  `);

  // Recent products (last 5)
  const { rows: recentProducts } = await pool.query(`
    SELECT id, name, created_at, status
    FROM opii.kaizen_products
    ORDER BY created_at DESC LIMIT 5
  `);

  // Top-5 most active products
  const { rows: topActive } = await pool.query(`
    SELECT p.id, p.name,
      (SELECT count(*) FROM opii.kaizen_issues i WHERE i.product_id = p.id AND i.status = 'open')::int AS open_issues,
      (SELECT count(*) FROM opii.kaizen_processes pr WHERE pr.product_id = p.id AND pr.status IN ('running', 'queued'))::int AS active_processes,
      (SELECT count(*) FROM opii.kaizen_processes pr WHERE pr.product_id = p.id AND pr.updated_at >= CURRENT_DATE - INTERVAL '7 days')::int AS recent_processes,
      (SELECT count(*) FROM opii.kaizen_releases r WHERE r.product_id = p.id AND r.updated_at >= CURRENT_DATE - INTERVAL '7 days')::int AS recent_releases,
      p.last_pipeline_at
    FROM opii.kaizen_products p
    WHERE p.status = 'active'
    ORDER BY active_processes DESC, recent_processes DESC, recent_releases DESC, open_issues DESC
    LIMIT 5
  `);

  // Issues by type
  const { rows: issuesByType } = await pool.query(`
    SELECT type, count(*)::int AS count
    FROM opii.kaizen_issues
    WHERE type IS NOT NULL
    GROUP BY type ORDER BY count DESC
  `);

  // Issues by priority
  const { rows: issuesByPriority } = await pool.query(`
    SELECT priority, count(*)::int AS count
    FROM opii.kaizen_issues
    WHERE priority IS NOT NULL
    GROUP BY priority ORDER BY count DESC
  `);

  // Processes by type
  const { rows: processesByType } = await pool.query(`
    SELECT type, count(*)::int AS count
    FROM opii.kaizen_processes
    GROUP BY type ORDER BY count DESC
  `);

  // Release velocity (last 8 weeks) — by latest activity (updated_at)
  const { rows: velocity } = await pool.query(`
    SELECT
      date_trunc('week', updated_at)::date AS week,
      count(*)::int AS count,
      count(*) FILTER (WHERE status = 'published')::int AS published,
      count(*) FILTER (WHERE status = 'developed')::int AS developed
    FROM opii.kaizen_releases
    WHERE updated_at >= CURRENT_DATE - INTERVAL '8 weeks'
    GROUP BY 1 ORDER BY 1
  `);

  // Last 5 pipeline runs
  const { rows: lastPipelines } = await pool.query(`
    SELECT p.name AS product_name, p.last_pipeline_at
    FROM opii.kaizen_products p
    WHERE p.last_pipeline_at IS NOT NULL
    ORDER BY p.last_pipeline_at DESC
    LIMIT 5
  `);

  // Recent activity: last 10 completed/failed processes
  const { rows: activity } = await pool.query(`
    SELECT pr.id, pr.type, pr.status, pr.updated_at,
      p.name AS product_name, p.id AS product_id
    FROM opii.kaizen_processes pr
    LEFT JOIN opii.kaizen_products p ON p.id = pr.product_id
    WHERE pr.status IN ('completed', 'failed')
    ORDER BY pr.updated_at DESC
    LIMIT 10
  `);

  return {
    products: {
      total: parseInt(stats.products_total),
      active: parseInt(stats.products_active),
      archived: parseInt(stats.products_archived),
      by_status: byStatus,
      recent: recentProducts,
      top_active: topActive,
    },
    issues: {
      open: parseInt(stats.issues_open),
      in_release: parseInt(stats.issues_in_release),
      done: parseInt(stats.issues_done),
      by_type: issuesByType,
      by_priority: issuesByPriority,
      created_this_week: parseInt(stats.issues_created_this_week),
      closed_this_week: parseInt(stats.issues_closed_this_week),
    },
    processes: {
      running: parseInt(stats.processes_running),
      queued: parseInt(stats.processes_queued),
      completed_today: parseInt(stats.processes_completed_today),
      failed_today: parseInt(stats.processes_failed_today),
      by_type: processesByType,
      avg_duration_ms: parseInt(stats.processes_avg_duration_ms),
      success_rate: successRate,
      completed_this_week: parseInt(stats.processes_completed_this_week),
    },
    releases: {
      draft: parseInt(stats.releases_draft),
      developed: parseInt(stats.releases_developed),
      published: parseInt(stats.releases_published),
      this_week: parseInt(stats.releases_this_week),
      this_month: parseInt(stats.releases_this_month),
      velocity,
    },
    plans: {
      active: parseInt(stats.plans_active),
      completed: parseInt(stats.plans_completed),
      templates: parseInt(stats.plans_templates),
    },
    automation: {
      products_with_pipeline: parseInt(stats.auto_pipeline_count),
      products_with_rc_sync: parseInt(stats.auto_rc_sync_count),
      last_pipeline_runs: lastPipelines,
    },
    recent_activity: activity,
  };
}
