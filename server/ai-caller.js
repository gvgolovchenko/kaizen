/**
 * AI Caller — unified interface for calling different AI providers.
 * Uses native fetch, no extra npm dependencies.
 */

import { execFile, spawn } from 'child_process';
import { createInterface } from 'readline';

const TIMEOUT = 120000;
const TEMPERATURE = 0.7;
const MAX_TOKENS = 4096;

/**
 * Call an AI model and return the text response.
 * @param {object} model - DB model record { provider, model_id, api_key }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options] - Extra options (e.g. { cwd } for claude-code)
 * @returns {Promise<string>} model response text
 */
export async function callAI(model, systemPrompt, userPrompt, options = {}) {
  const { provider, model_id, api_key, base_url } = model;

  const timeoutMs = options.timeoutMs || TIMEOUT;

  // Pass base_url and api_key into options for CLI-based providers
  if (base_url) options.baseUrl = base_url;
  if (api_key) options.apiKey = api_key;

  switch (provider) {
    case 'ollama':
      return callOllama(model_id, systemPrompt, userPrompt, timeoutMs, base_url);
    case 'mlx':
      return callMLX(model_id, systemPrompt, userPrompt, timeoutMs);
    case 'claude-code':
      return callClaudeCode(model_id, systemPrompt, userPrompt, options);
    case 'qwen-code':
      return callQwenCode(model_id, systemPrompt, userPrompt, options);
    case 'kilo-code':
      return callKiloCode(model_id, systemPrompt, userPrompt, options);
    case 'anthropic':
      return callAnthropic(model_id, api_key, systemPrompt, userPrompt, timeoutMs);
    case 'openai':
      return callOpenAI(model_id, api_key, systemPrompt, userPrompt, timeoutMs);
    case 'google':
      return callGoogle(model_id, api_key, systemPrompt, userPrompt, timeoutMs);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function fetchWithTimeout(url, opts, timeoutMs = TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`AI request timed out (${Math.round(timeoutMs / 1000)}s)`);
    throw err;
  }
}

// ── Ollama ──────────────────────────────────────────────

async function callOllama(modelId, systemPrompt, userPrompt, timeoutMs, baseUrl) {
  const url = baseUrl ? `${baseUrl.replace(/\/v1\/?$/, '')}/api/chat` : 'http://localhost:11434/api/chat';
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: { temperature: TEMPERATURE, num_predict: MAX_TOKENS },
    }),
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.message?.content || '';
}

// ── MLX ─────────────────────────────────────────────────

async function callMLX(modelId, systemPrompt, userPrompt, timeoutMs) {
  const resp = await fetchWithTimeout('http://localhost:8080/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`MLX error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Kilo Code (CLI) ───────────────────────────────────

async function callKiloCode(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--format', 'default',
      '--auto',
    ];
    if (modelId) args.push('--model', modelId);
    if (opts.cwd) args.push('--dir', opts.cwd);

    // System prompt + user prompt combined as message
    args.push('--', `${systemPrompt}\n\n${userPrompt}`);

    const env = { ...process.env };

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const maxBuffer = (opts.maxBufferMb || 10) * 1024 * 1024;
    const execOpts = { timeout, env, maxBuffer };

    const child = execFile('kilo', args, execOpts, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Kilo Code error: ${err.message}`));
      resolve(stdout || '');
    });
    child.stdin.end();
  });
}

/**
 * Call Kilo Code CLI with streaming JSON output.
 */
export async function callKiloCodeStreaming(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--format', 'json',
      '--auto',
    ];
    if (modelId) args.push('--model', modelId);
    if (opts.cwd) args.push('--dir', opts.cwd);

    args.push('--', `${systemPrompt}\n\n${userPrompt}`);

    const env = { ...process.env };

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const spawnOpts = { env };

    const child = spawn('kilo', args, spawnOpts);
    const events = [];
    let lastText = '';

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (opts.onEvent) opts.onEvent(event);
        // Capture text from text events
        if (event.type === 'text' && event.part?.text) {
          lastText = event.part.text;
        }
        // Capture result event if present
        if (event.type === 'result' && event.result) {
          lastText = event.result;
        }
      } catch { /* skip non-JSON lines */ }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Kilo Code timeout (${Math.round(timeout / 60000)} мин)`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      rl.close();
      if (code !== 0 && !lastText) {
        return reject(new Error(`Kilo Code exited with code ${code}`));
      }
      resolve({ text: lastText, events });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      rl.close();
      reject(new Error(`Kilo Code spawn error: ${err.message}`));
    });

    child.stdin.end();
  });
}

// ── Claude Code (CLI) ──────────────────────────────────

async function callClaudeCode(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const tools = (opts.allowedTools || ['Read', 'Glob', 'Grep']).join(',');

    const args = [
      '-p',
      '--output-format', 'text',
      '--model', modelId,
      '--dangerously-skip-permissions',
      '--tools', tools,
      '--system-prompt', systemPrompt,
      '--',
      userPrompt,
    ];

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) delete env[key];
    }

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const maxBuffer = (opts.maxBufferMb || 10) * 1024 * 1024;
    const execOpts = { timeout, env, maxBuffer };
    if (opts.cwd) execOpts.cwd = opts.cwd;

    const child = execFile('claude', args, execOpts, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Claude Code error: ${err.message}${stderr ? '\nStderr: ' + stderr : ''}`));
      resolve(stdout || '');
    });
    child.stdin.end();
  });
}

// ── Qwen Code (CLI) ────────────────────────────────────

async function callQwenCode(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const tools = opts.allowedTools || ['Read', 'Glob', 'Grep'];

    const args = [
      '--output-format', 'text',
      '--yolo',
      '--allowed-tools', ...tools,
      '--max-session-turns', '50',
    ];
    if (modelId) args.push('--model', modelId);

    const env = { ...process.env };
    // Custom base URL (e.g. Ollama OpenAI-compat at localhost:11434/v1)
    if (opts.baseUrl) {
      env.OPENAI_BASE_URL = opts.baseUrl;
      env.OPENAI_API_KEY = opts.apiKey || 'ollama';
      env.OPENAI_MODEL = modelId;
      args.push('--auth-type', 'openai');
    } else if (opts.apiKey) {
      env.OPENAI_API_KEY = opts.apiKey;
    }

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const maxBuffer = (opts.maxBufferMb || 10) * 1024 * 1024;
    const execOpts = { timeout, env, maxBuffer };
    if (opts.cwd) execOpts.cwd = opts.cwd;

    const child = execFile('qwen', args, execOpts, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Qwen Code error: ${err.message}`));
      resolve(stdout || '');
    });
    child.stdin.write(`${systemPrompt}\n\n${userPrompt}`);
    child.stdin.end();
  });
}

/**
 * Call Qwen Code CLI with streaming NDJSON output.
 */
export async function callQwenCodeStreaming(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const tools = opts.allowedTools || ['Read', 'Glob', 'Grep'];
    const args = [
      '--output-format', 'stream-json',
      '--yolo',
      '--allowed-tools', ...tools,
      '--max-session-turns', '50',
    ];
    if (modelId) args.push('--model', modelId);

    const env = { ...process.env };
    // Custom base URL (e.g. Ollama OpenAI-compat at localhost:11434/v1)
    if (opts.baseUrl) {
      env.OPENAI_BASE_URL = opts.baseUrl;
      env.OPENAI_API_KEY = opts.apiKey || 'ollama';
      env.OPENAI_MODEL = modelId;
      args.push('--auth-type', 'openai');
    } else if (opts.apiKey) {
      env.OPENAI_API_KEY = opts.apiKey;
    }

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const spawnOpts = { env, cwd: opts.cwd || process.cwd() };

    const child = spawn('qwen', args, spawnOpts);
    child.stdin.write(`${systemPrompt}\n\n${userPrompt}`);
    child.stdin.end();
    const events = [];
    let lastText = '';

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (opts.onEvent) opts.onEvent(event);
        // Capture last text result
        if (event.type === 'result' && event.result) lastText = event.result;
        if (event.type === 'assistant' && event.message?.content) {
          const textBlock = event.message.content.find(b => b.type === 'text');
          if (textBlock) lastText = textBlock.text;
        }
      } catch { /* skip non-JSON lines */ }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Qwen Code timeout (${Math.round(timeout / 60000)} мин)`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !lastText) {
        return reject(new Error(`Qwen Code exited with code ${code}`));
      }
      resolve({ text: lastText, events });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Qwen Code spawn error: ${err.message}`));
    });

    child.stdin.end();
  });
}

// ── Claude Code Streaming (spawn + NDJSON) ─────────────

/**
 * Call Claude Code CLI with streaming NDJSON output.
 * Returns { text, events } where text is the final result.
 * @param {string} modelId
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {string[]} [opts.allowedTools]
 * @param {string} [opts.cwd]
 * @param {number} [opts.timeoutMs]
 * @param {function} [opts.onEvent] - called for each NDJSON event
 * @returns {Promise<{text: string, events: object[]}>}
 */
export async function callClaudeCodeStreaming(modelId, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const tools = (opts.allowedTools || ['Read', 'Glob', 'Grep']).join(',');
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', modelId,
      '--dangerously-skip-permissions',
      '--tools', tools,
      '--system-prompt', systemPrompt,
      '--', userPrompt,
    ];

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) delete env[key];
    }

    const child = spawn('claude', args, {
      env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();

    let resultText = '';
    const events = [];

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (opts.onEvent) {
          Promise.resolve(opts.onEvent(event)).catch(() => {});
        }

        // Collect final text from result event
        if (event.type === 'result') {
          resultText = event.result || '';
        }
      } catch { /* skip non-JSON lines */ }
    });

    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude Code timeout (${Math.round(timeout / 60000)}min)`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      rl.close();
      if (code !== 0 && !resultText) {
        reject(new Error(`Claude Code exited with code ${code}`));
      } else {
        resolve({ text: resultText, events });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      rl.close();
      reject(new Error(`Claude Code spawn error: ${err.message}`));
    });
  });
}

// ── Anthropic ───────────────────────────────────────────

async function callAnthropic(modelId, apiKey, systemPrompt, userPrompt, timeoutMs) {
  if (!apiKey) throw new Error('API key required for Anthropic');

  const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

// ── OpenAI ──────────────────────────────────────────────

async function callOpenAI(modelId, apiKey, systemPrompt, userPrompt, timeoutMs) {
  if (!apiKey) throw new Error('API key required for OpenAI');

  const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Google (Gemini) ─────────────────────────────────────

async function callGoogle(modelId, apiKey, systemPrompt, userPrompt, timeoutMs) {
  if (!apiKey) throw new Error('API key required for Google');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_TOKENS,
      },
    }),
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
