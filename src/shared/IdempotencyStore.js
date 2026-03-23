'use strict';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

class InMemoryIdempotencyStore {
  constructor() {
    this._entries = new Map();
  }

  _scope({ key, method, path, callerId }) {
    return `${method}:${path}:${callerId || 'anonymous'}:${key}`;
  }

  begin({ key, method, path, callerId, body }) {
    const scope = this._scope({ key, method, path, callerId });
    const fingerprint = stableStringify(body);
    const entry = this._entries.get(scope);

    if (entry) {
      if (entry.fingerprint !== fingerprint) {
        return {
          outcome: 'mismatch',
          scope,
          fingerprint,
        };
      }
      if (entry.state === 'completed') {
        return {
          outcome: 'replay',
          scope,
          response: entry.response,
        };
      }
      return {
        outcome: 'in_progress',
        scope,
      };
    }

    this._entries.set(scope, {
      state: 'in_progress',
      fingerprint,
      response: null,
      createdAt: new Date().toISOString(),
    });
    return {
      outcome: 'started',
      scope,
      fingerprint,
    };
  }

  complete(scope, response) {
    const entry = this._entries.get(scope);
    if (!entry) {
      return;
    }
    entry.state = 'completed';
    entry.response = JSON.parse(JSON.stringify(response));
  }

  abort(scope) {
    this._entries.delete(scope);
  }
}

module.exports = {
  InMemoryIdempotencyStore,
  stableStringify,
};
