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
  const { provider, model_id, api_key } = model;

  const timeoutMs = options.timeoutMs || TIMEOUT;

  switch (provider) {
    case 'ollama':
      return callOllama(model_id, systemPrompt, userPrompt, timeoutMs);
    case 'mlx':
      return callMLX(model_id, systemPrompt, userPrompt, timeoutMs);
    case 'claude-code':
      return callClaudeCode(model_id, systemPrompt, userPrompt, options);
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

async function callOllama(modelId, systemPrompt, userPrompt, timeoutMs) {
  const resp = await fetchWithTimeout('http://localhost:11434/api/chat', {
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
      if (err) return reject(new Error(`Claude Code error: ${err.message}`));
      resolve(stdout || '');
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
