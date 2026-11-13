// Quick fixes for the compiler's friendly diagnostics. The compiler prints a
// `help:` line that already contains the exact state declaration it recommends,
// including the type appropriate to the error's context, so that one edit is
// unambiguous. Any other diagnostic (unknown kind, bad colour, type mismatch,
// duplicate state, ...) has no single safe edit and returns no actions.
const UNKNOWN_STATE = /unknown state '([A-Za-z_][A-Za-z0-9_]*)'/;
const DECLARE_HINT = /declare it with '(state\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*.*?)'\s*or\b/;
const CANDIDATE_HINT = /one of:\s*([^\n]*)/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sym(token) {
  return token && token.type === 'punct' ? token.value : '';
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

// States live directly inside `app`. Insert after the last declaration so the
// fix never lands inside a node's child or handler block; with no states yet,
// the declaration goes on the first line of the app body.
function declarationInsertion(document) {
  const tokens = document.tokens;
  const appIndex = tokens.findIndex(token => token.type === 'ident' && token.value === 'app');
  if (appIndex === -1) return null;
  let open = appIndex + 1;
  while (open < tokens.length && sym(tokens[open]) !== '{') open += 1;
  if (open === tokens.length) return null;
  const close = blockEnd(tokens, open);
  let lastStateLine = -1;
  for (let index = open + 1; index < close; index += 1) {
    if (tokens[index].type === 'ident' && tokens[index].value === 'state' &&
        tokens[index + 1]?.type === 'ident') {
      lastStateLine = tokens[index].start.line;
    }
  }
  const line = lastStateLine === -1 ? tokens[open].start.line + 1 : lastStateLine + 1;
  return { line, character: 0 };
}

function quickFixes(document, uri, diagnostic) {
  const message = String(diagnostic.message || '');
  const unknown = UNKNOWN_STATE.exec(message);
  if (!unknown) return [];
  const name = unknown[1];
  const actions = [];

  const declaration = DECLARE_HINT.exec(message);
  const hinted = declaration && /^state\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration[1]);
  const insertion = declarationInsertion(document);
  // A duplicate name or a missing app block would make the edit guess.
  if (declaration && hinted && hinted[1] === name && insertion &&
      !document.states.has(name) && validRange(diagnostic.range)) {
    const point = { start: insertion, end: insertion };
    actions.push({
      title: `Declare state '${name}'`,
      kind: 'quickfix',
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [uri]: [{ range: point, newText: `  ${declaration[1]}\n` }]
        }
      }
    });
  }

  // Replacing the name is only a single safe edit when the compiler names
  // exactly one existing state as an alternative.
  const candidates = (CANDIDATE_HINT.exec(message)?.[1] || '')
    .split(',')
    .map(candidate => candidate.trim())
    .filter(candidate => IDENTIFIER.test(candidate));
  if (candidates.length === 1 && document.states.has(candidates[0]) &&
      validRange(diagnostic.range)) {
    actions.push({
      title: `Use state '${candidates[0]}'`,
      kind: 'quickfix',
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [uri]: [{ range: diagnostic.range, newText: candidates[0] }]
        }
      }
    });
  }
  return actions;
}

function validRange(range) {
  return range && Number.isInteger(range.start?.line) && Number.isInteger(range.start?.character) &&
    Number.isInteger(range.end?.line) && Number.isInteger(range.end?.character);
}

export function codeActions(document, uri, range, context) {
  const diagnostics = Array.isArray(context?.diagnostics) ? context.diagnostics : [];
  const actions = [];
  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic.message !== 'string') continue;
    if (validRange(range) && validRange(diagnostic.range) &&
        (range.start.line > diagnostic.range.end.line ||
         diagnostic.range.start.line > range.end.line)) continue;
    actions.push(...quickFixes(document, uri, diagnostic));
  }
  return actions;
}
