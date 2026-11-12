#!/usr/bin/env node
// Opurom language server entry point.
//
//   node bin/server.mjs --stdio [--compiler /path/to/opuromc]
//
// The compiler also comes from the OPR_OpuromC environment variable; when
// neither is set the sibling opurom-lang/target/debug/opuromc is used.
import { main } from '../lib/server.mjs';

main(process.argv.slice(2));
