/**
 * Parse JSON array from AI response — handles think tags, markdown fences, nested brackets.
 * @param {string} raw
 * @returns {Array|null}
 */
export function parseJsonFromAI(raw) {
  let str = raw || '';

  // 1. Remove <think>...</think> (closed or unclosed to end of string)
  str = str.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');

  // 2. Try direct parse
  str = str.trim();
  try { const r = JSON.parse(str); return Array.isArray(r) ? r : [r]; } catch {}

  // 3. Extract from markdown code fences
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { const r = JSON.parse(fence[1].trim()); return Array.isArray(r) ? r : [r]; } catch {}
  }

  // 4. Find outermost [ ... ] with balanced brackets
  const start = str.indexOf('[');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < str.length; i++) {
      if (str[i] === '[') depth++;
      else if (str[i] === ']') depth--;
      if (depth === 0) {
        try { const r = JSON.parse(str.slice(start, i + 1)); return Array.isArray(r) ? r : [r]; } catch {}
        break;
      }
    }
  }

  // 5. Find ALL balanced { ... } blocks, try each one (last match wins — AI puts JSON at the end)
  const objects = [];
  for (let s = 0; s < str.length; s++) {
    if (str[s] !== '{') continue;
    let depth = 0;
    for (let i = s; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') depth--;
      if (depth === 0) {
        try { objects.push(JSON.parse(str.slice(s, i + 1))); } catch {}
        s = i; // skip past this block
        break;
      }
    }
  }
  if (objects.length === 1) return [objects[0]];
  if (objects.length > 1) {
    // Prefer object with develop_release keys (branch, commit_hash, summary)
    const dev = objects.find(o => o.branch || o.commit_hash || ('tests_passed' in o));
    if (dev) return [dev];
    return [objects[objects.length - 1]]; // fallback: last object
  }

  return null;
}

/**
 * Detect test command based on product tech stack.
 * @param {string} techStack
 * @returns {string}
 */
/**
 * Detect build/compile command based on tech stack string.
 */
export function detectBuildCommand(techStack) {
  const s = (techStack || '').toLowerCase();
  if (s.includes('dotnet') || s.includes('c#') || s.includes('asp'))
    return 'dotnet build';
  if (s.includes('node') || s.includes('express') || s.includes('react') || s.includes('vue') || s.includes('nuxt'))
    return 'npm run build';
  if (s.includes('python') || s.includes('fastapi') || s.includes('django') || s.includes('flask'))
    return null; // Python не компилируется
  if (s.includes('go'))
    return 'go build ./...';
  if (s.includes('rust'))
    return 'cargo build';
  if (s.includes('java') || s.includes('spring'))
    return 'mvn compile';
  return null;
}

export function detectTestCommand(techStack) {
  const s = (techStack || '').toLowerCase();
  if (s.includes('node') || s.includes('express') || s.includes('react') || s.includes('vue'))
    return 'npm test';
  if (s.includes('python') || s.includes('fastapi') || s.includes('django') || s.includes('flask'))
    return 'pytest';
  if (s.includes('go'))
    return 'go test ./...';
  if (s.includes('dotnet') || s.includes('c#') || s.includes('asp'))
    return 'dotnet test';
  if (s.includes('rust'))
    return 'cargo test';
  if (s.includes('java') || s.includes('spring'))
    return 'mvn test';
  return 'npm test';
}

/**
 * Validate and sanitize a git branch name.
 * @param {string} name
 * @returns {string} sanitized name
 * @throws {Error} if name is invalid
 */
export function validateBranchName(name) {
  if (!name || typeof name !== 'string') throw new Error('Branch name is required');
  const trimmed = name.trim();
  // Only allow alphanumeric, dots, hyphens, underscores, slashes
  if (!/^[a-zA-Z0-9._\/-]+$/.test(trimmed)) {
    throw new Error(`Invalid branch name: "${trimmed}". Allowed: letters, digits, . _ - /`);
  }
  // Disallow dangerous patterns
  if (trimmed.startsWith('-') || trimmed.includes('..') || trimmed.includes('~') || trimmed.endsWith('.lock')) {
    throw new Error(`Invalid branch name: "${trimmed}"`);
  }
  return trimmed;
}

/**
 * Mask api_key in model object for API responses.
 * @param {object} model
 * @returns {object}
 */
export function maskApiKey(model) {
  if (!model || !model.api_key) return model;
  const key = model.api_key;
  if (key.length <= 8) {
    model.api_key = '****';
  } else {
    model.api_key = key.slice(0, 4) + '****' + key.slice(-4);
  }
  return model;
}
