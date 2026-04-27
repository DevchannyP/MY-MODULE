'use strict';

const KANBAN_LANES = [
  { id: 'backlog', label: 'Backlog', statuses: ['pending', 'todo', 'ready'], color: '#475569' },
  { id: 'analysis', label: 'Analysis', statuses: ['in-analysis', 'stage-a', 'stage-b'], color: '#1d4ed8' },
  { id: 'build', label: 'Build', statuses: ['in-build', 'in-progress', 'stage-c', 'stage-d'], color: '#b45309' },
  { id: 'verify', label: 'Verify', statuses: ['in-verify', 'stage-e', 'gate'], color: '#7e22ce' },
  { id: 'done', label: 'Done', statuses: ['done', 'completed', 'pass', 'closed'], color: '#0f766e' },
];

function inferLaneId({ status, stage, completed } = {}) {
  const normalizedStatus = String(status || '').toLowerCase();
  const normalizedStage = String(stage || '').toUpperCase();

  if (
    completed
    || ['done', 'completed', 'pass', 'closed'].some((keyword) => normalizedStatus.includes(keyword))
  ) {
    return 'done';
  }
  if (normalizedStage === 'E' || normalizedStatus.includes('verify') || normalizedStatus.includes('gate')) {
    return 'verify';
  }
  if (
    ['C', 'D'].includes(normalizedStage)
    || normalizedStatus.includes('progress')
    || normalizedStatus.includes('build')
  ) {
    return 'build';
  }
  if (
    ['A', 'B'].includes(normalizedStage)
    || normalizedStatus.includes('analysis')
    || normalizedStatus.includes('plan')
  ) {
    return 'analysis';
  }
  return 'backlog';
}

function laneMeta(laneId) {
  return KANBAN_LANES.find((lane) => lane.id === laneId) || KANBAN_LANES[0];
}

function findActiveQueueItem(nextActions = {}) {
  const queue = Array.isArray(nextActions.queue) ? nextActions.queue : [];
  return queue.find((item) => !['done', 'completed', 'pass', 'closed'].includes(String(item?.status || '').toLowerCase())) || null;
}

function buildFocusPacket({ report = {}, nextActions = {}, currentWp = {} } = {}) {
  const activeQueueItem = findActiveQueueItem(nextActions);
  if (activeQueueItem) {
    return {
      id: String(activeQueueItem.id || 'NONE'),
      goal: String(activeQueueItem.goal || '진행 중 작업'),
      stage: String(activeQueueItem.stage || currentWp.stage || report.current_wp_stage || ''),
      status: String(activeQueueItem.status || 'in-progress'),
      source: 'next-actions',
      active: true,
    };
  }

  return {
    id: String(report.current_wp || currentWp.id || 'NONE'),
    goal: String(report.current_wp_goal || currentWp.goal || '현재 focus packet 없음'),
    stage: String(report.current_wp_stage || currentWp.stage || ''),
    status: String(currentWp.status || 'completed'),
    source: 'current-wp',
    active: false,
  };
}

module.exports = {
  KANBAN_LANES,
  inferLaneId,
  laneMeta,
  findActiveQueueItem,
  buildFocusPacket,
};
