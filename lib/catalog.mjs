// Opurom language catalog: node kinds, keywords and canonical props.
// Sources: opurom-examples/the IR format framework rules, opurom-examples/the language rules
// framework rules and the internal full-stack contract framework rules.

export const NODE_KINDS = [
  { name: 'ActivityRing', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'AnchorBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'AreaChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Avatar', props: ['label'], children: false },
  { name: 'Badge', props: ['label'], children: false },
  { name: 'BarcodeGlyph', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BatteryMeter', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BracketPanel', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Breadcrumbs', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BubbleChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'BulletChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Button', props: ['label'], children: false, handler: 'tap' },
  { name: 'Calendar', props: ['date', 'height'], children: false },
  { name: 'Candlestick', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Card', props: [], children: true },
  { name: 'Chart', props: ['type', 'width', 'height'], children: false },
  { name: 'Checkbox', props: ['bind'], children: false, handler: 'tap' },
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
  { name: 'Dialog', props: ['title'], children: true },
  { name: 'Divider', props: [], children: false },
  { name: 'DonutChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'DotPattern', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Equalizer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Filmstrip', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'FunnelChart', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Gauge', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Grid', props: ['columns'], children: true },
  { name: 'GridOverlay', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Heatmap', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Histogram', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Icon', props: ['name'], children: false },
  { name: 'Image', props: ['src', 'width', 'height'], children: false },
  { name: 'Input', props: ['placeholder', 'bind'], children: false },
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
  { name: 'Progress', props: ['value'], children: false },
  { name: 'ProgressRing', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'ProgressSteps', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'QrGlyph', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Radio', props: ['bind', 'value'], children: false, handler: 'tap' },
  { name: 'Rating', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'RichText', props: ['value', 'size', 'color'], children: false },
  { name: 'RingBadge', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Row', props: ['gap', 'padding', 'align', 'width'], children: true },
  { name: 'ScatterPlot', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Scroll', props: ['height'], children: true },
  { name: 'SearchBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SegmentedInput', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SelectBox', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Sidebar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'SignalBars', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Slider', props: ['bind', 'min', 'max'], children: false },
  { name: 'Spacer', props: ['width', 'height'], children: false },
  { name: 'Sparkline', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Spectrogram', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Speedometer', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Spinner', props: [], children: false },
  { name: 'StackedBar', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'StairDivider', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'StatCard', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Stepper', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Switch', props: ['bind'], children: false, handler: 'tap' },
  { name: 'TabStrip', props: ['value', 'values', 'segments', 'labels', 'min', 'max', 'size', 'src', 'type', 'width', 'height', 'columns', 'rows', 'gap', 'align'], children: false },
  { name: 'Table', props: ['columns', 'rows', 'gap'], children: true },
  { name: 'Tabs', props: ['labels', 'bind'], children: false, handler: 'tap' },
  { name: 'Text', props: ['value', 'size', 'color'], children: false },
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
