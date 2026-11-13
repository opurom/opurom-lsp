// Type inlay hints for state declarations.
//
// The label repeats the type the hover already reports for the same state, so
// this feature reads the shared parse instead of deriving types again.
const compare = (a, b) => (a.line - b.line) || (a.character - b.character);

const contains = (range, position) =>
  compare(position, range.start) >= 0 && compare(position, range.end) < 0;

export function inlayHints(document, range) {
  const lines = document.text.split(/\r?\n/);
  const hints = [];
  for (const state of document.states.values()) {
    // No literal initializer means no inferred type, and an `unknown` label
    // would repeat nothing useful.
    if (!state.type) continue;
    const position = { line: state.declarationLine, character: (lines[state.declarationLine] ?? '').length };
    if (range && !contains(range, position)) continue;
    hints.push({ position, label: `: ${state.type}`, kind: 1 });
  }
  return hints;
}
