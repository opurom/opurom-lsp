// Document symbols, state references and state rename over a parsed Opurom
// document. All positions come from the tokenizer, so a rename never edits a
// word that merely looks like a state name inside a comment or a plain string.
import { API_VERBS } from './catalog.mjs';
import { wordAt } from './document.mjs';

// LSP SymbolKind values.
const KINDS = {
  Namespace: 3,
  Class: 5,
  Method: 6,
  Field: 8,
  Interface: 11,
  Variable: 13,
  Object: 19
};

// These blocks declare their own names (fields, handlers, theme keys) rather
// than referring to app states, so a state scan must not look inside them.
const DECLARATION_BLOCKS = new Set(['model', 'api', 'theme', 'component']);
const BLOCK_SYMBOLS = {
  model: [KINDS.Class, 'model'],
  api: [KINDS.Interface, 'api'],
  theme: [KINDS.Object, 'theme'],
  component: [KINDS.Class, 'component']
};

function sym(token) {
  return token && token.type === 'punct' ? token.value : '';
}

function tokenRange(token) {
  return { start: token.start, end: token.end };
}

function symbol(name, kind, range, selectionRange, detail, children = []) {
  const result = { name, kind, range, selectionRange };
  if (detail) result.detail = detail;
  if (children.length) result.children = children;
  return result;
}

function blockEnd(tokens, open) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const value = sym(tokens[index]);
    if (value === '{') depth += 1;
    else if (value === '}' && --depth === 0) return index;
  }
  return Math.max(open, tokens.length - 1);
}

function parenEnd(tokens, open) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const value = sym(tokens[index]);
    if (value === '(') depth += 1;
    else if (value === ')' && --depth === 0) return index;
  }
  return Math.max(open, tokens.length - 1);
}

function skipLine(tokens, index, end, line) {
  while (index < end && tokens[index].start.line === line) index += 1;
  return index;
}

function collectFields(tokens, start, end) {
  const fields = [];
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token.type === 'ident' && sym(tokens[index + 1]) === ':') {
      fields.push(symbol(token.value, KINDS.Field, tokenRange(token), tokenRange(token),
        tokens[index + 2]?.value || 'field'));
    }
  }
  return fields;
}

function collectHandlers(tokens, start, end) {
  const handlers = [];
  for (let index = start; index < end - 1; index += 1) {
    const verb = tokens[index];
    const model = tokens[index + 1];
    if (verb.type === 'ident' && model.type === 'ident' && API_VERBS.includes(verb.value)) {
      handlers.push(symbol(`${verb.value} ${model.value}`, KINDS.Method,
        { start: verb.start, end: model.end }, tokenRange(verb), 'handler'));
      index += 1;
    }
  }
  return handlers;
}

// A capitalised identifier followed by `(` or `{` is a component use; the
// compiler recognises node kinds the same way.
function collect(tokens, start, end) {
  const symbols = [];
  let index = start;
  while (index < end) {
    const token = tokens[index];
    if (token.type !== 'ident') {
      index += 1;
      continue;
    }

    if (token.value === 'state') {
      const name = tokens[index + 1];
      if (name && name.type === 'ident') {
        symbols.push(symbol(name.value, KINDS.Variable,
          { start: token.start, end: name.end }, tokenRange(name), 'state'));
      }
      index = skipLine(tokens, index + 1, end, token.start.line);
      continue;
    }

    if (BLOCK_SYMBOLS[token.value]) {
      const label = tokens[index + 1];
      let open = index + 1;
      while (open < end && sym(tokens[open]) !== '{' &&
             sym(tokens[open]) !== '}' && sym(tokens[open]) !== ';') open += 1;
      if (sym(tokens[open]) === '{') {
        const close = blockEnd(tokens, open);
        const named = label && label.type !== 'punct';
        const [kind, detail] = BLOCK_SYMBOLS[token.value];
        const children = token.value === 'model' ? collectFields(tokens, open + 1, close)
          : token.value === 'api' ? collectHandlers(tokens, open + 1, close)
            : token.value === 'component' ? collect(tokens, open + 1, close)
              : [];
        symbols.push(symbol(named ? label.value : token.value, kind,
          { start: token.start, end: tokens[close].end },
          named ? tokenRange(label) : tokenRange(token), detail, children));
        index = close + 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (token.value === 'if' || token.value === 'for') {
      let open = index + 1;
      while (open < end && sym(tokens[open]) !== '{') open += 1;
      if (sym(tokens[open]) === '{') {
        const close = blockEnd(tokens, open);
        symbols.push(symbol(token.value, KINDS.Object,
          { start: token.start, end: tokens[close].end }, tokenRange(token),
          `${token.value} block`, collect(tokens, open + 1, close)));
        index = close + 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (/^[A-Z]/.test(token.value)) {
      let cursor = index + 1;
      let propCount = 0;
      if (sym(tokens[cursor]) === '(') {
        const close = parenEnd(tokens, cursor);
        for (let at = cursor + 1; at < close; at += 1) {
          if (sym(tokens[at]) === ':') propCount += 1;
        }
        cursor = close + 1;
      }
      let last = tokens[Math.min(cursor - 1, end - 1)] || token;
      let children = [];
      if (cursor < end && sym(tokens[cursor]) === '{') {
        const close = blockEnd(tokens, cursor);
        children = collect(tokens, cursor + 1, close);
        last = tokens[close];
        cursor = close + 1;
      }
      symbols.push(symbol(token.value, KINDS.Class,
        { start: token.start, end: last.end }, tokenRange(token),
        propCount ? `${propCount} prop(s)` : 'component', children));
      index = cursor;
      continue;
    }

    index += 1;
  }
  return symbols;
}

export function documentSymbols(document) {
  const tokens = document.tokens;
  const appIndex = tokens.findIndex(token => token.type === 'ident' && token.value === 'app');
  if (appIndex === -1) return collect(tokens, 0, tokens.length);

  let open = appIndex + 1;
  while (open < tokens.length && sym(tokens[open]) !== '{') open += 1;
  if (open === tokens.length) return collect(tokens, 0, tokens.length);

  const name = tokens[appIndex + 1];
  const close = blockEnd(tokens, open);
  const named = name && name.type === 'ident';
  return [symbol(named ? `app ${name.value}` : 'app', KINDS.Namespace,
    { start: tokens[appIndex].start, end: tokens[close].end },
    { start: tokens[appIndex].start, end: (named ? name : tokens[appIndex]).end },
    'application', collect(tokens, open + 1, close))];
}

// Every occurrence of a state name: its declaration, `{state}` interpolations,
// prop values such as `bind:`, condition states, and action-body assignments.
function skippedDeclarationBlocks(tokens) {
  const skipped = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (token.type !== 'ident' || !DECLARATION_BLOCKS.has(token.value)) continue;
    if (previous?.value === 'state' || sym(tokens[index + 1]) === ':' ||
        sym(tokens[index + 1]) === '=') continue;
    // shortcut: a declaration block's brace is found before any enclosing
    // block closes; upgrade to a full parser when declarations may nest.
    let open = index + 1;
    while (open < tokens.length && sym(tokens[open]) !== '{' &&
           sym(tokens[open]) !== '}' && sym(tokens[open]) !== ';') open += 1;
    if (sym(tokens[open]) !== '{') continue;
    const close = blockEnd(tokens, open);
    for (let at = index; at <= close; at += 1) skipped.add(at);
    index = close;
  }
  return skipped;
}

function compareRanges(a, b) {
  return a.start.line - b.start.line || a.start.character - b.start.character;
}

export function stateOccurrences(document, name) {
  const tokens = document.tokens;
  const skipped = skippedDeclarationBlocks(tokens);
  const ranges = [];
  const seen = new Set();
  const add = range => {
    const key = `${range.start.line}:${range.start.character}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push(range);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    if (skipped.has(index)) continue;
    const token = tokens[index];

    if (token.type === 'string') {
      for (const interpolation of token.interpolations || []) {
        if (interpolation.name === name) {
          add({ start: interpolation.start, end: interpolation.end });
        }
      }
      continue;
    }
    if (token.type !== 'ident' || token.value !== name) continue;

    const previous = tokens[index - 1];
    const beforePrevious = tokens[index - 2];
    const next = tokens[index + 1];
    const prevSym = sym(previous);
    const nextSym = sym(next);

    // A prop NAME is never a state reference.
    if (nextSym === ':') continue;

    if (previous?.value === 'state' && nextSym === '=') {
      add(tokenRange(token)); // declaration
      continue;
    }
    if (prevSym === ':' || prevSym === '(' && beforePrevious?.value !== 'for') {
      add(tokenRange(token)); // prop value or `if (state)` condition
      continue;
    }
    if (nextSym === '=' || nextSym === '+=' || nextSym === '-=' ||
        (nextSym === '.' && tokens[index + 2]?.value === 'toggle')) {
      add(tokenRange(token)); // action-body target
      continue;
    }
    if (['=', '+=', '-=', '+', '-'].includes(prevSym) ||
        ['=', '+=', '-='].includes(sym(beforePrevious))) {
      add(tokenRange(token)); // right-hand side of an action expression
    }
  }
  return ranges.sort(compareRanges);
}

function contains(range, position) {
  return position.line === range.start.line && position.line === range.end.line &&
    position.character >= range.start.character && position.character <= range.end.character;
}

// The cursor must sit on a declared state name AND on one of its occurrences;
// a model field or a prop that happens to share the spelling is not renameable.
export function renameTarget(document, position) {
  const { word } = wordAt(document, position);
  if (!word || !document.states.has(word)) return null;
  const occurrences = stateOccurrences(document, word);
  const range = occurrences.find(candidate => contains(candidate, position));
  return range ? { name: word, range, occurrences } : null;
}

export function stateReferences(document, uri, position, includeDeclaration = true) {
  const target = renameTarget(document, position);
  if (!target) return [];
  const declaration = document.states.get(target.name).declaration;
  return target.occurrences
    .filter(range => includeDeclaration ||
      range.start.line !== declaration.line || range.start.character !== declaration.character)
    .map(range => ({ uri, range }));
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
