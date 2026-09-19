import http from 'node:http';
import https from 'node:https';

export function requestWithTimeout(url, options = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { ...options, headers: { 'User-Agent': 'Gitaru/1.0', ...options.headers } }, resolve);
    const timer = setTimeout(() => request.destroy(new Error('TIMEOUT')), timeoutMs);
    request.once('error', reject);
    request.once('close', () => clearTimeout(timer));
    request.end();
  });
}

export async function resolveDirectUrl(url, validateUrl) {
  let current = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await validateUrl(current.toString());
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
