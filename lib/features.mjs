// Hover, completion and definition over a parsed Opurom document.
import {
  ANIMATE_VALUES,
  API_VERBS,
  BOOL_PROPS,
  CANONICAL_PROPS,
  COMPONENTS,
  DESIGN_TONES,
  DESIGN_VARIANTS,
  FIELD_TYPES,
  GENERIC_PROPS,
  GESTURE_VALUES,
  KEYWORDS,
  NODE_KINDS,
  NODE_KIND_NAMES,
  PROP_VALUES,
  findCanonicalProp,
  findComponent,
  findNodeKind,
  resolveKind
} from './catalog.mjs';
import { wordAt } from './document.mjs';

function markdownHover(contents) {
  return { contents: { kind: 'markdown', value: contents } };
}

function findModelField(document, name, line) {
  const matches = [];
  for (const model of document.models.values()) {
    for (const field of model.fields) {
      if (field.name === name) matches.push({ model, field });
    }
  }
  // shortcut: first model wins off a declaration line, upgrade when field references are scoped.
  return matches.find(match => match.field.declarationLine === line) || matches[0] || null;
}

export function hover(document, position) {
  const { word, range } = wordAt(document, position);
  if (!word) return null;

  const state = document.states.get(word);
  if (state) {
    const type = state.type || 'unknown';
    const initializer = state.initializer ? ` = ${state.initializer}` : '';
    return {
      ...markdownHover(
        `**state** \`${state.name}\`\n\n` +
        `- type: \`${type}\`\n` +
        `- initializer: \`${state.initializer || '(none)'}\`\n` +
        `- declared at line ${state.declarationLine + 1}`
      ),
      range
    };
  }

  const model = document.models.get(word);
  if (model) {
    const fields = model.fields
      .map(field => `  - \`${field.name}\`: \`${field.type}\`${field.primary ? ' (primary)' : ''}`)
      .join('\n');
    return {
      ...markdownHover(
        `**model** \`${model.name}\`\n\n` +
        `- declared at line ${model.declarationLine + 1}\n` +
        (fields ? `- fields:\n${fields}` : '- fields: (none)')
      ),
      range
    };
  }

  const local = document.components.get(word);
  if (local) {
    const params = local.params.length
      ? local.params.map(param => `\`${param.name}${param.type ? `: ${param.type}` : ''}\``).join(', ')
      : '(none)';
    return {
      ...markdownHover(
        `**component** \`${local.name}\`\n\n` +
        `- params: ${params}\n` +
        `- declared at line ${local.declarationLine + 1}`
      ),
      range
    };
  }

  const kind = findNodeKind(word);
  if (kind) {
    const props = kind.props.length ? kind.props.map(prop => `\`${prop}\``).join(', ') : '(none)';
    return {
      ...markdownHover(
        `**node kind** \`${kind.name}\`\n\n` +
        `- props: ${props}\n` +
        `- children: ${kind.children ? 'yes' : 'no'}` +
        (kind.handler ? `\n- handler: \`${kind.handler}\`` : '')
      ),
      range
    };
  }

  const component = findComponent(word);
  if (component) {
    const defaults = Object.keys(component.defaults || {}).length
      ? Object.entries(component.defaults)
          .map(([key, value]) => `\`${key}: ${value}\``)
          .join(', ')
      : '(none)';
    return {
      ...markdownHover(
        `**component** \`${component.name}\`\n\n` +
        `- lowers to primitive \`${component.primitive}\` (\`${component.category}\`)\n` +
        `- default props: ${defaults}`
      ),
      range
    };
  }

  const prop = findCanonicalProp(word);
  if (prop) {
    const shortcut = prop.shortcut ? ` (shortcut \`${prop.shortcut}\`)` : '';
    return {
      ...markdownHover(
        `**canonical prop** \`${prop.name}\`${shortcut}\n\n` +
        `- type: \`${prop.type}\``
      ),
      range
    };
  }

  if (ANIMATE_VALUES.includes(word)) {
    return {
      ...markdownHover(`**animate value** \`${word}\`\n\nEntry animation preset for the \`animate\` prop.`),
      range
    };
  }

  if (GESTURE_VALUES.includes(word)) {
    return {
      ...markdownHover(`**gesture value** \`${word}\`\n\nGesture that binds a node's handler for the \`gesture\` prop.`),
      range
    };
  }

  if (KEYWORDS.includes(word)) {
    return { ...markdownHover(`**keyword** \`${word}\``), range };
  }

  // Fields are checked last so no catalog word loses its existing hover.
  const declared = findModelField(document, word, position.line);
  if (declared) {
    const { model, field } = declared;
    const primary = field.primary ? ' (primary)' : '';
    return {
      ...markdownHover(
        `**model field** \`${model.name}.${field.name}\`${primary}\n\n` +
        `- type: \`${field.type || 'unknown'}\`\n` +
        `- declared at line ${field.declarationLine + 1}`
      ),
      range
    };
  }

  return null;
}

function item(label, kind, detail, documentation = detail) {
  const item_ = { label, kind };
  if (detail) item_.detail = detail;
  if (documentation) item_.documentation = documentation;
  return item_;
}

// The innermost callee enclosing the caret: a node kind (primitive or catalog
// component), a locally declared component, or neither.
function calleeAt(document, position) {
  const stack = [];
  let previous = null;
  for (const token of document.tokens) {
    if (token.end.line > position.line ||
        (token.end.line === position.line && token.end.character > position.character)) break;
    if (token.type === 'punct' && token.value === '(') {
      const component = previous?.type === 'ident' ? document.components.get(previous.value) || null : null;
      const kind = component ? null : previous?.type === 'ident' ? resolveKind(previous.value) : null;
      stack.push({ kind, component });
    } else if (token.type === 'punct' && token.value === ')') {
      stack.pop();
    }
    previous = token;
  }
  return stack.filter(frame => frame.kind || frame.component).at(-1) || null;
}

// Stable ordering so required props stay first wherever the client re-sorts.
function sorted(items) {
  return items.map((entry, index) => ({ ...entry, sortText: String(index).padStart(3, '0') }));
}

// Props accepted at the caret inside a node literal: the kind's own props
// first (required ones marked), then the props every kind accepts, the design
// props and the source shortcuts.
function propItems(kind, wordRange) {
  const required = new Set(kind.required || []);
  const seen = new Set();
  const items = [];
  const push = (label, detail, documentation, snippet = false) => {
    if (seen.has(label)) return;
    seen.add(label);
    const entry = item(label, 10, detail, documentation);
    // Named-argument semantics: the client replaces the typed prefix with the
    // attribute name and a colon, leaving the value position ready to type.
    entry.filterText = label;
    entry.textEdit = {
      range: wordRange,
      newText: snippet ? `${label}: \${1:value}` : `${label}: `
    };
    if (snippet) entry.insertTextFormat = 2; // Snippet
    items.push(entry);
  };
  for (const prop of kind.props) {
    push(
      prop,
      required.has(prop) ? `${kind.name} attribute (required)` : `${kind.name} attribute`,
      `${kind.name} attribute \`${prop}\``,
      required.has(prop)
    );
  }
  for (const prop of GENERIC_PROPS) push(prop, 'generic attribute', `generic attribute \`${prop}\``);
  for (const prop of ['state', 'variant', 'tone']) push(prop, 'design attribute', `design attribute \`${prop}\``);
  for (const prop of CANONICAL_PROPS) {
    if (prop.shortcut) push(prop.shortcut, `shortcut for ${prop.name}`, `shortcut for \`${prop.name}\``);
  }
  return items;
}

// The allowed values for the prop immediately before the caret, when the
// caret sits in a prop-value position inside a node literal; null otherwise.
function propValueItems(document, position) {
  const before = [];
  for (const token of document.tokens) {
    if (token.end.line > position.line ||
        (token.end.line === position.line && token.end.character > position.character)) break;
    before.push(token);
  }
  let index = before.length;
  if (index && before[index - 1].type === 'ident') index -= 1; // a partially typed value
  if (!index || before[index - 1].value !== ':') return null;
  const prop = before[index - 2];
  if (!prop || prop.type !== 'ident') return null;
  const values = PROP_VALUES[prop.value]
    || (BOOL_PROPS.has(prop.value) ? ['true', 'false'] : null);
  if (values) {
    return { isIncomplete: false, items: sorted(values.map(value => item(value, 12, `${prop.value} value`))) };
  }
  if (prop.value === 'bind') {
    return {
      isIncomplete: false,
      items: sorted([...document.states.values()].map(state =>
        item(state.name, 6, `state: ${state.type || 'unknown'}`)))
    };
  }
  return null;
}

export function completion(document, position = { line: 0, character: 0 }) {
  const callee = calleeAt(document, position);
  if (callee?.component) {
    // A declared component takes positional arguments, not attribute names.
    return { isIncomplete: false, items: [] };
  }
  if (callee?.kind) {
    const values = propValueItems(document, position);
    return values || {
      isIncomplete: false,
      items: sorted(propItems(callee.kind, wordAt(document, position).range))
    };
  }

  const items = [];

  for (const kind of NODE_KINDS) {
    // A locally declared component of the same name shadows the node kind.
    if (document.components.has(kind.name)) continue;
    items.push(item(kind.name, 7, kind.props.length ? `props: ${kind.props.join(', ')}` : 'node kind'));
  }
  for (const row of COMPONENTS) {
    // Self-referencing rows are already offered as node kinds above.
    if (NODE_KIND_NAMES.includes(row[0]) || document.components.has(row[0])) continue;
    items.push(item(
      row[0],
      7,
      `component: ${row[1]}`,
      `component \`${row[0]}\` lowers to \`${row[1]}\` (category \`${row[2]}\`)`
    ));
  }
  for (const keyword of KEYWORDS) {
    items.push(item(keyword, 14, 'keyword'));
  }
  for (const prop of CANONICAL_PROPS) {
    items.push(item(prop.name, 10, `canonical prop: ${prop.type}`));
    if (prop.shortcut) items.push(item(prop.shortcut, 10, `shortcut for ${prop.name}`));
  }
  for (const value of ANIMATE_VALUES) {
    items.push(item(value, 12, 'animate preset'));
  }
  for (const value of GESTURE_VALUES) {
    items.push(item(value, 12, 'gesture preset'));
  }
  for (const value of DESIGN_VARIANTS) {
    items.push(item(value, 12, 'design variant'));
  }
  for (const value of DESIGN_TONES) {
    items.push(item(value, 12, 'semantic tone'));
  }
  for (const verb of API_VERBS) {
    items.push(item(verb, 14, 'api handler verb'));
  }
  for (const type of FIELD_TYPES) {
    items.push(item(type, 14, 'model field type'));
  }
  for (const state of document.states.values()) {
    items.push(item(state.name, 6, `state: ${state.type || 'unknown'}`));
  }
  for (const model of document.models.values()) {
    items.push(item(model.name, 7, `model: ${model.fields.length} field(s)`));
    for (const field of model.fields) {
      items.push(item(field.name, 5, `${model.name}.${field.name}: ${field.type}`));
    }
  }
  for (const component of document.components.values()) {
    items.push(item(
      component.name,
      7,
      'declared component',
      `component \`${component.name}\` declared at line ${component.declarationLine + 1}`
    ));
  }
  for (const api of document.apis) {
    items.push(item(api.path, 12, `api path: ${api.handlers.map(h => h.verb).join(', ') || 'no handler'}`));
    for (const handler of api.handlers) {
      items.push(item(handler.verb, 14, `${api.path} ${handler.verb} ${handler.model}`));
    }
  }

  return { isIncomplete: false, items };
}

export function signatureHelp(document, position = { line: 0, character: 0 }) {
  const nodeKind = calleeAt(document, position)?.kind;
  if (!nodeKind) return null;
  const label = `${nodeKind.name}(${nodeKind.props.join(', ')})`;
  const signatures = [{
    label,
    documentation: {
      kind: 'markdown',
      value: `**${nodeKind.name}** attributes: ${nodeKind.props.length ? nodeKind.props.map(prop => `\`${prop}\``).join(', ') : '(none)'}`
    },
    parameters: nodeKind.props.map(prop => ({ label: prop }))
  }];
  // The classifier knows which node kind encloses the caret, but Opurom node
  // props are named attributes with no fixed order, so the active parameter is
  // the attribute name currently being typed, if it matches one.
  const { word } = wordAt(document, position);
  const index = word ? nodeKind.props.indexOf(word) : -1;
  return {
    signatures,
    activeSignature: 0,
    activeParameter: index >= 0 ? index : 0
  };
}

export function definition(document, position) {
  const { word } = wordAt(document, position);
  if (!word) return null;

  const state = document.states.get(word);
  if (state) {
    return {
      targetUri: null,
      range: {
        start: state.declaration,
        end: {
          line: state.declaration.line,
          character: state.declaration.character + state.name.length
        }
      },
      origin: `state ${state.name}`
    };
  }

  const model = document.models.get(word);
  if (model) {
    return {
      targetUri: null,
      range: {
        start: model.declaration,
        end: {
          line: model.declaration.line,
          character: model.declaration.character + model.name.length
        }
      },
      origin: `model ${model.name}`
    };
  }

  return null;
}

export { NODE_KIND_NAMES };
