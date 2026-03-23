'use strict';

class InMemoryRateLimiter {
  constructor() {
    this._buckets = new Map();
  }

  consume({ key, limit, windowMs }) {
    const now = Date.now();
    const entry = this._buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      const fresh = {
        count: 1,
        limit,
        resetAt: now + windowMs,
      };
      this._buckets.set(key, fresh);
      return {
        allowed: true,
        limit,
        remaining: Math.max(limit - fresh.count, 0),
        resetAt: fresh.resetAt,
        retryAfterSeconds: 0,
      };
    }

    entry.count += 1;
    entry.limit = limit;
    const allowed = entry.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(limit - entry.count, 0),
      resetAt: entry.resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
    };
  }
}

module.exports = {
  InMemoryRateLimiter,
};
