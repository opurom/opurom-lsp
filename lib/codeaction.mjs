// Quick fixes for the compiler's friendly diagnostics. Three layers, in
// order: fixes the compiler supplies for its own error code, the canonical
// prefix of its `help:` line, and the message text as a last resort. The
// server owns no error-code table; codes and edits come from the compiler,
// so a diagnostic without structured data falls through instead of guessing.
const UNKNOWN_STATE = /unknown state '([A-Za-z_][A-Za-z0-9_]*)'/;
const DECLARE_HINT = /declare it with '(state\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*.*?)'\s*or\b/;
const CANDIDATE_HINT = /one of:\s*([^\n]*)/;
const HELP_LINE = /^help:\s*(.*)$/m;
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

// The compiler's own fix instructions, when it emits them on the diagnostic.
// `code` identifies the diagnostic; `data.fixes` carries the edits, so this
// layer adds no rule of its own.
function structuredFixes(diagnostic) {
  const fixes = diagnostic.data?.fixes;
  if (!Array.isArray(fixes)) return [];
  const wellFormed = fix => fix && typeof fix.title === 'string' && fix.title.length > 0 &&
    fix.changes && typeof fix.changes === 'object' &&
    Object.keys(fix.changes).length > 0 &&
    Object.values(fix.changes).every(edits => Array.isArray(edits) && edits.every(edit =>
      edit && typeof edit.newText === 'string' && validRange(edit.range)));
  return fixes.filter(wellFormed).map(fix => ({
    title: fix.title,
    kind: fix.kind || 'quickfix',
    diagnostics: [diagnostic],
    edit: { changes: fix.changes }
  }));
}

function correctionOf(diagnostic) {
  if (typeof diagnostic.data?.correctionMessage === 'string') {
    return diagnostic.data.correctionMessage;
  }
  return HELP_LINE.exec(String(diagnostic.message || ''))?.[1] || '';
}

// The identifier the diagnostic points at, if the compiler flagged a word.
function identifierAt(document, range) {
  if (!validRange(range)) return null;
  const line = String(document.text || '').split(/\r?\n/)[range.start.line] || '';
  const token = line.slice(range.start.character, range.end.character);
  return IDENTIFIER.test(token) ? token : null;
}

// Actions implied by the canonical `help:` prefix, validated against the
// diagnostic's own token so a stale or mismatched help line fixes nothing.
function helpFixes(document, uri, diagnostic) {
  const help = correctionOf(diagnostic);
  if (!help) return [];
  const token = identifierAt(document, diagnostic.range);
  if (!token) return [];
  const actions = [];

  const declaration = DECLARE_HINT.exec(help);
  const hinted = declaration && /^state\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration[1]);
  const insertion = declarationInsertion(document);
  if (hinted && hinted[1] === token && insertion && !document.states.has(token)) {
    const point = { start: insertion, end: insertion };
    actions.push({
      title: `Declare state '${token}'`,
      kind: 'quickfix',
      diagnostics: [diagnostic],
      edit: { changes: { [uri]: [{ range: point, newText: `  ${declaration[1]}\n` }] } }
    });
  }

  // Replacing the name is only one safe edit when the help names exactly one
  // existing state as the alternative.
  const candidates = (CANDIDATE_HINT.exec(help)?.[1] || '')
    .split(',')
    .map(candidate => candidate.trim())
    .filter(candidate => IDENTIFIER.test(candidate));
  if (candidates.length === 1 && candidates[0] !== token && document.states.has(candidates[0])) {
    actions.push({
      title: `Use state '${candidates[0]}'`,
      kind: 'quickfix',
      diagnostics: [diagnostic],
      edit: { changes: { [uri]: [{ range: diagnostic.range, newText: candidates[0] }] } }
    });
  }
  return actions;
}

// Last resort: the message text, including the help line the diagnostics
// parser appended to it. Used only when the compiler supplies no structured
// fix and the help prefix yields nothing.
function messageFixes(document, uri, diagnostic) {
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

function quickFixes(document, uri, diagnostic) {
  const structured = structuredFixes(diagnostic);
  if (structured.length) return structured;
  const fromHelp = helpFixes(document, uri, diagnostic);
  if (fromHelp.length) return fromHelp;
  return messageFixes(document, uri, diagnostic);
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
