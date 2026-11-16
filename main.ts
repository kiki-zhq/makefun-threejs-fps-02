// DUSTLINE — Site 7: a three.js tactical FPS entry (Node 22, standard library
// only). The game is this directory's game/ folder — plain static files the
// browser loads as ES modules with three.js from an import map — and the program
// hands it in: it copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function countEntries(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    total += 1;
    if (statSync(path).isDirectory()) total += countEntries(path);
  }
  return total;
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json). Count first so a too-big game fails loudly
// here instead of silently at the gate.
const gameEntries = countEntries(join(out, 'game'));
if (gameEntries > 993) throw new Error(`game/ holds ${gameEntries} entries, over the 993 cap`);
const shotEntries = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).filter((name) => !name.startsWith('.'))
  : [];
if (shotEntries.length < 3 || shotEntries.length > 4) {
  throw new Error(`screenshots/ holds ${shotEntries.length} images, the gate wants 3 or 4`);
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
