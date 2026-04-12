'use strict';

const OPERATOR_ACTION_CLIENT_RUNTIME_SOURCE = `
function normalizeOperatorActionClientEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map(function(entry) {
    return {
      id: String(entry && entry.id || ''),
      action: String(entry && entry.action || 'unknown'),
      label: String(entry && entry.label || '명령'),
      scope: String(entry && entry.scope || ''),
      source: String(entry && entry.source || ''),
      command: String(entry && entry.command || ''),
      delivery_status: String(entry && entry.delivery_status || 'unsent'),
      delivery_message: String(entry && entry.delivery_message || ''),
      delivery_ts: String(entry && entry.delivery_ts || ''),
      ts: String(entry && entry.ts || ''),
    };
  }).filter(function(entry) {
    return Boolean(entry.command || entry.source || entry.id);
  }).slice(0, 6);
}

function loadOperatorActionClientStorage(storageKey) {
  try {
    if (!window.sessionStorage) {
      return [];
    }
    var raw = window.sessionStorage.getItem(String(storageKey || '').trim());
    if (!raw) {
      return [];
    }
    return normalizeOperatorActionClientEntries(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

function saveOperatorActionClientStorage(storageKey, entries) {
  try {
    if (!window.sessionStorage) {
      return;
    }
    window.sessionStorage.setItem(
      String(storageKey || '').trim(),
      JSON.stringify(normalizeOperatorActionClientEntries(entries))
    );
  } catch (_) {
    return;
  }
}

function mergeOperatorActionClientEntries(entries, action) {
  var history = normalizeOperatorActionClientEntries(entries);
  var nextEntry = normalizeOperatorActionClientEntries([action])[0] || null;
  if (!nextEntry) {
    return history;
  }
  var deduped = history.filter(function(entry) {
    if (!entry) {
      return false;
    }
    if (nextEntry.id && entry.id === nextEntry.id) {
      return false;
    }
    return !(
      String(entry.command || '').trim() === String(nextEntry.command || '').trim()
      && String(entry.ts || '') === String(nextEntry.ts || '')
    );
  });
  return [nextEntry].concat(deduped).slice(0, 6);
}

function operatorActionClientSourceLabel(source) {
  var value = String(source || '').trim();
  if (value === 'home-spotlight') return 'home-spotlight';
  if (value === 'home-loop') return 'home-loop';
  if (value === 'home-chain') return 'home-chain';
  if (value === 'deep-link') return 'deep-link';
  if (value === 'control-center') return 'control-center';
  return value || 'unknown';
}

function operatorActionClientSourceSummary(entries) {
  var history = normalizeOperatorActionClientEntries(entries);
  if (history.length < 1) {
    return 'source 집계 없음';
  }
  var counts = new Map();
  history.forEach(function(entry) {
    var key = operatorActionClientSourceLabel(entry.source);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries()).map(function(pair) {
    return pair[0] + ' ' + pair[1];
  }).join(' / ');
}
`;

module.exports = {
  OPERATOR_ACTION_CLIENT_RUNTIME_SOURCE,
};
