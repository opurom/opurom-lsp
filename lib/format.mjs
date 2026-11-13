// Deterministic Opurom formatter. The token stream is re-emitted from scratch,
// so braces, indentation and spacing no longer depend on the source spelling.
// Re-emitting the output again produces the same bytes (idempotence): every
// `{` ends a line, every `}` starts one, and spacing depends only on the
// neighbouring token kinds. String literals and comments keep their raw text.
import { tokenize } from './document.mjs';

const INDENT = '  ';
const NO_SPACE_BEFORE = new Set([')', ']', ',', ';', ':', '.']);
const NO_SPACE_AFTER = new Set(['(', '[', '.']);
const KEYWORDS_WITH_PAREN = new Set(['if', 'for', 'while', 'match']);
const SIGNS = new Set(['+', '-']);

function sym(token) {
  return token && token.type === 'punct' ? token.value : '';
}

function endsValue(token) {
  if (!token) return false;
  return token.type === 'ident' || token.type === 'number' || token.type === 'string' ||
    sym(token) === ')' || sym(token) === ']';
}

function isSign(tokens, index) {
  return SIGNS.has(sym(tokens[index])) && !endsValue(tokens[index - 1]);
}

function needsSpace(tokens, index) {
  const previous = tokens[index - 1];
  const token = tokens[index];
  if (isSign(tokens, index - 1)) return false;
  if (NO_SPACE_AFTER.has(sym(previous))) return false;
  if (NO_SPACE_BEFORE.has(sym(token))) return false;
  if (sym(token) === '(') {
    return previous.type === 'ident' && KEYWORDS_WITH_PAREN.has(previous.value);
  }
  return true;
}

function render(tokens) {
  let text = '';
  for (let index = 0; index < tokens.length; index += 1) {
    if (index > 0 && needsSpace(tokens, index)) text += ' ';
    text += tokens[index].raw;
  }
  return text;
}

export function formatDocument(text) {
  const source = String(text || '');
  const tokens = tokenize(source);
  const sourceLines = source.split(/\r?\n/);
  const blankBefore = new Set();
  for (let line = 1; line < sourceLines.length; line += 1) {
    if (!sourceLines[line - 1].trim() && sourceLines[line].trim()) blankBefore.add(line);
  }

  const lines = [];
  let buffer = [];
  let bufferLine = -1;
  let lastSourceLine = -1;
  let depth = 0;
  let parens = 0;

  const emit = (line, sourceLine) => {
    if (lines.length && lines[lines.length - 1] !== '' && blankBefore.has(sourceLine)) {
      lines.push('');
    }
    lines.push(line);
    lastSourceLine = sourceLine;
  };

  const flush = () => {
    if (!buffer.length) return;
    emit(INDENT.repeat(Math.max(0, depth)) + render(buffer), bufferLine);
    buffer = [];
    bufferLine = -1;
    parens = 0;
  };

  for (const token of tokens) {
    const value = sym(token);

    if (token.type === 'comment') {
      if (parens === 0 && buffer.length && token.start.line === bufferLine) {
        buffer.push(token); // trailing comment stays with its statement
      } else if (parens === 0 && lines.length && token.start.line === lastSourceLine) {
        lines[lines.length - 1] += ` ${token.raw}`;
      } else {
        flush();
        emit(INDENT.repeat(Math.max(0, depth)) + token.raw, token.start.line);
      }
      continue;
    }

    // A line break ends a statement, but not an unfinished argument list.
    if (buffer.length && token.start.line !== bufferLine && parens === 0) flush();
    if (!buffer.length) bufferLine = token.start.line;

    if (value === '(' || value === '[') parens += 1;
    if (value === ')' || value === ']') parens = Math.max(0, parens - 1);

    if (value === '{') {
      buffer.push(token);
      flush();
      depth += 1;
      continue;
    }
    if (value === '}') {
      // An empty block stays on one line: `theme {}`.
      if (!buffer.length && lines.length && lines[lines.length - 1].trimEnd().endsWith('{')) {
        lines[lines.length - 1] += '}';
        depth = Math.max(0, depth - 1);
        lastSourceLine = token.start.line;
        continue;
      }
      flush();
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + '}');
      lastSourceLine = token.start.line;
      continue;
    }
    if (value === ';') {
      buffer.push(token);
      flush();
      continue;
    }
    buffer.push(token);
  }
  flush();
  return lines.length ? `${lines.join('\n')}\n` : '';
}
