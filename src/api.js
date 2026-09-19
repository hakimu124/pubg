import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { validatePublicUrl } from './security/urlValidator.js';
import { createRateLimiter } from './security/rateLimiter.js';
import { createDirectMediaAdapter } from './services/directMediaAdapter.js';
import { canHandleTikTok, createTikTokAdapter } from './services/tiktokAdapter.js';

const tokens = new Map();
const adapter = createDirectMediaAdapter({ validateUrl: validatePublicUrl, maxDownloadSize: config.maxDownloadSize, tokenTtlMs: config.tokenTtlMs, tokens });
const tiktokAdapter = createTikTokAdapter({ validateUrl: validatePublicUrl, maxDownloadSize: config.maxDownloadSize, tokenTtlMs: config.tokenTtlMs, tokens });
const metadataAllowed = createRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.metadataRateLimit });
const downloadAllowed = createRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.downloadRateLimit });

export function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function errorMessage(code) {
  return ({ INVALID_URL: 'Invalid URL. Paste a complete http:// or https:// link.', UNSUPPORTED_SOURCE: 'Unsupported source. Paste a direct public media file link or a public TikTok post.', DOWNLOADER_UNAVAILABLE: 'TikTok is currently unavailable on this deployment because the media engine is not installed.', PRIVATE_CONTENT: 'Private content cannot be downloaded.', DRM_PROTECTED: 'DRM-protected media cannot be downloaded.', MEDIA_UNAVAILABLE: 'Media unavailable. Check that the public post still works.', TOO_LARGE: 'That file is too large for Gitaru.', RATE_LIMITED: 'Too many requests. Please try again later.', FORMAT_UNAVAILABLE: 'Format unavailable', TIMEOUT: 'Network error' })[code] || 'Processing failed';
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) throw new Error('INVALID_URL'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('INVALID_URL'); }
}

export async function metadataHandler(req, res) {
  if (!metadataAllowed(req.socket.remoteAddress || 'unknown')) return json(res, 429, { success: false, code: 'RATE_LIMITED', error: errorMessage('RATE_LIMITED') });
  try {
    const url = (await readJson(req)).url;
    return json(res, 200, await (canHandleTikTok(url) ? tiktokAdapter : adapter).getMetadata(url));
  }
  catch (error) { return json(res, 400, { success: false, code: error.message, error: errorMessage(error.message) }); }
}

export async function downloadHandler(req, res) {
  if (!downloadAllowed(req.socket.remoteAddress || 'unknown')) return json(res, 429, { success: false, code: 'RATE_LIMITED', error: errorMessage('RATE_LIMITED') });
  try {
    const formatId = (await readJson(req)).formatId;
    const item = tokens.get(String(formatId));
    if (!item) throw new Error('FORMAT_UNAVAILABLE');
    return await (item.adapter === 'tiktok' ? tiktokAdapter : adapter).download(formatId, res);
  }
  catch (error) { return json(res, error.message === 'RATE_LIMITED' ? 429 : 400, { success: false, code: error.message, error: errorMessage(error.message) }); }
}

export function sourcesHandler(_req, res) {
  return json(res, 200, { success: true, sources: [{ id: adapter.id, label: adapter.label, status: 'Supported' }, { id: tiktokAdapter.id, label: tiktokAdapter.label, status: 'Supported' }, { id: 'platforms', label: 'Other platform pages', status: 'Coming soon' }] });
}

export function staticHandler(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(config.publicDir, requested));
  if (!file.startsWith(config.publicDir)) return json(res, 404, { error: 'Not found' });
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'" });
    res.end(data);
  });
}

export function cleanupTokens() {
  const now = Date.now();
  for (const [id, item] of tokens) if (item.expires < now) tokens.delete(id);
}
