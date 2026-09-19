import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 8787);
const maxDownloadSize = parseSize(process.env.MAX_DOWNLOAD_SIZE || '500MB');
const tokenTtl = 10 * 60 * 1000;
const tokens = new Map();
const rateBuckets = new Map();
const mimeExtensions = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac' };

function parseSize(value) {
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)?$/i);
  if (!match) return 500 * 1024 * 1024;
  const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.floor(Number(match[1]) * (units[match[2]?.toUpperCase()] || 1));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function safeFilename(input, extension) {
  const cleaned = String(input || 'gitaru-download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'gitaru-download';
  return `${cleaned}.${extension}`;
}

function isBlockedAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return true;
}

async function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('UNSUPPORTED_SOURCE');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal') || net.isIP(hostname) && isBlockedAddress(hostname)) throw new Error('UNSUPPORTED_SOURCE');
  let addresses;
  try { addresses = (await dns.lookup(hostname, { all: true })).map((entry) => entry.address); } catch { throw new Error('MEDIA_UNAVAILABLE'); }
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new Error('UNSUPPORTED_SOURCE');
  return url;
}

function requestWithTimeout(url, options = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { ...options, headers: { 'User-Agent': 'Gitaru/1.0', ...options.headers } }, resolve);
    const timer = setTimeout(() => request.destroy(new Error('TIMEOUT')), timeout);
    request.once('error', reject);
    request.once('close', () => clearTimeout(timer));
    request.end();
  });
}

async function resolveDirectUrl(url) {
  let current = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await validatePublicUrl(current.toString());
    const response = await requestWithTimeout(current, { method: 'HEAD' });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (!response.headers.location) throw new Error('MEDIA_UNAVAILABLE');
      current = new URL(response.headers.location, current);
      continue;
    }
    return { url: current, response };
  }
  throw new Error('MEDIA_UNAVAILABLE');
}

function sourceName(url) { return url.hostname.replace(/^www\./, ''); }
function titleFromUrl(url) { return decodeURIComponent(path.basename(url.pathname) || 'public-media').replace(/[-_]+/g, ' ').replace(/\.[^.]+$/, '').slice(0, 80); }
function errorMessage(code) {
  return ({ INVALID_URL: 'Invalid URL', UNSUPPORTED_SOURCE: 'Unsupported source', MEDIA_UNAVAILABLE: 'Media unavailable', TOO_LARGE: 'That file is too large for Gitaru.', RATE_LIMITED: 'Too many requests. Please try again later.', FORMAT_UNAVAILABLE: 'Format unavailable', TIMEOUT: 'Network error' })[code] || 'Processing failed';
}

function rateLimit(req, kind) {
  const address = req.socket.remoteAddress || 'unknown';
  const limit = Number(process.env[kind === 'metadata' ? 'METADATA_RATE_LIMIT' : 'DOWNLOAD_RATE_LIMIT'] || (kind === 'metadata' ? 20 : 8));
  const key = `${kind}:${address}`;
  const now = Date.now();
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
  const bucket = rateBuckets.get(key) || { started: now, count: 0 };
  if (now - bucket.started > windowMs) { bucket.started = now; bucket.count = 0; }
  bucket.count += 1; rateBuckets.set(key, bucket);
  return bucket.count <= limit;
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10000) throw new Error('INVALID_URL'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('INVALID_URL'); }
}

function cleanupTokens() {
  const now = Date.now();
  for (const [id, item] of tokens) if (item.expires < now) tokens.delete(id);
}
setInterval(cleanupTokens, 60_000).unref();

async function metadata(req, res) {
  if (!rateLimit(req, 'metadata')) return json(res, 429, { success: false, code: 'RATE_LIMITED', error: errorMessage('RATE_LIMITED') });
  try {
    const input = await body(req);
    const url = await validatePublicUrl(input.url);
    const resolved = await resolveDirectUrl(url);
    const contentType = (resolved.response.headers['content-type'] || '').split(';')[0].toLowerCase();
    const size = Number(resolved.response.headers['content-length'] || 0);
    if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) throw new Error('UNSUPPORTED_SOURCE');
    if (size > maxDownloadSize) throw new Error('TOO_LARGE');
    const extension = mimeExtensions[contentType] || contentType.split('/')[1] || 'bin';
    const id = crypto.randomBytes(24).toString('hex');
    tokens.set(id, { url: resolved.url.toString(), title: titleFromUrl(resolved.url), source: sourceName(resolved.url), contentType, extension, size, expires: Date.now() + tokenTtl });
    return json(res, 200, { success: true, source: sourceName(resolved.url), title: titleFromUrl(resolved.url), thumbnail: null, duration: null, formats: [{ id, type: contentType.startsWith('video/') ? 'video' : 'audio', quality: contentType.startsWith('video/') ? 'Original' : 'Original', format: extension, size: size || null }], note: 'Direct public media only. Platform pages are not fetched.' });
  } catch (error) { return json(res, 400, { success: false, code: error.message, error: errorMessage(error.message) }); }
}

async function download(req, res) {
  if (!rateLimit(req, 'download')) return json(res, 429, { success: false, code: 'RATE_LIMITED', error: errorMessage('RATE_LIMITED') });
  try {
    const input = await body(req);
    const item = tokens.get(String(input.formatId));
    if (!item || item.expires < Date.now()) throw new Error('FORMAT_UNAVAILABLE');
    tokens.delete(String(input.formatId));
    const response = await requestWithTimeout(new URL(item.url), { method: 'GET' }, 120000);
    if (response.statusCode !== 200) throw new Error('MEDIA_UNAVAILABLE');
    const declaredSize = Number(response.headers['content-length'] || item.size || 0);
    if (declaredSize > maxDownloadSize) { response.destroy(); throw new Error('TOO_LARGE'); }
    let received = 0;
    response.on('data', (chunk) => { received += chunk.length; if (received > maxDownloadSize) response.destroy(new Error('TOO_LARGE')); });
    res.writeHead(200, { 'Content-Type': item.contentType, 'Content-Disposition': `attachment; filename="${safeFilename(item.title, item.extension)}"`, 'Cache-Control': 'no-store', ...(declaredSize ? { 'Content-Length': declaredSize } : {}) });
    response.on('error', () => { if (!res.headersSent) json(res, 502, { success: false, error: errorMessage('MEDIA_UNAVAILABLE') }); else res.destroy(); });
    response.pipe(res);
  } catch (error) { return json(res, error.message === 'RATE_LIMITED' ? 429 : 400, { success: false, code: error.message, error: errorMessage(error.message) }); }
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir)) return json(res, 404, { error: 'Not found' });
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/metadata') return metadata(req, res);
    if (req.method === 'POST' && req.url === '/api/download') return download(req, res);
    if (req.method === 'GET' && req.url === '/api/sources') return json(res, 200, { success: true, sources: [{ id: 'direct', label: 'Direct public media', status: 'Supported' }, { id: 'platforms', label: 'Platform pages', status: 'Coming soon' }] });
    if (req.method === 'GET') return serveStatic(req, res);
    return json(res, 404, { error: 'Not found' });
  } catch { return json(res, 500, { success: false, error: 'Server unavailable' }); }
});
server.listen(port, () => console.log(`Gitaru running at http://localhost:${port}`));
