import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SOURCE_HOSTS = new Map([
  ['youtube.com', 'YouTube public videos'], ['www.youtube.com', 'YouTube public videos'], ['youtu.be', 'YouTube public videos'],
  ['tiktok.com', 'TikTok public posts'], ['www.tiktok.com', 'TikTok public posts'], ['vm.tiktok.com', 'TikTok public posts'], ['vt.tiktok.com', 'TikTok public posts'],
  ['instagram.com', 'Instagram public posts'], ['www.instagram.com', 'Instagram public posts'],
  ['facebook.com', 'Facebook public videos'], ['www.facebook.com', 'Facebook public videos'], ['fb.watch', 'Facebook public videos'],
  ['x.com', 'X public posts'], ['www.x.com', 'X public posts'], ['twitter.com', 'X public posts'], ['www.twitter.com', 'X public posts'],
  ['vimeo.com', 'Vimeo public videos'], ['www.vimeo.com', 'Vimeo public videos']
]);
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export function sourceForUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return [...SOURCE_HOSTS.keys()].find((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch { return null; }
}

export function createYtDlpAdapter({ validateUrl, maxDownloadSize, tokenTtlMs, tokens, binary = process.env.YTDLP_PATH || 'yt-dlp' }) {
  return {
    id: 'yt-dlp-public',
    async getMetadata(rawUrl) {
      const host = sourceForUrl(rawUrl);
      if (!host) throw new Error('UNSUPPORTED_SOURCE');
      await validateUrl(rawUrl);
      const details = await inspect(binary, rawUrl);
      if (details.is_live || details.age_limit > 0) throw new Error('MEDIA_UNAVAILABLE');
      const source = SOURCE_HOSTS.get(host);
      const title = safeTitle(details.title || 'public-media');
      const formats = buildFormats(details, { tokens, tokenTtlMs, maxDownloadSize, binary, sourceUrl: details.webpage_url || rawUrl, title, source });
      if (!formats.length) throw new Error('FORMAT_UNAVAILABLE');
      return { success: true, source, title, thumbnail: details.thumbnail || null, duration: details.duration || null, formats: formats.map(({ token, key, ...format }) => ({ id: token, ...format })), note: 'Public media only. Private, login-only, DRM-protected, and unavailable posts are rejected.' };
    },
    async download(formatId, response) {
      const item = tokens.get(String(formatId));
      if (!item || item.expires < Date.now()) throw new Error('FORMAT_UNAVAILABLE');
      tokens.delete(String(formatId));
      response.writeHead(200, { 'Content-Type': item.contentType, 'Content-Disposition': `attachment; filename="${safeFilename(item.title, item.extension)}"`, 'Cache-Control': 'no-store' });
      const args = ['--no-warnings', '--no-playlist', '--no-part', '--format', item.formatId, '--output', '-', item.sourceUrl];
      const process = spawn(binary, args, { windowsHide: true });
      let received = 0;
      process.stdout.on('data', (chunk) => { received += chunk.length; if (received > maxDownloadSize) process.kill(); else response.write(chunk); });
      process.stderr.resume();
      process.once('error', () => response.destroy());
      process.once('close', (code) => { if (code !== 0 || received === 0) response.destroy(); else response.end(); });
    }
  };
}

async function inspect(binary, url) {
  try {
    const { stdout } = await execFileAsync(binary, ['--dump-single-json', '--no-warnings', '--no-playlist', '--skip-download', url], { timeout: 60_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('DOWNLOADER_UNAVAILABLE');
    const output = `${error.stdout || ''} ${error.stderr || ''}`.toLowerCase();
    if (output.includes('login') || output.includes('private')) throw new Error('PRIVATE_CONTENT');
    if (output.includes('drm')) throw new Error('DRM_PROTECTED');
    throw new Error('MEDIA_UNAVAILABLE');
  }
}

function buildFormats(details, options) {
  const candidates = [];
  const formats = Array.isArray(details.formats) ? details.formats : [];
  for (const format of formats) {
    if (!format.url || format.protocol === 'm3u8_native' || format.protocol === 'm3u8') continue;
    const hasVideo = format.vcodec && format.vcodec !== 'none';
    const hasAudio = format.acodec && format.acodec !== 'none';
    const isImage = imageExtensions.has(String(format.ext || '').toLowerCase()) && !hasVideo && !hasAudio;
    if (!hasVideo && !hasAudio && !isImage) continue;
    const size = Number(format.filesize || format.filesize_approx || 0);
    if (size > options.maxDownloadSize) continue;
    const type = isImage ? 'photo' : hasVideo ? 'video' : 'audio';
    const quality = type === 'photo' ? 'Original' : type === 'audio' ? (format.abr ? `${Math.round(format.abr)} kbps` : 'Audio') : (format.height ? `${format.height}p` : format.format_note || 'Video');
    const key = `${type}:${quality}:${format.ext}`;
    if (candidates.some((candidate) => candidate.key === key)) continue;
    const token = crypto.randomBytes(24).toString('hex');
    options.tokens.set(token, { adapter: 'yt-dlp-public', sourceUrl: options.sourceUrl, formatId: String(format.format_id), title: options.title, source: options.source, contentType: contentTypeFor(type, format.ext), extension: safeExtension(type, format.ext), size, expires: Date.now() + options.tokenTtlMs });
    candidates.push({ key, token, type, quality, format: safeExtension(type, format.ext), size: size || null });
  }
  return candidates.sort((left, right) => formatRank(left) - formatRank(right));
}

function formatRank(format) { return format.type === 'photo' ? 0 : format.type === 'audio' ? 100 : 1000 - Number.parseInt(format.quality, 10) || 0; }
function contentTypeFor(type, extension) { if (type === 'photo') return `image/${extension === 'jpg' ? 'jpeg' : extension}`; if (type === 'audio') return extension === 'mp3' ? 'audio/mpeg' : `audio/${extension}`; return `video/${extension}`; }
function safeExtension(type, extension) { const value = String(extension || (type === 'photo' ? 'jpg' : type === 'audio' ? 'm4a' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, ''); return value.slice(0, 8) || 'mp4'; }
function safeTitle(value) { return String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'public-media'; }
function safeFilename(title, extension) { const asciiTitle = safeTitle(title).replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'public-media'; return `${asciiTitle}.${safeExtension('video', extension)}`; }
