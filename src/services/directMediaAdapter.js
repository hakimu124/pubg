import path from 'node:path';
import crypto from 'node:crypto';
import { requestWithTimeout, resolveDirectUrl } from './httpClient.js';

const mimeExtensions = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac' };

export function sourceName(url) { return url.hostname.replace(/^www\./, ''); }
export function titleFromUrl(url) { return decodeURIComponent(path.basename(url.pathname) || 'public-media').replace(/[-_]+/g, ' ').replace(/\.[^.]+$/, '').slice(0, 80); }

export function createDirectMediaAdapter({ validateUrl, maxDownloadSize, tokenTtlMs, tokens }) {
  return {
    id: 'direct',
    label: 'Direct public media',
    async getMetadata(rawUrl) {
      const url = await validateUrl(rawUrl);
      const resolved = await resolveDirectUrl(url, validateUrl);
      const contentType = (resolved.response.headers['content-type'] || '').split(';')[0].toLowerCase();
      const size = Number(resolved.response.headers['content-length'] || 0);
      if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) throw new Error('UNSUPPORTED_SOURCE');
      if (size > maxDownloadSize) throw new Error('TOO_LARGE');
      const extension = mimeExtensions[contentType] || contentType.split('/')[1] || 'bin';
      const id = crypto.randomBytes(24).toString('hex');
      const metadata = { url: resolved.url.toString(), title: titleFromUrl(resolved.url), source: sourceName(resolved.url), contentType, extension, size, expires: Date.now() + tokenTtlMs };
      tokens.set(id, metadata);
      return { success: true, source: metadata.source, title: metadata.title, thumbnail: null, duration: null, formats: [{ id, type: contentType.startsWith('video/') ? 'video' : 'audio', quality: 'Original', format: extension, size: size || null }], note: 'Direct public media only. Platform pages are not fetched.' };
    },
    async download(formatId, response) {
      const item = tokens.get(String(formatId));
      if (!item || item.expires < Date.now()) throw new Error('FORMAT_UNAVAILABLE');
      tokens.delete(String(formatId));
      const upstream = await requestWithTimeout(new URL(item.url), { method: 'GET' }, 120_000);
      if (upstream.statusCode !== 200) throw new Error('MEDIA_UNAVAILABLE');
      const declaredSize = Number(upstream.headers['content-length'] || item.size || 0);
      if (declaredSize > maxDownloadSize) { upstream.destroy(); throw new Error('TOO_LARGE'); }
      let received = 0;
      upstream.on('data', (chunk) => { received += chunk.length; if (received > maxDownloadSize) upstream.destroy(new Error('TOO_LARGE')); });
      response.writeHead(200, { 'Content-Type': item.contentType, 'Content-Disposition': `attachment; filename="${safeFilename(item.title, item.extension)}"`, 'Cache-Control': 'no-store', ...(declaredSize ? { 'Content-Length': declaredSize } : {}) });
      upstream.pipe(response);
    }
  };
}

function safeFilename(input, extension) {
  const cleaned = String(input || 'gitaru-download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'gitaru-download';
  return `${cleaned}.${extension}`;
}
