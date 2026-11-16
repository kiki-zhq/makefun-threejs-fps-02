// A tiny static server for play-testing the game locally (Node 22, standard
// library only). Serves game/ at http://localhost:8080 — open it in a desktop
// browser and play.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'game');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const port = Number.parseInt(process.env.PORT ?? '8080', 10);

createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = join(root, path);
  if (!existsSync(file) || !file.startsWith(root)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => {
  console.log(`DUSTLINE serving game/ at http://localhost:${port}`);
});
