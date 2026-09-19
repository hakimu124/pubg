import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

export function canHandleTikTok(rawUrl) {
  try { return TIKTOK_HOSTS.has(new URL(rawUrl).hostname.toLowerCase()); } catch { return false; }
}

export function createTikTokAdapter({ validateUrl, maxDownloadSize, tokenTtlMs, tokens, binary = process.env.YTDLP_PATH || 'yt-dlp' }) {
  return {
    id: 'tiktok',
    label: 'TikTok public posts',
    async getMetadata(rawUrl) {
      if (!canHandleTikTok(rawUrl)) throw new Error('UNSUPPORTED_SOURCE');
      await validateUrl(rawUrl);
      let info;
      try {
        ({ stdout: info } = await execFileAsync(binary, ['--dump-single-json', '--no-warnings', '--no-playlist', '--skip-download', rawUrl], { timeout: 45_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error('DOWNLOADER_UNAVAILABLE');
        const output = `${error.stdout || ''} ${error.stderr || ''}`.toLowerCase();
        if (output.includes('login') || output.includes('private')) throw new Error('PRIVATE_CONTENT');
        if (output.includes('drm')) throw new Error('DRM_PROTECTED');
        throw new Error('MEDIA_UNAVAILABLE');
      }
      let details;
      try { details = JSON.parse(info); } catch { throw new Error('MEDIA_UNAVAILABLE'); }
      if (!details.url || details.is_live || details.age_limit > 0) throw new Error('MEDIA_UNAVAILABLE');
      const format = details.ext || 'mp4';
      const id = crypto.randomBytes(24).toString('hex');
      const item = { adapter: 'tiktok', sourceUrl: details.webpage_url || rawUrl, formatId: details.format_id, title: safeTitle(details.title), source: 'tiktok.com', contentType: details.mimetype?.split(';')[0] || `video/${format}`, extension: format, size: Number(details.filesize || details.filesize_approx || 0), expires: Date.now() + tokenTtlMs };
      if (!item.formatId) throw new Error('FORMAT_UNAVAILABLE');
      if (item.size > maxDownloadSize) throw new Error('TOO_LARGE');
      tokens.set(id, item);
      return { success: true, source: item.source, title: item.title, thumbnail: details.thumbnail || null, duration: details.duration || null, formats: [{ id, type: 'video', quality: details.format_note || 'Available', format: item.extension, size: item.size || null }], note: 'Public TikTok media only. Private, login-only, DRM-protected, and unavailable posts are rejected.' };
    },
    async download(formatId, response) {
      const item = tokens.get(String(formatId));
      if (!item || item.expires < Date.now()) throw new Error('FORMAT_UNAVAILABLE');
      tokens.delete(String(formatId));
      response.writeHead(200, { 'Content-Type': item.contentType, 'Content-Disposition': `attachment; filename="${safeFilename(item.title, item.extension)}"`, 'Cache-Control': 'no-store' });
      const process = spawn(binary, ['--no-warnings', '--no-playlist', '--no-part', '--format', item.formatId, '--output', '-', item.sourceUrl], { windowsHide: true });
      let received = 0;
      process.stdout.on('data', (chunk) => { received += chunk.length; if (received > maxDownloadSize) process.kill(); else response.write(chunk); });
      process.stderr.resume();
      process.once('error', () => { if (!response.headersSent) response.destroy(); else response.destroy(); });
      process.once('close', (code) => { if (code !== 0 || received === 0) response.destroy(); else response.end(); });
    }
  };
}

function safeTitle(value) { return String(value || 'tiktok-video').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'tiktok-video'; }
function safeFilename(title, extension) {
  const asciiTitle = safeTitle(title).replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'tiktok-video';
  const safeExtension = String(extension).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'mp4';
  return `${asciiTitle}.${safeExtension}`;
}
