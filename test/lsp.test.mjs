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
import { NODE_KIND_NAMES } from '../lib/catalog.mjs';
import { completion, hover } from '../lib/features.mjs';
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
  assert.ok(initialize.result.capabilities.diagnosticProvider);

  await client.notification('initialized', {});

  const uri = 'file://the temporary checkout-lsp-test/counter.opu';
  await client.notification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'opurom', version: 1, text: BAD_PROGRAM }
  });

  const diagnostics = await waitForDiagnostics(client, uri);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, 1);
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
    'list', 'get', 'create', 'update', 'delete', 'primary',
    'padding', 'margin', 'color', 'radius', 'shadow', 'gradient', 'glass', 'opacity', 'animate',
    'count', 'name'
  ]) {
    assert.ok(labels.includes(expected), `completion offers ${expected}`);
  }

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
    '}',
    ''
  ].join('\n');
  assert.deepEqual(await openDocument(client, uri, program), []);

  const button = await client.request(2, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'Button(', 'Button('.length)
  });
  assert.deepEqual(button.result.items.map(entry => entry.label), ['label']);
  assert.equal(button.result.items[0].detail, 'Button attribute');
  assert.match(button.result.items[0].documentation, /Button attribute `label`/);

  const column = await client.request(3, 'textDocument/completion', {
    textDocument: { uri },
    position: positionOf(program, 'Column(', 'Column('.length)
  });
  assert.deepEqual(column.result.items.map(entry => entry.label),
    ['gap', 'padding', 'align', 'width']);
  for (const entry of column.result.items) {
    assert.equal(typeof entry.documentation, 'string');
    assert.match(entry.documentation, /Column attribute `/);
  }

  const outside = await client.request(4, 'textDocument/completion', {
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

test('completion leaves node parens at the closing paren', () => {
  const text = 'Button(label: "Column(")\nColumn(';
  const document = parseDocument(text);
  assert.deepEqual(
    completion(document, { line: 0, character: 7 }).items.map(entry => entry.label),
    ['label']
  );
  const closed = completion(document, { line: 0, character: text.indexOf('\n') });
  assert.ok(closed.items.some(entry => entry.label === 'Column'));
  assert.ok(!closed.items.some(entry => entry.label === 'label'));
  const quoted = completion(parseDocument('Text("(")\n'), { line: 0, character: 9 });
  assert.ok(quoted.items.some(entry => entry.label === 'Column'));
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
  assert.equal(caps.textDocumentSync, 1);

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

  assert.deepEqual(await changeDocument(client, uri, renamed, 2), []);

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

  assert.deepEqual(await changeDocument(client, uri, formatted, 2), []);

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
  assert.deepEqual(await changeDocument(client, uri, used, 3), []);

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
  // Delta-encoded per the LSP contract: [deltaLine, startChar, length, tokenType,
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
      const fixed = applyEdits(ACTION_PROGRAM, action.edit.changes[uri]);
      assert.deepEqual(await changeDocument(client, uri, fixed, 3 + index), []);
    }

    await finish(client);
  });
