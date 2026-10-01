/**
 * The website: static files from ./public, and nothing else.
 *
 * No framework and no dependencies, on purpose: it is one page, and a server
 * that is forty lines of node:http has nothing to update and nothing to break.
 *
 * The one dynamic thing is /config.js, which tells the page where the API is,
 * so the same files work against a local API and the deployed one.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const API_URL = (process.env.API_URL || 'https://blockyapi-production.up.railway.app').replace(/\/+$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/config.js') {
    res.writeHead(200, { ...SECURITY, 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
    res.end(`window.BLOCKY_API = ${JSON.stringify(API_URL)};\n`);
    return;
  }

  // Resolve inside ./public only: a path with ".." in it never leaves it.
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, relative);
  if (!file.startsWith(ROOT)) file = join(ROOT, 'index.html');

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    // Pages are linked without their extension: /privacy is privacy.html.
    try {
      await stat(`${file}.html`);
      file = `${file}.html`;
    } catch {
      file = join(ROOT, '404.html');
      res.statusCode = 404;
    }
  }

  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    // Images and fonts never change under the same name; the pages and their code might.
    const cache = type.startsWith('image/') || type.startsWith('font/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(res.statusCode || 200, { ...SECURITY, 'content-type': type, 'cache-control': cache });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500, SECURITY);
    res.end();
  }
}).listen(PORT, () => {
  console.log(`blocky web on http://localhost:${PORT} (api: ${API_URL})`);
});
