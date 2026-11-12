// Lightweight in-process parse of an Opurom document.
//
// This is not a compiler: it extracts the declarations the language features
// need (state, model, api) with their source positions, so hover, completion
// and definition can answer without spawning opuromc.

const PUNCTUATION = new Set(['{', '}', '(', ')', '[', ']', ':', ';', ',', '.', '=', '+', '-']);

export function tokenize(text) {
  const tokens = [];
  const source = String(text || '');
  let index = 0;
  let line = 0;
  let character = 0;

  const advance = count => {
    for (let step = 0; step < count; step += 1) {
      if (source[index] === '\n') {
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
      index += 1;
    }
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '\n' || char === ' ' || char === '\t' || char === '\r') {
      advance(1);
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') advance(1);
      continue;
    }
    if (char === '"') {
      const start = { line, character };
      let value = '';
      advance(1);
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\' && index + 1 < source.length) {
          advance(1);
          value += source[index];
          advance(1);
          continue;
        }
        if (source[index] === '{' && source[index + 1] === '{') {
          value += '{';
          advance(2);
          continue;
        }
        if (source[index] === '{') {
          // Interpolation: keep the braces in the raw text.
          value += '{';
          advance(1);
          continue;
        }
        value += source[index];
        advance(1);
      }
      if (index < source.length) advance(1); // closing quote
      tokens.push({ type: 'string', value, start, end: { line, character } });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = { line, character };
      let value = '';
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        value += source[index];
        advance(1);
      }
      tokens.push({ type: 'ident', value, start, end: { line, character } });
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = { line, character };
      let value = '';
      while (index < source.length && /[0-9.]/.test(source[index])) {
        value += source[index];
        advance(1);
      }
      tokens.push({ type: 'number', value, start, end: { line, character } });
      continue;
    }
    if (PUNCTUATION.has(char)) {
      const start = { line, character };
      const value = char;
      advance(1);
      tokens.push({ type: 'punct', value, start, end: { line, character } });
      continue;
    }
    advance(1);
  }
  return tokens;
}

function literalText(token) {
  if (!token) return '';
  if (token.type === 'string') return `"${token.value}"`;
  return token.value;
}

// Infers the Opurom type of a literal: int, bool or string.
export function inferType(token) {
  if (!token) return null;
  if (token.type === 'number') return 'int';
  if (token.type === 'string') return 'string';
  if (token.type === 'ident' && (token.value === 'true' || token.value === 'false')) return 'bool';
  return null;
}

export function parseDocument(text) {
  const tokens = tokenize(text);
  const states = new Map();
  const models = new Map();
  const apis = [];
  const nodeUses = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'ident') continue;

    if (token.value === 'state') {
      const name = tokens[index + 1];
      const equals = tokens[index + 2];
      if (!name || name.type !== 'ident') continue;
      if (!equals || equals.value !== '=') continue;
      const literal = tokens[index + 3];
      if (!states.has(name.value)) {
        states.set(name.value, {
          name: name.value,
          type: inferType(literal),
          initializer: literalText(literal),
          declaration: name.start,
          declarationLine: name.start.line
        });
      }
      continue;
    }

    if (token.value === 'model') {
      const name = tokens[index + 1];
      if (!name || name.type !== 'ident') continue;
      const fields = [];
      let cursor = index + 2;
      while (cursor < tokens.length && tokens[cursor].value !== '{') cursor += 1;
      cursor += 1;
      let depth = 1;
      let field = null;
      while (cursor < tokens.length && depth > 0) {
        const current = tokens[cursor];
        if (current.value === '{') depth += 1;
        if (current.value === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        if (current.type === 'ident' && tokens[cursor + 1]?.value === ':') {
          field = {
            name: current.value,
            type: tokens[cursor + 2]?.value || null,
            primary: false,
            default: null,
            declaration: current.start,
            declarationLine: current.start.line
          };
          fields.push(field);
          cursor += 3;
          continue;
        }
        if (field) {
          if (current.type === 'ident' && current.value === 'primary') field.primary = true;
          if (current.value === '=' && tokens[cursor + 1]) {
            field.default = literalText(tokens[cursor + 1]);
            cursor += 1;
          }
        }
        cursor += 1;
      }
      if (!models.has(name.value)) {
        models.set(name.value, {
          name: name.value,
          fields,
          declaration: name.start,
          declarationLine: name.start.line
        });
      }
      continue;
    }

    if (token.value === 'api') {
      const pathToken = tokens[index + 1];
      if (!pathToken || pathToken.type !== 'string') continue;
      const handlers = [];
      let cursor = index + 2;
      while (cursor < tokens.length && tokens[cursor].value !== '{') cursor += 1;
      cursor += 1;
      let depth = 1;
      while (cursor < tokens.length && depth > 0) {
        const current = tokens[cursor];
        if (current.value === '{') depth += 1;
        if (current.value === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        if (current.type === 'ident' && tokens[cursor + 1]?.type === 'ident') {
          handlers.push({ verb: current.value, model: tokens[cursor + 1].value });
          cursor += 2;
          continue;
        }
        cursor += 1;
      }
      apis.push({
        path: pathToken.value,
        handlers,
        declaration: pathToken.start,
        declarationLine: pathToken.start.line
      });
      continue;
    }

    // Node kind usage: `Kind(` or `Kind {`.
    const next = tokens[index + 1];
    if (next && (next.value === '(' || next.value === '{')) {
      nodeUses.push({ kind: token.value, position: token.start, line: token.start.line });
    }
  }

  return { text: String(text || ''), tokens, states, models, apis, nodeUses };
}

const WORD_CHAR = /[A-Za-z0-9_]/;

// The identifier under the cursor. The cursor may sit at either edge of the
// word, so the word is expanded in both directions.
export function wordAt(document, position) {
  const lines = document.text.split(/\r?\n/);
  const line = lines[position.line] ?? '';
  let start = Math.max(0, Math.min(position.character, line.length));
  let end = start;
  while (start > 0 && WORD_CHAR.test(line[start - 1])) start -= 1;
  while (end < line.length && WORD_CHAR.test(line[end])) end += 1;
  const word = line.slice(start, end);
  return {
    word,
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end }
    }
  };
}
