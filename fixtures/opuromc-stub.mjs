#!/usr/bin/env node
// Stub `opuromc` used by the self-contained LSP test.
//
// It mimics the real compiler closely enough for the language server:
// `check <file>` prints `path:line:col: error: message` plus a `help:` line
// on stderr and exits 1, or exits 0 with no output for a valid file.
//
// A file is "invalid" when it contains the marker `OPAQUE_BAD_STATE`.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] !== 'check' || !args[1]) {
  process.stderr.write('usage: opuromc check <file>\n');
  process.exit(2);
}

const file = args[1];
let text = '';
try {
  text = readFileSync(file, 'utf8');
} catch {
  process.stderr.write(`${file}:1:1: error: cannot read file\n  help: check the path\n`);
  process.exit(1);
}

const lines = text.split(/\r?\n/);
const badIndex = lines.findIndex(line => line.includes('OPAQUE_BAD_STATE'));
if (badIndex !== -1) {
  const column = lines[badIndex].indexOf('OPAQUE_BAD_STATE') + 1;
  process.stderr.write(
    `${file}:${badIndex + 1}:${column}: error: unknown state 'nope' in Text interpolation\n` +
    "  help: declare it with 'state nope = 0' or use one of: count\n"
  );
  process.exit(1);
}

process.stdout.write('ok\n');
process.exit(0);
