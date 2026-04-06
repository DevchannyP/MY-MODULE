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

function buildControlCenterRuntimeResponse() {
  const runtime = buildMindmapRuntime();
  const meta = runtime.graphData?.meta || {};
  const controlCenter = meta.controlCenter || {};

  return {
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
}

module.exports = {
  buildHomeRuntimeResponse,
  buildControlCenterRuntimeResponse,
};
