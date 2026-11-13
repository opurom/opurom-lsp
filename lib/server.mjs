// Opurom language server: LSP over stdio with Content-Length framing.
// Node builtins only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFrameReader, encodeMessage } from './frame.mjs';
import { parseCompilerOutput, toLspDiagnostics } from './diagnostics.mjs';
import { parseDocument } from './document.mjs';
import { completion, definition, hover } from './features.mjs';
import { KEYWORDS } from './catalog.mjs';
import { documentSymbols, IDENTIFIER, renameTarget, stateReferences } from './symbols.mjs';
import { formatDocument } from './format.mjs';
import { codeActions } from './codeaction.mjs';
import { COMPILER_ENV, resolveCompiler } from './compiler.mjs';

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

const SERVER_VERSION = '0.1.0';

const isPosition = value => value && Number.isInteger(value.line) && value.line >= 0 &&
  Number.isInteger(value.character) && value.character >= 0;
const isRange = value => value && isPosition(value.start) && isPosition(value.end);
const documentUri = params => {
  const uri = params?.textDocument?.uri;
  return typeof uri === 'string' && uri ? uri : null;
};

function parseArgs(argv) {
  const options = { stdio: false, compiler: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stdio') {
      options.stdio = true;
    } else if (arg === '--compiler') {
      options.compiler = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--compiler=')) {
      options.compiler = arg.slice('--compiler='.length);
    }
  }
  return options;
}

function runCompiler(compilerPath, file) {
  return new Promise(resolve => {
    // A JavaScript compiler shim is run with the current Node binary; a
    // native compiler is run directly.
    const isScript = /\.(?:mjs|cjs|js)$/.test(compilerPath);
    const command = isScript ? process.execPath : compilerPath;
    const args = isScript ? [compilerPath, 'check', file] : ['check', file];
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ missing: true, output: `spawn failed: ${error.message}` });
      return;
    }
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => {
      resolve({ missing: true, output: `spawn failed: ${error.message}` });
    });
    child.on('close', code => {
      resolve({ missing: false, code, output });
    });
  });
}

export function createServer(options = {}) {
  const compilerPath = resolveCompiler({
    flag: options.compiler,
    envValue: options.env ? options.env[COMPILER_ENV] : process.env[COMPILER_ENV],
    env: options.env || process.env
  });

  const state = {
    compilerPath,
    documents: new Map(), // uri -> { text, version, parsed }
    shutdownRequested: false,
    warnedAboutCompiler: false,
    warnedAboutUnknown: false
  };

  const send = message => {
    if (options.write) options.write(message);
    else process.stdout.write(encodeMessage(message));
  };

  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

  const respond = (id, result) => {
    if (id === undefined || id === null) return;
    send({ jsonrpc: '2.0', id, result });
  };

  const respondError = (id, code, message) => {
    // A parse error has no request id; JSON-RPC answers it with id null.
    send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  };

  const invalid = (id, message) => respondError(id, INVALID_PARAMS, message);

  const publishDiagnostics = (uri, diagnostics) => {
    notify('textDocument/publishDiagnostics', { uri, diagnostics });
  };

  const documentFor = uri => {
    const entry = state.documents.get(uri);
    if (!entry) return null;
    if (!entry.parsed) entry.parsed = parseDocument(entry.text);
    return entry;
  };

  const warnAboutCompiler = () => {
    if (state.warnedAboutCompiler) return;
    state.warnedAboutCompiler = true;
    notify('window/showMessage', {
      type: 2,
      message:
        `Opurom compiler not found at ${state.compilerPath}. ` +
        'Diagnostics are disabled. Build opurom-lang with cargo build, set OPR_OpuromC, ' +
        'or pass --compiler <path>.'
    });
  };

  const checkDocument = async (uri, version) => {
    const entry = state.documents.get(uri);
    if (!entry) return;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opurom-lsp-'));
    const file = path.join(directory, 'document.opu');
    try {
      fs.writeFileSync(file, entry.text, 'utf8');
      const result = await runCompiler(state.compilerPath, file);
      if (result.missing) {
        warnAboutCompiler();
        publishDiagnostics(uri, []);
        return;
      }
      // A newer edit already arrived; its own check will publish.
      if (state.documents.get(uri)?.version !== version) return;
      const parsed = parseCompilerOutput(result.output);
      publishDiagnostics(uri, toLspDiagnostics(parsed, entry.text));
    } catch (error) {
      if (state.documents.get(uri)?.version !== version) return;
      publishDiagnostics(uri, []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  const handle = async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      respondError(null, INVALID_REQUEST, 'request must be a JSON-RPC object');
      return;
    }
    const { id, method } = message;
    if (typeof method !== 'string') {
      respondError(id, INVALID_REQUEST, 'request is missing a method');
      return;
    }
    const params = message.params || {};

    switch (method) {
      case 'initialize':
        respond(id, {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            completionProvider: { triggerCharacters: [':', '"', ' '] },
            definitionProvider: true,
            diagnosticProvider: {
              interFileDependencies: false,
              workspaceDiagnostics: false
            },
            documentSymbolProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            documentFormattingProvider: true,
            codeActionProvider: true
          },
          serverInfo: { name: 'opurom-lsp', version: SERVER_VERSION }
        });
        return;

      case 'initialized':
        return;

      case 'shutdown':
        state.shutdownRequested = true;
        respond(id, null);
        return;

      case 'exit':
        process.exit(state.shutdownRequested ? 0 : 1);
        return;

      case 'textDocument/didOpen': {
        const uri = params.textDocument?.uri;
        if (!uri) return;
        state.documents.set(uri, {
          text: params.textDocument.text || '',
          version: params.textDocument.version ?? 0
        });
        await checkDocument(uri, state.documents.get(uri).version);
        return;
      }

      case 'textDocument/didChange': {
        const uri = params.textDocument?.uri;
        if (!uri) return;
        const change = Array.isArray(params.contentChanges) ? params.contentChanges[0] : null;
        const text = change && typeof change.text === 'string' ? change.text : '';
        const version = params.textDocument?.version ?? 0;
        state.documents.set(uri, { text, version });
        await checkDocument(uri, version);
        return;
      }

      case 'textDocument/didClose': {
        const uri = params.textDocument?.uri;
        if (!uri) return;
        state.documents.delete(uri);
        publishDiagnostics(uri, []);
        return;
      }

      case 'textDocument/hover': {
        const uri = params.textDocument?.uri;
        const entry = documentFor(uri);
        if (!entry) {
          respond(id, null);
          return;
        }
        respond(id, hover(entry.parsed, params.position || { line: 0, character: 0 }));
        return;
      }

      case 'textDocument/completion': {
        const uri = params.textDocument?.uri;
        const entry = documentFor(uri);
        respond(id, entry ? completion(entry.parsed) : { isIncomplete: false, items: [] });
        return;
      }

      case 'textDocument/definition': {
        const uri = params.textDocument?.uri;
        const entry = documentFor(uri);
        if (!entry) {
          respond(id, null);
          return;
        }
        const found = definition(entry.parsed, params.position || { line: 0, character: 0 });
        respond(id, found ? { uri, range: found.range } : null);
        return;
      }

      case 'textDocument/documentSymbol': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/documentSymbol requires textDocument.uri');
          return;
        }
        const entry = documentFor(uri);
        respond(id, entry ? documentSymbols(entry.parsed) : []);
        return;
      }

      case 'textDocument/references': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/references requires textDocument.uri');
          return;
        }
        if (!isPosition(params.position)) {
          invalid(id, 'textDocument/references requires a valid position');
          return;
        }
        const entry = documentFor(uri);
        if (!entry) {
          respond(id, []);
          return;
        }
        respond(id, stateReferences(entry.parsed, uri, params.position,
          params.context?.includeDeclaration !== false));
        return;
      }

      case 'textDocument/prepareRename': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/prepareRename requires textDocument.uri');
          return;
        }
        if (!isPosition(params.position)) {
          invalid(id, 'textDocument/prepareRename requires a valid position');
          return;
        }
        const entry = documentFor(uri);
        const target = entry ? renameTarget(entry.parsed, params.position) : null;
        if (!target) {
          invalid(id, 'cannot rename: the position is not on a declared state name');
          return;
        }
        respond(id, { range: target.range, placeholder: target.name });
        return;
      }

      case 'textDocument/rename': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/rename requires textDocument.uri');
          return;
        }
        if (!isPosition(params.position)) {
          invalid(id, 'textDocument/rename requires a valid position');
          return;
        }
        const newName = params.newName;
        if (typeof newName !== 'string' || !IDENTIFIER.test(newName) ||
            KEYWORDS.includes(newName)) {
          invalid(id, 'textDocument/rename requires an identifier as newName');
          return;
        }
        const entry = documentFor(uri);
        if (!entry) {
          invalid(id, 'cannot rename: the document is not open');
          return;
        }
        const target = renameTarget(entry.parsed, params.position);
        if (!target) {
          invalid(id, 'cannot rename: the position is not on a declared state name');
          return;
        }
        if (newName !== target.name && entry.parsed.states.has(newName)) {
          invalid(id, `cannot rename: state '${newName}' already exists`);
          return;
        }
        respond(id, {
          changes: {
            [uri]: target.occurrences.map(range => ({ range, newText: newName }))
          }
        });
        return;
      }

      case 'textDocument/formatting': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/formatting requires textDocument.uri');
          return;
        }
        const entry = documentFor(uri);
        if (!entry) {
          respond(id, []);
          return;
        }
        const lines = entry.text.split(/\r?\n/);
        respond(id, [{
          range: {
            start: { line: 0, character: 0 },
            end: { line: lines.length - 1, character: lines[lines.length - 1].length }
          },
          newText: formatDocument(entry.text)
        }]);
        return;
      }

      case 'textDocument/codeAction': {
        const uri = documentUri(params);
        if (!uri) {
          invalid(id, 'textDocument/codeAction requires textDocument.uri');
          return;
        }
        if (!isRange(params.range)) {
          invalid(id, 'textDocument/codeAction requires a valid range');
          return;
        }
        const entry = documentFor(uri);
        respond(id, entry ? codeActions(entry.parsed, uri, params.range, params.context) : []);
        return;
      }

      default:
        respondError(id, METHOD_NOT_FOUND, `unsupported method: ${method}`);
    }
  };

  const reader = createFrameReader(
    message => {
      handle(message).catch(error => {
        respondError(message?.id, INTERNAL_ERROR, String(error?.message || error));
      });
    },
    problem => {
      respondError(null, PARSE_ERROR, problem);
    }
  );

  return {
    state,
    compilerPath,
    push(chunk) {
      reader.push(chunk);
    },
    handle,
    stop() {
      process.exit(0);
    }
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.stdio) {
    process.stderr.write('usage: node bin/server.mjs --stdio [--compiler <path>]\n');
    process.exit(2);
  }
  const server = createServer({ compiler: options.compiler });
  process.stdin.on('data', chunk => server.push(chunk));
  process.stdin.on('end', () => {
    process.exit(server.state.shutdownRequested ? 0 : 1);
  });
  process.stdin.resume();
}
