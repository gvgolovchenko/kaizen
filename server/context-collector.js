import { readFile, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';

// --- Helpers ---

/**
 * Conservative token estimate for mixed rus/eng text.
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 3);
}

/**
 * Read file safely. Returns null for binary files, .env, or on error.
 */
async function tryReadFile(filePath, maxChars = 15000) {
  try {
    if (basename(filePath).startsWith('.env')) return null;

    const buf = await readFile(filePath);

    // Check for binary: null bytes in first 512 bytes
    const checkLen = Math.min(buf.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) return null;
    }

    const text = buf.toString('utf-8');
    return text.length > maxChars ? text.slice(0, maxChars) + '\n... (файл усечён)' : text;
  } catch {
    return null;
  }
}

const DEFAULT_EXCLUDES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.cache', 'coverage',
  '.DS_Store', '.env', '.idea', '.vscode',
]);

/**
 * Build a text directory tree.
 */
async function buildDirectoryTree(dirPath, maxDepth = 3, excludes = DEFAULT_EXCLUDES) {
  const lines = [];

  async function walk(currentPath, prefix, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    // Filter excluded
    entries = entries.filter(e => !excludes.has(e.name));

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`);

      if (entry.isDirectory()) {
        await walk(join(currentPath, entry.name), prefix + childPrefix, depth + 1);
      }
    }
  }

  lines.push(basename(dirPath) + '/');
  await walk(dirPath, '', 1);
  return lines.join('\n');
}

// --- Main ---

/**
 * Collect project context for AI models that can't read files interactively.
 *
 * @param {string} projectPath - Absolute path to the project root
 * @param {object} [options]
 * @param {number} [options.maxTokens] - Token budget (default: 3200)
 * @param {string} [options.techStack] - Tech stack string for extension detection
 * @returns {{ context: string, stats: { filesRead: number, totalChars: number, truncated: boolean } }}
 */
export async function collectProjectContext(projectPath, options = {}) {
  const maxTokens = Math.max(options.maxTokens || 3200, 1000);
  let usedTokens = 0;
  const parts = [];
  let filesRead = 0;
  let totalChars = 0;
  let truncated = false;

  function addPart(text) {
    const tokens = estimateTokens(text);
    if (usedTokens + tokens > maxTokens) {
      // Truncate to fit
      const remainChars = (maxTokens - usedTokens) * 3;
      if (remainChars > 100) {
        parts.push(text.slice(0, remainChars) + '\n... (усечено по бюджету)');
        totalChars += remainChars;
        usedTokens = maxTokens;
        truncated = true;
        return 'truncated';
      }
      truncated = true;
      return 'skip';
    }
    parts.push(text);
    usedTokens += tokens;
    totalChars += text.length;
    return 'added';
  }

  function addFile(relPath, content) {
    filesRead++;
    return addPart(`<file path="${relPath}">\n${content}\n</file>`);
  }

  // Layer 1: Project docs (CLAUDE.md, README.md)
  for (const name of ['CLAUDE.md', 'README.md']) {
    if (usedTokens >= maxTokens) break;
    const content = await tryReadFile(join(projectPath, name));
    if (content) {
      const result = addFile(name, content);
      if (result === 'skip') break;
    }
  }

  // Layer 2: docs/*.md
  if (usedTokens < maxTokens) {
    try {
      const docsDir = join(projectPath, 'docs');
      const entries = await readdir(docsDir);
      const mdFiles = entries.filter(f => f.endsWith('.md')).sort();
      for (const name of mdFiles) {
        if (usedTokens >= maxTokens) break;
        const content = await tryReadFile(join(docsDir, name));
        if (content) {
          const result = addFile(`docs/${name}`, content);
          if (result === 'skip') break;
        }
      }
    } catch {
      // No docs/ directory — fine
    }
  }

  // Layer 3: package.json
  if (usedTokens < maxTokens) {
    const content = await tryReadFile(join(projectPath, 'package.json'));
    if (content) addFile('package.json', content);
  }

  // Layer 4: Directory tree
  if (usedTokens < maxTokens) {
    const tree = await buildDirectoryTree(projectPath);
    addPart(`<directory-tree>\n${tree}\n</directory-tree>`);
  }

  const context = `=== КОНТЕКСТ ПРОЕКТА ===\n\n${parts.join('\n\n')}\n\n=== КОНЕЦ КОНТЕКСТА ===`;

  return {
    context,
    stats: { filesRead, totalChars, truncated },
  };
}
