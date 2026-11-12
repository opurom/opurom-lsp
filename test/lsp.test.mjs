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
