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

  // 5. Find outermost { ... } (single object)
  const objStart = str.indexOf('{');
  if (objStart !== -1) {
    let depth = 0;
    for (let i = objStart; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') depth--;
      if (depth === 0) {
        try { return [JSON.parse(str.slice(objStart, i + 1))]; } catch {}
        break;
      }
    }
  }

  return null;
}

/**
 * Detect test command based on product tech stack.
 * @param {string} techStack
 * @returns {string}
 */
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
