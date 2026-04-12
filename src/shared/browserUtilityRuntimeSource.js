'use strict';

const BROWSER_UTILITY_RUNTIME_SOURCE = `
var CLIENT_PENDING_IDEMPOTENCY_KEYS = {};

function stableStringifyForClientIdempotency(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(function(item) { return stableStringifyForClientIdempotency(item); }).join(',') + ']';
  }
  var keys = Object.keys(value).sort();
  return '{' + keys.map(function(key) {
    return JSON.stringify(key) + ':' + stableStringifyForClientIdempotency(value[key]);
  }).join(',') + '}';
}

function createClientIdempotencyKey(scope) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return String(scope || 'client') + ':' + window.crypto.randomUUID();
  }
  return String(scope || 'client') + ':' + Date.now() + ':' + Math.random().toString(16).slice(2);
}

function reserveClientIdempotencyKey(scope, payload) {
  var targetScope = String(scope || '').trim();
  if (!targetScope) {
    return '';
  }
  var fingerprint = stableStringifyForClientIdempotency(payload || {});
  var existing = CLIENT_PENDING_IDEMPOTENCY_KEYS[targetScope];
  if (existing && existing.fingerprint === fingerprint) {
    return existing.key;
  }
  var key = createClientIdempotencyKey(targetScope);
  CLIENT_PENDING_IDEMPOTENCY_KEYS[targetScope] = { key: key, fingerprint: fingerprint };
  return key;
}

function releaseClientIdempotencyKey(scope, key) {
  var targetScope = String(scope || '').trim();
  var existing = CLIENT_PENDING_IDEMPOTENCY_KEYS[targetScope];
  if (existing && existing.key === key) {
    delete CLIENT_PENDING_IDEMPOTENCY_KEYS[targetScope];
  }
}

function fetchJsonClient(url, options) {
  var opts = options || {};
  var method = String(opts.method || 'GET').toUpperCase();
  var headers = Object.assign({}, opts.defaultHeaders || {}, opts.headers || {});
  var idempotencyScope = opts.idempotencyScope;
  var reservedKey = '';
  if (method === 'POST' && idempotencyScope) {
    reservedKey = reserveClientIdempotencyKey(idempotencyScope, opts.idempotencyPayload);
    if (reservedKey) {
      headers['Idempotency-Key'] = reservedKey;
    }
  }
  var requestOptions = Object.assign({}, opts, { method: method, headers: headers });
  delete requestOptions.defaultHeaders;
  delete requestOptions.idempotencyScope;
  delete requestOptions.idempotencyPayload;
  return fetch(url, requestOptions).finally(function() {
    if (reservedKey && idempotencyScope) {
      releaseClientIdempotencyKey(idempotencyScope, reservedKey);
    }
  });
}

function copyTextToClipboardClient(value) {
  var text = String(value || '');
  if (!text.trim()) {
    return Promise.reject(new Error('empty command'));
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function(resolve, reject) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        resolve();
      } else {
        reject(new Error('copy failed'));
      }
    } catch (error) {
      document.body.removeChild(textarea);
      reject(error);
    }
  });
}
`;

module.exports = {
  BROWSER_UTILITY_RUNTIME_SOURCE,
};
