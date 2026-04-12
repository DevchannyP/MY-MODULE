'use strict';

const DEEP_LINK_CLIENT_RUNTIME_SOURCE = `
function normalizeDeepLinkClientContext(context) {
  return {
    focus: String(context && context.focus || '').trim(),
    reason: String(context && context.reason || '').trim(),
    command: String(context && context.command || '').trim(),
    label: String(context && context.label || '').trim(),
    source: String(context && context.source || '').trim(),
  };
}

function hasDeepLinkClientContext(context) {
  var normalized = normalizeDeepLinkClientContext(context);
  return !!(normalized.focus || normalized.reason || normalized.command || normalized.label || normalized.source);
}

function loadDeepLinkClientStorage(storageKey) {
  try {
    if (!window.sessionStorage) {
      return normalizeDeepLinkClientContext(null);
    }
    var raw = window.sessionStorage.getItem(String(storageKey || '').trim());
    if (!raw) {
      return normalizeDeepLinkClientContext(null);
    }
    return normalizeDeepLinkClientContext(JSON.parse(raw));
  } catch (_) {
    return normalizeDeepLinkClientContext(null);
  }
}

function saveDeepLinkClientStorage(storageKey, context) {
  try {
    if (!window.sessionStorage) {
      return;
    }
    var normalized = normalizeDeepLinkClientContext(context);
    if (!hasDeepLinkClientContext(normalized)) {
      window.sessionStorage.removeItem(String(storageKey || '').trim());
      return;
    }
    window.sessionStorage.setItem(String(storageKey || '').trim(), JSON.stringify(normalized));
  } catch (_) {
    return;
  }
}

function readDeepLinkClientContextFromSearch(searchValue) {
  try {
    var params = new URLSearchParams(String(searchValue || ''));
    return normalizeDeepLinkClientContext({
      focus: String(params.get('focus') || '').trim(),
      reason: String(params.get('reason') || '').trim(),
      command: String(params.get('command') || '').trim(),
      label: String(params.get('label') || '').trim(),
      source: String(params.get('source') || '').trim(),
    });
  } catch (_) {
    return normalizeDeepLinkClientContext(null);
  }
}

function buildDeepLinkClientHref(basePath, focus, targetId, meta) {
  var params = new URLSearchParams();
  if (focus) params.set('focus', String(focus).trim());
  if (meta && meta.reason) params.set('reason', String(meta.reason).trim());
  if (meta && meta.command) params.set('command', String(meta.command).trim());
  if (meta && meta.label) params.set('label', String(meta.label).trim());
  if (meta && meta.source) params.set('source', String(meta.source).trim());
  var query = params.toString();
  return String(basePath || 'mindmap/index.html') + (query ? '?' + query : '') + (targetId ? ('#' + targetId) : '');
}
`;

module.exports = {
  DEEP_LINK_CLIENT_RUNTIME_SOURCE,
};
