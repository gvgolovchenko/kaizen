/**
 * AI Caller — unified interface for calling different AI providers.
 * Uses native fetch, no extra npm dependencies.
 */

const TIMEOUT = 120000;
const TEMPERATURE = 0.7;
const MAX_TOKENS = 4096;

/**
 * Call an AI model and return the text response.
 * @param {object} model - DB model record { provider, model_id, api_key }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} model response text
 */
export async function callAI(model, systemPrompt, userPrompt) {
  const { provider, model_id, api_key } = model;

  switch (provider) {
    case 'ollama':
      return callOllama(model_id, systemPrompt, userPrompt);
    case 'mlx':
      return callMLX(model_id, systemPrompt, userPrompt);
    case 'anthropic':
      return callAnthropic(model_id, api_key, systemPrompt, userPrompt);
    case 'openai':
      return callOpenAI(model_id, api_key, systemPrompt, userPrompt);
    case 'google':
      return callGoogle(model_id, api_key, systemPrompt, userPrompt);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('AI request timed out (120s)');
    throw err;
  }
}

// ── Ollama ──────────────────────────────────────────────

async function callOllama(modelId, systemPrompt, userPrompt) {
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
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.message?.content || '';
}

// ── MLX ─────────────────────────────────────────────────

async function callMLX(modelId, systemPrompt, userPrompt) {
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
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`MLX error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Anthropic ───────────────────────────────────────────

async function callAnthropic(modelId, apiKey, systemPrompt, userPrompt) {
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
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

// ── OpenAI ──────────────────────────────────────────────

async function callOpenAI(modelId, apiKey, systemPrompt, userPrompt) {
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
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Google (Gemini) ─────────────────────────────────────

async function callGoogle(modelId, apiKey, systemPrompt, userPrompt) {
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
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
