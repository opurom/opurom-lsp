# opurom-lsp

The Opurom language server. Zero npm dependencies — **Node builtins only**
(`node:fs`, `node:os`, `node:path`, `node:child_process`). There is no
`vscode-languageserver` package and no install step.

```sh
node opurom-lsp/bin/server.mjs --stdio
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
| `initialize` | Returns `textDocumentSync: 1` and the hover, completion, definition, folding range, diagnostic, document symbol, references, rename, document formatting and code action providers. |
| `initialized` | Lifecycle acknowledgement. |
| `shutdown` | Marks the session as shutting down. |
| `exit` | Ends the process with code 0 when `shutdown` was seen, 1 otherwise. |
| `textDocument/didOpen` | Stores the document, runs the compiler, publishes diagnostics. |
| `textDocument/didChange` | Same as `didOpen` for the new text. |
| `textDocument/didClose` | Drops the document and clears its diagnostics. |
| `textDocument/hover` | Markdown for a state (type + initializer), a model (fields), a node kind (props) or a canonical prop. |
| `textDocument/completion` | The 24 node kinds, keywords, canonical props, model field types, API verbs and the declared states and models. |
| `textDocument/definition` | The `state` or `model` declaration line inside the same document. |
| `textDocument/foldingRange` | `region` ranges for multiline brace-delimited blocks and `comment` ranges for runs of two or more consecutive comment-only lines. An unknown document URI returns `[]`. |
| `textDocument/documentSymbol` | A hierarchical outline: the app, its states, models with fields, API paths with handlers, and the component tree with ranges and symbol kinds. |
| `textDocument/references` | Every reference to the state name under the cursor: declaration, `{state}` interpolations, `bind:` values, conditions and action bodies. |
| `textDocument/prepareRename` | Validates the position before `rename`. Returns the state name range and placeholder, or error `-32602` when the position is not on a declared state reference. |
| `textDocument/rename` | A `WorkspaceEdit` replacing every occurrence of a state name. Rejects invalid identifiers, keywords, existing state names and non-renameable positions with `-32602`. |
| `textDocument/formatting` | A whole-document `TextEdit` that normalises indentation to two spaces, braces and token spacing. Idempotent. |
| `textDocument/codeAction` | Quick fixes for the compiler's `unknown state` diagnostic when the compiler's `help:` line makes the edit unambiguous. |

Unknown methods answer with JSON-RPC error `-32601`. Malformed params for a
request answer with `-32602`. A malformed frame answers with parse error
`-32700` and the process stays alive. The contract is defined in
[the LSP scope contract](../opurom-examples/golden/the LSP scope contract) and
[the integration extensions](../opurom-examples/golden/the integration extensions).

## Semantic features

All semantic features are derived from the in-process parse of the open
document. The parser keeps each token's source position, the raw text of string
literals and the position of every `{state}` interpolation, so references and
rename work inside strings and action bodies without guessing at words in
comments or plain string text.

`textDocument/foldingRange` reports multiline brace-delimited blocks as `region`
ranges and runs of two or more consecutive comment-only lines as `comment`
ranges.

`prepareRename` is the validation gate: the cursor must land on a declared
state name **and** on one of that state's classified occurrences. Editors call
it before committing a rename, and the error response makes them refuse the
operation. `rename` returns one `TextEdit` per occurrence with the same range
that `references` reports.

`textDocument/formatting` re-emits the token stream rather than adjusting the
original whitespace. Every `{` ends a line, every `}` starts one, an empty
block stays on one line, and spacing depends only on the neighbouring token
kinds. Because the emitted layout obeys the same rules on a second pass,
formatting an already-formatted document returns identical text. Comments,
string literals and single blank lines are preserved.

`textDocument/codeAction` offers a fix only for the compiler's friendly
`unknown state` diagnostic. It inserts the exact declaration the compiler's
`help:` line recommends after the last app-level `state` declaration, and —
only when the compiler names exactly one existing state as an alternative —
offers to replace the offending name with it. Unknown kinds, type mismatches,
duplicate names and ambiguous candidate lists yield an empty action list.

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
warning, publishes empty diagnostics and keeps serving every document feature.
It never crashes on a missing tool.

## Point VS Code at it

The VS Code extension in `../opurom-ide-plugins` starts this server itself and
needs no manual wiring. To run the server by hand (for example with a different
editor), set the path in the extension settings:

```json
{
  "opurom.lspPath": "/absolute/path/to/opurom-lsp/bin/server.mjs"
}
```

The extension spawns `node <lspPath> --stdio` and speaks the same JSON-RPC
framing to it.

## Tests

```sh
cd opurom-lsp
node --test
```

`test/lsp.test.mjs` drives the spawned server over real Content-Length framed
JSON-RPC. It covers diagnostics, hover, completion and definition, plus a
session for each of `foldingRange`, `documentSymbol`, `references`,
`prepareRename`, `rename`, `formatting` and `codeAction`. A unit-level folding
test covers nested blocks, single-line blocks, braces inside strings,
consecutive comment folding and trailing comments, and a framed request checks
that an unknown folding URI returns an empty array. Error paths include unknown
methods, malformed params, rename on a non-renameable position, malformed frames
and a missing compiler. The formatter test formats a messy document, applies the
returned edit, then formats again and asserts identical output. Code-action tests
apply each returned edit and assert the compiler's diagnostics clear. The suite
uses the stub compiler in `fixtures/` so it is self-contained, and runs
additional checks against the real `opuromc` when it is built.

## Status

The server provides diagnostics from `opuromc check`, hover, completion,
definition, document symbols, folding ranges, references, validated rename,
idempotent document formatting and quick-fix code actions. Framed JSON-RPC tests
cover initialization, document open and change notifications, diagnostics and
each language request; a unit test covers folding-range extraction. Diagnostics
come from the compiler; the semantic features come from the in-process parse of
the open document. The debugger adapter protocol (DAP) is served by the separate
`../opurom-debug` repository.
