// Locating the Opurom compiler binary. Node builtins only.
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';

export const COMPILER_ENV = 'OPR_OpuromC';

// Sibling layout: <workspace>/opurom-lsp/lib -> <workspace>/opurom-lang.
export function defaultCompilerPath() {
  return path.resolve(
    import.meta.dirname,
    '..',
    '..',
    'opurom-lang',
    'target',
    'debug',
    'opuromc'
  );
}

export function findOnPath(name, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not executable or not present; keep looking.
    }
  }
  return null;
}

// Resolution order: explicit flag, OPR_OpuromC, the sibling default when it
// exists, then opuromc on PATH, then the sibling default as the last resort.
//
// An explicit value wins even when the file is missing: the server reports
// the missing tool instead of silently using a different compiler.
export function resolveCompiler({ flag, envValue, env = process.env } = {}) {
  const explicit = String(flag || envValue || '').trim();
  if (explicit) return explicit;
  const sibling = defaultCompilerPath();
  if (existsSync(sibling)) return sibling;
  return findOnPath('opuromc', env) || sibling;
}
