import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reference site for the web audit. Every check in the suite should pass here,
 * which proves the tests fail for the *right* reasons when a real site breaks.
 *
 *   node fixtures/site/server.mjs        # http://localhost:4173
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const PORT = Number(process.env.PORT ?? 4173);
const BASE = `http://localhost:${PORT}`;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/svg+xml',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);

  if (url.pathname === '/old') {
    res.writeHead(301, { location: '/' });
    res.end();
    return;
  }

  let requested = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!path.extname(requested)) requested += '.html';

  const file = path.join(root, requested);

  // Refuse traversal, then try the file.
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    const notFound = await readFile(path.join(root, '404.html'));
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notFound);
  }
});

server.listen(PORT, () => {
  console.log(`fixture site: ${BASE}`);
  console.log(`fixture sitemap assumes ${BASE} — set SITE_URL to match if you change PORT`);
});
