/**
 * Smoke Tester — headless browser validation of product pages after develop_release.
 *
 * Starts the product's dev server (npm/yarn/docker compose), opens each configured page with Playwright,
 * checks for JS console errors and basic content rendering.
 *
 * Auto-discovery: if smoke_test config is missing or has no pages,
 * scans the project source to find pages and dev server settings.
 *
 * Supports:
 * - npm/yarn dev servers
 * - Docker Compose projects (docker_compose: true in config)
 */

import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { readFile, readdir, access, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * Run smoke tests for a product.
 * @param {Object} opts
 * @param {Object} opts.smokeConfig - product.smoke_test config (can be empty/partial)
 * @param {string} opts.projectPath - absolute path to project directory
 * @param {string} opts.techStack - product tech_stack string
 * @param {Function} opts.log - async (step, message, data?) => void
 * @returns {{ passed: boolean, results: Array, discoveredConfig: Object|null }}
 */
export async function runSmokeTests({ smokeConfig, devPorts, projectPath, techStack, log }) {
  // Auto-discover config if not fully configured
  let config = { ...smokeConfig };
  const dp = devPorts || {};

  // Apply dev_ports from product deploy config (priority over auto-discovery)
  if (!config.url && dp.frontend) {
    config.url = `http://localhost:${dp.frontend}`;
  }
  if (!config.start_command && dp.start_command) {
    config.start_command = dp.start_command;
  }

  // Check if Docker Compose mode is enabled
  const dockerComposeMode = config.docker_compose === true || 
    (config.start_command && config.start_command.includes('docker compose'));

  if (!config.url || !config.pages?.length || (!config.start_command && !dockerComposeMode)) {
    await log('smoke_autodiscover', 'Автообнаружение настроек smoke test...');
    const discovered = await discoverSmokeConfig(projectPath, techStack);

    if (!config.url) config.url = discovered.url;
    if (!config.start_command) config.start_command = discovered.start_command;
    if (!config.pages?.length) config.pages = discovered.pages;
    if (!config.ready_timeout_ms) config.ready_timeout_ms = discovered.ready_timeout_ms;

    // Override discovered port with dev_ports if available
    if (dp.frontend && config.url) {
      try {
        const u = new URL(config.url);
        u.port = String(dp.frontend);
        config.url = u.href;
      } catch { /* keep discovered url */ }
    }
    // Inject --port into start_command if dev_ports specifies a port
    if (dp.frontend && config.start_command && !config.start_command.includes('--port')) {
      config.start_command += ` --port ${dp.frontend}`;
    }

    await log('smoke_autodiscover_done', `Обнаружено: ${config.start_command} → ${config.url}, ${config.pages.length} страниц`, {
      discovered,
      merged: config,
      dev_ports: dp,
    });
  }

  const {
    start_command = 'npm run dev',
    url,
    pages = ['/'],
    ready_timeout_ms = 20000,
    check_timeout_ms = 10000,
    docker_compose = false,
  } = config;

  if (!url) {
    await log('smoke_skip', 'Smoke test пропущен: не удалось определить URL');
    return { passed: true, results: [], discoveredConfig: null };
  }

  await log('smoke_start', `Smoke test: ${pages.length} страниц на ${url}`);

  // 1. Start server (dev server or Docker Compose)
  let serverProcess = null;
  let dockerComposeProject = null;
  
  try {
    if (docker_compose || dockerComposeMode) {
      // Docker Compose mode: start containers
      dockerComposeProject = await startDockerCompose(start_command, projectPath, log);
      await log('smoke_docker_compose_starting', `Запуск Docker Compose: ${projectPath}`);
    } else {
      // Traditional dev server mode
      serverProcess = startDevServer(start_command, projectPath);
      // Save port for cleanup fallback
      try { serverProcess._smokePort = new URL(url).port; } catch { /* ignore */ }
      await log('smoke_server_starting', `Запуск: ${start_command}`);
    }

    // 2. Wait for server to be ready
    const ready = await waitForReady(url, ready_timeout_ms);
    if (!ready) {
      await log('smoke_server_timeout', `Сервер не ответил за ${ready_timeout_ms / 1000}с на ${url}`);
      return {
        passed: false,
        results: [{ page: url, ok: false, errors: [`Сервер не ответил за ${ready_timeout_ms / 1000}с`] }],
        discoveredConfig: config,
      };
    }
    await log('smoke_server_ready', `Сервер готов: ${url}`);

    // 3. Run browser checks
    const results = await checkPages(url, pages, check_timeout_ms, log);

    const allPassed = results.every(r => r.ok);
    const summary = results.map(r =>
      `${r.ok ? '✓' : '✗'} ${r.page}${r.errors.length ? ': ' + r.errors.join('; ') : ''}`
    ).join('\n');

    await log(
      allPassed ? 'smoke_passed' : 'smoke_failed',
      allPassed
        ? `Smoke test пройден: ${results.length} страниц OK`
        : `Smoke test ПРОВАЛЕН:\n${summary}`,
      { results }
    );

    return { passed: allPassed, results, discoveredConfig: config };

  } finally {
    // 4. Cleanup: kill dev server or stop Docker Compose
    if (serverProcess) {
      killProcess(serverProcess);
    }
    if (dockerComposeProject) {
      await stopDockerCompose(dockerComposeProject, log);
    }
  }
}

// ── Auto-discovery ──────────────────────────────────────

/**
 * Scan a project directory to discover dev server settings and pages.
 */
export async function discoverSmokeConfig(projectPath, techStack) {
  const result = {
    start_command: null,
    url: null,
    pages: [],
    ready_timeout_ms: 25000,
  };

  // Detect project structure
  const structure = await detectProjectStructure(projectPath);

  // 1. Discover start_command and port
  const serverInfo = await discoverDevServer(projectPath, structure, techStack);
  result.start_command = serverInfo.command;
  result.url = serverInfo.url;
  result.ready_timeout_ms = serverInfo.ready_timeout_ms;

  // 2. Discover pages
  result.pages = await discoverPages(projectPath, structure);

  // Fallback: at least check root
  if (result.pages.length === 0) {
    result.pages = ['/'];
  }

  return result;
}

/**
 * Detect the project structure type.
 */
async function detectProjectStructure(projectPath) {
  const checks = {
    hasPackageJson: await exists(join(projectPath, 'package.json')),
    hasFrontDir: await exists(join(projectPath, 'front')),
    hasPublicDir: await exists(join(projectPath, 'public')),
    hasSrcDir: await exists(join(projectPath, 'src')),
    hasAppDir: await exists(join(projectPath, 'app')),
    hasNuxtConfig: await exists(join(projectPath, 'nuxt.config.ts')) || await exists(join(projectPath, 'nuxt.config.js')),
    hasViteConfig: await exists(join(projectPath, 'vite.config.ts')) || await exists(join(projectPath, 'vite.config.js')),
    hasDevSh: await exists(join(projectPath, 'dev.sh')),
    // Front subdirectory checks
    frontHasNuxtConfig: await exists(join(projectPath, 'front', 'nuxt.config.ts')) || await exists(join(projectPath, 'front', 'nuxt.config.js')),
    frontHasViteConfig: await exists(join(projectPath, 'front', 'vite.config.ts')) || await exists(join(projectPath, 'front', 'vite.config.js')),
    frontHasPackageJson: await exists(join(projectPath, 'front', 'package.json')),
  };

  let type = 'unknown';
  let frontendRoot = projectPath;

  if (checks.hasFrontDir && (checks.frontHasNuxtConfig || checks.frontHasViteConfig || checks.frontHasPackageJson)) {
    frontendRoot = join(projectPath, 'front');
    type = checks.frontHasNuxtConfig ? 'nuxt-monorepo' : 'vue-monorepo';
  } else if (checks.hasNuxtConfig) {
    type = 'nuxt';
  } else if (checks.hasViteConfig) {
    type = 'vite';
  } else if (checks.hasPublicDir && checks.hasPackageJson) {
    type = 'express-vanilla';
  } else if (checks.hasPackageJson) {
    type = 'node';
  }

  return { type, frontendRoot, ...checks };
}

/**
 * Discover dev server command and port.
 */
async function discoverDevServer(projectPath, structure, techStack) {
  const info = { command: 'npm run dev', url: 'http://localhost:3000', ready_timeout_ms: 25000 };

  // 1. Check dev.sh first (monorepo projects often have this)
  if (structure.hasDevSh) {
    const devSh = await safeReadFile(join(projectPath, 'dev.sh'));
    const portMatch = devSh.match(/--port\s+(\d+)/);
    if (portMatch) {
      const port = portMatch[1];
      info.url = `http://localhost:${port}`;
    }
    // Look for front-specific command
    if (devSh.includes('nuxt dev') || devSh.includes('npx nuxt')) {
      const envVars = extractEnvVars(devSh);
      if (structure.hasFrontDir) {
        info.command = `cd front && ${envVars}npx nuxt dev --port ${portMatch?.[1] || '3000'}`;
      }
    }
  }

  // 2. Check package.json scripts
  const pkgPath = structure.frontendRoot === projectPath
    ? join(projectPath, 'package.json')
    : join(structure.frontendRoot, 'package.json');

  const pkg = await safeReadJson(pkgPath);
  if (pkg?.scripts) {
    // Detect port from dev script
    const devScript = pkg.scripts.dev || pkg.scripts.start || '';
    const portFromScript = devScript.match(/--port\s+(\d+)/) || devScript.match(/PORT[=:]\s*(\d+)/);
    if (portFromScript) {
      info.url = `http://localhost:${portFromScript[1]}`;
    }

    // Build start command
    if (structure.frontendRoot !== projectPath) {
      const relDir = structure.frontendRoot.replace(projectPath + '/', '');
      info.command = `cd ${relDir} && npm run dev`;
    }
  }

  // 3. Detect framework-specific configs for port
  // Nuxt
  const nuxtConfig = await safeReadFile(join(structure.frontendRoot, 'nuxt.config.ts'))
    || await safeReadFile(join(structure.frontendRoot, 'nuxt.config.js'));
  if (nuxtConfig) {
    const portMatch = nuxtConfig.match(/port\s*[:=]\s*(\d+)/);
    if (portMatch) info.url = `http://localhost:${portMatch[1]}`;
    info.ready_timeout_ms = 30000; // Nuxt takes longer to start
  }

  // Vite
  const viteConfig = await safeReadFile(join(structure.frontendRoot, 'vite.config.ts'))
    || await safeReadFile(join(structure.frontendRoot, 'vite.config.js'));
  if (viteConfig) {
    const portMatch = viteConfig.match(/port\s*[:=]\s*(\d+)/);
    if (portMatch) info.url = `http://localhost:${portMatch[1]}`;
  }

  // 4. Tech stack hints
  const stack = (techStack || '').toLowerCase();
  if (stack.includes('express') && !structure.hasFrontDir) {
    // Express with static files — server is the app itself
    const serverPkg = await safeReadJson(join(projectPath, 'package.json'));
    const port = serverPkg?.scripts?.dev?.match(/PORT[=:]\s*(\d+)/)?.[1] || '3000';
    info.url = `http://localhost:${port}`;
  }

  return info;
}

/**
 * Discover pages from project source code.
 */
async function discoverPages(projectPath, structure) {
  const pages = new Set();

  // Always add root
  pages.add('/');

  const frontRoot = structure.frontendRoot;

  // 1. Nuxt: pages/ directory = file-based routing
  const nuxtPagesDir = join(frontRoot, 'app', 'pages');
  const nuxtPagesDirAlt = join(frontRoot, 'pages');
  const pagesDir = await exists(nuxtPagesDir) ? nuxtPagesDir : (await exists(nuxtPagesDirAlt) ? nuxtPagesDirAlt : null);

  if (pagesDir) {
    const vueFiles = await findFiles(pagesDir, '.vue');
    for (const file of vueFiles) {
      const rel = file.replace(pagesDir, '').replace(/\.vue$/, '');
      // Convert Nuxt file naming to routes
      let route = rel
        .replace(/\/index$/, '/') // /pages/index.vue → /
        .replace(/\[([^\]]+)\]/g, ':$1'); // [id] → :id (skip dynamic routes in smoke)

      // Skip dynamic routes — they need parameters
      if (route.includes(':')) continue;

      // Normalize
      if (!route.startsWith('/')) route = '/' + route;
      if (route !== '/' && route.endsWith('/')) route = route.slice(0, -1);

      pages.add(route);
    }
    return [...pages];
  }

  // 2. Vue Router: src/router/index.{js,ts}
  for (const routerPath of [
    join(frontRoot, 'src', 'router', 'index.js'),
    join(frontRoot, 'src', 'router', 'index.ts'),
  ]) {
    const routerContent = await safeReadFile(routerPath);
    if (routerContent) {
      // Match path: '/...' patterns
      const pathMatches = routerContent.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g);
      for (const m of pathMatches) {
        const route = m[1];
        // Skip dynamic routes, catch-all, and nested
        if (route.includes(':') || route.includes('*') || !route.startsWith('/')) continue;
        pages.add(route);
      }
      return [...pages];
    }
  }

  // 3. Static HTML files in public/
  if (structure.hasPublicDir) {
    const htmlFiles = await findFiles(join(projectPath, 'public'), '.html');
    for (const file of htmlFiles) {
      const rel = file.replace(join(projectPath, 'public'), '');
      if (rel === '/index.html') {
        pages.add('/');
      } else {
        pages.add(rel);
      }
    }
    return [...pages];
  }

  // 4. Express routes: look for *.html in project root
  const rootHtmlFiles = await findFilesShallow(projectPath, '.html');
  for (const file of rootHtmlFiles) {
    const name = file.split('/').pop();
    if (name === 'index.html') pages.add('/');
    else pages.add('/' + name);
  }

  return [...pages];
}

// ── Helpers ─────────────────────────────────────────────

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function safeReadFile(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function safeReadJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

function extractEnvVars(devShContent) {
  // Extract NUXT_PUBLIC_* env vars from dev.sh
  const matches = devShContent.matchAll(/(NUXT_PUBLIC_\w+=[^\s\\]+)/g);
  const vars = [...matches].map(m => m[1]);
  return vars.length > 0 ? vars.join(' ') + ' ' : '';
}

async function findFiles(dir, ext) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findFiles(fullPath, ext));
      } else if (extname(entry.name) === ext) {
        results.push(fullPath);
      }
    }
  } catch { /* directory doesn't exist or not readable */ }
  return results;
}

async function findFilesShallow(dir, ext) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && extname(entry.name) === ext) {
        results.push(join(dir, entry.name));
      }
    }
  } catch { /* ignore */ }
  return results;
}

// ── Dev server management ───────────────────────────────

function startDevServer(command, cwd) {
  const proc = spawn('sh', ['-c', command], {
    cwd,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, NODE_ENV: 'development', BROWSER: 'none', CI: 'true' },
  });
  proc.unref();
  return proc;
}

/**
 * Start Docker Compose project.
 * @param {string} command - docker compose command (e.g., 'docker compose up -d')
 * @param {string} cwd - project directory
 * @param {Function} log - logging function
 * @returns {Promise<{cwd: string, projectName: string}>}
 */
async function startDockerCompose(command, cwd, log) {
  try {
    // Extract project directory for docker compose commands
    // Command might be 'docker compose up -d' or full path like 'docker compose -f /path/docker-compose.yml up -d'
    const composeCmd = command || 'docker compose up -d';
    
    await log('smoke_docker_exec', `Выполнение: ${composeCmd}`);
    
    // Run docker compose up -d
    execSync(composeCmd, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env },
    });
    
    // Extract project name for cleanup (use directory name as fallback)
    const projectName = cwd.split('/').pop() || 'kaizen';
    
    return { cwd, projectName };
  } catch (err) {
    await log('smoke_docker_error', `Ошибка запуска Docker Compose: ${err.message}`, {
      command: composeCmd,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Stop Docker Compose project.
 * @param {{cwd: string, projectName: string}} project - project info
 * @param {Function} log - logging function
 */
async function stopDockerCompose(project, log) {
  try {
    await log('smoke_docker_stopping', `Остановка Docker Compose: ${project.cwd}`);
    
    // Stop containers
    execSync('docker compose down', {
      cwd: project.cwd,
      stdio: 'pipe',
      timeout: 30000, // 30 second timeout
    });
    
    await log('smoke_docker_stopped', 'Docker Compose остановлен');
  } catch (err) {
    await log('smoke_docker_stop_error', `Ошибка остановки Docker Compose: ${err.message}`, {
      error: err.message,
    });
    // Non-critical, don't throw
  }
}

function killProcess(proc) {
  const pid = proc.pid;
  if (!pid) return;

  // 1. SIGTERM the process group
  try { process.kill(-pid, 'SIGTERM'); } catch { /* group may not exist */ }
  try { proc.kill('SIGTERM'); } catch { /* already dead */ }

  // 2. SIGKILL after 3s if still alive
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }

    // 3. Find and kill any orphaned children by port (last resort)
    killByPort(proc._smokePort).catch(() => {});
  }, 3000);
}

async function killByPort(port) {
  if (!port) return;
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8', timeout: 3000 }).trim();
    if (output) {
      for (const p of output.split('\n').filter(Boolean)) {
        try { process.kill(parseInt(p), 'SIGKILL'); } catch { /* ignore */ }
      }
    }
  } catch { /* no process on port */ }
}

async function waitForReady(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch { /* not ready yet */ }
    await sleep(1000);
  }
  return false;
}

// ── Browser checks ──────────────────────────────────────

async function checkPages(baseUrl, pages, timeoutMs, log) {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const pagePath of pages) {
      const fullUrl = new URL(pagePath, baseUrl).href;
      const result = await checkSinglePage(browser, fullUrl, timeoutMs);
      results.push(result);
      await log('smoke_page', `${result.ok ? '✓' : '✗'} ${pagePath}`, {
        url: fullUrl,
        errors: result.errors,
        status: result.status,
      });
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function checkSinglePage(browser, url, timeoutMs) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    errors.push(`JS error: ${err.message}`);
  });

  let status = 0;
  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    status = response?.status() || 0;

    if (status >= 400) {
      errors.push(`HTTP ${status}`);
    }

    // Wait a bit for any deferred JS to run
    await page.waitForTimeout(1500);

    // Check page has visible content
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim() || '');
    if (bodyText.length < 10) {
      errors.push('Страница пустая или почти пустая');
    }

  } catch (err) {
    errors.push(`Ошибка загрузки: ${err.message}`);
  } finally {
    await context.close();
  }

  const pagePath = new URL(url).pathname;

  return {
    page: pagePath,
    url,
    status,
    ok: errors.length === 0,
    errors,
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
