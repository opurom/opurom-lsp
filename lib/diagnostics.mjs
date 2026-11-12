// Parse `opuromc check` output into LSP diagnostics.
//
// Compiler format (stderr or stdout):
//   path:line:col: error: message
//     help: how to fix it
const DIAGNOSTIC_RE = /^(.*?):(\d+):(\d+):\s*(error|warning):\s*(.*)$/;
const HELP_RE = /^\s*help:\s*(.*)$/;

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
      message: help ? `${message}\nhelp: ${help[1].trim()}` : message
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
  return parsed.map(diagnostic => ({
    range: toRange(diagnostic, lines[diagnostic.line]),
    severity: diagnostic.severity,
    source: 'opuromc',
    message: diagnostic.message
  }));
}
