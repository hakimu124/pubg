import dns from 'node:dns/promises';
import net from 'node:net';

export function isBlockedAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [first, second] = address.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || first >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return true;
}

export async function validatePublicUrl(raw) {
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
