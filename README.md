# opurom-lsp

The Opurom language server. Zero npm dependencies — **Node builtins only**
(`node:fs`, `node:os`, `node:path`, `node:child_process`). There is no
`vscode-languageserver` package and no install step.

```sh
node the framework workspace/opurom-lsp/bin/server.mjs --stdio
```

The server speaks LSP over stdio with the standard `Content-Length: N\r\n\r\n<JSON>`
framing.

## Options

| Option | Meaning |
| --- | --- |
| `--stdio` | Required. The server refuses to start without it. |
| `--compiler <path>` | Path to `opuromc`. Overrides `OPR_OpuromC`. |
| `OPR_OpuromC` | Environment fallback for the compiler path. |
| — | With neither option, the sibling `opurom-lang/target/debug/opuromc` is used, then `opuromc` on `PATH`. |

## Supported methods

| Method | Behaviour |
| --- | --- |
| `initialize` | Returns `textDocumentSync: 1`, `hoverProvider`, `completionProvider`, `definitionProvider` and `diagnosticProvider`. |
| `initialized` | Lifecycle acknowledgement. |
| `shutdown` | Marks the session as shutting down. |
| `exit` | Ends the process with code 0 when `shutdown` was seen, 1 otherwise. |
| `textDocument/didOpen` | Stores the document, runs the compiler, publishes diagnostics. |
| `textDocument/didChange` | Same as `didOpen` for the new text. |
| `textDocument/didClose` | Drops the document and clears its diagnostics. |
| `textDocument/hover` | Markdown for a state (type + initializer), a model (fields), a node kind (props) or a canonical prop. |
| `textDocument/completion` | The 24 node kinds, keywords, canonical props, model field types, API verbs and the declared states and models. |
| `textDocument/definition` | The `state` or `model` declaration line inside the same document. |

Unknown methods answer with JSON-RPC error `-32601`. A malformed frame answers
with parse error `-32700` and the process stays alive.

## Diagnostics

On `didOpen` and `didChange` the document is written to a temporary `.opu` file and
`opuromc check <file>` runs on it. The compiler output

```
path:line:col: error: message
  help: how to fix it
```

becomes one LSP diagnostic per line: `severity` 1 for `error` and 2 for `warning`,
a 0-based range that widens the reported character to the token that starts there,
and a message whose second line is the `help:` text.

If the compiler binary is missing, the server emits **one** `window/showMessage`
warning, publishes empty diagnostics and keeps serving hover, completion and
definition. It never crashes on a missing tool.

## Point VS Code at it

The VS Code extension in `../opurom-ide-plugins` starts this server itself and
needs no manual wiring. To run the server by hand (for example with a different
editor), set the path in the extension settings:

```json
{
  "opurom.lspPath": "the framework workspace/opurom-lsp/bin/server.mjs"
}
```

The extension spawns `node <lspPath> --stdio` and speaks the same JSON-RPC
framing to it.

## Tests

```sh
cd the framework workspace/opurom-lsp
node --test
```

`test/lsp.test.mjs` runs a real JSON-RPC session (initialize → initialized →
didOpen with a bad program → diagnostics → didChange → hover → completion →
definition → unknown method → shutdown → exit) against the spawned server, using
the stub compiler in `fixtures/` so the suite is self-contained. A second test
repeats the diagnostics check with the real `opuromc` when it is built, and is
skipped otherwise. A third test proves that a malformed frame is answered with a
parse error while the server stays alive, and a fourth proves that a missing
compiler warns exactly once.

## Honest status

Verified in this round: diagnostics from `opuromc check`, hover, completion and
definition. The semantic features are derived from a lightweight in-process parse
of the open document, not from the compiler's IR, so they describe what the
document declares rather than what the compiler will lower.

Not implemented (initial release+): formatting, rename, references, code actions,
semantic tokens, workspace symbols, and the debugger adapter protocol (DAP).
There is no JetBrains plugin and no profiler view yet.
