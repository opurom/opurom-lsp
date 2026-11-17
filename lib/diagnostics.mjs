// Parse `opuromc check` output into LSP diagnostics.
//
// Compiler format (stderr or stdout):
//   path:line:col: error: message
//     help: how to fix it
//
// The compiler does not emit stable error codes yet. Until it does, the code
// is derived from the message template (quoted values and numbers removed, so
// the same rule always maps to the same code) and the correction text travels
// both in the message, as before, and in `data.correctionMessage`.
const DIAGNOSTIC_RE = /^(.*?):(\d+):(\d+):\s*(error|warning):\s*(.*)$/;
const HELP_RE = /^\s*help:\s*(.*)$/;

// Two leading words after normalization identify a rule without growing into
// a second rule table; unknown shapes fall back to a single generic code.
function stableCode(message) {
  const template = message
    .replace(/'[^']*'/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return template ? `opurom.${template}` : 'opurom.diagnostic';
}

// Diagnostic tags without a rule table: the compiler only ever reports these
// two shapes as text, so the same keywords map to the same tags.
function stableTags(message) {
  const tags = [];
  if (/\bdeprecated\b/i.test(message)) tags.push(1);
  if (/\bunused\b|\bnever used\b/i.test(message)) tags.push(2);
  return tags;
}

export function parseCompilerOutput(text) {
  const diagnostics = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = DIAGNOSTIC_RE.exec(raw.trimEnd());
    if (!match) continue;
    const message = match[5].trim();
    // The `help:` line directly below belongs to this diagnostic; it becomes
    // the second line of the message.
    const help = HELP_RE.exec(lines[index + 1] || '');
    if (help) index += 1;
    diagnostics.push({
      line: Math.max(0, Number(match[2]) - 1),
      character: Math.max(0, Number(match[3]) - 1),
      severity: match[4] === 'warning' ? 2 : 1,
      message: help ? `${message}\nhelp: ${help[1].trim()}` : message,
      help: help ? help[1].trim() : null,
      code: stableCode(message),
      tags: stableTags(message)
    });
  }
  return diagnostics;
}

// The compiler reports a single character position; widen the range to the
// token that starts there so editors underline the whole word.
export function toRange(diagnostic, sourceLine) {
  const start = diagnostic.character;
  const text = sourceLine ?? '';
  let end = start + 1;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
  return {
    start: { line: diagnostic.line, character: start },
    end: { line: diagnostic.line, character: Math.max(end, start + 1) }
  };
}

export function toLspDiagnostics(parsed, text) {
  const lines = String(text || '').split(/\r?\n/);
  return parsed.map(diagnostic => {
    const lspDiagnostic = {
      range: toRange(diagnostic, lines[diagnostic.line]),
      severity: diagnostic.severity,
      source: 'opuromc',
      code: diagnostic.code || stableCode(String(diagnostic.message || '')),
      message: diagnostic.message
    };
    const tags = diagnostic.tags || stableTags(String(diagnostic.message || ''));
    if (tags.length) lspDiagnostic.tags = tags;
    if (diagnostic.help) lspDiagnostic.data = { correctionMessage: diagnostic.help };
    return lspDiagnostic;
  });
}
