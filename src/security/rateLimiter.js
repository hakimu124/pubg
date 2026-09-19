export function createRateLimiter({ windowMs, limit }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key) || { started: now, count: 0 };
    if (now - bucket.started > windowMs) { bucket.started = now; bucket.count = 0; }
    bucket.count += 1;
    buckets.set(key, bucket);
    return bucket.count <= limit;
  };
}
