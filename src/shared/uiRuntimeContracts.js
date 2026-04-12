'use strict';

const { buildHomeRuntime } = require('../../scripts/generate-ui-home');
const { buildMindmapRuntime } = require('../../scripts/generate-mindmap');

function stageProgress(stageValue) {
  const stage = String(stageValue || '').toUpperCase();
  if (stage === 'A') return 20;
  if (stage === 'B') return 35;
  if (stage === 'C') return 55;
  if (stage === 'D') return 80;
  if (stage === 'E') return 100;
  return 0;
}

function normalizeMasterStatus(input) {
  const blocker = String(input?.blocker || '없음');
  let status = 'normal';
  if (blocker.includes('드리프트')) {
    status = 'blocked';
  } else if (blocker !== '없음' && blocker !== '정상') {
    status = 'attention';
  }

  return {
    goal: String(input?.goal || '목표 미정'),
    stage: String(input?.stage || input?.currentStage || '미확정'),
    progress_pct: Number(input?.progress_pct ?? input?.progress ?? stageProgress(input?.stage || input?.currentStage)),
    blocker,
    next_action: String(input?.next_action || input?.nextTask || '다음 작업 없음'),
    status,
  };
}

function normalizePlanRow(row) {
  return {
    id: String(row?.id || ''),
    step: String(row?.step || ''),
    task: String(row?.task || ''),
    purpose: String(row?.purpose || ''),
    input: String(row?.input || ''),
    output: String(row?.output || ''),
    status: String(row?.status || 'pending'),
    priority: String(row?.priority || ''),
    owner: String(row?.owner || ''),
    next_action: String(row?.nextAction || ''),
  };
}

function normalizeKanbanCard(card) {
  return {
    id: String(card?.id || ''),
    title: String(card?.title || ''),
    purpose: String(card?.purpose || ''),
    input: String(card?.input || ''),
    output: String(card?.output || ''),
    next_action: String(card?.next_action || card?.nextAction || ''),
    owner: String(card?.owner || ''),
    priority: String(card?.priority || ''),
    status: String(card?.status || 'pending'),
  };
}

function normalizeKanbanLane(lane) {
  return {
    id: String(lane?.id || ''),
    label: String(lane?.label || ''),
    owner: String(lane?.owner || ''),
    status: String(lane?.status || 'pending'),
    purpose: String(lane?.purpose || ''),
    is_current: lane?.is_current === true,
    cards: Array.isArray(lane?.cards) ? lane.cards.map(normalizeKanbanCard) : [],
  };
}

function normalizeControlNode(node) {
  return {
    id: String(node?.id || ''),
    label: String(node?.label || ''),
    kind: String(node?.kind || node?.controlKind || 'control'),
    owner: String(node?.owner || ''),
    purpose: String(node?.purpose || ''),
    inputs: Array.isArray(node?.inputs) ? node.inputs.map(String) : [],
    outputs: Array.isArray(node?.outputs) ? node.outputs.map(String) : [],
    issues: Array.isArray(node?.issues) ? node.issues.map(String) : [],
    next_action: String(node?.nextAction || node?.next_action || ''),
    status: String(node?.status || 'pending'),
  };
}

function normalizeExecutionActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return null;
  }

  return {
    action: String(activity.action || ''),
    worker: String(activity.worker || ''),
    worker_index: Number.isInteger(activity.worker_index) ? activity.worker_index : null,
    pts: String(activity.pts || ''),
    packet_id: String(activity.packet_id || ''),
    prompt_preview: String(activity.prompt_preview || ''),
    ok: activity.ok !== false,
    error: typeof activity.error === 'string' && activity.error.trim() ? activity.error : null,
    next_enter_in: typeof activity.next_enter_in === 'number' ? activity.next_enter_in : null,
    next_prompt_in: typeof activity.next_prompt_in === 'number' ? activity.next_prompt_in : null,
  };
}

function normalizeOperatorCockpit(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const currentWp = input.current_wp || {};
  const validationProfile = input.validation_profile || input.commit_guard?.validation_profile || {};
  const branch = input.branch || {};
  const commitGuard = input.commit_guard || {};
  const guard = commitGuard.guard || {};
  const commitCandidate = commitGuard.commit_candidate || {};

  return {
    current_wp: {
      id: String(currentWp.id || 'UNKNOWN'),
      goal: String(currentWp.goal || 'UNKNOWN'),
      stage: String(currentWp.stage || 'UNKNOWN'),
      type: String(currentWp.type || 'UNKNOWN'),
    },
    next_wp: String(input.next_wp || 'NONE'),
    git: {
      branch: String(input.git?.branch || 'unknown'),
      dirty: input.git?.dirty === true,
      dirty_count: typeof input.git?.dirty_count === 'number' ? input.git.dirty_count : 0,
    },
    validation_profile: {
      packet_type: String(validationProfile.packet_type || currentWp.type || 'UNKNOWN'),
      stage: String(validationProfile.stage || currentWp.stage || 'UNKNOWN'),
      commands: Array.isArray(validationProfile.commands) ? validationProfile.commands.map(String) : [],
    },
    branch: {
      current_branch: String(branch.current_branch || input.git?.branch || 'unknown'),
      recommended_branch: String(branch.recommended_branch || ''),
      create_command: String(branch.create_command || ''),
      commit_subject: String(branch.commit_template?.subject || commitCandidate.subject || ''),
    },
    commit_guard: {
      next_action: String(commitGuard.next_action || ''),
      protected_branch: guard.protected_branch === true,
      has_dirty_changes: guard.has_dirty_changes === true,
      validations_passed: guard.validations_passed === true,
      can_apply: guard.can_apply === true,
      reasons: Array.isArray(guard.reasons) ? guard.reasons.map(String) : [],
      commit_subject: String(commitCandidate.subject || branch.commit_template?.subject || ''),
    },
    operator_actions: Array.isArray(input.operator_actions) ? input.operator_actions.map(String) : [],
    as_of: String(input.as_of || new Date().toISOString()),
  };
}

function normalizeRecentOperatorAction(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const command = String(input.command || '').trim();
  const label = String(input.label || '').trim();
  if (!command || !label) {
    return null;
  }

  return {
    id: String(input.id || ''),
    action: String(input.action || 'unknown'),
    label,
    scope: String(input.scope || ''),
    command,
    delivery_status: String(input.delivery_status || 'unsent'),
    delivery_message: String(input.delivery_message || ''),
    delivery_ts: String(input.delivery_ts || ''),
    ts: String(input.ts || ''),
  };
}

function deriveExecutionNextAction({ sessionCount, schedulerRunning, lastError, lastPromptText }) {
  if (sessionCount < 1) {
    return 'PTY 세션을 확인한 뒤 다시 새로고침하세요.';
  }
  if (lastError && lastError.error) {
    return lastPromptText
      ? '실패 원인을 해소한 뒤 이전 프롬프트 재실행 또는 자동 전송 중지를 선택하세요.'
      : '실패 원인을 해소한 뒤 다시 전송하세요.';
  }
  if (schedulerRunning) {
    return '자동 전송이 실행 중입니다. 필요하면 중지 후 프롬프트를 조정하세요.';
  }
  if (lastPromptText) {
    return '마지막 프롬프트를 재실행하거나 자동 전송을 시작할 수 있습니다.';
  }
  return '추천 프롬프트를 불러오거나 직접 입력한 뒤 전송하세요.';
}

function summarizeExecutionActivity(activity, fallback = '없음') {
  if (!activity || typeof activity !== 'object') {
    return fallback;
  }

  const parts = [
    String(activity.action || '').trim(),
    String(activity.worker || '').trim(),
    String(activity.pts || '').trim(),
    String(activity.packet_id || '').trim(),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' / ') : fallback;
}

function summarizeExecutionFailureLocation(activity) {
  if (!activity || !activity.error) {
    return '없음';
  }
  const base = summarizeExecutionActivity(activity, '없음');
  if (!String(activity.pts || '').trim()) {
    return base === '없음' ? '없음' : base + ' / pts 없음';
  }
  return base;
}

function buildControlMatrix({
  sessionCount,
  schedulerRunning,
  lastPromptText,
  rollbackEnabled,
  failureReasonVisible,
} = {}) {
  const hasSessions = sessionCount > 0;
  const hasLastPrompt = Boolean(String(lastPromptText || '').trim());

  return {
    send_prompt: {
      enabled: hasSessions,
      reason: hasSessions ? '연결된 PTY 세션으로 즉시 전송할 수 있습니다.' : '연결된 PTY 세션이 없어 전송할 수 없습니다.',
    },
    auto_send_toggle: {
      enabled: hasSessions,
      reason: hasSessions
        ? (schedulerRunning ? '자동 전송이 실행 중이며 중지로 전환할 수 있습니다.' : '선택한 세션과 프롬프트로 자동 전송을 시작할 수 있습니다.')
        : '연결된 PTY 세션이 없어 자동 전송을 제어할 수 없습니다.',
    },
    stop: {
      enabled: schedulerRunning === true,
      reason: schedulerRunning === true ? '현재 자동 전송이 실행 중이라 즉시 중지할 수 있습니다.' : '실행 중인 자동 전송이 없어 중지할 대상이 없습니다.',
    },
    retry_last_prompt: {
      enabled: hasLastPrompt,
      reason: hasLastPrompt ? '마지막 프롬프트가 기록되어 다시 실행할 수 있습니다.' : '마지막 프롬프트가 없어 재시도할 수 없습니다.',
    },
    rollback: {
      enabled: rollbackEnabled === true,
      reason: rollbackEnabled === true ? '도메인 롤백 UI가 활성화되어 있습니다.' : 'system_api.rollback_ui.enabled=false 상태라 롤백 UI가 비활성화되어 있습니다.',
    },
    terminal_status_visible: {
      enabled: true,
      reason: '현재 터미널, worker, 최근 실행 상태를 화면에 표시합니다.',
    },
    failure_reason_visible: {
      enabled: failureReasonVisible === true,
      reason: failureReasonVisible === true ? '최근 실패 원인을 바로 확인할 수 있습니다.' : '최근 실패가 없어 표시할 실패 원인이 없습니다.',
    },
  };
}

function buildEnabledControlActions(controlMatrix) {
  const controlLabels = {
    send_prompt: '프롬프트 전송',
    auto_send_toggle: '자동 전송',
    stop: '중지',
    retry_last_prompt: '재시도',
    rollback: '롤백',
  };

  return Object.entries(controlLabels)
    .filter(([id]) => controlMatrix[id]?.enabled === true)
    .map(([id, label]) => ({
      id,
      label,
      reason: String(controlMatrix[id]?.reason || ''),
    }));
}

function buildExecutionOperatorBrief({
  schedulerRunning,
  currentActivity,
  lastActivity,
  lastError,
  nextAction,
  controlMatrix,
} = {}) {
  const lastDispatchActivity = lastError || lastActivity || null;
  const availableControls = buildEnabledControlActions(controlMatrix);

  return {
    auto_send_status: schedulerRunning === true ? '실행 중' : '중지됨',
    current_execution: schedulerRunning === true
      ? summarizeExecutionActivity(currentActivity, '실행 중인 worker 없음')
      : '중지됨',
    last_dispatch: summarizeExecutionActivity(lastDispatchActivity, '최근 전송 없음'),
    blocked_at: summarizeExecutionFailureLocation(lastError || (lastActivity?.error ? lastActivity : null)),
    failure_reason: String(lastError?.error || lastActivity?.error || '').trim() || '없음',
    next_action: String(nextAction || '').trim() || '다음 행동 없음',
    available_controls: availableControls,
    available_controls_summary: availableControls.length > 0
      ? availableControls.map((item) => item.label).join(', ')
      : '즉시 가능한 제어 없음',
  };
}

function buildControlCenterRuntimeState({
  flagStatus = {},
  bridgeState = {},
  schedulerStatus = {},
  operatorCockpit = null,
  recentOperatorAction = null,
} = {}) {
  const sessions = Array.isArray(bridgeState.sessions) ? bridgeState.sessions : [];
  const enabledFlags = Array.isArray(flagStatus.enabled_flags) ? flagStatus.enabled_flags : [];
  const normalizedLastError = normalizeExecutionActivity(bridgeState.lastError);
  const normalizedLastActivity = normalizeExecutionActivity(schedulerStatus.last_activity);
  const normalizedCurrentActivity = normalizeExecutionActivity(schedulerStatus.current_activity);
  const rollbackEnabled = enabledFlags.includes('system_api.rollback_ui.enabled');
  const lastPromptText = String(bridgeState.lastPromptText || '');
  const failureReasonVisible = Boolean(normalizedLastError?.error || normalizedLastActivity?.error);
  const controlMatrix = buildControlMatrix({
    sessionCount: sessions.length,
    schedulerRunning: schedulerStatus.running === true,
    lastPromptText,
    rollbackEnabled,
    failureReasonVisible,
  });
  const nextAction = deriveExecutionNextAction({
    sessionCount: sessions.length,
    schedulerRunning: schedulerStatus.running === true,
    lastError: normalizedLastError,
    lastPromptText,
  });
  const operatorBrief = buildExecutionOperatorBrief({
    schedulerRunning: schedulerStatus.running === true,
    currentActivity: normalizedCurrentActivity,
    lastActivity: normalizedLastActivity,
    lastError: normalizedLastError,
    nextAction,
    controlMatrix,
  });

  return {
    feature_flags: {
      enabled_flags: enabledFlags,
      env_overridden_flags: Array.isArray(flagStatus.env_overridden_flags) ? flagStatus.env_overridden_flags : [],
      env_overrides_applied: typeof flagStatus.envOverridesApplied === 'number' ? flagStatus.envOverridesApplied : 0,
      flags_loaded: flagStatus.flagsLoaded === true,
      flag_count: typeof flagStatus.flagCount === 'number' ? flagStatus.flagCount : 0,
    },
    execution: {
      runtime_available: sessions.length > 0,
      session_count: sessions.length,
      current_worker_index: Number.isInteger(schedulerStatus.current_worker_index) ? schedulerStatus.current_worker_index : null,
      selected_pts_hint: String(
        normalizedCurrentActivity?.pts
        || normalizedLastActivity?.pts
        || sessions[0]?.pts
        || '',
      ),
      last_prompt_text: lastPromptText,
      current_activity: normalizedCurrentActivity,
      last_activity: normalizedLastActivity,
      last_error: normalizedLastError,
      next_action: nextAction,
      operator_brief: operatorBrief,
    },
    scheduler: {
      running: schedulerStatus.running === true,
      started_at: schedulerStatus.started_at || null,
      active_worker_index: Number.isInteger(schedulerStatus.active_worker_index) ? schedulerStatus.active_worker_index : null,
      current_worker_index: Number.isInteger(schedulerStatus.current_worker_index) ? schedulerStatus.current_worker_index : null,
      worker_count: Array.isArray(schedulerStatus.workers) ? schedulerStatus.workers.length : 0,
      workers: Array.isArray(schedulerStatus.workers) ? schedulerStatus.workers : [],
      current_activity: normalizedCurrentActivity,
      last_activity: normalizedLastActivity,
    },
    control_endpoints: {
      sessions: '/api/pty/sessions',
      send: '/api/pty/send',
      scheduler_status: '/api/pty/scheduler/status',
      scheduler_start: '/api/pty/scheduler/start',
      scheduler_stop: '/api/pty/scheduler/stop',
      flags: '/flags',
      optimize_prompt: '/api/automation/optimize-prompt',
      stage_run: '/api/planning-studio/stage-run',
      rollback_base: '/api/v1/system/rollback',
    },
    user_controls: {
      send_prompt: sessions.length > 0,
      auto_send_toggle: sessions.length > 0,
      stop: schedulerStatus.running === true,
      retry_last_prompt: Boolean(lastPromptText.trim()),
      rollback: rollbackEnabled,
      terminal_status_visible: true,
      failure_reason_visible: failureReasonVisible,
      control_matrix: controlMatrix,
    },
    operator_cockpit: normalizeOperatorCockpit(operatorCockpit),
    recent_operator_action: normalizeRecentOperatorAction(recentOperatorAction),
    as_of: new Date().toISOString(),
  };
}

function buildHomeRuntimeState({
  flagStatus = {},
  schedulerStatus = {},
  operatorCockpit = null,
  recentOperatorAction = null,
} = {}) {
  return {
    feature_flags: {
      enabled_flags: Array.isArray(flagStatus.enabled_flags) ? flagStatus.enabled_flags : [],
      env_overridden_flags: Array.isArray(flagStatus.env_overridden_flags) ? flagStatus.env_overridden_flags : [],
      env_overrides_applied: typeof flagStatus.envOverridesApplied === 'number' ? flagStatus.envOverridesApplied : 0,
      flags_loaded: flagStatus.flagsLoaded === true,
      flag_count: typeof flagStatus.flagCount === 'number' ? flagStatus.flagCount : 0,
    },
    scheduler: {
      running: schedulerStatus.running === true,
      worker_count: Array.isArray(schedulerStatus.workers) ? schedulerStatus.workers.length : 0,
      started_at: schedulerStatus.started_at || schedulerStatus.startedAt || null,
      last_activity: normalizeExecutionActivity(schedulerStatus.last_activity || schedulerStatus.lastActivity),
    },
    control_endpoints: {
      send: '/api/pty/send',
      sessions: '/api/pty/sessions',
      scheduler_status: '/api/pty/scheduler/status',
      scheduler_start: '/api/pty/scheduler/start',
      scheduler_stop: '/api/pty/scheduler/stop',
      flags: '/flags',
      optimize_prompt: '/api/automation/optimize-prompt',
      stage_run: '/api/planning-studio/stage-run',
    },
    operator_cockpit: normalizeOperatorCockpit(operatorCockpit),
    recent_operator_action: normalizeRecentOperatorAction(recentOperatorAction),
    as_of: new Date().toISOString(),
  };
}

function buildHomeRuntimeResponse() {
  const runtime = buildHomeRuntime();
  const report = runtime.homeData?.report || {};
  const planStudioData = runtime.homeData?.planStudioData || {};
  const currentPlan = planStudioData.currentPlan || null;
  const nextPlan = planStudioData.nextPlan || null;

  return {
    ok: true,
    data: {
      status: normalizeMasterStatus({
        goal: report.current_wp_goal || currentPlan?.goal || nextPlan?.goal || '목표 미정',
        stage: report.current_wp_stage || currentPlan?.stage || report.requirements_stage || '미확정',
        progress_pct: stageProgress(report.current_wp_stage || currentPlan?.stage || report.requirements_stage),
        blocker: report.promotion_pipeline?.drift_status === 'clean' ? '정상' : `드리프트 ${String(report.promotion_pipeline?.drift_status || 'unknown')}`,
        next_action: report.next_wp_goal || nextPlan?.goal || '다음 작업 없음',
      }),
      summary: {
        current_wp: String(report.current_wp || planStudioData.currentPlanId || 'NONE'),
        current_wp_goal: String(report.current_wp_goal || currentPlan?.goal || '현재 packet 정보 없음'),
        next_wp: String(report.next_wp || planStudioData.nextPlanId || 'NONE'),
        next_wp_goal: String(report.next_wp_goal || nextPlan?.goal || '다음 실행 packet 정보 없음'),
        requirements_stage: String(report.requirements_stage || '미확정'),
        included_plan_count: Number(planStudioData.summary?.includedCount || 0),
        completed_plan_count: Number(planStudioData.summary?.completedCount || 0),
      },
      plan_preview: {
        current_plan: currentPlan ? normalizePlanRow({
          id: currentPlan.id,
          step: 'current',
          task: currentPlan.id,
          purpose: currentPlan.goal,
          input: (currentPlan.validation || []).join(' / '),
          output: currentPlan.result || '',
          status: currentPlan.status,
          priority: String(currentPlan.priority ?? ''),
          owner: currentPlan.capabilityName || '',
          nextAction: currentPlan.nextUnlock || '',
        }) : null,
        next_plan: nextPlan ? normalizePlanRow({
          id: nextPlan.id,
          step: 'next',
          task: nextPlan.id,
          purpose: nextPlan.goal,
          input: (nextPlan.validation || []).join(' / '),
          output: nextPlan.result || '',
          status: nextPlan.status,
          priority: String(nextPlan.priority ?? ''),
          owner: nextPlan.capabilityName || '',
          nextAction: nextPlan.nextUnlock || '',
        }) : null,
        default_plan_id: String(planStudioData.defaultPlanId || ''),
      },
      navigation: {
        group_count: Array.isArray(runtime.homeData?.menuExplorerData?.groups) ? runtime.homeData.menuExplorerData.groups.length : 0,
        item_count: Array.isArray(runtime.homeData?.menuExplorerData?.items) ? runtime.homeData.menuExplorerData.items.length : 0,
      },
    },
    meta: {
      contract_version: 'ui-runtime.v1',
      surface: 'home',
      generated_at: String(runtime.homeData?.generatedAt || new Date().toISOString()),
    },
  };
}

function buildControlCenterRuntimeResponse(options = {}) {
  const runtime = buildMindmapRuntime();
  const meta = runtime.graphData?.meta || {};
  const controlCenter = meta.controlCenter || {};

  const response = {
    ok: true,
    data: {
      status: normalizeMasterStatus({
        goal: controlCenter.statusBar?.goal,
        stage: controlCenter.statusBar?.currentStage,
        progress_pct: controlCenter.statusBar?.progress,
        blocker: controlCenter.statusBar?.blocker,
        next_action: controlCenter.statusBar?.nextTask,
      }),
      summary: {
        current_wp: String(meta.report?.current_wp || 'NONE'),
        current_wp_goal: String(meta.report?.current_wp_goal || controlCenter.statusBar?.goal || '현재 packet 정보 없음'),
        requirements_stage: String(meta.report?.requirements_stage || controlCenter.statusBar?.currentStage || '미확정'),
        current_lane_id: String(controlCenter.statusBar?.currentLaneId || ''),
      },
      plan_rows: Array.isArray(controlCenter.planRows) ? controlCenter.planRows.map(normalizePlanRow) : [],
      kanban_lanes: Array.isArray(controlCenter.kanbanLanes) ? controlCenter.kanbanLanes.map(normalizeKanbanLane) : [],
      control_nodes: Array.isArray(controlCenter.controlNodes) ? controlCenter.controlNodes.map(normalizeControlNode) : [],
      scaffold_capabilities: {
        preview_endpoint: '/api/planning-studio/scaffold-preview',
        create_endpoint: '/api/planning-studio/scaffold-create',
        preview_requires: ['domain.viewer', 'system.admin'],
        create_requires: ['system.admin'],
        default_blueprint: String(controlCenter.scaffoldCatalog?.defaultBlueprint || ''),
        default_recipe: String(controlCenter.scaffoldCatalog?.defaultRecipe || ''),
        blueprint_count: Array.isArray(controlCenter.scaffoldCatalog?.blueprints) ? controlCenter.scaffoldCatalog.blueprints.length : 0,
        recipe_count: Array.isArray(controlCenter.scaffoldCatalog?.recipes) ? controlCenter.scaffoldCatalog.recipes.length : 0,
      },
      stage_capabilities: {
        run_endpoint: '/api/planning-studio/stage-run',
        execute_requires: ['system.admin'],
        supported_stages: ['A', 'B', 'C', 'D', 'E'],
        default_stage: String(meta.report?.requirements_stage || controlCenter.statusBar?.currentStage || 'D'),
      },
    },
    meta: {
      contract_version: 'ui-runtime.v1',
      surface: 'control-center',
      generated_at: String(meta.generatedAt || new Date().toISOString()),
    },
  };

  if (options.runtime_state && typeof options.runtime_state === 'object') {
    response.runtime_state = options.runtime_state;
  }

  return response;
}

module.exports = {
  buildHomeRuntimeState,
  buildHomeRuntimeResponse,
  buildControlCenterRuntimeResponse,
  buildControlCenterRuntimeState,
};
