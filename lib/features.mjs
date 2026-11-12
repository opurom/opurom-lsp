// Hover, completion and definition over a parsed Opurom document.
import {
  ANIMATE_VALUES,
  API_VERBS,
  CANONICAL_PROPS,
  FIELD_TYPES,
  KEYWORDS,
  NODE_KINDS,
  NODE_KIND_NAMES,
  findCanonicalProp,
  findNodeKind
} from './catalog.mjs';
import { wordAt } from './document.mjs';

function markdownHover(contents) {
  return { contents: { kind: 'markdown', value: contents } };
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

  if (KEYWORDS.includes(word)) {
    return { ...markdownHover(`**keyword** \`${word}\``), range };
  }

  return null;
}

function item(label, kind, detail) {
  const item_ = { label, kind };
  if (detail) item_.detail = detail;
  return item_;
}

export function completion(document) {
  const items = [];

  for (const kind of NODE_KINDS) {
    items.push(item(kind.name, 7, kind.props.length ? `props: ${kind.props.join(', ')}` : 'node kind'));
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
  for (const api of document.apis) {
    items.push(item(api.path, 12, `api path: ${api.handlers.map(h => h.verb).join(', ') || 'no handler'}`));
    for (const handler of api.handlers) {
      items.push(item(handler.verb, 14, `${api.path} ${handler.verb} ${handler.model}`));
    }
  }

  return { isIncomplete: false, items };
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
