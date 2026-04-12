'use strict';

function normalizeRecentOperatorAction(input = {}) {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!command || !label) {
    return null;
  }

  return {
    id: typeof input.id === 'string' ? input.id : '',
    action: typeof input.action === 'string' ? input.action : 'unknown',
    label,
    scope: typeof input.scope === 'string' ? input.scope : '',
    source: typeof input.source === 'string' ? input.source : '',
    command,
    delivery_status: typeof input.delivery_status === 'string' ? input.delivery_status : 'unsent',
    delivery_message: typeof input.delivery_message === 'string' ? input.delivery_message : '',
    delivery_ts: typeof input.delivery_ts === 'string' ? input.delivery_ts : '',
    ts: typeof input.ts === 'string' ? input.ts : new Date().toISOString(),
  };
}

function normalizeRecentOperatorActions(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => normalizeRecentOperatorAction(entry))
    .filter(Boolean)
    .slice(0, 6);
}

function mergeRecentOperatorActions(history = [], action = null) {
  const normalizedAction = normalizeRecentOperatorAction(action);
  const normalizedHistory = normalizeRecentOperatorActions(history);
  if (!normalizedAction) {
    return normalizedHistory;
  }
  return [normalizedAction].concat(normalizedHistory.filter((entry) => {
    if (!entry) return false;
    if (normalizedAction.id && entry.id === normalizedAction.id) {
      return false;
    }
    return !(
      entry.command === normalizedAction.command
      && entry.ts === normalizedAction.ts
    );
  })).slice(0, 6);
}

function buildOperatorActionSources(entries) {
  const normalizedEntries = normalizeRecentOperatorActions(entries);
  const counts = new Map();
  normalizedEntries.forEach((entry) => {
    const source = String(entry.source || 'unknown').trim() || 'unknown';
    counts.set(source, (counts.get(source) || 0) + 1);
  });
  const summary = counts.size > 0
    ? Array.from(counts.entries()).map(([source, count]) => `${source} ${count}`).join(' / ')
    : 'source 집계 없음';
  return {
    summary,
    entries: Array.from(counts.entries()).map(([source, count]) => ({ source, count })),
  };
}

module.exports = {
  normalizeRecentOperatorAction,
  normalizeRecentOperatorActions,
  mergeRecentOperatorActions,
  buildOperatorActionSources,
};
