import { renameTarget } from './symbols.mjs';

export function documentHighlights(document, position) {
  const target = renameTarget(document, position);
  if (!target) return [];
  const declaration = document.states.get(target.name).declaration;
  return target.occurrences.map(range => ({
    range,
    kind: range.start.line === declaration.line &&
      range.start.character === declaration.character ? 2 : 1
  }));
}
