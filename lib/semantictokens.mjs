// Semantic tokens over a parsed Opurom document.
//
// The legend carries only the token types the parse classifies exactly: state
// occurrences reuse the reference classifier, so declaration, interpolation,
// prop value and action-body ranges match what references and rename operate
// on; model names and node-kind uses come from the parse; api paths are the
// string tokens the parse recorded as api declarations. Everything else keeps
// the colour the TextMate grammar already gives it.
import { NODE_KIND_NAMES } from './catalog.mjs';
import { stateOccurrences } from './symbols.mjs';

export const SEMANTIC_TOKEN_TYPES = ['state', 'model', 'apiPath', 'nodeKind'];

const STATE = 0;
const MODEL = 1;
const API_PATH = 2;
const NODE_KIND = 3;

const key = position => `${position.line}:${position.character}`;

export function semanticTokens(document) {
  const marks = [];
  const emitted = new Set();

  for (const name of document.states.keys()) {
    for (const range of stateOccurrences(document, name)) {
      emitted.add(key(range.start));
      marks.push({
        line: range.start.line,
        character: range.start.character,
        length: range.end.character - range.start.character,
        type: STATE
      });
    }
  }

  const nodeUses = new Set(document.nodeUses.map(use => key(use.position)));
  const apiPaths = new Set(document.apis.map(api => key(api.declaration)));

  for (let index = 0; index < document.tokens.length; index += 1) {
    const token = document.tokens[index];
    if (token.type === 'string') {
      if (apiPaths.has(key(token.start))) {
        marks.push({
          line: token.start.line,
          character: token.start.character,
          length: token.end.character - token.start.character,
          type: API_PATH
        });
      }
      continue;
    }
    if (token.type !== 'ident' || emitted.has(key(token.start))) continue;
    if (nodeUses.has(key(token.start)) && NODE_KIND_NAMES.includes(token.value)) {
      marks.push({
        line: token.start.line,
        character: token.start.character,
        length: token.end.character - token.start.character,
        type: NODE_KIND
      });
      continue;
    }
    // A prop name is followed by `:`; a model name never is.
    if (document.models.has(token.value) && document.tokens[index + 1]?.value !== ':') {
      marks.push({
        line: token.start.line,
        character: token.start.character,
        length: token.end.character - token.start.character,
        type: MODEL
      });
    }
  }

  marks.sort((a, b) => a.line - b.line || a.character - b.character);
  const data = [];
  let line = 0;
  let character = 0;
  for (const mark of marks) {
    data.push(
      mark.line - line,
      mark.line === line ? mark.character - character : mark.character,
      mark.length,
      mark.type,
      0 // no token modifiers
    );
    line = mark.line;
    character = mark.character;
  }
  return data;
}
