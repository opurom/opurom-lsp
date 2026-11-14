// Opurom language catalog: node kinds, keywords and canonical props.
// Sources: opurom-examples/the IR format framework rules, opurom-examples/the language rules
// framework rules and the internal full-stack contract framework rules.

export const NODE_KINDS = [
  { name: 'Column', props: ['gap', 'padding', 'align', 'width'], children: true },
  { name: 'Row', props: ['gap', 'padding', 'align', 'width'], children: true },
  { name: 'Container', props: ['padding', 'width', 'height', 'radius', 'color'], children: true },
  { name: 'Text', props: ['value', 'size', 'color'], children: false },
  { name: 'Button', props: ['label'], children: false, handler: 'tap' },
  { name: 'Input', props: ['placeholder', 'bind'], children: false },
  { name: 'Image', props: ['src', 'width', 'height'], children: false },
  { name: 'Spacer', props: ['width', 'height'], children: false },
  { name: 'Card', props: ['padding', 'margin', 'color', 'radius'], children: true },
  { name: 'Divider', props: [], children: false },
  { name: 'Icon', props: ['name'], children: false },
  { name: 'Badge', props: ['label'], children: false },
  { name: 'Progress', props: ['value'], children: false },
  { name: 'Switch', props: ['bind'], children: false },
  { name: 'Slider', props: ['bind', 'min', 'max'], children: false },
  { name: 'Checkbox', props: ['bind'], children: false },
  { name: 'Radio', props: ['bind', 'value'], children: false },
  { name: 'Dialog', props: ['title'], children: true },
  { name: 'Tabs', props: ['labels', 'bind'], children: true },
  { name: 'List', props: [], children: true },
  { name: 'Grid', props: ['columns'], children: true },
  { name: 'Scroll', props: ['height'], children: true },
  { name: 'Avatar', props: ['label'], children: false },
  { name: 'Spinner', props: [], children: false }
];

export const NODE_KIND_NAMES = NODE_KINDS.map(kind => kind.name);

export const KEYWORDS = [
  'app', 'state', 'model', 'api', 'theme', 'if', 'for',
  'list', 'get', 'create', 'update', 'delete', 'primary', 'true', 'false'
];

// Canonical style props (the IR format framework rules) plus their source shortcuts.
export const CANONICAL_PROPS = [
  { name: 'padding', shortcut: 'p', type: 'number' },
  { name: 'margin', shortcut: 'm', type: 'number' },
  { name: 'color', shortcut: 'bg', type: 'color' },
  { name: 'radius', shortcut: 'rounded', type: 'number' },
  { name: 'shadow', shortcut: '', type: 'number' },
  { name: 'gradient', shortcut: '', type: 'color' },
  { name: 'glass', shortcut: '', type: 'bool' },
  { name: 'opacity', shortcut: '', type: 'number' },
  { name: 'border', shortcut: '', type: 'color' },
  { name: 'animate', shortcut: '', type: '"spring"|"ease"|"inertia"|"none"' },
  { name: 'gesture', shortcut: '', type: '"tap"|"doubleTap"|"longPress"|"drag"' }
];

export const CANONICAL_PROP_NAMES = CANONICAL_PROPS.map(prop => prop.name);

export const ANIMATE_VALUES = ['spring', 'ease', 'inertia', 'none'];

export const GESTURE_VALUES = ['tap', 'doubleTap', 'longPress', 'drag'];

export const API_VERBS = ['list', 'get', 'create', 'update', 'delete'];

export const FIELD_TYPES = ['int', 'string', 'bool'];

export function findNodeKind(name) {
  return NODE_KINDS.find(kind => kind.name === name) || null;
}

export function findCanonicalProp(name) {
  return CANONICAL_PROPS.find(prop => prop.name === name || (prop.shortcut && prop.shortcut === name)) || null;
}
