import * as processes from './db/processes.js';
import * as processLogs from './db/process-logs.js';
import * as products from './db/products.js';
import * as releases from './db/releases.js';
import * as issues from './db/issues.js';
import * as aiModels from './db/ai-models.js';
import { callAI, callClaudeCodeStreaming } from './ai-caller.js';
import { parseJsonFromAI, detectTestCommand, detectBuildCommand, validateBranchName } from './utils.js';
import { collectProjectContext } from './context-collector.js';
import { notify, getNotifyOpts } from './notifier.js';
import { pushToGitlab, pushToDefaultBranch, waitForPipeline, getPipelineStatus } from './gitlab-client.js';
import { runSmokeTests } from './smoke-tester.js';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

/**
 * Generate context_files prompt section from product automation config.
 */
function getContextFilesPrompt(product) {
  const files = product.automation?.context_files;
  if (!files || !Array.isArray(files) || files.length === 0) return '';
  return `\n  ОБЯЗАТЕЛЬНО прочитай следующие ключевые файлы проекта:\n${files.map(f =>
    `  - ${f.path}${f.description ? ` — ${f.description}` : ''}`
  ).join('\n')}`;
}

/**
 * Generate critical_paths prompt section from product automation config.
 */
function getCriticalPathsPrompt(product) {
  const paths = product.automation?.critical_paths;
  if (!paths || !Array.isArray(paths) || paths.length === 0) return '';
  return `\n  КРИТИЧНЫЕ МОДУЛИ (НЕ ЛОМАЙ! Изменяй осторожно, проверяй после каждого изменения):\n${paths.map(p =>
    `  - ${p.path}${p.description ? ` — ${p.description}` : ''}`
  ).join('\n')}`;
}

/**
 * Watchdog wrapper — guarantees a Promise settles within timeoutMs.
 * If the inner promise hangs (callAI timeout doesn't fire), this rejects.
 */
function withWatchdog(promise, timeoutMs, label = 'AI call') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Watchdog: ${label} не завершился за ${Math.round(timeoutMs / 1000)}с`));
    }, timeoutMs);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Git fallback: extract develop_release results from git when JSON parsing fails.
 * Checks if the branch has commits and extracts commit hash, file count, etc.
 */
async function gitFallback(branchName, cwd, processId) {
  const fallback = {
    branch: branchName,
    commit_hash: null,
    tests_passed: false,
    summary: 'Не удалось распарсить итоговый JSON',
    git_fallback: true,
  };
  try {
    // Check if branch exists and get latest commit
    const { stdout: hash } = await execFileAsync('git', ['rev-parse', branchName], { cwd, timeout: 10_000 });
    fallback.commit_hash = hash.trim() || null;

    if (fallback.commit_hash) {
      // Count changed files vs parent branch
      try {
        const { stdout: diff } = await execFileAsync('git', ['diff', '--stat', `${branchName}~1`, branchName], { cwd, timeout: 10_000 });
        const lines = diff.trim().split('\n');
        const lastLine = lines[lines.length - 1] || '';
        const filesMatch = lastLine.match(/(\d+)\s+files?\s+changed/);
        if (filesMatch) fallback.files_changed = parseInt(filesMatch[1], 10);
      } catch {}

      // Get commit message as summary
      try {
        const { stdout: msg } = await execFileAsync('git', ['log', '-1', '--format=%s', branchName], { cwd, timeout: 10_000 });
        if (msg.trim()) fallback.summary = msg.trim();
      } catch {}

      fallback.tests_passed = true; // branch exists with commit → assume success
    }

    await processLogs.create({
      process_id: processId,
      step: 'git_fallback',
      message: `JSON не распарсен, результат получен из git: коммит ${fallback.commit_hash || '—'}, файлов: ${fallback.files_changed || '?'}`,
      data: fallback,
    });
  } catch {
    // Branch doesn't exist — no fallback possible
  }
  return fallback;
}

/**
 * Run tests: merge develop_release branches (from plan depends_on) and run test command.
 * No AI model required — just shell commands.
 */
async function runTests(processId, proc, product, startTime, timeoutMs) {
  const cwd = product.project_path;
  if (!cwd) throw new Error('Product has no project_path configured');

  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}

  const testCommand = config.test_command || detectTestCommand(product.tech_stack);

  // 1. Collect branches from plan step dependencies
  let branches = [];
  if (proc.plan_step_id) {
    const planSteps = await import('./db/plan-steps.js');
    const step = await planSteps.getById(proc.plan_step_id);
    if (step?.depends_on?.length) {
      const allSteps = await planSteps.getByPlan(step.plan_id);
      for (const depId of step.depends_on) {
        const depStep = allSteps.find(s => s.id === depId);
        if (depStep?.process_id && depStep.process_type === 'develop_release') {
          const depProc = await processes.getById(depStep.process_id);
          if (depProc?.result?.branch) {
            branches.push(depProc.result.branch);
          }
        }
      }
    }
  }

  // Also accept explicit branches from config
  if (config.branches?.length) branches = config.branches;

  await processLogs.create({
    process_id: processId,
    step: 'test_started',
    message: `Тестирование продукта. Команда: ${testCommand}. Веток для мержа: ${branches.length}`,
    data: { test_command: testCommand, cwd, branches },
  });

  // 2. Create integration branch and merge release branches
  let integrationBranch = null;
  if (branches.length > 0) {
    integrationBranch = `kaizen/integration-${processId.slice(0, 8)}`;

    try {
      // Ensure clean state on main
      await execFileAsync('git', ['checkout', 'main'], { cwd, timeout: 15_000 });
      await execFileAsync('git', ['pull', '--ff-only'], { cwd, timeout: 30_000 }).catch(() => {});

      // Create integration branch
      await execFileAsync('git', ['checkout', '-b', integrationBranch], { cwd, timeout: 10_000 });

      // Merge each release branch sequentially
      for (const branch of branches) {
        await processLogs.create({
          process_id: processId,
          step: 'merging_branch',
          message: `Мерж ветки: ${branch}`,
          data: { branch },
        });

        try {
          await execFileAsync('git', ['merge', branch, '--no-edit'], { cwd, timeout: 30_000 });
        } catch (mergeErr) {
          // Merge conflict — abort and report
          await execFileAsync('git', ['merge', '--abort'], { cwd, timeout: 10_000 }).catch(() => {});

          const error = `Конфликт при мерже ветки ${branch}: ${mergeErr.message}`;
          await processLogs.create({
            process_id: processId,
            step: 'merge_conflict',
            message: error,
            data: { branch, error: mergeErr.message },
          });

          // Cleanup: go back to main, delete integration branch
          await execFileAsync('git', ['checkout', 'main'], { cwd, timeout: 10_000 }).catch(() => {});
          await execFileAsync('git', ['branch', '-D', integrationBranch], { cwd, timeout: 10_000 }).catch(() => {});

          const durationMs = Date.now() - startTime;
          await processes.update(processId, {
            status: 'failed',
            result: { branches, failed_branch: branch, integration_branch: integrationBranch },
            error,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
          });
          return;
        }
      }

      await processLogs.create({
        process_id: processId,
        step: 'merge_complete',
        message: `Все ${branches.length} веток смержены в ${integrationBranch}`,
        data: { integration_branch: integrationBranch, branches },
      });
    } catch (gitErr) {
      throw new Error(`Git error during merge setup: ${gitErr.message}`);
    }
  }

  // 3. Run tests
  await processLogs.create({
    process_id: processId,
    step: 'running_tests',
    message: `Запуск: ${testCommand}`,
  });

  let stdout = '', stderr = '', exitCode = 0;
  const cmdTimeoutMs = Math.min(timeoutMs - 5000, 10 * 60 * 1000);

  try {
    const result = await execFileAsync('sh', ['-c', testCommand], {
      cwd,
      timeout: cmdTimeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, CI: 'true', NODE_ENV: 'test' },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    exitCode = err.code ?? 1;
  }

  // 4. Parse results
  const output = (stdout + '\n' + stderr).trim();
  const lastChars = output.slice(-3000);

  // Try to extract test counts from common test runner outputs
  const totalMatch = output.match(/(\d+)\s+(?:tests?|specs?|suites?)/i);
  const failMatch = output.match(/(\d+)\s+fail/i);
  const passMatch = output.match(/(\d+)\s+pass/i);

  const testsTotal = totalMatch ? parseInt(totalMatch[1]) : null;
  const testsFailed = failMatch ? parseInt(failMatch[1]) : null;
  const testsPassed = exitCode === 0;

  await processLogs.create({
    process_id: processId,
    step: 'test_result',
    message: testsPassed
      ? `Тесты пройдены (exit code 0)${testsTotal ? `, всего: ${testsTotal}` : ''}`
      : `Тесты провалены (exit code ${exitCode})${testsFailed ? `, ошибок: ${testsFailed}` : ''}`,
    data: { tests_passed: testsPassed, exit_code: exitCode, tests_total: testsTotal, tests_failed: testsFailed, output: lastChars },
  });

  // 5. Build result
  const resultObj = {
    tests_passed: testsPassed,
    test_command: testCommand,
    exit_code: exitCode,
    tests_total: testsTotal,
    tests_failed: testsFailed,
    tests_pass_count: passMatch ? parseInt(passMatch[1]) : null,
    test_output: lastChars,
    branches,
    integration_branch: integrationBranch,
  };

  // 6. Cleanup on failure: go back to main, delete integration branch
  if (!testsPassed && integrationBranch) {
    await execFileAsync('git', ['checkout', 'main'], { cwd, timeout: 10_000 }).catch(() => {});
    await execFileAsync('git', ['branch', '-D', integrationBranch], { cwd, timeout: 10_000 }).catch(() => {});
    resultObj.integration_branch = null;
  }

  // 7. Complete
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: testsPassed ? 'completed' : 'failed',
    result: resultObj,
    error: testsPassed ? null : `Tests failed (exit code ${exitCode})`,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

const IMPROVE_TEMPLATES = {
  general: 'Проанализируй продукт и предложи общие улучшения: UX, функциональность, стабильность, масштабируемость.',
  ui: 'Предложи улучшения пользовательского интерфейса: удобство навигации, визуальный дизайн, адаптивность, доступность.',
  performance: 'Предложи улучшения производительности: оптимизация загрузки, кэширование, уменьшение задержек, эффективность запросов.',
  security: 'Проанализируй потенциальные уязвимости и предложи улучшения безопасности: аутентификация, авторизация, защита данных, OWASP.',
  competitors: 'Представь, что ты аналитик. Какие функции есть у конкурентов, но отсутствуют в этом продукте? Предложи задачи для конкурентного паритета.',
  dx: 'Предложи улучшения для разработчиков: документация, CI/CD, тестирование, линтинг, структура кода, DX.',
};

/**
 * Run a process in the background (fire-and-forget).
 * @param {string} processId
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Timeout in ms (default 20 min)
 */
export async function runProcess(processId, options = {}) {
  const timeoutMs = options.timeoutMs || 20 * 60 * 1000;
  const startTime = Date.now();
  let proc = null;

  try {
    // 1. Update status → running
    await processes.update(processId, { status: 'running', started_at: new Date().toISOString() });

    // 2. Load process + product + model
    proc = await processes.getById(processId);
    if (!proc) throw new Error('Process not found');

    const product = await products.getById(proc.product_id);
    if (!product) throw new Error('Product not found');

    // Dispatch local processes before loading model (no model required)
    if (proc.type === 'run_tests') {
      await runTests(processId, proc, product, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'deploy') {
      await runDeploy(processId, proc, product, startTime, timeoutMs);
      return;
    }

    const model = await aiModels.getById(proc.model_id);
    if (!model) throw new Error('Model not found');

    if (model.deployment === 'cloud' && model.provider !== 'claude-code' && !model.api_key) {
      throw new Error('API key required for cloud model');
    }

    // Dispatch by process type
    if (proc.type === 'prepare_spec') {
      await runPrepareSpec(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'roadmap_from_doc') {
      await runRoadmapFromDoc(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'develop_release') {
      await runDevelopRelease(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'prepare_press_release') {
      await runPreparePressRelease(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'form_release') {
      await runFormRelease(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    if (proc.type === 'update_docs') {
      await runUpdateDocs(processId, proc, product, model, startTime, timeoutMs);
      return;
    }
    const taskCount = Math.min(Math.max(parseInt(proc.input_count) || 5, 1), 10);

    // 3. Build prompts
    const isClaudeCode = model.provider === 'claude-code';
    const hasProjectPath = !!product.project_path;
    const useInteractiveTools = isClaudeCode && hasProjectPath;
    const useCollectedContext = !isClaudeCode && hasProjectPath;

    // Collect project context for non-claude-code providers
    let fileContext = '';
    let contextStats = null;
    if (useCollectedContext) {
      try {
        const contextLength = model.context_length || 8192;
        const maxTokens = Math.max(Math.floor(contextLength * 0.4), 1000);
        const result = await collectProjectContext(product.project_path, {
          maxTokens,
          techStack: product.tech_stack,
        });
        fileContext = result.context;
        contextStats = result.stats;
      } catch (err) {
        await processLogs.create({
          process_id: processId,
          step: 'context_warning',
          message: `Не удалось собрать контекст: ${err.message}`,
        });
      }
    }

    const systemPrompt = `Ты — эксперт по улучшению программных продуктов. Анализируй продукт и генерируй конкретные, реализуемые задачи.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${!hasProjectPath && product.repo_url ? `Репозиторий: ${product.repo_url}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}
${useInteractiveTools ? `\nПроект находится в текущей директории. Начни с чтения CLAUDE.md и файлов из docs/ — там контекст проекта, архитектура, API, схема БД, бизнес-логика. Затем используй инструменты Read, Glob, Grep чтобы изучить код и структуру файлов. Основывай предложения на реальном коде и документации проекта.` : ''}
${fileContext ? `\nНиже приведён контекст проекта (файлы, документация, структура). Используй его для анализа и генерации предложений на основе реального кода.\n\n${fileContext}` : ''}

ВАЖНО: Верни ответ ТОЛЬКО как JSON-массив из ${taskCount} задач. Никакого текста, рассуждений или тегов до или после JSON. Не используй <think> блоки.
Формат каждой задачи:
{
  "title": "Краткое название задачи",
  "description": "Подробное описание что нужно сделать и зачем",
  "type": "improvement | bug | feature",
  "priority": "critical | high | medium | low"
}`;

    const userPrompt = proc.input_prompt || IMPROVE_TEMPLATES[proc.input_template_id] || IMPROVE_TEMPLATES.general;

    // 4. Log: request_sent
    const logData = {
      model_name: model.name,
      provider: model.provider,
      system_prompt_length: systemPrompt.length,
      user_prompt_length: userPrompt.length,
      cwd: useInteractiveTools ? product.project_path : null,
    };
    if (contextStats) {
      logData.context_stats = contextStats;
    }

    let logMsg = `Запрос отправлен модели ${model.name}`;
    if (useInteractiveTools) logMsg += ` (cwd: ${product.project_path})`;
    if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

    await processLogs.create({
      process_id: processId,
      step: 'request_sent',
      message: logMsg,
      data: logData,
    });

    // 5. Call AI (with watchdog safety net)
    const aiOptions = {};
    if (useInteractiveTools) aiOptions.cwd = product.project_path;
    if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
    const watchdogMs = timeoutMs + 60_000; // +60s grace for normal timeout to fire first
    const rawResponse = await withWatchdog(
      callAI(model, systemPrompt, userPrompt, aiOptions),
      watchdogMs,
      `improve/${model.name}`,
    );

    // 6. Log: response_received
    await processLogs.create({
      process_id: processId,
      step: 'response_received',
      message: `Ответ получен (${rawResponse.length} символов)`,
      data: { response_length: rawResponse.length },
    });

    // 7. Parse JSON
    const parsed = parseJsonFromAI(rawResponse);
    if (!parsed) {
      await processLogs.create({
        process_id: processId,
        step: 'error',
        message: 'Не удалось распарсить JSON из ответа модели',
        data: { raw_response: rawResponse.slice(0, 2000) },
      });
      throw new Error('Failed to parse AI response as JSON');
    }

    // 8. Log: parse_result
    await processLogs.create({
      process_id: processId,
      step: 'parse_result',
      message: `JSON распарсен: ${parsed.length} элементов`,
      data: { count: parsed.length },
    });

    // 9. Validate and normalize
    const validTypes = ['improvement', 'bug', 'feature'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    const suggestions = parsed.slice(0, taskCount).map(s => ({
      title: String(s.title || '').slice(0, 200),
      description: String(s.description || ''),
      type: validTypes.includes(s.type) ? s.type : 'improvement',
      priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
    })).filter(s => s.title.length > 0);

    // 10. Log: issues_ready
    await processLogs.create({
      process_id: processId,
      step: 'issues_ready',
      message: `Подготовлено предложений: ${suggestions.length}`,
      data: { count: suggestions.length },
    });

    // 11. Update process → completed
    const durationMs = Date.now() - startTime;
    await processes.update(processId, {
      status: 'completed',
      result: suggestions,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    });

  } catch (err) {
    // 12. Error handling
    const durationMs = Date.now() - startTime;
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: err.message,
      data: { stack: err.stack },
    }).catch(() => {});

    await processes.update(processId, {
      status: 'failed',
      error: err.message,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).catch(() => {});

    // Reset dev_status on failure for develop_release processes
    if (proc?.type === 'develop_release' && proc?.release_id) {
      await releases.updateDevInfo(proc.release_id, { dev_status: 'failed' }).catch(() => {});
      // Notify: develop failed
      if (product) {
        notify('develop_failed', {
          product: product.name,
          version: proc.release_id,
          error: err.message,
        }, getNotifyOpts(product)).catch(() => {});
      }
    }

    console.error(`Process ${processId} failed:`, err.message);

    // Auto-retry: if retryable error and retries left, create a retry copy
    const retryInfo = parseRetryInfo(proc);
    if (proc && shouldAutoRetry(proc, retryInfo, err)) {
      try {
        const retryCount = (retryInfo.retry_count || 0) + 1;
        const delayMs = Math.min(retryCount * 30_000, 120_000); // 30s, 60s, 120s
        console.log(`Auto-retry: process ${processId} (attempt ${retryCount}), delay ${delayMs / 1000}s`);

        await processLogs.create({
          process_id: processId,
          step: 'auto_retry',
          message: `Автоматический перезапуск (попытка ${retryCount}/${MAX_RETRIES}) через ${delayMs / 1000}с`,
          data: { retry_count: retryCount, delay_ms: delayMs, error: err.message },
        });

        setTimeout(async () => {
          try {
            const newProc = await processes.create({
              product_id: proc.product_id,
              type: proc.type,
              model_id: proc.model_id,
              release_id: proc.release_id,
              input_prompt: proc.input_prompt,
              input_template_id: proc.input_template_id,
              input_count: proc.input_count,
              plan_step_id: proc.plan_step_id,
              config: { ...proc.config, retry_count: retryCount, retry_of: processId },
            });
            // Enqueue via import to avoid circular dependency
            const { QueueManager } = await import('./queue-manager.js');
            QueueManager.instance?.enqueue(newProc.id, proc.model_id, options.timeoutMs);
          } catch (retryErr) {
            console.error(`Auto-retry create failed for ${processId}:`, retryErr.message);
          }
        }, delayMs);
      } catch (retryErr) {
        console.error(`Auto-retry setup failed for ${processId}:`, retryErr.message);
      }
    }
  }
}

const MAX_RETRIES = 2;

function parseRetryInfo(proc) {
  if (!proc) return {};
  try {
    const parsed = JSON.parse(proc.input_prompt);
    if (parsed && typeof parsed === 'object' && 'retry_count' in parsed) return parsed;
  } catch { /* not retry JSON */ }
  return {};
}

function shouldAutoRetry(proc, retryInfo, err) {
  const retryCount = retryInfo.retry_count || 0;
  if (retryCount >= MAX_RETRIES) return false;

  // Don't retry local processes (run_tests, update_docs, deploy) — they have deterministic errors
  if (['run_tests', 'update_docs', 'deploy'].includes(proc.type)) return false;

  // Retry on timeout, network, or AI provider errors
  const msg = (err.message || '').toLowerCase();
  const retryablePatterns = ['timeout', 'econnrefused', 'econnreset', 'socket hang up', 'rate limit', '429', '503', '502', 'overloaded'];
  return retryablePatterns.some(p => msg.includes(p));
}

/**
 * Run a prepare_spec process — generate AI release specification.
 */
async function runPrepareSpec(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (!release.issues || release.issues.length === 0) throw new Error('Release has no issues');

  // Load last 3 published releases for context
  const publishedReleases = await releases.getPublishedByProduct(product.id, 3);

  // 2. Determine mode (same pattern as improve)
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;

  // 3. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.4), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 4. Build system prompt
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  let systemPrompt = `Ты — опытный техлид и архитектор. Твоя задача — подготовить подробную спецификацию разработки для релиза программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПроект находится в текущей директории. Начни с чтения CLAUDE.md и файлов из docs/ — там контекст проекта, архитектура, API, схема БД, бизнес-логика. Затем используй инструменты Read, Glob, Grep чтобы изучить код и структуру файлов. Основывай спецификацию на реальном коде и документации проекта.`;
    systemPrompt += getContextFilesPrompt(product);
    systemPrompt += getCriticalPathsPrompt(product);
    systemPrompt += `\n\nКРИТИЧНО: Для каждой задачи, затрагивающей БД, укажи ТОЧНЫЕ имена таблиц и колонок из CLAUDE.md или docs/DATABASE_SCHEMA.md. Не придумывай — копируй из документации. Укажи существующие SQL-запросы или модели, которые уже работают с этими таблицами.`;
  }

  if (fileContext) {
    systemPrompt += `\n\nНиже приведён контекст проекта (файлы, документация, структура). Используй его для написания спецификации на основе реального кода.\n\n${fileContext}`;
  }

  systemPrompt += `\n\nВАЖНО: Верни ТОЛЬКО текст спецификации в формате Markdown. Никаких обёрток, тегов, JSON или рассуждений. Не используй <think> блоки.`;

  // 5. Build user prompt
  const issuesList = release.issues.map((iss, i) =>
    `${i + 1}. **${iss.title}** (${iss.type}, ${iss.priority})${iss.description ? `\n   ${iss.description}` : ''}`
  ).join('\n');

  let historySection = '';
  if (publishedReleases.length > 0) {
    historySection = `\n\n## История последних релизов\n\n` + publishedReleases.map(r => {
      const rIssues = (r.issues || []).map(i => `  - ${i.title} (${i.type})`).join('\n');
      return `### ${r.version} — ${r.name}\n${rIssues}`;
    }).join('\n\n');
  }

  const userPrompt = `Подготовь спецификацию разработки для релиза.

## Релиз: ${release.version} — ${release.name}
${release.description ? `\nОписание: ${release.description}` : ''}

## Задачи релиза

${issuesList}
${historySection}

## Формат спецификации

Напиши документ в Markdown со следующей структурой:

# Спецификация релиза ${release.version} — ${release.name}

## Обзор
Краткое описание релиза, его целей и ожидаемого результата.

## Задачи

Для каждой задачи из релиза:
### Задача N: <название>
- **Тип**: improvement/bug/feature
- **Приоритет**: critical/high/medium/low
- **Описание**: Подробное описание что нужно сделать
- **Файлы для изменения**: Точные пути к файлам (проверенные через Glob/Read — НЕ угаданные)
- **Существующий код**: Ключевые фрагменты затрагиваемого кода (скопируй из проекта)
- **Схема БД** (если задача затрагивает БД): Точные имена таблиц и колонок — ТОЛЬКО из CLAUDE.md или docs/, НЕ придуманные
- **Шаги реализации**: Пошаговый план (конкретные действия)
- **Критерии приёмки**: Как проверить что задача выполнена

## Порядок реализации
Рекомендуемая последовательность выполнения задач (с учётом зависимостей).

## Риски и замечания
Потенциальные риски, на что обратить внимание при реализации.
Перечисли существующие модули/функции, которые могут быть затронуты изменениями — разработчик должен убедиться, что они не сломаны.`;

  // 6. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    release_version: release.version,
    issues_count: release.issues.length,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос спецификации отправлен модели ${model.name} (${mode})`;
  if (useInteractiveTools) logMsg += ` (cwd: ${product.project_path})`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 7. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `prepare_spec/${model.name}`,
  );

  // 8. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 9. Save spec
  await releases.saveSpec(release.id, rawResponse);

  await processLogs.create({
    process_id: processId,
    step: 'spec_saved',
    message: `Спецификация сохранена (${rawResponse.length} символов)`,
    data: { char_count: rawResponse.length },
  });

  // 10. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: { text: rawResponse.slice(0, 500), mode, char_count: rawResponse.length },
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

/**
 * Run a roadmap_from_doc process — analyze requirements document and generate roadmap.
 */
async function runRoadmapFromDoc(processId, proc, product, model, startTime, timeoutMs) {
  const docText = proc.input_prompt;
  if (!docText) throw new Error('Document text is empty');

  // 1. Determine mode
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  // 2. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.3), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 3. Build system prompt
  let systemPrompt = `Ты — опытный технический аналитик и архитектор. Тебе предстоит создать дорожную карту разработки на основе документа с требованиями.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПуть к проекту: ${product.project_path}\nУ тебя есть доступ к файлам проекта (Read, Glob, Grep). Используй их для понимания текущего состояния кодовой базы перед составлением дорожной карты.`;
  }

  if (fileContext) {
    systemPrompt += `\n\n=== ДОКУМЕНТАЦИЯ И АРХИТЕКТУРА ПРОЕКТА ===\n${fileContext}`;
  }

  systemPrompt += `\n\nВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON. Не используй <think> блоки.`;

  // 4. Build user prompt
  const userPrompt = `Проанализируй следующий документ с требованиями и создай дорожную карту разработки.

=== ДОКУМЕНТ ===
${docText}
=== КОНЕЦ ДОКУМЕНТА ===

Разбей требования на логические этапы (релизы) и задачи. Каждый релиз должен быть самодостаточным и приносить ценность. Учитывай зависимости между задачами при определении порядка релизов.

Верни JSON строго в следующем формате:
{
  "summary": "Краткое описание дорожной карты (2-4 предложения)",
  "total_releases": <число>,
  "total_issues": <число>,
  "roadmap": [
    {
      "version": "1.0.0",
      "name": "Название релиза",
      "description": "Что войдёт в этот релиз и какую ценность принесёт",
      "issues": [
        {
          "title": "Краткое название задачи (до 150 символов)",
          "description": "Подробное описание что нужно сделать и зачем",
          "type": "feature | improvement | bug",
          "priority": "critical | high | medium | low"
        }
      ]
    }
  ]
}`;

  // 5. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    document_length: docText.length,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос отправлен модели ${model.name}, режим: ${mode}, документ: ${docText.length} символов`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 6. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `roadmap_from_doc/${model.name}`,
  );

  // 7. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 8. Parse and validate
  const parsed = parseJsonFromAI(rawResponse);
  if (!parsed || !Array.isArray(parsed.roadmap) || parsed.roadmap.length === 0) {
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: 'Невалидная структура дорожной карты в ответе модели',
      data: { raw_response: rawResponse.slice(0, 2000) },
    });
    throw new Error('Invalid roadmap structure in AI response');
  }

  const validTypes = ['feature', 'improvement', 'bug'];
  const validPriorities = ['critical', 'high', 'medium', 'low'];

  const roadmap = parsed.roadmap.map(release => ({
    version: String(release.version || '').slice(0, 20),
    name: String(release.name || '').slice(0, 100),
    description: String(release.description || ''),
    issues: Array.isArray(release.issues) ? release.issues
      .map(i => ({
        title: String(i.title || '').slice(0, 200),
        description: String(i.description || ''),
        type: validTypes.includes(i.type) ? i.type : 'feature',
        priority: validPriorities.includes(i.priority) ? i.priority : 'medium',
      }))
      .filter(i => i.title.length > 0) : [],
  })).filter(r => r.version.length > 0 && r.name.length > 0);

  const result = {
    summary: String(parsed.summary || ''),
    total_releases: roadmap.length,
    total_issues: roadmap.reduce((sum, r) => sum + r.issues.length, 0),
    roadmap,
  };

  // 9. Log: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Дорожная карта: ${result.total_releases} релизов, ${result.total_issues} задач`,
    data: { total_releases: result.total_releases, total_issues: result.total_issues },
  });

  // 10. Save result
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

/**
 * Run update_docs: merge develop_release branches, then use Claude Code
 * to update project documentation based on all changes.
 */
async function runUpdateDocs(processId, proc, product, model, startTime, timeoutMs) {
  const cwd = product.project_path;
  if (!cwd) throw new Error('Product has no project_path configured');

  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}

  // 1. Collect branches from plan step dependencies
  let branches = [];
  if (proc.plan_step_id) {
    const planSteps = await import('./db/plan-steps.js');
    const step = await planSteps.getById(proc.plan_step_id);
    if (step?.depends_on?.length) {
      const allSteps = await planSteps.getByPlan(step.plan_id);
      for (const depId of step.depends_on) {
        const depStep = allSteps.find(s => s.id === depId);
        if (depStep?.process_id && depStep.process_type === 'develop_release') {
          const depProc = await processes.getById(depStep.process_id);
          if (depProc?.result?.branch) {
            branches.push(depProc.result.branch);
          }
        }
      }
    }
  }
  if (config.branches?.length) branches = config.branches;

  // Also collect release info for context
  let releaseContext = '';
  if (proc.plan_step_id) {
    const planSteps = await import('./db/plan-steps.js');
    const step = await planSteps.getById(proc.plan_step_id);
    if (step?.depends_on?.length) {
      const allSteps = await planSteps.getByPlan(step.plan_id);
      for (const depId of step.depends_on) {
        const depStep = allSteps.find(s => s.id === depId);
        if (depStep?.release_id) {
          const rel = await releases.getById(depStep.release_id);
          if (rel) {
            releaseContext += `\n- ${rel.version} "${rel.name}": ${rel.issues?.map(i => i.title).join(', ') || 'нет задач'}`;
          }
        }
      }
    }
  }

  const docFiles = config.doc_files || [
    'docs/USER_GUIDE.md',
    'docs/MAIN_FUNC.md',
    'docs/RELEASE_NOTES.md',
    'docs/DATABASE_SCHEMA.md',
  ];

  await processLogs.create({
    process_id: processId,
    step: 'docs_started',
    message: `Обновление документации. Веток для мержа: ${branches.length}, файлов: ${docFiles.join(', ')}`,
    data: { branches, doc_files: docFiles },
  });

  // 2. Merge branches (same logic as run_tests)
  let integrationBranch = null;
  if (branches.length > 0) {
    integrationBranch = `kaizen/docs-${processId.slice(0, 8)}`;
    try {
      await execFileAsync('git', ['checkout', 'main'], { cwd, timeout: 15_000 });
      await execFileAsync('git', ['pull', '--ff-only'], { cwd, timeout: 30_000 }).catch(() => {});
      await execFileAsync('git', ['checkout', '-b', integrationBranch], { cwd, timeout: 10_000 });

      for (const branch of branches) {
        try {
          await execFileAsync('git', ['merge', branch, '--no-edit'], { cwd, timeout: 30_000 });
        } catch (mergeErr) {
          await execFileAsync('git', ['merge', '--abort'], { cwd, timeout: 10_000 }).catch(() => {});
          await execFileAsync('git', ['checkout', 'main'], { cwd, timeout: 10_000 }).catch(() => {});
          await execFileAsync('git', ['branch', '-D', integrationBranch], { cwd, timeout: 10_000 }).catch(() => {});
          throw new Error(`Конфликт при мерже ветки ${branch}: ${mergeErr.message}`);
        }
      }

      await processLogs.create({
        process_id: processId,
        step: 'merge_complete',
        message: `${branches.length} веток смержены в ${integrationBranch}`,
        data: { integration_branch: integrationBranch, branches },
      });
    } catch (err) {
      throw new Error(`Git merge error: ${err.message}`);
    }
  }

  // 3. Get diff summary for context
  let diffSummary = '';
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--stat', 'main', 'HEAD'], { cwd, timeout: 15_000 });
    diffSummary = stdout.trim();
  } catch {}

  // 4. Build prompts for Claude Code
  const systemPrompt = `Ты — технический писатель. Твоя задача — обновить документацию проекта на основе изменений в коде.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
Путь к проекту: ${cwd}

СТРОГИЙ ПОРЯДОК ДЕЙСТВИЙ:

Шаг 1 — ИЗУЧЕНИЕ ИЗМЕНЕНИЙ
  Используй git diff main..HEAD для просмотра всех изменений.
  Изучи новый и изменённый код. Пойми что было добавлено/изменено.

Шаг 2 — ОБНОВЛЕНИЕ ДОКУМЕНТАЦИИ
  Обнови следующие файлы (если они существуют):
${docFiles.map(f => `  - ${f}`).join('\n')}

  Для каждого файла:
  - Прочитай текущее содержимое
  - Определи какие разделы затронуты изменениями
  - Обнови только затронутые разделы
  - Сохрани существующий формат и стиль
  - Если файла нет — создай с базовой структурой

  Для RELEASE_NOTES.md:
  - Добавь записи о новых релизах в начало файла
  - Формат: ## версия — название (дата)
${releaseContext ? `\n  Релизы для документирования:${releaseContext}` : ''}

Шаг 3 — КОММИТ И ПУШ
  git add -A
  git commit -m "docs: обновление документации"
  git push origin HEAD
  Получи хэш коммита: git rev-parse HEAD

Шаг 4 — ИТОГОВЫЙ JSON
  Последней строкой ответа выведи ТОЛЬКО этот JSON (без пояснений):
  {"branch":"текущая ветка","commit_hash":"<хэш>","files_updated":["файл1","файл2"],"summary":"краткое описание обновлений"}

ПРАВИЛА:
- Не изменяй код — только документацию
- Не выходи за пределы ${cwd}
- Пиши документацию на русском языке${config.language === 'en' ? ' (на английском)' : ''}
- При отсутствии изменений — верни JSON с пустым files_updated`;

  const userPrompt = `Обнови документацию проекта.

${diffSummary ? `=== ИЗМЕНЕНИЯ (git diff --stat) ===\n${diffSummary}\n` : ''}
${releaseContext ? `=== РЕЛИЗЫ ===${releaseContext}\n` : ''}
Файлы для обновления: ${docFiles.join(', ')}`;

  // 5. Log: request_sent
  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: `Запрос отправлен Claude Code. Ветка: ${integrationBranch || 'текущая'}`,
    data: { branch: integrationBranch, doc_files: docFiles },
  });

  // 6. Call Claude Code with streaming
  const onEvent = createCheckpointTracker(processId);
  const watchdogMs = timeoutMs + 60_000;
  const { text: rawResponse, events } = await withWatchdog(
    callClaudeCodeStreaming(model?.model_id || 'claude-sonnet-4-6', systemPrompt, userPrompt, {
      cwd,
      timeoutMs,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      onEvent,
    }),
    watchdogMs,
    `update_docs/${model?.name || 'claude-code'}`,
  );

  // 7. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов, ${events.length} событий)`,
    data: { response_length: rawResponse.length, event_count: events.length },
  });

  // 8. Parse result
  const parsedArr = parseJsonFromAI(rawResponse);
  const parsed = parsedArr ? parsedArr[0] : null;
  let resultObj;
  if (parsed) {
    resultObj = {
      branch: parsed.branch || integrationBranch || 'unknown',
      commit_hash: parsed.commit_hash || null,
      files_updated: parsed.files_updated || [],
      summary: parsed.summary || '',
    };
  } else {
    // Git fallback
    resultObj = await gitFallback(integrationBranch || 'HEAD', cwd, processId);
    resultObj.files_updated = [];
  }

  // 9. Log: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Ветка: ${resultObj.branch} · коммит: ${resultObj.commit_hash || '—'} · файлов обновлено: ${resultObj.files_updated?.length || 0}`,
    data: resultObj,
  });

  // 10. Complete
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: resultObj,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

/**
 * Run a form_release process — AI groups open issues into releases.
 */
async function runFormRelease(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Parse config
  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const maxReleases = Math.min(Math.max(parseInt(config.max_releases) || 3, 1), 10);
  const strategy = config.strategy || 'balanced';
  const autoApprove = config.auto_approve === true;

  // 2. Load open issues
  const openIssues = await issues.getByProduct(product.id, 'open');
  if (openIssues.length < 2) throw new Error('Недостаточно открытых задач (минимум 2)');

  // 3. Get last published release version for incrementing
  const publishedReleases = await releases.getPublishedByProduct(product.id, 1);
  const lastVersion = publishedReleases.length > 0 ? publishedReleases[0].version : '0.0.0';

  // 4. Build issues context (compact)
  const issuesContext = openIssues.map((iss, i) => ({
    index: i,
    title: iss.title,
    description: (iss.description || '').slice(0, 300),
    type: iss.type,
    priority: iss.priority,
    rc_ticket_id: iss.rc_ticket_id || null,
    created_at: iss.created_at,
  }));

  // 5. Build strategy description
  const strategyDescriptions = {
    critical_first: 'Первый релиз — все критичные и высокоприоритетные баги. Остальные задачи — в последующие релизы.',
    by_topic: 'Группируй задачи по функциональным областям (UI, безопасность, API, данные и т.д.).',
    balanced: 'Сбалансированные релизы по объёму и приоритету. В каждом релизе — микс типов задач.',
    single: 'Объедини все задачи в один релиз.',
  };

  const systemPrompt = `Ты — опытный Product Manager. Проанализируй список задач продукта и предложи оптимальное распределение по релизам.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}

Стратегия группировки: ${strategy}
${strategyDescriptions[strategy] || strategyDescriptions.balanced}

Максимум релизов: ${maxReleases}
Последняя версия: ${lastVersion}

ВАЖНО: Верни ответ ТОЛЬКО как JSON без markdown. Не используй <think> блоки.

Формат:
{
  "releases": [
    {
      "version": "семантическая версия (инкремент от ${lastVersion})",
      "name": "Краткое название (2-4 слова)",
      "description": "Release notes — что входит и зачем",
      "issue_indices": [0, 2, 5],
      "priority": "high|medium|low",
      "rationale": "Почему эти задачи сгруппированы вместе"
    }
  ],
  "unassigned": [6, 7],
  "summary": "Краткое описание распределения (2-3 предложения)"
}

Правила:
- Критичные баги — в первый релиз
- Связанные по функциональности задачи — вместе
- Размер релиза: 3–10 задач (оптимально 5–7)
- Если задача не подходит ни к одному релизу — в unassigned
- issue_indices — это индексы из массива задач (0-based)
- Каждая задача может быть только в одном релизе`;

  const userPrompt = `Распредели ${openIssues.length} задач по релизам.

Задачи (JSON):
${JSON.stringify(issuesContext, null, 2)}`;

  // 6. Log: request_sent
  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: `Запрос формирования релиза отправлен модели ${model.name}. Задач: ${openIssues.length}, стратегия: ${strategy}, авто-утверждение: ${autoApprove}`,
    data: { model_name: model.name, issues_count: openIssues.length, strategy, max_releases: maxReleases, auto_approve: autoApprove, last_version: lastVersion },
  });

  // 7. Call AI
  const aiOptions = {};
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `form_release/${model.name}`,
  );

  // 8. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 9. Parse and validate
  const parsed = parseJsonFromAI(rawResponse);
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!data || !Array.isArray(data.releases) || data.releases.length === 0) {
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: 'Невалидная структура ответа — не найден массив releases',
      data: { raw_response: rawResponse.slice(0, 2000) },
    });
    throw new Error('Invalid form_release structure in AI response');
  }

  // Normalize
  const validPriorities = ['high', 'medium', 'low'];
  const proposedReleases = data.releases.slice(0, maxReleases).map(rel => ({
    version: String(rel.version || '').slice(0, 20),
    name: String(rel.name || '').slice(0, 100),
    description: String(rel.description || ''),
    issue_indices: Array.isArray(rel.issue_indices) ? rel.issue_indices.filter(i => i >= 0 && i < openIssues.length) : [],
    priority: validPriorities.includes(rel.priority) ? rel.priority : 'medium',
    rationale: String(rel.rationale || ''),
  })).filter(r => r.version && r.name && r.issue_indices.length > 0);

  // Map indices to issue IDs
  const result = {
    summary: String(data.summary || ''),
    releases: proposedReleases.map(rel => ({
      ...rel,
      issues: rel.issue_indices.map(i => ({
        id: openIssues[i].id,
        title: openIssues[i].title,
        type: openIssues[i].type,
        priority: openIssues[i].priority,
      })),
    })),
    unassigned: Array.isArray(data.unassigned)
      ? data.unassigned.filter(i => i >= 0 && i < openIssues.length).map(i => ({
          id: openIssues[i].id,
          title: openIssues[i].title,
        }))
      : [],
  };

  // 10. Log: parse_result
  const totalAssigned = result.releases.reduce((sum, r) => sum + r.issues.length, 0);
  await processLogs.create({
    process_id: processId,
    step: 'releases_ready',
    message: `Предложение: ${result.releases.length} релизов, ${totalAssigned} задач распределено, ${result.unassigned.length} не включены`,
    data: { releases_count: result.releases.length, assigned: totalAssigned, unassigned: result.unassigned.length },
  });

  // 11. Auto-approve if enabled
  if (autoApprove) {
    const createdReleases = [];
    for (const rel of result.releases) {
      const issueIds = rel.issues.map(i => i.id);
      const created = await releases.create({
        product_id: product.id,
        version: rel.version,
        name: rel.name,
        description: rel.description,
        issue_ids: issueIds,
      });
      createdReleases.push({ id: created.id, version: created.version, name: created.name, issues: issueIds.length });
    }

    await processLogs.create({
      process_id: processId,
      step: 'auto_approved',
      message: `Авто-утверждение: создано ${createdReleases.length} релизов`,
      data: { created_releases: createdReleases },
    });

    result.auto_approved = true;
    result.created_releases = createdReleases;
  }

  // 12. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}

// ── Checkpoint tracking for develop_release ──────────────

const CHECKPOINT_MESSAGES = {
  repo:      'Подготовка репозитория (git checkout/pull)',
  study:     'Изучение кодовой базы',
  implement: 'Реализация задач',
  docs:      'Обновление документации',
  tests:     'Написание тестов',
  test_run:  'Запуск тестов',
  commit:    'Коммит и push',
};

const CHECKPOINT_PHASES = ['repo', 'study', 'implement', 'tests', 'test_run', 'docs', 'commit'];

function createCheckpointTracker(processId) {
  let currentPhase = null;
  let toolCount = 0;
  let writeCount = 0;

  return async function onEvent(event) {
    try {
      // Handle content_block_start with tool_use (Claude stream-json format)
      let tool = null;
      let input = {};

      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        tool = event.content_block.name;
        input = event.content_block.input || {};
      } else if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        const toolBlock = event.message.content.find(b => b.type === 'tool_use');
        if (toolBlock) {
          tool = toolBlock.name;
          input = toolBlock.input || {};
        }
      }

      if (!tool) return;
      toolCount++;

      let detectedPhase = null;

      if (tool === 'Bash') {
        const cmd = input.command || '';
        if (/git\s+(checkout|pull|fetch|branch)/.test(cmd)) detectedPhase = 'repo';
        else if (/git\s+(commit|push)/.test(cmd)) detectedPhase = 'commit';
        else if (/(npm\s+test|vitest|jest|playwright|node\s+--test)/.test(cmd)) detectedPhase = 'test_run';
      } else if (tool === 'Write' || tool === 'Edit') {
        writeCount++;
        const path = input.file_path || '';
        if (/\.(test|spec)\./.test(path)) detectedPhase = 'tests';
        else if (/docs\//.test(path)) detectedPhase = 'docs';
        else if (!currentPhase || currentPhase === 'repo' || currentPhase === 'study') detectedPhase = 'implement';
      } else if (['Read', 'Glob', 'Grep'].includes(tool) && (!currentPhase || currentPhase === 'repo')) {
        detectedPhase = 'study';
      }

      if (detectedPhase && detectedPhase !== currentPhase) {
        const detectedIdx = CHECKPOINT_PHASES.indexOf(detectedPhase);
        const currentIdx = currentPhase ? CHECKPOINT_PHASES.indexOf(currentPhase) : -1;
        if (detectedIdx > currentIdx) {
          currentPhase = detectedPhase;
          await processLogs.create({
            process_id: processId,
            step: 'checkpoint',
            message: CHECKPOINT_MESSAGES[detectedPhase],
            data: { phase: detectedPhase, tool_count: toolCount, write_count: writeCount },
          }).catch(() => {});
        }
      }
    } catch { /* checkpoint tracking must never crash the process */ }
  };
}

/**
 * Run a develop_release process — Claude Code implements all release tasks.
 */
async function runDevelopRelease(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (!release.spec) throw new Error('Release spec is required for development');
  if (!product.project_path) throw new Error('product.project_path is required');

  // 1b. Block parallel develop_release on the same project_path
  const allProcs = await processes.getAll({ status: 'running' });
  const conflict = allProcs.find(p =>
    p.id !== processId &&
    p.type === 'develop_release' &&
    p.product_id === proc.product_id
  );
  if (conflict) {
    throw new Error(`Параллельная разработка заблокирована: на этом продукте уже запущен develop_release (${conflict.id.slice(0, 8)})`);
  }

  // 2. Parse config from input_prompt
  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const rawBranch   = config.git_branch  || `kaizen/release-${release.version}`;
  const branchName  = validateBranchName(rawBranch);
  const testCommand = config.test_command || detectTestCommand(product.tech_stack);
  const buildCommand = config.build_command || detectBuildCommand(product.tech_stack);

  // 3. Mark release as in_progress
  await releases.updateDevInfo(release.id, { dev_status: 'in_progress' });

  // 4. System prompt
  const buildStep = buildCommand
    ? `\nШаг 5 — ПРОВЕРКА СБОРКИ
  Запусти команду сборки: ${buildCommand}
  Если не собирается — исправь ошибки. НЕ КОММИТЬ код, который не компилируется.
  Повтори до 3 раз, анализируя ошибки компиляции.\n`
    : '';

  const systemPrompt = `Ты — опытный разработчик. Твоя задача — полностью реализовать релиз программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack  ? `Стек: ${product.tech_stack}`       : ''}
Путь к проекту: ${product.project_path}

СТРОГИЙ ПОРЯДОК ДЕЙСТВИЙ:

Шаг 1 — ПОДГОТОВКА РЕПОЗИТОРИЯ
  Выполни: git pull
  Создай ветку: git checkout -b ${branchName}
  (если ветка существует: git checkout ${branchName})

Шаг 2 — ИЗУЧЕНИЕ ПРОЕКТА И ДОКУМЕНТАЦИИ (КРИТИЧНО!)
  ОБЯЗАТЕЛЬНО прочитай файл CLAUDE.md в корне проекта — там архитектура, схема БД, имена таблиц и колонок, API, бизнес-логика.
  Прочитай файлы из папки docs/ — там детальная документация проекта.
  Если задача затрагивает базу данных — найди ТОЧНЫЕ имена таблиц и колонок в документации.
  НЕ ПРИДУМЫВАЙ имена колонок, таблиц, полей — бери ТОЛЬКО из документации или существующего кода.
  Изучи существующий код в файлах, которые будешь менять — пойми текущую реализацию.${getContextFilesPrompt(product)}${getCriticalPathsPrompt(product)}

Шаг 3 — BASELINE: ПРОВЕРКА ТЕКУЩЕГО СОСТОЯНИЯ
  Запусти тесты ДО своих изменений: ${testCommand}
  Запомни, какие тесты проходят — это baseline.${buildCommand ? `\n  Запусти сборку: ${buildCommand}\n  Убедись, что проект собирается ДО твоих изменений.` : ''}
  Если baseline-тесты уже падают — зафиксируй это, но НЕ ломай то, что работало.

Шаг 4 — РЕАЛИЗАЦИЯ ВСЕХ ЗАДАЧ
  Реализуй каждую задачу из спецификации полностью.
  Пиши код в стиле существующего проекта.
  Не пропускай задачи — реализуй все.
  НЕ обновляй документацию (docs/) — это делается отдельным процессом.
  КРИТИЧНО: Не ломай существующий функционал! Если меняешь файл — сначала пойми, что он делает сейчас.
${buildStep}
Шаг ${buildCommand ? '6' : '5'} — НАПИСАНИЕ ТЕСТОВ
  Напиши тесты для каждого реализованного компонента / функции / эндпоинта.
  Покрой основные сценарии использования и граничные случаи.

Шаг ${buildCommand ? '7' : '6'} — ПРОВЕРКА ТЕСТОВ (максимум 3 итерации)
  Запусти: ${testCommand}
  Если тесты упали:
    - Проанализируй ошибки
    - Исправь код (не тест, если только тест не содержит явную ошибку)
    - Запусти снова
  После 3 неудачных итераций: зафиксируй причину в summary и переходи к следующему шагу.
  ВАЖНО: все baseline-тесты (которые проходили ДО твоих изменений) ДОЛЖНЫ продолжать проходить.

Шаг ${buildCommand ? '8' : '7'} — КОММИТ И ПУШ
  git add -A
  git commit -m "feat: ${release.version} — ${release.name}"
  git push origin ${branchName}
  (если отклонён: git push --set-upstream origin ${branchName})
  Получи хэш коммита: git rev-parse HEAD

Шаг ${buildCommand ? '9' : '8'} — ИТОГОВЫЙ JSON
  Последней строкой ответа выведи ТОЛЬКО этот JSON (без пояснений):
  {"branch":"${branchName}","commit_hash":"<хэш>","files_changed":<N>,"tests_written":<N>,"tests_passed":<true|false>,"summary":"<краткое описание>"}

ПРАВИЛА:
- Не выходи за пределы ${product.project_path}
- Не создавай Pull Request
- НЕ ПРИДУМЫВАЙ имена колонок БД — бери из CLAUDE.md, docs/ или существующего кода
- Если добавляешь зависимость (import, using, NuGet, npm) — убедись, что пакет установлен
- При непреодолимой ошибке: опиши в summary, верни JSON с tests_passed: false`;

  // 5. User prompt
  const issuesList = release.issues.map((iss, i) =>
    `### ${i + 1}. ${iss.title} (${iss.type}, ${iss.priority})\n${iss.description || '—'}`
  ).join('\n\n');

  const userPrompt = `Реализуй релиз:

ВЕТКА: ${branchName}
ТЕСТ-КОМАНДА: ${testCommand}

=== СПЕЦИФИКАЦИЯ ===
${release.spec}

=== ЗАДАЧИ РЕЛИЗА (${release.issues.length} шт.) ===
${issuesList}`;

  // 6. Log: request_sent
  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: `Запрос отправлен Claude Code. Ветка: ${branchName}, задач: ${release.issues.length}`,
    data: { branch: branchName, test_command: testCommand, issues_count: release.issues.length,
            cwd: product.project_path },
  });

  // 7. Call Claude Code with streaming + checkpoints
  const onEvent = createCheckpointTracker(processId);
  const watchdogMs = timeoutMs + 60_000;
  const { text: rawResponse, events } = await withWatchdog(
    callClaudeCodeStreaming(model.model_id, systemPrompt, userPrompt, {
      cwd: product.project_path,
      timeoutMs,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      onEvent,
    }),
    watchdogMs,
    `develop_release/${model.name}`,
  );

  // 8. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов, ${events.length} событий)`,
    data: { response_length: rawResponse.length, event_count: events.length },
  });

  // 9. Parse JSON from last line of response
  const parsedArr = parseJsonFromAI(rawResponse);
  const parsed = parsedArr ? parsedArr[0] : null;
  let resultObj;
  if (parsed) {
    resultObj = {
      branch:        parsed.branch        || branchName,
      commit_hash:   parsed.commit_hash   || null,
      files_changed: parsed.files_changed || null,
      tests_written: parsed.tests_written || null,
      tests_passed:  parsed.tests_passed  !== false,
      summary:       parsed.summary       || '',
    };
  } else {
    // Git fallback: if JSON parsing failed, try to extract results from git
    resultObj = await gitFallback(branchName, product.project_path, processId);
  }

  // 10. Log: parse_result
  await processLogs.create({
    process_id: processId,
    step: 'parse_result',
    message: `Ветка: ${resultObj.branch} · коммит: ${resultObj.commit_hash || '—'} · тесты: ${resultObj.tests_passed ? 'пройдены' : 'не пройдены'}`,
    data: resultObj,
  });

  // 11. GitLab push (if configured)
  if (product.deploy?.gitlab?.remote_url && product.deploy?.gitlab?.access_token) {
    try {
      const pushResult = await pushToGitlab(product.project_path, resultObj.branch || branchName, product.deploy);
      await processLogs.create({
        process_id: processId,
        step: pushResult.pushed ? 'gitlab_push' : 'gitlab_push_failed',
        message: pushResult.pushed
          ? `Ветка ${resultObj.branch} отправлена в GitLab`
          : `Ошибка push в GitLab: ${pushResult.output}`,
        data: pushResult,
      });
    } catch (pushErr) {
      await processLogs.create({
        process_id: processId,
        step: 'gitlab_push_failed',
        message: `Ошибка push в GitLab: ${pushErr.message}`,
      });
    }
  }

  // 12. Smoke test (auto-discover if not configured, runs after every develop_release)
  if (resultObj.tests_passed && product.project_path) {
    const smokeConfig = product.smoke_test || {};
    const smokeEnabled = smokeConfig.enabled !== false; // enabled by default if project_path exists
    if (smokeEnabled) {
      try {
        const smokeLog = async (step, message, data) => {
          await processLogs.create({ process_id: processId, step, message, data });
        };
        const smokeResult = await runSmokeTests({
          smokeConfig,
          projectPath: product.project_path,
          techStack: product.tech_stack,
          log: smokeLog,
        });

        // Auto-save discovered config for future runs
        if (smokeResult.discoveredConfig && (!smokeConfig.url || !smokeConfig.pages?.length)) {
          try {
            await products.update(product.id, {
              smoke_test: { ...smokeResult.discoveredConfig, enabled: true },
            });
            await processLogs.create({
              process_id: processId,
              step: 'smoke_config_saved',
              message: 'Smoke test конфиг автоматически сохранён в продукт',
              data: smokeResult.discoveredConfig,
            });
          } catch { /* non-critical */ }
        }

        if (!smokeResult.passed) {
          resultObj.tests_passed = false;
          resultObj.smoke_failed = true;
          resultObj.smoke_results = smokeResult.results;
          resultObj.summary = (resultObj.summary || '') + '\n\nSmoke test ПРОВАЛЕН: ' +
            smokeResult.results.filter(r => !r.ok).map(r => `${r.page}: ${r.errors.join('; ')}`).join(', ');
        }
      } catch (smokeErr) {
        await processLogs.create({
          process_id: processId,
          step: 'smoke_error',
          message: `Ошибка smoke test: ${smokeErr.message}`,
          data: { error: smokeErr.message },
        });
      }
    }
  }

  // 13. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: resultObj,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  // 14. Update release
  await releases.updateDevInfo(release.id, {
    dev_branch: resultObj.branch,
    dev_commit: resultObj.commit_hash,
    dev_status: resultObj.tests_passed ? 'done' : 'failed',
  });

  // 15. Auto-publish if tests passed and auto_publish is enabled
  if (resultObj.tests_passed && config.auto_publish) {
    try {
      await releases.publish(release.id);
      await processLogs.create({
        process_id: processId,
        step: 'auto_published',
        message: `Релиз ${release.version} автоматически опубликован (тесты пройдены)`,
        data: { release_id: release.id, version: release.version },
      });
      // Notify: release published
      notify('release_published', {
        product: product.name, version: release.version,
        issues_count: release.issues?.length || 0, product_id: product.id,
      }, getNotifyOpts(product)).catch(() => {});
    } catch (pubErr) {
      await processLogs.create({
        process_id: processId,
        step: 'auto_publish_failed',
        message: `Ошибка авто-публикации: ${pubErr.message}`,
        data: { error: pubErr.message },
      });
    }
  }

  // 16. Notify: develop completed/failed
  if (resultObj.tests_passed) {
    notify('develop_completed', {
      product: product.name, version: release.version,
      branch: resultObj.branch, tests_passed: true, commit: resultObj.commit_hash,
    }, getNotifyOpts(product)).catch(() => {});
  } else {
    notify('develop_failed', {
      product: product.name, version: release.version,
      error: 'тесты не пройдены',
    }, getNotifyOpts(product)).catch(() => {});
  }
}

/**
 * Run a deploy process — merge to default branch, push to GitLab, wait for CI/CD pipeline.
 */
async function runDeploy(processId, proc, product, startTime, timeoutMs) {
  const deploy = product.deploy;
  if (!deploy?.gitlab?.remote_url || !deploy?.gitlab?.access_token) {
    throw new Error('GitLab не настроен для этого продукта (deploy.gitlab.remote_url, access_token)');
  }
  if (!product.project_path) throw new Error('product.project_path не задан');

  let config = {};
  try { config = JSON.parse(proc.input_prompt || '{}'); } catch {}

  const branchName = config.branch || null;
  const release = proc.release_id ? await releases.getById(proc.release_id) : null;

  // Determine branch to deploy
  let deployBranch = branchName;
  if (!deployBranch && release) {
    deployBranch = release.dev_branch || `kaizen/release-${release.version}`;
  }
  if (!deployBranch) throw new Error('Не указана ветка для деплоя (branch)');

  await processLogs.create({
    process_id: processId,
    step: 'deploy_started',
    message: `Деплой ветки ${deployBranch} в GitLab`,
    data: { branch: deployBranch, method: deploy.target?.method || 'docker' },
  });

  // 1. Merge branch to default branch and push
  const pushResult = await pushToDefaultBranch(product.project_path, deployBranch, deploy);

  if (!pushResult.pushed) {
    throw new Error(`Не удалось push в GitLab: ${pushResult.output}`);
  }

  await processLogs.create({
    process_id: processId,
    step: 'gitlab_pushed',
    message: `Push в ${deploy.gitlab.default_branch || 'main'} выполнен`,
    data: pushResult,
  });

  // 2. Get commit SHA for pipeline tracking
  const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: product.project_path, timeout: 10_000,
  });
  const commitSha = sha.trim();

  // 3. Wait for GitLab pipeline
  await processLogs.create({
    process_id: processId,
    step: 'pipeline_waiting',
    message: `Ожидание pipeline для коммита ${commitSha.substring(0, 8)}...`,
    data: { sha: commitSha },
  });

  const pipelineTimeoutMs = Math.min(timeoutMs - (Date.now() - startTime), 600_000);
  let pipelineResult;
  try {
    pipelineResult = await waitForPipeline(deploy, commitSha, { timeoutMs: pipelineTimeoutMs });
  } catch (err) {
    pipelineResult = { status: 'timeout', web_url: null, jobs: [] };
  }

  await processLogs.create({
    process_id: processId,
    step: 'pipeline_result',
    message: `Pipeline: ${pipelineResult.status}${pipelineResult.web_url ? ` (${pipelineResult.web_url})` : ''}`,
    data: pipelineResult,
  });

  // 4. Complete
  const durationMs = Date.now() - startTime;
  const resultObj = {
    branch: deployBranch,
    commit_sha: commitSha,
    pipeline_status: pipelineResult.status,
    pipeline_url: pipelineResult.web_url,
    jobs: pipelineResult.jobs,
    method: deploy.target?.method || 'docker',
  };

  const success = pipelineResult.status === 'success';
  await processes.update(processId, {
    status: success ? 'completed' : 'failed',
    result: resultObj,
    error: success ? null : `Pipeline ${pipelineResult.status}`,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });

  // 5. Notify
  notify(success ? 'deploy_completed' : 'deploy_failed', {
    product: product.name,
    version: release?.version || deployBranch,
    pipeline_status: pipelineResult.status,
    pipeline_url: pipelineResult.web_url,
  }, getNotifyOpts(product)).catch(() => {});
}

/**
 * Run a prepare_press_release process — generate PR materials for multiple channels.
 */
async function runPreparePressRelease(processId, proc, product, model, startTime, timeoutMs) {
  // 1. Load release with issues
  const release = await releases.getById(proc.release_id);
  if (!release) throw new Error('Release not found');
  if (release.status !== 'released') throw new Error('Release must be published first');
  if (!release.issues || release.issues.length === 0) throw new Error('Release has no issues');

  // 2. Parse parameters from input_prompt
  let params = {};
  try { params = JSON.parse(proc.input_prompt || '{}'); } catch {}
  const channels = params.channels || ['social', 'website', 'bitrix24', 'media'];
  const tone = params.tone || 'official';
  const audiences = params.audiences || ['employees'];
  const generateImages = params.generate_images !== false;
  const keyPoints = params.key_points || '';

  // 3. Determine mode
  const isClaudeCode = model.provider === 'claude-code';
  const hasProjectPath = !!product.project_path;
  const useInteractiveTools = isClaudeCode && hasProjectPath;
  const useCollectedContext = !isClaudeCode && hasProjectPath;
  const mode = useInteractiveTools ? 'claude-code' : 'standalone';

  // 4. Collect project context for standalone mode
  let fileContext = '';
  let contextStats = null;
  if (useCollectedContext) {
    try {
      const contextLength = model.context_length || 8192;
      const maxTokens = Math.max(Math.floor(contextLength * 0.3), 1000);
      const result = await collectProjectContext(product.project_path, {
        maxTokens,
        techStack: product.tech_stack,
      });
      fileContext = result.context;
      contextStats = result.stats;
    } catch (err) {
      await processLogs.create({
        process_id: processId,
        step: 'context_warning',
        message: `Не удалось собрать контекст: ${err.message}`,
      });
    }
  }

  // 5. Build tone/audience labels
  const toneLabels = { official: 'Официальная', friendly: 'Дружелюбная', technical: 'Техническая', marketing: 'Маркетинговая' };
  const audienceLabels = { employees: 'Сотрудники', clients: 'Клиенты', tech_community: 'Техническое сообщество', general: 'Широкая аудитория' };
  const toneText = toneLabels[tone] || tone;
  const audienceText = audiences.map(a => audienceLabels[a] || a).join(', ');

  // 6. Build system prompt
  let systemPrompt = `Ты — PR-менеджер и маркетолог технологической компании. Твоя задача — подготовить PR-материалы для опубликованного релиза программного продукта.

Продукт: ${product.name}
${product.description ? `Описание: ${product.description}` : ''}
${product.tech_stack ? `Стек: ${product.tech_stack}` : ''}
${product.owner ? `Ответственный: ${product.owner}` : ''}

Тональность: ${toneText}
Целевая аудитория: ${audienceText}`;

  if (useInteractiveTools) {
    systemPrompt += `\n\nПроект находится в текущей директории. Изучи CLAUDE.md и docs/ для понимания продукта. Используй Read, Glob, Grep для анализа.`;
  }

  if (fileContext) {
    systemPrompt += `\n\nКонтекст проекта:\n\n${fileContext}`;
  }

  const channelInstructions = [];
  if (channels.includes('social')) channelInstructions.push('"social" — посты для ВКонтакте и Telegram с хештегами');
  if (channels.includes('website')) channelInstructions.push('"website" — статья для сайта компании с SEO');
  if (channels.includes('bitrix24')) channelInstructions.push('"bitrix24" — внутренний пост в ленту Битрикс24 для сотрудников');
  if (channels.includes('media')) channelInstructions.push('"media" — пресс-релиз для СМИ с цитатами и бойлерплейтом');

  systemPrompt += `\n\nВАЖНО: Верни ответ ТОЛЬКО как JSON указанного формата. Никакого текста вне JSON. Не используй <think> блоки.`;

  // 7. Build user prompt
  const issuesList = release.issues.map((iss, i) =>
    `${i + 1}. **${iss.title}** (${iss.type}, ${iss.priority})${iss.description ? `\n   ${iss.description}` : ''}`
  ).join('\n');

  let userPrompt = `Подготовь PR-материалы для опубликованного релиза.

## Релиз: ${release.version} — ${release.name}
${release.description ? `\nОписание: ${release.description}` : ''}

## Задачи релиза

${issuesList}

${release.spec ? `## Спецификация\n\n${typeof release.spec === 'string' ? release.spec.slice(0, 3000) : ''}\n` : ''}
${keyPoints ? `## Ключевые акценты\n\n${keyPoints}\n` : ''}

## Требуемые каналы

${channelInstructions.join('\n')}

## JSON-формат ответа

{
  "channels": {
    ${channels.includes('social') ? `"social": { "platform_vk": "Текст поста для ВК", "platform_telegram": "Текст поста для Telegram", "hashtags": ["#тег1", "#тег2"] },` : ''}
    ${channels.includes('website') ? `"website": { "title": "Заголовок", "subtitle": "Подзаголовок", "body": "Текст статьи (Markdown)", "seo_keywords": ["ключ1"], "meta_description": "Мета-описание" },` : ''}
    ${channels.includes('bitrix24') ? `"bitrix24": { "title": "Заголовок", "body": "Текст поста", "mentions": ["@отдел или @имя"] },` : ''}
    ${channels.includes('media') ? `"media": { "title": "Заголовок", "lead": "Лид", "body": "Текст", "quotes": ["Цитата 1"], "boilerplate": "О компании" }` : ''}
  }${generateImages ? `,
  "image_prompts": [{ "description": "Описание изображения", "purpose": "Для чего", "style": "Стиль", "dimensions": "Размеры" }],
  "screenshots_needed": [{ "what": "Что снять", "why": "Зачем", "annotations": "Подписи" }]` : ''}
}`;

  // 8. Log: request_sent
  const logData = {
    model_name: model.name,
    provider: model.provider,
    mode,
    release_version: release.version,
    issues_count: release.issues.length,
    channels,
    tone,
    audiences,
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    cwd: useInteractiveTools ? product.project_path : null,
  };
  if (contextStats) logData.context_stats = contextStats;

  let logMsg = `Запрос пресс-релиза отправлен модели ${model.name} (${mode}), каналы: ${channels.join(', ')}`;
  if (contextStats) logMsg += ` (контекст: ${contextStats.filesRead} файлов, ${contextStats.totalChars} символов${contextStats.truncated ? ', усечён' : ''})`;

  await processLogs.create({
    process_id: processId,
    step: 'request_sent',
    message: logMsg,
    data: logData,
  });

  // 9. Call AI (with watchdog safety net)
  const aiOptions = {};
  if (useInteractiveTools) aiOptions.cwd = product.project_path;
  if (timeoutMs) aiOptions.timeoutMs = timeoutMs;
  const watchdogMs = timeoutMs + 60_000;
  const rawResponse = await withWatchdog(
    callAI(model, systemPrompt, userPrompt, aiOptions),
    watchdogMs,
    `prepare_press_release/${model.name}`,
  );

  // 10. Log: response_received
  await processLogs.create({
    process_id: processId,
    step: 'response_received',
    message: `Ответ получен (${rawResponse.length} символов)`,
    data: { response_length: rawResponse.length },
  });

  // 11. Parse JSON
  const parsed = parseJsonFromAI(rawResponse);
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!data || !data.channels) {
    await processLogs.create({
      process_id: processId,
      step: 'error',
      message: 'Не удалось распарсить JSON пресс-релиза из ответа модели',
      data: { raw_response: rawResponse.slice(0, 2000) },
    });
    throw new Error('Failed to parse press release JSON from AI response');
  }

  // 12. Normalize: keep only requested channels
  const normalizedChannels = {};
  for (const ch of channels) {
    if (data.channels[ch]) normalizedChannels[ch] = data.channels[ch];
  }
  const normalizedData = { channels: normalizedChannels };
  if (generateImages && data.image_prompts) normalizedData.image_prompts = data.image_prompts;
  if (generateImages && data.screenshots_needed) normalizedData.screenshots_needed = data.screenshots_needed;

  // 13. Save press release
  await releases.savePressRelease(release.id, normalizedData);

  await processLogs.create({
    process_id: processId,
    step: 'press_release_saved',
    message: `Пресс-релиз сохранён (${Object.keys(normalizedChannels).length} каналов)`,
    data: { channels: Object.keys(normalizedChannels) },
  });

  // 14. Update process → completed
  const durationMs = Date.now() - startTime;
  await processes.update(processId, {
    status: 'completed',
    result: { mode, channels: Object.keys(normalizedChannels), has_images: !!normalizedData.image_prompts },
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
}
