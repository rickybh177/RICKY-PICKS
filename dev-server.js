#!/usr/bin/env node
/* Dev server local — sin necesidad de `vercel login`.
   Sirve public/ como estáticos y api/*.js como rutas.
   Uso: node dev-server.js                               */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

/* ---- cargar .env ---- */
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  });
  console.log('✓ .env cargado');
} catch (e) {
  console.warn('⚠ Sin .env (las API van a fallar sin variables)');
}

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_DIR    = path.join(__dirname, 'api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

/* ---- shim para que los handlers de Vercel funcionen con Node http ---- */
function buildReq(nodeReq, body, query) {
  return Object.assign(nodeReq, {
    body,
    query,
    headers: nodeReq.headers,
    method: nodeReq.method,
  });
}
function buildRes(nodeRes) {
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return res; },
    setHeader(k, v) { nodeRes.setHeader(k, v); return res; },
    json(data) {
      const body = JSON.stringify(data);
      nodeRes.writeHead(statusCode, { 'Content-Type': 'application/json' });
      nodeRes.end(body);
    },
    end(data) {
      nodeRes.writeHead(statusCode);
      nodeRes.end(data || '');
    },
    send(data) {
      nodeRes.writeHead(statusCode, { 'Content-Type': 'text/plain' });
      nodeRes.end(String(data));
    },
  };
  return res;
}

async function readBody(nodeReq) {
  return new Promise((resolve, reject) => {
    let raw = '';
    nodeReq.on('data', c => { raw += c; });
    nodeReq.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    nodeReq.on('error', reject);
  });
}

/* ---- servidor ---- */
const server = http.createServer(async (nodeReq, nodeRes) => {
  const parsed  = url.parse(nodeReq.url, true);
  const pathname = parsed.pathname.replace(/\?.*$/, '');

  /* API routes: /api/xxx → api/xxx.js */
  if (pathname.startsWith('/api/')) {
    const name    = pathname.slice(5).replace(/\//g, path.sep);
    const apiFile = path.join(API_DIR, name + '.js');
    if (fs.existsSync(apiFile)) {
      try {
        /* limpiar caché para que los cambios en caliente surtan efecto */
        delete require.cache[require.resolve(apiFile)];
        const handler = require(apiFile);
        const body    = await readBody(nodeReq);
        const req     = buildReq(nodeReq, body, parsed.query);
        const res     = buildRes(nodeRes);
        await handler(req, res);
      } catch (e) {
        console.error('API error:', e);
        nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
        nodeRes.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    nodeRes.writeHead(404, { 'Content-Type': 'application/json' });
    nodeRes.end(JSON.stringify({ error: 'API not found: ' + pathname }));
    return;
  }

  /* Archivos estáticos desde public/ */
  let filePath = pathname === '/' ? '/index.html' : pathname;
  /* Si no tiene extensión, intenta .html (para rutas amigables) */
  if (!path.extname(filePath)) filePath += '.html';
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext  = path.extname(fullPath);
    const mime = MIME[ext] || 'application/octet-stream';
    nodeRes.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(fullPath).pipe(nodeRes);
    return;
  }

  /* 404 */
  nodeRes.writeHead(404, { 'Content-Type': 'text/plain' });
  nodeRes.end('Not found: ' + pathname);
});

server.listen(PORT, () => {
  console.log(`\n🚀 RICKY-PICKS corriendo en http://localhost:${PORT}\n`);
  console.log('  Landing page  →  http://localhost:' + PORT + '/');
  console.log('  Mis modelos   →  http://localhost:' + PORT + '/mis-modelos.html');
  console.log('  Admin         →  http://localhost:' + PORT + '/admin.html');
  console.log('\nCtrl+C para detener.\n');
});
