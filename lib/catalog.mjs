// Opurom language catalog: node kinds, keywords, canonical props and the
// component catalog. Prop sets mirror the compiler's lower.rs tables, the
// authority for what a node literal accepts.
import { readFileSync } from 'node:fs';

export const NODE_KINDS = [
  { name: 'ActivityRing', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'AnchorBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'AreaChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Avatar', props: ['label'], required: ['label'], children: false },
  { name: 'Badge', props: ['label', 'width'], required: ['label'], children: false },
  { name: 'BarcodeGlyph', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BatteryMeter', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BracketPanel', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Breadcrumbs', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BubbleChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BulletChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Button', props: ['label', 'width'], required: ['label'], children: false, handler: 'tap' },
  { name: 'Calendar', props: ['date', 'height'], children: false },
  { name: 'Candlestick', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Card', props: [], children: true },
  { name: 'Chart', props: ['type', 'width', 'height'], children: false },
  { name: 'Checkbox', props: ['bind'], required: ['bind'], children: false, handler: 'tap' },
  { name: 'CheckerBackdrop', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ChevronDivider', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ColorPalette', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ColorWell', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Column', props: ['gap', 'padding', 'align', 'width'], children: true },
  { name: 'ComboBox', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Compass', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Container', props: ['padding', 'width', 'height', 'radius', 'color'], children: true },
  { name: 'CornerFrame', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'CrosshairMark', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'DateField', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Dial', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Dialog', props: ['title'], required: ['title'], children: true },
  { name: 'Divider', props: [], children: false },
  { name: 'DonutChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'DotPattern', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Equalizer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Filmstrip', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'FunnelChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Gauge', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Grid', props: ['columns', 'compactColumns'], required: ['columns'], children: true },
  { name: 'GridOverlay', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Heatmap', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Histogram', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Icon', props: ['name'], required: ['name'], children: false },
  { name: 'Image', props: ['src', 'width', 'height', 'fit'], required: ['src'], children: false },
  { name: 'Input', props: ['placeholder', 'bind', 'required', 'minLength', 'maxLength', 'pattern', 'textBuffer', 'secure', 'value', 'width'], children: false },
  { name: 'Knob', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'KpiTile', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'LadderDivider', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'LevelMeter', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'List', props: [], children: true },
  { name: 'Map', props: ['center', 'zoom', 'height'], children: false },
  { name: 'Menu', props: ['items', 'width'], children: true },
  { name: 'MenuBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'NavRail', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Pagination', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'PieChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'PinInput', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Player', props: ['src', 'width', 'height'], children: false },
  { name: 'PolarChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Progress', props: ['value'], required: ['value'], children: false },
  { name: 'ProgressRing', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ProgressSteps', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'QrGlyph', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Radio', props: ['bind', 'value'], required: ['bind', 'value'], children: false, handler: 'tap' },
  { name: 'Rating', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'RichText', props: ['value', 'size', 'color'], children: false },
  { name: 'RingBadge', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Row', props: ['gap', 'padding', 'align', 'width'], children: true },
  { name: 'ScatterPlot', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Scroll', props: ['height'], required: ['height'], children: true },
  { name: 'SearchBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SegmentedInput', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SelectBox', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Sidebar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SignalBars', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Slider', props: ['bind', 'min', 'max'], required: ['bind', 'min', 'max'], children: false },
  { name: 'Spacer', props: ['width', 'height'], children: false },
  { name: 'Sparkline', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Spectrogram', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Speedometer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Spinner', props: [], children: false },
  { name: 'StackedBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'StairDivider', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'StatCard', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Stepper', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Switch', props: ['bind'], required: ['bind'], children: false, handler: 'tap' },
  { name: 'TabStrip', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Table', props: ['columns', 'rows', 'gap'], children: true },
  { name: 'Tabs', props: ['labels', 'bind'], required: ['labels'], children: false, handler: 'tap' },
  { name: 'Text', props: ['value', 'size', 'color'], required: ['value'], children: false },
  { name: 'Thermometer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ThumbnailGrid', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'TimeField', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'TocTree', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Tooltip', props: ['text', 'placement', 'width'], children: true },
  { name: 'Treemap', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'UploadZone', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Waterfall', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Waveform', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'WaveformPlayer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ZoomLens', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
];

export const NODE_KIND_NAMES = NODE_KINDS.map(kind => kind.name);

// Generic props every kind accepts, mirroring the compiler's GENERIC_PROPS.
export const GENERIC_PROPS = [
  'padding', 'margin', 'color', 'radius', 'shadow', 'gradient', 'glass', 'opacity',
  'border', 'animate', 'gesture', 'label', 'role', 'fontScale', 'highContrast', 'particles'
];

// Vendored component catalog, copied from opurom-lang/src/catalog.json (the
// copy the compiler embeds): rows are [name, primitive, category, defaults].
const CATALOG = JSON.parse(readFileSync(new URL('./components.json', import.meta.url), 'utf8'));
export const COMPONENTS = CATALOG.components;

const COMPONENT_BY_NAME = new Map(COMPONENTS.map(row => [row[0], row]));

export function findComponent(name) {
  const row = COMPONENT_BY_NAME.get(name);
  return row ? { name: row[0], primitive: row[1], category: row[2], defaults: row[3] } : null;
}

export const KEYWORDS = [
  'app', 'state', 'model', 'api', 'theme', 'import', 'component', 'computed',
  'page', 'push', 'if', 'else', 'for', 'in', 'async', 'await',
  'list', 'get', 'create', 'update', 'delete', 'primary', 'true', 'false',
  'delay', 'fetch',
  'set', 'add', 'sub', 'toggle', 'validate'
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
  { name: 'animate', shortcut: '', type: '"spring"|"ease"|"inertia"|"collision"|"none"' },
  { name: 'gesture', shortcut: '', type: '"tap"|"doubleTap"|"longPress"|"drag"' },
  { name: 'required', shortcut: '', type: 'bool' },
  { name: 'minLength', shortcut: '', type: 'number' },
  { name: 'maxLength', shortcut: '', type: 'number' },
  { name: 'pattern', shortcut: '', type: 'string' },
  { name: 'variant', shortcut: '', type: '"primary"|"secondary"|"text"|"danger"|"ghost"|"fab"' },
  { name: 'tone', shortcut: '', type: '"success"|"warning"|"error"|"info"|"neutral"' }
];

export const CANONICAL_PROP_NAMES = CANONICAL_PROPS.map(prop => prop.name);

export const ANIMATE_VALUES = ['spring', 'ease', 'inertia', 'collision', 'none'];

export const GESTURE_VALUES = ['tap', 'doubleTap', 'longPress', 'drag'];

export const DESIGN_VARIANTS = ['primary', 'secondary', 'text', 'danger', 'ghost', 'fab'];

export const DESIGN_TONES = ['success', 'warning', 'error', 'info', 'neutral'];

export const DESIGN_STATES = ['default', 'hover', 'active', 'focus', 'disabled'];

// Keyword values the compiler accepts per prop, for value completion.
export const PROP_VALUES = {
  state: DESIGN_STATES,
  variant: DESIGN_VARIANTS,
  tone: DESIGN_TONES,
  animate: ANIMATE_VALUES,
  gesture: GESTURE_VALUES
};

// Props whose value must be a boolean literal.
export const BOOL_PROPS = new Set(['glass', 'required', 'secure', 'highContrast']);

export const API_VERBS = ['list', 'get', 'create', 'update', 'delete'];

export const FIELD_TYPES = ['int', 'string', 'bool'];

export function findNodeKind(name) {
  return NODE_KINDS.find(kind => kind.name === name) || null;
}

// The node kind a callee lowers to: a primitive directly, or a catalog
// component through its primitive.
export function resolveKind(name) {
  const direct = findNodeKind(name);
  if (direct) return direct;
  const component = findComponent(name);
  return component ? findNodeKind(component.primitive) : null;
}

export function findCanonicalProp(name) {
  return CANONICAL_PROPS.find(prop => prop.name === name || (prop.shortcut && prop.shortcut === name)) || null;
}
