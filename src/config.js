import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  root,
  publicDir: path.join(root, '..', 'public'),
  port: Number(process.env.PORT || 8787),
  maxDownloadSize: parseSize(process.env.MAX_DOWNLOAD_SIZE || '500MB'),
  tokenTtlMs: 10 * 60 * 1000,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  metadataRateLimit: Number(process.env.METADATA_RATE_LIMIT || 20),
  downloadRateLimit: Number(process.env.DOWNLOAD_RATE_LIMIT || 8)
};

export function parseSize(value) {
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)?$/i);
  if (!match) return 500 * 1024 * 1024;
  const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.floor(Number(match[1]) * (units[match[2]?.toUpperCase()] || 1));
}
