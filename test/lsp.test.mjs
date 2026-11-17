// Conformance test for the Opurom language server.
//
// The main test runs a real JSON-RPC session against the server process with
// a stub compiler, so it is self-contained. A second test uses the real
// opuromc when it is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../lib/document.mjs';
import { parseCompilerOutput, toLspDiagnostics, toRange } from '../lib/diagnostics.mjs';
import { createFuzzyMatcher } from '../lib/fuzzy.mjs';
import { NODE_KIND_NAMES } from '../lib/catalog.mjs';
import { stateOccurrences } from '../lib/symbols.mjs';
import { completion, definition, hover, signatureHelp } from '../lib/features.mjs';
import { foldingRanges } from '../lib/folding.mjs';
import { inlayHints } from '../lib/inlayhint.mjs';
import { documentHighlights } from '../lib/highlight.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const serverEntry = path.join(root, 'bin', 'server.mjs');
const stubCompiler = path.join(root, 'fixtures', 'opuromc-stub.mjs');
const realCompiler = path.resolve(root, '..', 'opurom-lang', 'target', 'debug', 'opuromc');

const BAD_PROGRAM = [
  'app Counter {',
  '  state count = 0',
  '  Column(gap: 8) {',
  '    Text("Count: {OPAQUE_BAD_STATE}")',
  '  }',
  '}',
  ''
].join('\n');

const GOOD_PROGRAM = [
  'app Counter {',
  '  state count = 0',
  '  state name = "world"',
  '  Column(gap: 8) {',
  '    Text("Count: {count}")',
  '  }',
  '}',
  ''
].join('\n');

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

class Client {
  constructor(args, env) {
    this.child = spawn(process.execPath, [serverEntry, '--stdio', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    this.stderr = '';
    this.child.stdout.on('data', chunk => this._onData(chunk));
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.exited = new Promise(resolve => this.child.on('close', code => resolve(code)));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      const message = JSON.parse(body);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    }
  }

  send(message) {
    this.child.stdin.write(frame(message));
  }

  sendRaw(text) {
    this.child.stdin.write(text);
  }

  async next(timeoutMs = 10000) {
    if (this.messages.length) return this.messages.shift();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
      this.waiters.push(message => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async request(id, method, params) {
    this.send({ jsonrpc: '2.0', id, method, params });
    for (;;) {
      const message = await this.next();
      if (message.id === id) return message;
    }
  }

  async notification(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  close() {
    this.child.kill();
  }
}

async function waitForDiagnostics(client, uri) {
  for (;;) {
    const message = await client.next();
    if (message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri) {
      return message.params.diagnostics;
    }
  }
}

function positionOf(text, needle, offsetInNeedle = 0) {
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    const index = lines[line].indexOf(needle);
    if (index !== -1) {
      return { line, character: index + offsetInNeedle };
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

// A document with states, a model, an api and a component tree. The state
// `count` appears in its declaration, a `{count}` interpolation and an action
// body; `name` appears in its declaration and a `bind:` prop value.
const FEATURE_PROGRAM = [
  'app Counter {',
  '  state count = 0',
  '  state name = "world"',
  '  model Todo {',
  '    id: int primary',
  '    title: string',
  '  }',
  '  api "/todos" {',
  '    list Todo',
  '  }',
  '  Column(gap: 8) {',
  '    Text("Count: {count}")',
  '    Button("+") { count += 1 }',
  '    Input(placeholder: "Your name", bind: name)',
  '  }',
  '}',
  ''
].join('\n');

const MESSY_PROGRAM = [
  'app   Counter{',
  'state count=0;// running total',
  '  state name = "world"',
  '',
  ' Column( gap:8,   padding:16 ){',
  ' Text( "Count: {count}" ,size:24 )',
  ' Row(gap:8){ Button("-"){count-=1} Button("+"){ count += 1 } }',
  '   Input(placeholder:"Your name",bind:name)',
  ' }',
  '}',
  ''
].join('\n');

const ACTION_PROGRAM = [
  'app Counter {',
  '  state count = 0',
  '  Column(gap: 8) {',
  '    Text("Count: {nope}")',
  '  }',
  '}',
  ''
].join('\n');

const FOLDING_PROGRAM = [
  '// A comment with { braces }',
  '// The second comment line',
  'app Counter {',
  '  state count = 0',
  '  Column(gap: 8) {',
  '    Text("Count: {count}")',
  '    Text("literal { } braces")',
  '    Button("+") { count += 1 }',
  '  }',
  '}',
  ''
].join('\n');

const HIGHLIGHT_PROGRAM = [
  '// count is a plain comment',
  'app Counter {',
  '  state count = 0',
  '  Column(gap: 8) {',
  '    Text("Count: {count} and plain count")',
  '    Input(placeholder: "Your count", bind: count)',
  '    Button("+") { count += 1 }',
  '  }',
  '}',
  ''
].join('\n');

const HOVER_PROGRAM = [
  'app Shop {',
  '  state count = 0',
  '  state label = "cart"',
  '  state active = true',
  '  state closed = false',
  '  model Item {',
  '    id: int primary',
  '    title: string',
  '  }',
  '  Column(gap: 8) {',
  '    Text("{count} {label}")',
  '  }',
  '  // mystery is not declared anywhere',
  '}',
  ''
].join('\n');

// One occurrence of every classified token type: the state declaration and
// action body, the model name in its declaration and in an api handler, the
// api path string, the node kinds and the `{count}` interpolation. The line
// 9 string is a plain literal, so the api path is the only marked string.
const SEMANTIC_PROGRAM = [
  'app Counter {',
  '  state count = 0',
  '  model Todo {',
  '    id: int primary',
  '  }',
  '  api "/todos" {',
  '    list Todo',
  '  }',
  '  Column(gap: 8) {',
  '    Text("Count: {count}")',
  '    Button("+") { count += 1 }',
  '  }',
  '}',
  ''
].join('\n');

function offsetAt(text, position) {
  const lines = text.split('\n');
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    offset += (lines[line] ?? '').length + 1;
  }
  return offset + position.character;
}

// Apply LSP TextEdits back-to-front so every offset stays valid.
function applyEdits(text, edits) {
  let result = text;
  const sorted = [...edits].sort((a, b) =>
    offsetAt(text, b.range.start) - offsetAt(text, a.range.start));
  for (const edit of sorted) {
    const start = offsetAt(text, edit.range.start);
    const end = offsetAt(text, edit.range.end);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

async function openDocument(client, uri, text) {
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text }
  });
  return waitForDiagnostics(client, uri);
}

async function changeDocument(client, uri, text, version) {
  await client.notification('textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text }]
  });
  return waitForDiagnostics(client, uri);
}

async function finish(client) {
  await client.request(99, 'shutdown', null);
  await client.notification('exit', null);
  assert.equal(await client.exited, 0);
}

test('JSON-RPC session with a stub compiler', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const initialize = await client.request(1, 'initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {}
  });
  assert.equal(initialize.result.capabilities.textDocumentSync, 1);
  assert.equal(initialize.result.capabilities.hoverProvider, true);
  assert.ok(initialize.result.capabilities.completionProvider);
  assert.equal(initialize.result.capabilities.definitionProvider, true);
  // Diagnostics are pushed only; a pull provider is neither implemented nor
  // advertised, so clients cannot expect textDocument/diagnostic.
  assert.equal(initialize.result.capabilities.diagnosticProvider, undefined);

  await client.notification('initialized', {});

  const uri = 'file://the temporary checkout-lsp-test/counter.opu';
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: BAD_PROGRAM }
  });

  const diagnostics = await waitForDiagnostics(client, uri);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, 1);
  assert.equal(diagnostics[0].code, 'opurom.unknown-state');
  assert.match(diagnostics[0].data.correctionMessage, /declare|use one of/);
  assert.equal(diagnostics[0].range.start.line, 3);
  assert.equal(diagnostics[0].range.start.character, 18);
  assert.match(diagnostics[0].message, /unknown state 'nope'/);
  assert.match(diagnostics[0].message, /help: declare it with/);

  await client.notification('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: GOOD_PROGRAM }]
  });
  const cleared = await waitForDiagnostics(client, uri);
  assert.deepEqual(cleared, []);

  const pull = await client.request(20, 'textDocument/diagnostic', {
    textDocument: { uri }
  });
  assert.equal(pull.error.code, -32601);
  assert.match(pull.error.message, /unsupported method/);

  const hover = await client.request(2, 'textDocument/hover', {
    textDocument: { uri },
    position: positionOf(GOOD_PROGRAM, 'count = 0', 0)
  });
  assert.ok(hover.result, 'hover returns a result');
  assert.match(hover.result.contents.value, /state/);
  assert.match(hover.result.contents.value, /int/);

  const hoverKind = await client.request(3, 'textDocument/hover', {
    textDocument: { uri },
    position: positionOf(GOOD_PROGRAM, 'Column', 1)
  });
  assert.match(hoverKind.result.contents.value, /node kind/);
  assert.match(hoverKind.result.contents.value, /gap/);

  const completion = await client.request(4, 'textDocument/completion', {
    textDocument: { uri },
    position: { line: 0, character: 0 }
  });
  const labels = completion.result.items.map(entry => entry.label);
  for (const expected of [
    'Column', 'Card', 'Switch', 'Spinner', 'Grid',
    'app', 'state', 'model', 'api', 'theme', 'if', 'for',
    'import', 'component', 'computed', 'page', 'push', 'else', 'in', 'async', 'await', 'delay', 'fetch', 'validate',
    'list', 'get', 'create', 'update', 'delete', 'primary',
    'padding', 'margin', 'color', 'radius', 'shadow', 'gradient', 'glass', 'opacity', 'animate', 'gesture',
    'required', 'minLength', 'maxLength', 'pattern',
    'variant', 'tone',
    'primary', 'secondary', 'text', 'danger', 'ghost', 'fab',
    'success', 'warning', 'error', 'info', 'neutral',
    'inertia', 'collision', 'doubleTap', 'longPress', 'drag',
    'count', 'name',
    'VStack'
  ]) {
    assert.ok(labels.includes(expected), `completion offers ${expected}`);
  }
  // `duration` is an IR-only prop the compiler rejects in source.
  assert.ok(!labels.includes('duration'));

  const definition = await client.request(5, 'textDocument/definition', {
    textDocument: { uri },
    position: positionOf(GOOD_PROGRAM, '{count}', 1)
  });
  assert.ok(definition.result, 'definition returns a location');
  assert.equal(definition.result.uri, uri);
  assert.equal(definition.result.range.start.line, 1);
  assert.equal(definition.result.range.start.character, 8);

  const unknown = await client.request(6, 'textDocument/somethingElse', {});
  assert.equal(unknown.error.code, -32601);
  assert.match(unknown.error.message, /somethingElse/);

  const shutdown = await client.request(7, 'shutdown', null);
  assert.equal(shutdown.result, null);
  await client.notification('exit', null);
  const code = await client.exited;
  assert.equal(code, 0);
});

test('empty diagnostics are not republished for a clean document', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/quiet.opu';
  assert.deepEqual(await openDocument(client, uri, GOOD_PROGRAM), []);
  assert.equal(client.messages.some(message =>
    message.method === 'textDocument/publishDiagnostics'), false);

  await client.notification('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: GOOD_PROGRAM }]
  });
  // didChange awaits the check, so any extra publish would sit in the queue
  // before the next response.
  await client.request(2, 'textDocument/hover', {
    textDocument: { uri },
    position: { line: 0, character: 0 }
  });
  assert.equal(client.messages.some(message =>
    message.method === 'textDocument/publishDiagnostics'), false,
  'a second empty publish would be redundant');

  await finish(client);
});

test('diagnostics carry a stable code, tags and the correction text', () => {
  const output = [
    "doc.opu:3:18: error: unknown state 'alpha' in Text interpolation",
    "  help: declare it with 'state alpha = 0' or use one of: count",
    "doc.opu:5:18: error: unknown state 'beta' in Text interpolation",
    "  help: declare it with 'state beta = 0' or use one of: count",
    "doc.opu:7:9: error: invalid color '#XYZ' for 'color'",
    "doc.opu:8:1: warning: unused import 'a.opu'",
    'doc.opu:9:1: warning: deprecated member use',
    ''
  ].join('\n');

  const diagnostics = toLspDiagnostics(parseCompilerOutput(output), output);
  assert.equal(diagnostics.length, 5);
  // The same rule maps to one code even when the interpolated name changes.
  assert.equal(diagnostics[0].code, 'opurom.unknown-state');
  assert.equal(diagnostics[0].code, diagnostics[1].code);
  assert.equal(diagnostics[2].code, 'opurom.invalid-color');
  assert.equal(diagnostics[0].data.correctionMessage,
    "declare it with 'state alpha = 0' or use one of: count");
  // The message keeps the appended help line, as before.
  assert.match(diagnostics[0].message, /help: declare it with/);
  assert.deepEqual(diagnostics[3].tags, [2]);
  assert.deepEqual(diagnostics[4].tags, [1]);
  assert.equal(diagnostics[3].severity, 2);
  assert.equal(diagnostics[2].data, undefined);
});

test('diagnostic spans cover the token that starts at the column', () => {
  const span = (line, needle, offsetInNeedle = 0) => {
    const start = line.indexOf(needle) + offsetInNeedle;
    const range = toRange({ line: 0, character: start }, line);
    return line.slice(range.start.character, range.end.character);
  };

  assert.equal(span('  Column(gap: 42)', '42'), '42');
  assert.equal(span('  opacity: 0.95', '0.95'), '0.95');
  assert.equal(span('  Text("hi")', '"hi"'), '"hi"');
  assert.equal(span('  state count = 0', 'count'), 'count');
  assert.equal(span('  count += 1', '+='), '+='); // symbols stay one character wide
  assert.equal(span('  name = true', 'true'), 'true');

  // Negative cases: a number stops at the first non-digit character, a broken
  // quote never crosses the line, an escaped quote is skipped and a column
  // past the end still yields a one-character span.
  assert.equal(span('  state a = 12ab', '12'), '12');
  assert.equal(span('  Text("open', '"'), '"open');
  assert.equal(span('  Text("a\\"b")', '"'), '"a\\"b"');
  assert.equal(span('  x', 'x', 2), '');
  const past = toRange({ line: 0, character: 10 }, '  x');
  assert.deepEqual(past, { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } });
  assert.equal(span('  opacity: 0.5', ' ', 1), ' ');
});

test('malformed frames are reported and the server stays alive', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { processId: process.pid, capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/empty.opu';
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: GOOD_PROGRAM }
  });
  await waitForDiagnostics(client, uri);

  const broken = '{not json!!';
  client.sendRaw(`Content-Length: ${broken.length}\r\n\r\n${broken}`);
  const parseError = await client.next();
  assert.equal(parseError.error.code, -32700);

  const stillAlive = await client.request(2, 'textDocument/completion', {
    textDocument: { uri },
    position: { line: 0, character: 0 }
  });
  assert.ok(stillAlive.result.items.length > 0);

  await client.request(3, 'shutdown', null);
  await client.notification('exit', null);
  assert.equal(await client.exited, 0);
});

test('a missing compiler warns once and publishes empty diagnostics', async t => {
  const missing = path.join(os.tmpdir(), 'opurom-lsp-missing-compiler');
  const client = new Client(['--compiler', missing]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { processId: process.pid, capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/missing.opu';
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: BAD_PROGRAM }
  });

  const warning = await client.next();
  assert.equal(warning.method, 'window/showMessage');
  assert.equal(warning.params.type, 2);
  assert.match(warning.params.message, /compiler not found/);

  const diagnostics = await waitForDiagnostics(client, uri);
  assert.deepEqual(diagnostics, []);

  // The warning is emitted once, not once per document.
  await client.notification('textDocument/didOpen', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/other.opu', languageId: 'opurom', version: 1, text: BAD_PROGRAM }
  });
  const second = await client.next();
  assert.equal(second.method, 'textDocument/publishDiagnostics');
  assert.deepEqual(second.params.diagnostics, []);

  await client.request(2, 'shutdown', null);
  await client.notification('exit', null);
  assert.equal(await client.exited, 0);
});

test('the real opuromc produces diagnostics', { skip: !fs.existsSync(realCompiler) }, async t => {
  const client = new Client(['--compiler', realCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { processId: process.pid, capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/real.opu';
  const bad = [
    'app Counter {',
    '  state count = 0',
    '  Column(gap: 8) {',
    '    Text("Count: {nope}")',
    '  }',
    '}',
    ''
  ].join('\n');
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: bad }
  });

  const diagnostics = await waitForDiagnostics(client, uri);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, 1);
  assert.equal(diagnostics[0].code, 'opurom.unknown-state');
  assert.match(diagnostics[0].data.correctionMessage, /declare|use one of/);
  assert.equal(diagnostics[0].range.start.line, 3);
  assert.match(diagnostics[0].message, /unknown state/);

  await client.request(2, 'shutdown', null);
  await client.notification('exit', null);
  assert.equal(await client.exited, 0);
});

test('a full-stack document exposes model fields and api paths', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { processId: process.pid, capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/fullstack.opu';
  const program = [
    'app TodoApp {',
    '  model Todo {',
    '    id: int primary',
    '    title: string',
    '  }',
    '',
    '  api "/todos" {',
    '    list Todo',
    '  }',
    '',
    '  state count = 0',
    '}',
    ''
  ].join('\n');
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: program }
  });
  await waitForDiagnostics(client, uri);

  const completion = await client.request(2, 'textDocument/completion', {
    textDocument: { uri },
    position: { line: 0, character: 0 }
  });
  const labels = completion.result.items.map(entry => entry.label);
  for (const expected of ['Todo', 'id', 'title', '/todos']) {
    assert.ok(labels.includes(expected), `completion offers ${expected}`);
  }

  const modelHover = await client.request(3, 'textDocument/hover', {
    textDocument: { uri },
    position: positionOf(program, 'model Todo', 6)
  });
  assert.match(modelHover.result.contents.value, /model/);
  assert.match(modelHover.result.contents.value, /title/);

  const modelDefinition = await client.request(4, 'textDocument/definition', {
    textDocument: { uri },
    position: positionOf(program, 'list Todo', 6)
  });
  assert.equal(modelDefinition.result.range.start.line, 1);
  assert.equal(modelDefinition.result.range.start.character, 8);

  await client.request(5, 'shutdown', null);
  await client.notification('exit', null);
  assert.equal(await client.exited, 0);
});

test('completion offers catalog attributes inside node parens', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/attributes.opu';
  const program = [
    'app Shop {',
    '  Button(',
    '  Column(',
    '  Grid(',
    '}',
    ''
  ].join('\n');
  assert.deepEqual(await openDocument(client, uri, program), []);

  const button = await client.request(2, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'Button(', 'Button('.length)
  });
  // The kind's own props come first, required ones marked, then the props
  // every kind accepts: generic, design and source shortcuts.
  const buttonLabels = button.result.items.map(entry => entry.label);
  assert.deepEqual(buttonLabels.slice(0, 2), ['label', 'width']);
  assert.equal(button.result.items[0].detail, 'Button attribute (required)');
  assert.equal(button.result.items[0].sortText, '8999');
  assert.equal(button.result.items[0].filterText, 'label');
  assert.equal(button.result.items[0].insertTextFormat, 2);
  assert.equal(button.result.items[0].textEdit.newText, 'label: ${1:value}');
  assert.deepEqual(button.result.items[0].textEdit.range, {
    start: { line: 1, character: 9 }, end: { line: 1, character: 9 }
  });
  const color = button.result.items.find(entry => entry.label === 'color');
  assert.equal(color.textEdit.newText, 'color: ');
  assert.equal(color.insertTextFormat, undefined);
  assert.equal(color.sortText, '9101'); // generic tier 900, offset by position
  assert.match(button.result.items[0].documentation, /Button attribute `label`/);
  for (const expected of ['color', 'radius', 'animate', 'state', 'variant', 'p', 'm', 'bg', 'rounded']) {
    assert.ok(buttonLabels.includes(expected), `Button completion offers ${expected}`);
  }
  assert.equal(new Set(buttonLabels).size, buttonLabels.length, 'no duplicate props');

  const column = await client.request(3, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'Column(', 'Column('.length)
  });
  const columnLabels = column.result.items.map(entry => entry.label);
  assert.deepEqual(columnLabels.slice(0, 4), ['gap', 'padding', 'align', 'width']);
  for (const entry of column.result.items) {
    assert.equal(typeof entry.documentation, 'string');
    assert.ok(entry.documentation.length > 0);
  }
  assert.match(column.result.items[0].documentation, /Column attribute `/);

  // The Grid keeps its declared column count on compact widths through a
  // dedicated prop; the catalog must offer it alongside the wider-tier one.
  const grid = await client.request(4, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'Grid(', 'Grid('.length)
  });
  assert.deepEqual(grid.result.items.map(entry => entry.label).slice(0, 2),
    ['columns', 'compactColumns']);
  for (const entry of grid.result.items.slice(0, 2)) {
    assert.match(entry.documentation, /Grid attribute `/);
  }

  const outside = await client.request(5, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'app Shop', 0)
  });
  const labels = outside.result.items.map(entry => entry.label);
  for (const name of NODE_KIND_NAMES) {
    assert.ok(labels.includes(name), `completion outside a node offers ${name}`);
  }
  assert.ok(labels.includes('app'));
  assert.ok(!labels.includes('label'));
  assert.ok(outside.result.items.every(entry =>
    typeof entry.documentation === 'string' && entry.documentation.length > 0));

  await finish(client);
});

test('fuzzy ranking follows the analyzer TEXT-mode scorer', () => {
  // Cases mirrored from the analyzer's own matcher tests.
  for (const [pattern, low, high] of [
    ['jade', 'jump to a directory in tree', 'fix imports and dependencies using jade (java only)'],
    ['unedit', 'Undo an edit', 'Close unedited tabs'],
    ['fix', 'find next match', 'format edited lines in workspace files (g4 fix)']
  ]) {
    const matcher = createFuzzyMatcher(pattern);
    assert.ok(matcher.score(low) >= 0, `${low} matches ${pattern}`);
    assert.ok(matcher.score(low) < matcher.score(high), `${high} ranks above ${low}`);
  }
  const abc = createFuzzyMatcher('abc');
  assert.equal(abc.score('def'), -1);
  assert.equal(abc.score('abd'), -1);
  assert.equal(abc.score('abc'), 1);
  assert.ok(abc.score('Ab stuff c') > 0);
  assert.equal(createFuzzyMatcher('').score('anything'), 1);
});

test('completion filters and orders candidates by fuzzy score', () => {
  const document = parseDocument('app A {\n  Grid(cc\n}\n');
  const labels = completion(document, { line: 1, character: 10 })
    .items.map(entry => entry.label);
  assert.ok(labels.includes('compactColumns'), 'camel abbreviation matches');
  assert.ok(!labels.includes('color'), 'a non-subsequence is filtered out');

  const ordered = completion(parseDocument('app A {\n  Grid(col\n}\n'),
    { line: 1, character: 11 }).items;
  const rank = new Map(ordered.map((entry, index) => [entry.label, index]));
  assert.ok(rank.get('color') < rank.get('compactColumns'),
    'a prefix match outranks a loose subsequence');
});

test('completion replaces a typed attribute prefix with the named argument', () => {
  const line = '  Button(lab';
  const document = parseDocument(`app A {\n${line}\n}\n`);
  const label = completion(document, { line: 1, character: line.length })
    .items.find(entry => entry.label === 'label');
  assert.deepEqual(label.textEdit.range, {
    start: { line: 1, character: 9 }, end: { line: 1, character: 12 }
  });
  assert.equal(label.textEdit.newText, 'label: ${1:value}');
});

test('completion ranks by relevance through sortText', () => {
  const program = [
    'app A {',
    '  state count = 0',
    '  component Card(t: string) { Text("{t}") }',
    '}',
    ''
  ].join('\n');
  const items = completion(parseDocument(program), { line: 0, character: 0 }).items;
  const byLabel = new Map(items.map(entry => [entry.label, entry]));
  assert.equal(byLabel.get('count').sortText, '8999');   // state: 1000
  assert.equal(byLabel.get('Card').sortText, '9099');    // local component: 900
  assert.equal(byLabel.get('Column').sortText, '9399');  // node kind: 600
  assert.equal(byLabel.get('app').sortText, '9699');     // keyword: 300
  assert.equal('relevance' in byLabel.get('count'), false, 'relevance stays internal');
});

test('completion leaves node parens at the closing paren', () => {
  const text = 'Button(label: "Column(")\nColumn(';
  const document = parseDocument(text);
  assert.deepEqual(
    completion(document, { line: 0, character: 7 }).items.slice(0, 2).map(entry => entry.label),
    ['label', 'width']
  );
  const closed = completion(document, { line: 0, character: text.indexOf('\n') });
  assert.ok(closed.items.some(entry => entry.label === 'Column'));
  assert.ok(!closed.items.some(entry => entry.label === 'label'));
  const quoted = completion(parseDocument('Text("(")\n'), { line: 0, character: 9 });
  assert.ok(quoted.items.some(entry => entry.label === 'Column'));
});

test('completion resolves catalog components to their primitive props', () => {
  const document = parseDocument('app A {\n  VStack(\n}\n');
  const labels = completion(document, { line: 1, character: 9 }).items.map(entry => entry.label);
  // VStack lowers to Column, so Column's props complete inside its literal.
  assert.deepEqual(labels.slice(0, 4), ['gap', 'padding', 'align', 'width']);
  assert.ok(labels.includes('color'), 'generic props complete too');

  const button = completion(parseDocument('app A {\n  Button(\n}\n'), { line: 1, character: 9 });
  assert.equal(button.items[0].detail, 'Button attribute (required)');
  assert.equal(button.items[0].sortText, '8999');
});

test('completion offers allowed values after a prop colon', () => {
  const program = 'app A {\n  state on = true\n  Column(variant: \n}\n';
  const variant = completion(parseDocument(program), { line: 2, character: program.split('\n')[2].length });
  assert.deepEqual(variant.items.map(entry => entry.label),
    ['primary', 'secondary', 'text', 'danger', 'ghost', 'fab']);

  const boolDoc = 'app A {\n  Column(glass: \n}\n';
  const bool = completion(parseDocument(boolDoc), { line: 1, character: boolDoc.split('\n')[1].length });
  assert.deepEqual(bool.items.map(entry => entry.label), ['true', 'false']);

  const bindDoc = 'app A {\n  state on = true\n  Switch(bind: \n}\n';
  const bind = completion(parseDocument(bindDoc), { line: 2, character: bindDoc.split('\n')[2].length });
  const on = bind.items.find(entry => entry.label === 'on');
  assert.ok(on, 'bind completes the declared states');
  assert.equal(on.detail, 'state: bool');

  // A prop with no value list falls back to the attribute list.
  const gapDoc = 'app A {\n  Column(gap: \n}\n';
  const gap = completion(parseDocument(gapDoc), { line: 1, character: gapDoc.split('\n')[1].length });
  assert.equal(gap.items[0].label, 'gap');
});

test('completion omits attributes for declared component arguments', () => {
  const program = [
    'app A {',
    '  component Card(title: string) { Text("{title}") }',
    '  Card(',
    '}',
    ''
  ].join('\n');
  const document = parseDocument(program);
  const inside = completion(document, { line: 2, character: '  Card('.length });
  assert.deepEqual(inside.items, [], 'component arguments are positional');

  const outside = completion(document, { line: 1, character: 0 });
  const labels = outside.items.map(entry => entry.label);
  assert.equal(labels.filter(label => label === 'Card').length, 1,
    'the declared component shadows the node kind');
  assert.ok(labels.includes('VStack'), 'catalog components complete outside literals');
});

test('hover explains declared and catalog components', () => {
  const program = [
    'app A {',
    '  component Card(title: string) { Text("t") }',
    '  VStack(gap: 4) { }',
    '}',
    ''
  ].join('\n');
  const document = parseDocument(program);

  const local = hover(document, positionOf(program, 'Card(title', 0));
  assert.match(local.contents.value, /\*\*component\*\* `Card`/);
  assert.match(local.contents.value, /`title: string`/);

  const alias = hover(document, positionOf(program, 'VStack', 0));
  assert.match(alias.contents.value, /\*\*component\*\* `VStack`/);
  assert.match(alias.contents.value, /primitive `Column`/);
});

test('hover reports state types, model field types and nothing for unknown words', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/hover.opu';
  assert.deepEqual(await openDocument(client, uri, HOVER_PROGRAM), []);

  const hoverFor = (id, needle) => client.request(id, 'textDocument/hover', {
    textDocument: { uri },
    position: positionOf(HOVER_PROGRAM, needle, 0)
  });

  for (const [id, needle, type, initializer] of [
    [2, 'count = 0', 'int', '0'],
    [3, 'label = "cart"', 'string', '"cart"'],
    [4, 'active = true', 'bool', 'true'],
    [5, 'closed = false', 'bool', 'false']
  ]) {
    const result = (await hoverFor(id, needle)).result;
    assert.match(result.contents.value, /\*\*state\*\*/);
    assert.ok(result.contents.value.includes(`- type: \`${type}\``),
      `${needle} reports type ${type}`);
    assert.ok(result.contents.value.includes(`- initializer: \`${initializer}\``),
      `${needle} reports initializer ${initializer}`);
  }

  const title = (await hoverFor(6, 'title: string')).result;
  assert.match(title.contents.value, /\*\*model field\*\* `Item.title`/);
  assert.match(title.contents.value, /- type: `string`/);
  assert.deepEqual(title.range.start, positionOf(HOVER_PROGRAM, 'title: string', 0));

  const idField = (await hoverFor(7, 'id: int primary')).result;
  assert.match(idField.contents.value, /\*\*model field\*\* `Item.id` \(primary\)/);
  assert.match(idField.contents.value, /- type: `int`/);

  const unknown = await hoverFor(8, 'mystery is not');
  assert.equal(unknown.result, null);
  assert.equal(unknown.error, undefined);

  await finish(client);
});

test('hover resolves a shared field name to the model on the cursor line', () => {
  const program = [
    'model User {',
    '  id: int primary',
    '}',
    'model Todo {',
    '  id: string',
    '}',
    ''
  ].join('\n');
  const document = parseDocument(program);

  const user = hover(document, positionOf(program, 'id: int', 0));
  assert.match(user.contents.value, /\*\*model field\*\* `User.id`/);
  assert.match(user.contents.value, /- type: `int`/);

  const todo = hover(document, positionOf(program, 'id: string', 0));
  assert.match(todo.contents.value, /\*\*model field\*\* `Todo.id`/);
  assert.match(todo.contents.value, /- type: `string`/);
});

test('initialize advertises the five new providers', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const init = await client.request(1, 'initialize', {
    processId: process.pid, capabilities: {}
  });
  const caps = init.result.capabilities;
  assert.equal(caps.documentSymbolProvider, true);
  assert.equal(caps.referencesProvider, true);
  assert.deepEqual(caps.renameProvider, { prepareProvider: true });
  assert.equal(caps.documentFormattingProvider, true);
  assert.equal(caps.codeActionProvider, true);
  assert.deepEqual(caps.semanticTokensProvider, {
    legend: { tokenTypes: ['state', 'model', 'apiPath', 'nodeKind'] },
    full: true
  });
  assert.equal(caps.hoverProvider, true);
  assert.ok(caps.signatureHelpProvider);
  assert.deepEqual(caps.signatureHelpProvider.triggerCharacters, ['(', ',']);
  assert.deepEqual(caps.completionProvider.triggerCharacters,
    [':', '"', "'", '(', '{', '/', '=', '.']);
  assert.equal(caps.textDocumentSync, 1);
  assert.ok(!('diagnosticProvider' in caps), 'push-only diagnostics are not a pull provider');

  await finish(client);
});

test('documentSymbol returns a hierarchical outline with ranges and kinds', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/symbols.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);

  const response = await client.request(2, 'textDocument/documentSymbol', {
    textDocument: { uri }
  });
  const symbols = response.result;
  assert.equal(symbols.length, 1);
  const app = symbols[0];
  assert.equal(app.name, 'app Counter');
  assert.equal(app.kind, 3); // Namespace
  assert.deepEqual(app.range.start, { line: 0, character: 0 });
  assert.equal(app.range.end.line, 15);
  assert.deepEqual(app.selectionRange.start, { line: 0, character: 0 });

  const byName = new Map(app.children.map(child => [child.name, child]));
  for (const name of ['count', 'name', 'Todo', '/todos', 'Column']) {
    assert.ok(byName.has(name), `outline contains ${name}`);
  }
  const count = byName.get('count');
  assert.equal(count.kind, 13); // Variable
  assert.deepEqual(count.selectionRange, {
    start: { line: 1, character: 8 },
    end: { line: 1, character: 13 }
  });
  assert.ok(count.range.start.line <= count.selectionRange.start.line);

  const model = byName.get('Todo');
  assert.equal(model.kind, 5); // Class
  assert.deepEqual(model.children.map(field => field.name), ['id', 'title']);
  assert.equal(model.children[0].kind, 8); // Field

  const api = byName.get('/todos');
  assert.equal(api.kind, 11); // Interface
  assert.equal(api.children[0].name, 'list Todo');
  assert.equal(api.children[0].kind, 6); // Method

  const column = byName.get('Column');
  assert.deepEqual(column.children.map(child => child.name), ['Text', 'Button', 'Input']);
  assert.equal(column.children[0].kind, 5);
  assert.ok(column.range.end.line > column.range.start.line);

  await finish(client);
});

test('references finds the declaration, interpolation, bind and action body', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/refs.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);

  const all = await client.request(2, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, '{count}', 1),
    context: { includeDeclaration: true }
  });
  assert.equal(all.result.length, 3);
  assert.deepEqual(all.result.map(location => location.range.start), [
    { line: 1, character: 8 },
    { line: 11, character: 18 },
    { line: 12, character: 18 }
  ]);
  for (const location of all.result) assert.equal(location.uri, uri);

  const withoutDeclaration = await client.request(3, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, '{count}', 1),
    context: { includeDeclaration: false }
  });
  assert.equal(withoutDeclaration.result.length, 2);
  assert.ok(withoutDeclaration.result.every(location => location.range.start.line !== 1));

  const bindRefs = await client.request(4, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'bind: name', 6),
    context: { includeDeclaration: true }
  });
  assert.equal(bindRefs.result.length, 2);
  assert.ok(bindRefs.result.some(location => location.range.start.line === 13));

  // A word inside a plain string is not a reference, even when it is spelled
  // exactly like a declared state.
  const notAReference = await client.request(5, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'Your name', 5),
    context: { includeDeclaration: true }
  });
  assert.deepEqual(notAReference.result, []);

  const unknownWord = await client.request(6, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'Column(gap', 1),
    context: { includeDeclaration: true }
  });
  assert.deepEqual(unknownWord.result, []);

  await finish(client);
});

test('prepareRename refuses a position that is not a renameable state name', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/prepare.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);

  const accepted = await client.request(2, 'textDocument/prepareRename', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, '{count}', 1)
  });
  assert.deepEqual(accepted.result, {
    range: { start: { line: 11, character: 18 }, end: { line: 11, character: 23 } },
    placeholder: 'count'
  });

  const positions = [
    positionOf(FEATURE_PROGRAM, 'title: string', 0), // model field
    positionOf(FEATURE_PROGRAM, 'Column(gap', 1),    // component kind
    positionOf(FEATURE_PROGRAM, 'Your name', 5),     // plain string spelled like a state
    { line: 0, character: 0 }                        // app keyword
  ];
  for (const [index, position] of positions.entries()) {
    const refused = await client.request(10 + index, 'textDocument/prepareRename', {
      textDocument: { uri }, position
    });
    assert.equal(refused.error?.code, -32602, `prepareRename refuses position ${index}`);
    assert.match(refused.error.message, /cannot rename/);
  }

  await finish(client);
});

test('rename rewrites the declaration, interpolation and action body', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/rename.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);

  const rename = await client.request(2, 'textDocument/rename', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'count = 0', 0),
    newName: 'total'
  });
  const edits = rename.result.changes[uri];
  assert.equal(edits.length, 3);
  assert.ok(edits.every(edit => edit.newText === 'total'));

  const renamed = applyEdits(FEATURE_PROGRAM, edits);
  assert.ok(renamed.includes('state total = 0'));
  assert.ok(renamed.includes('Text("Count: {total}")'));
  assert.ok(renamed.includes('Button("+") { total += 1 }'));
  assert.ok(!renamed.includes('{count}'));
  assert.ok(renamed.includes('bind: name'));    // a different state stays intact
  assert.ok(renamed.includes('title: string')); // model fields stay intact

  // Start from the broken text so the clean publish below proves the change.
  assert.equal((await changeDocument(client, uri, ACTION_PROGRAM, 2)).length, 1);
  assert.deepEqual(await changeDocument(client, uri, renamed, 3), []);

  const after = await client.request(3, 'textDocument/references', {
    textDocument: { uri },
    position: positionOf(renamed, '{total}', 1),
    context: { includeDeclaration: true }
  });
  assert.equal(after.result.length, 3);

  await finish(client);
});

test('rename rejects malformed names and non-renameable positions', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/rename-errors.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);
  const base = {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'count = 0', 0)
  };

  for (const [index, newName] of ['bad name', '9lives', '', 'state', null, 42].entries()) {
    const bad = await client.request(10 + index, 'textDocument/rename', { ...base, newName });
    assert.equal(bad.error?.code, -32602, `rename rejects newName ${JSON.stringify(newName)}`);
  }
  const missing = await client.request(20, 'textDocument/rename', base);
  assert.equal(missing.error.code, -32602);

  const collision = await client.request(21, 'textDocument/rename', { ...base, newName: 'name' });
  assert.equal(collision.error.code, -32602);
  assert.match(collision.error.message, /already exists/);

  const wrongPosition = await client.request(22, 'textDocument/rename', {
    textDocument: { uri },
    position: positionOf(FEATURE_PROGRAM, 'title: string', 0),
    newName: 'total'
  });
  assert.equal(wrongPosition.error.code, -32602);
  assert.match(wrongPosition.error.message, /cannot rename/);

  await finish(client);
});

test('formatting is deterministic and idempotent over JSON-RPC', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/format.opu';
  assert.deepEqual(await openDocument(client, uri, MESSY_PROGRAM), []);

  const options = { tabSize: 2, insertSpaces: true };
  const first = await client.request(2, 'textDocument/formatting', {
    textDocument: { uri }, options
  });
  assert.equal(first.result.length, 1);
  const formatted = first.result[0].newText;
  assert.deepEqual(first.result[0].range.start, { line: 0, character: 0 });
  assert.equal(first.result[0].range.end.line, MESSY_PROGRAM.split('\n').length - 1);
  assert.ok(formatted.startsWith('app Counter {\n'));
  assert.ok(formatted.includes('  state count = 0; // running total'));
  assert.ok(formatted.includes('    Text("Count: {count}", size: 24)'));
  assert.ok(formatted.includes('      Button("-") {'));
  assert.equal(applyEdits(MESSY_PROGRAM, first.result), formatted);

  // Start from the broken text so the clean publish below proves the change.
  assert.equal((await changeDocument(client, uri, ACTION_PROGRAM, 2)).length, 1);
  assert.deepEqual(await changeDocument(client, uri, formatted, 3), []);

  const second = await client.request(3, 'textDocument/formatting', {
    textDocument: { uri }, options
  });
  assert.equal(second.result[0].newText, formatted,
    'formatting an already-formatted document produces identical output');
  await finish(client);
});

test('codeAction quick fixes are unambiguous and clear the diagnostic', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/actions.opu';
  const diagnostics = await openDocument(client, uri, ACTION_PROGRAM);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /unknown state 'nope'/);
  assert.match(diagnostics[0].message, /help: declare it with/);

  const response = await client.request(2, 'textDocument/codeAction', {
    textDocument: { uri },
    range: diagnostics[0].range,
    context: { diagnostics }
  });
  const actions = response.result;
  assert.equal(actions.length, 2);
  const byTitle = new Map(actions.map(action => [action.title, action]));
  assert.ok(byTitle.has("Declare state 'nope'"));
  assert.ok(byTitle.has("Use state 'count'"));
  for (const action of actions) {
    assert.equal(action.kind, 'quickfix');
    assert.equal(action.diagnostics[0].message, diagnostics[0].message);
    assert.ok(action.edit.changes[uri].length > 0);
  }

  const declared = applyEdits(ACTION_PROGRAM,
    byTitle.get("Declare state 'nope'").edit.changes[uri]);
  assert.ok(declared.includes('  state nope = 0'));
  assert.deepEqual(await changeDocument(client, uri, declared, 2), []);

  const used = applyEdits(ACTION_PROGRAM,
    byTitle.get("Use state 'count'").edit.changes[uri]);
  assert.ok(used.includes('Text("Count: {count}")'));
  // Go back to the broken text first so this fix is proven to clear a live
  // diagnostic; an already-clean document gets no second empty publish.
  assert.equal((await changeDocument(client, uri, ACTION_PROGRAM, 3)).length, 1);
  assert.deepEqual(await changeDocument(client, uri, used, 4), []);

  await finish(client);
});

test('codeAction prefers compiler fixes over help text and message regex', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const program = ['app T {', '  state count = 0', '  Text("{right}")', '}', ''].join('\n');
  const uri = 'file://the temporary checkout-lsp-test/layers.opu';
  assert.deepEqual(await openDocument(client, uri, program), []);

  const at = positionOf(program, '{right}', 1);
  const range = { start: at, end: { line: at.line, character: at.character + 'right'.length } };
  const request = (id, diagnostic) => client.request(id, 'textDocument/codeAction', {
    textDocument: { uri },
    range,
    context: { diagnostics: [diagnostic] }
  });

  // The compiler's structured fix wins: no help or message fallback.
  const codeFix = {
    range,
    severity: 1,
    source: 'opuromc',
    code: 'opurom.undeclared_state',
    message: "unknown state 'right' in Text interpolation\n" +
      "help: declare it with 'state right = 0' or use one of: count",
    data: { fixes: [{ title: 'Apply compiler fix', changes: { [uri]: [{ range, newText: 'count' }] } }] }
  };
  const structured = await request(2, codeFix);
  assert.deepEqual(structured.result.map(action => action.title), ['Apply compiler fix']);
  assert.equal(structured.result[0].diagnostics[0].code, 'opurom.undeclared_state');

  // Without structured data the help prefix wins over the message text.
  const helpOnly = { ...codeFix };
  delete helpOnly.data;
  helpOnly.message = "unknown state 'wrong' in Text interpolation\n" +
    "help: declare it with 'state right = 0' or use one of: count";
  const fromHelp = (await request(3, helpOnly)).result;
  assert.deepEqual(fromHelp.map(action => action.title),
    ["Declare state 'right'", "Use state 'count'"]);
  for (const action of fromHelp) {
    assert.equal(action.kind, 'quickfix');
    assert.equal(action.diagnostics[0].message, helpOnly.message);
  }

  const unsupported = await request(4, {
    range, severity: 1, source: 'opuromc', message: 'unknown kind here\nhelp: none'
  });
  assert.deepEqual(unsupported.result, []);

  await finish(client);
});

test('codeAction returns no fix for ambiguous or unsupported diagnostics', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/ambiguous.opu';
  assert.deepEqual(await openDocument(client, uri, FEATURE_PROGRAM), []);
  const wide = { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } };
  const ambiguous = {
    range: { start: { line: 3, character: 18 }, end: { line: 3, character: 22 } },
    severity: 1,
    source: 'opuromc',
    message: "unknown state 'nope' in Text interpolation\n" +
      "help: declare it with 'state nope = 0' or use one of: count, name"
  };

  const twoCandidates = await client.request(2, 'textDocument/codeAction', {
    textDocument: { uri }, range: wide, context: { diagnostics: [ambiguous] }
  });
  assert.equal(twoCandidates.result.length, 1);
  assert.equal(twoCandidates.result[0].title, "Declare state 'nope'");

  const unsupported = await client.request(3, 'textDocument/codeAction', {
    textDocument: { uri },
    range: wide,
    context: {
      diagnostics: [{
        ...ambiguous,
        message: "unknown kind 'Frobnicator'\nhelp: use one of the 24 valid kinds"
      }]
    }
  });
  assert.deepEqual(unsupported.result, []);

  const outside = await client.request(4, 'textDocument/codeAction', {
    textDocument: { uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    context: { diagnostics: [ambiguous] }
  });
  assert.deepEqual(outside.result, []);

  await finish(client);
});

test('foldingRange reports nested blocks and comments over JSON-RPC', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const init = await client.request(1, 'initialize', { capabilities: {} });
  assert.equal(init.result.capabilities.foldingRangeProvider, true);

  const uri = 'file://the temporary checkout-lsp-test/folding.opu';
  assert.deepEqual(await openDocument(client, uri, FOLDING_PROGRAM), []);

  const response = await client.request(2, 'textDocument/foldingRange', {
    textDocument: { uri }
  });
  const expected = [
    { startLine: 0, endLine: 1, kind: 'comment' },
    { startLine: 2, endLine: 9, kind: 'region' },
    { startLine: 4, endLine: 8, kind: 'region' }
  ];
  assert.ok(response.result.some(range =>
    range.startLine === 2 && range.endLine === 9 && range.kind === 'region'),
  'folding includes the app block');
  assert.deepEqual(response.result, expected);

  await finish(client);
});

test('foldingRanges ignores single lines and braces inside strings', () => {
  assert.deepEqual(foldingRanges(parseDocument(FOLDING_PROGRAM)), [
    { startLine: 0, endLine: 1, kind: 'comment' },
    { startLine: 2, endLine: 9, kind: 'region' },
    { startLine: 4, endLine: 8, kind: 'region' }
  ]);

  const trailingComments = [
    'state count = 0 // trailing comment',
    '// standalone comment',
    ''
  ].join('\n');
  assert.deepEqual(foldingRanges(parseDocument(trailingComments)), []);
});

test('foldingRange returns an empty array for an unknown URI', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { capabilities: {} });
  const response = await client.request(2, 'textDocument/foldingRange', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/unopened.opu' }
  });
  assert.deepEqual(response.result, []);

  await finish(client);
});

test('inlayHint reports the inferred state types over JSON-RPC', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const init = await client.request(1, 'initialize', { capabilities: {} });
  assert.equal(init.result.capabilities.inlayHintProvider, true);

  const uri = 'file://the temporary checkout-lsp-test/inlay.opu';
  assert.deepEqual(await openDocument(client, uri, GOOD_PROGRAM), []);

  const lines = GOOD_PROGRAM.split('\n');
  const wholeDocument = {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lines[lines.length - 1].length }
  };
  const response = await client.request(2, 'textDocument/inlayHint', {
    textDocument: { uri },
    range: wholeDocument
  });
  assert.deepEqual(response.result, [
    { position: { line: 1, character: lines[1].length }, label: ': int', kind: 1 },
    { position: { line: 2, character: lines[2].length }, label: ': string', kind: 1 }
  ]);

  const partial = await client.request(3, 'textDocument/inlayHint', {
    textDocument: { uri },
    range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }
  });
  assert.deepEqual(partial.result, [
    { position: { line: 1, character: lines[1].length }, label: ': int', kind: 1 }
  ]);

  const empty = await client.request(4, 'textDocument/inlayHint', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/unopened-inlay.opu' },
    range: wholeDocument
  });
  assert.deepEqual(empty.result, []);

  const missingRange = await client.request(5, 'textDocument/inlayHint', {
    textDocument: { uri }
  });
  assert.equal(missingRange.error?.code, -32602);

  await finish(client);
});

test('inlayHint skips state declarations without an inferred type', () => {
  const program = [
    'app Counter {',
    '  state count = 0',
    '  state ready = true',
    '  state alias = count',
    '}'
  ].join('\n');
  const lines = program.split('\n');
  assert.deepEqual(inlayHints(parseDocument(program), {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: 0 }
  }), [
    { position: { line: 1, character: lines[1].length }, label: ': int', kind: 1 },
    { position: { line: 2, character: lines[2].length }, label: ': bool', kind: 1 }
  ]);
});

test('documentHighlight marks state occurrences over JSON-RPC', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const init = await client.request(1, 'initialize', { capabilities: {} });
  assert.equal(init.result.capabilities.documentHighlightProvider, true);

  const uri = 'file://the temporary checkout-lsp-test/highlight.opu';
  assert.deepEqual(await openDocument(client, uri, HIGHLIGHT_PROGRAM), []);

  const response = await client.request(2, 'textDocument/documentHighlight', {
    textDocument: { uri },
    position: positionOf(HIGHLIGHT_PROGRAM, '{count}', 1)
  });
  assert.deepEqual(response.result, [
    { range: { start: { line: 2, character: 8 }, end: { line: 2, character: 13 } }, kind: 2 },
    { range: { start: { line: 4, character: 18 }, end: { line: 4, character: 23 } }, kind: 1 },
    { range: { start: { line: 5, character: 43 }, end: { line: 5, character: 48 } }, kind: 1 },
    { range: { start: { line: 6, character: 18 }, end: { line: 6, character: 23 } }, kind: 1 }
  ]);

  await finish(client);
});

test('documentHighlights ignores non-state words, comments and plain strings', () => {
  const document = parseDocument(HIGHLIGHT_PROGRAM);
  const positions = [
    positionOf(HIGHLIGHT_PROGRAM, 'Column(gap', 1),
    positionOf(HIGHLIGHT_PROGRAM, '// count', 3),
    positionOf(HIGHLIGHT_PROGRAM, 'plain count', 6),
    positionOf(HIGHLIGHT_PROGRAM, 'Your count', 5)
  ];
  for (const position of positions) {
    assert.deepEqual(documentHighlights(document, position), []);
  }
});

test('documentHighlight returns an empty array for an unknown URI', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  await client.request(1, 'initialize', { capabilities: {} });
  const response = await client.request(2, 'textDocument/documentHighlight', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/unopened-highlight.opu' },
    position: { line: 0, character: 0 }
  });
  assert.deepEqual(response.result, []);

  await finish(client);
});

test('semanticTokens returns delta-encoded compiler-accurate tokens', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());

  const init = await client.request(1, 'initialize', { capabilities: {} });
  assert.deepEqual(init.result.capabilities.semanticTokensProvider, {
    legend: { tokenTypes: ['state', 'model', 'apiPath', 'nodeKind'] },
    full: true
  });

  const uri = 'file://the temporary checkout-lsp-test/tokens.opu';
  assert.deepEqual(await openDocument(client, uri, SEMANTIC_PROGRAM), []);

  const response = await client.request(2, 'textDocument/semanticTokens/full', {
    textDocument: { uri }
  });
  // Delta-encoded per the LSP protocol: [deltaLine, startChar, length, tokenType,
  // modifiers] with tokenType indexing the advertised legend.
  assert.deepEqual(response.result, {
    data: [
      1, 8, 5, 0, 0,  // count declaration: state
      1, 8, 4, 1, 0,  // Todo declaration: model
      3, 6, 8, 2, 0,  // "/todos": apiPath
      1, 9, 4, 1, 0,  // Todo in `list Todo`: model
      2, 2, 6, 3, 0,  // Column: nodeKind
      1, 4, 4, 3, 0,  // Text: nodeKind
      0, 14, 5, 0, 0, // {count} interpolation: state
      1, 4, 6, 3, 0,  // Button: nodeKind
      0, 14, 5, 0, 0  // count in the action body: state
    ]
  });

  const empty = await client.request(3, 'textDocument/semanticTokens/full', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/unopened-tokens.opu' }
  });
  assert.deepEqual(empty.result, { data: [] });

  const malformed = await client.request(4, 'textDocument/semanticTokens/full', {});
  assert.equal(malformed.error?.code, -32602);
  assert.match(malformed.error.message, /textDocument\.uri/);

  await finish(client);
});

test('malformed params for every new request return InvalidParams', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/malformed.opu';
  assert.deepEqual(await openDocument(client, uri, GOOD_PROGRAM), []);
  const position = { line: 1, character: 8 };
  const requests = [
    ['textDocument/foldingRange', {}],
    ['textDocument/documentSymbol', {}],
    ['textDocument/documentSymbol', { textDocument: { uri: 42 } }],
    ['textDocument/references', { textDocument: { uri } }],
    ['textDocument/references', { textDocument: { uri }, position: 'here' }],
    ['textDocument/documentHighlight', {}],
    ['textDocument/documentHighlight', { textDocument: { uri } }],
    ['textDocument/documentHighlight', { textDocument: { uri }, position: 'here' }],
    ['textDocument/prepareRename', { textDocument: { uri } }],
    ['textDocument/prepareRename', {
      textDocument: { uri }, position: { line: -1, character: 0 }
    }],
    ['textDocument/rename', { textDocument: { uri }, position }],
    ['textDocument/rename', { textDocument: { uri }, position, newName: 'not valid' }],
    ['textDocument/formatting', {}],
    ['textDocument/codeAction', { textDocument: { uri } }],
    ['textDocument/codeAction', { textDocument: { uri }, range: { start: position } }],
    ['textDocument/semanticTokens/full', {}],
    ['textDocument/semanticTokens/full', { textDocument: { uri: 42 } }],
    ['textDocument/inlayHint', {}],
    ['textDocument/inlayHint', { textDocument: { uri: 42 } }],
    ['textDocument/inlayHint', { textDocument: { uri } }],
    ['textDocument/inlayHint', { textDocument: { uri }, range: { start: position } }]
  ];
  for (const [index, [method, params]] of requests.entries()) {
    const response = await client.request(10 + index, method, params);
    assert.equal(response.error?.code, -32602,
      `${method} rejects ${JSON.stringify(params)}`);
  }

  const unknown = await client.request(50, 'workspace/symbol', { query: '' });
  assert.equal(unknown.error.code, -32601);

  await finish(client);
});

test('quick fixes from the real opuromc clear its diagnostics',
  { skip: !fs.existsSync(realCompiler) }, async t => {
    const client = new Client(['--compiler', realCompiler]);
    t.after(() => client.close());
    await client.request(1, 'initialize', { capabilities: {} });

    const uri = 'file://the temporary checkout-lsp-test/real-actions.opu';
    const diagnostics = await openDocument(client, uri, ACTION_PROGRAM);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0].message, /unknown state 'nope'/);

    const actions = (await client.request(2, 'textDocument/codeAction', {
      textDocument: { uri },
      range: diagnostics[0].range,
      context: { diagnostics }
    })).result;
    assert.ok(actions.length >= 1);
    for (const [index, action] of actions.entries()) {
      // Restore the broken text so every fix clears a live diagnostic.
      assert.equal((await changeDocument(client, uri, ACTION_PROGRAM, 3 + index * 2)).length, 1);
      const fixed = applyEdits(ACTION_PROGRAM, action.edit.changes[uri]);
      assert.deepEqual(await changeDocument(client, uri, fixed, 4 + index * 2), []);
    }

    await finish(client);
  });

test('definition resolves declared component uses to their declaration', () => {
  const program = [
    'app A {',
    '  state count = 0',
    '  component Card(title: string) { Text("{title}") }',
    '  Card("hi")',
    '}',
    ''
  ].join('\n');
  const document = parseDocument(program);
  const use = definition(document, positionOf(program, 'Card("hi")', 0));
  assert.deepEqual(use.range.start, positionOf(program, 'component Card', 10));
  assert.equal(use.origin, 'component Card');
  // Existing navigation stays intact, and component parameters are local.
  assert.equal(definition(document, positionOf(program, 'count = 0', 0)).origin, 'state count');
  assert.equal(definition(document, positionOf(program, 'title: string', 0)), null);
});

test('signatureHelp lists node-kind props and tracks the typed attribute', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const uri = 'file://the temporary checkout-lsp-test/signature.opu';
  const program = [
    'app Shop {',
    '  Column(gap: 8, padding: 4) {',
    '  }',
    '}',
    ''
  ].join('\n');
  assert.deepEqual(await openDocument(client, uri, program), []);

  const insideColumn = await client.request(2, 'textDocument/signatureHelp', {
    textDocument: { uri },
    position: positionOf(program, 'Column(', 'Column(gap'.length)
  });
  const help = insideColumn.result;
  assert.equal(help.activeSignature, 0);
  assert.equal(help.signatures.length, 1);
  const signature = help.signatures[0];
  assert.equal(signature.label, 'Column(gap, padding, align, width)');
  assert.deepEqual(signature.parameters.map(entry => entry.label),
    ['gap', 'padding', 'align', 'width']);
  assert.match(signature.documentation.value, /Column/);
  // The caret sits on `gap`, which is the first prop.
  assert.equal(help.activeParameter, 0);

  const onPadding = await client.request(3, 'textDocument/signatureHelp', {
    textDocument: { uri },
    position: positionOf(program, 'padding', 'padding'.length)
  });
  assert.equal(onPadding.result.activeParameter, 1);

  const outside = await client.request(4, 'textDocument/signatureHelp', {
    textDocument: { uri },
    position: positionOf(program, 'app Shop', 0)
  });
  assert.equal(outside.result, null);

  const unknown = await client.request(5, 'textDocument/signatureHelp', {
    textDocument: { uri: 'file://the temporary checkout-lsp-test/absent.opu' },
    position: { line: 0, character: 0 }
  });
  assert.equal(unknown.result, null);

  const missingUri = await client.request(6, 'textDocument/signatureHelp', {
    position: { line: 0, character: 0 }
  });
  assert.equal(missingUri.error.code, -32602);
  const badPosition = await client.request(7, 'textDocument/signatureHelp', {
    textDocument: { uri },
    position: { line: -1, character: 0 }
  });
  assert.equal(badPosition.error.code, -32602);

  await finish(client);
});

test('signatureHelp classifies the innermost node kind with the shared classifier', () => {
  const text = 'Column(gap: 8) {\n  Row(padding: 1, ';
  const document = parseDocument(text);
  const row = signatureHelp(document, { line: 1, character: text.split('\n')[1].length });
  assert.equal(row.signatures[0].label, 'Row(gap, padding, align, width)');
  // After `padding: 1, ` no catalog word is under the caret, so the first prop is active.
  assert.equal(row.activeParameter, 0);
  const nested = signatureHelp(document, { line: 1, character: '  Row(padding'.length });
  assert.equal(nested.activeParameter, 1);
  assert.equal(signatureHelp(document, { line: 0, character: 0 }), null);
});

test('definition sends a declared component location over JSON-RPC', async t => {
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });

  const program = [
    'app A {',
    '  component Card(title: string) { Text("{title}") }',
    '  Card("hi")',
    '}',
    ''
  ].join('\n');
  const uri = 'file://the temporary checkout-lsp-test/component-definition.opu';
  assert.deepEqual(await openDocument(client, uri, program), []);

  const result = (await client.request(2, 'textDocument/definition', {
    textDocument: { uri },
    position: positionOf(program, 'Card("hi")', 1)
  })).result;
  assert.equal(result.uri, uri);
  assert.deepEqual(result.range.start, positionOf(program, 'component Card', 10));
  assert.deepEqual(result.range.end, positionOf(program, 'component Card', 14));

  await finish(client);
});

test('component parameters are not app state occurrences', () => {
  // A component declares its own parameter names. When one happens to share a
  // spelling with an app state, rename and semantic highlighting must not
  // touch the component body: those words are local, not state references.
  const program = [
    'app Demo {',
    '  state count = 0',
    '  component Card(count: int) {',
    '    Text("{count}")',
    '  }',
    '  Card(count: 1)',
    '  Text("{count}")',
    '}',
    ''
  ].join('\n');
  const document = parseDocument(program);
  const ranges = stateOccurrences(document, 'count');
  assert.deepEqual(
    ranges.map(range => [range.start.line, range.start.character]),
    [[1, 8], [6, 9]],
    'only the declaration and the app-level interpolation are state occurrences'
  );
});

test('rename leaves component-local names intact', async t => {
  const program = [
    'app Demo {',
    '  state count = 0',
    '  component Card(count: int) {',
    '    Text("{count}")',
    '  }',
    '  Text("{count}")',
    '}',
    ''
  ].join('\n');
  const client = new Client(['--compiler', stubCompiler]);
  t.after(() => client.close());
  await client.request(1, 'initialize', { capabilities: {} });
  const uri = 'file://the temporary checkout-lsp-test/rename-component.opu';
  assert.deepEqual(await openDocument(client, uri, program), []);

  const rename = await client.request(2, 'textDocument/rename', {
    textDocument: { uri },
    position: positionOf(program, 'count = 0', 0),
    newName: 'total'
  });
  const edits = rename.result.changes[uri];
  assert.equal(edits.length, 2, 'only the state declaration and app interpolation');
  assert.ok(edits.every(edit => edit.newText === 'total'));
  const renamed = applyEdits(program, edits);
  assert.ok(renamed.includes('state total = 0'));
  assert.ok(renamed.includes('component Card(count: int)'), 'component parameter unchanged');
  assert.ok(renamed.includes('Text("{count}")'), 'component interpolation unchanged');
});
