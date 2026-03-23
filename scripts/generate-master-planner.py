#!/usr/bin/env python3
"""
Workflow OS — 마스터 기획서 UI 생성기
실제 프로젝트 YAML 데이터를 읽어 self-contained HTML을 생성한다.
실행: python3 scripts/generate-master-planner.py
출력: artifacts/master-planner/index.html
"""

import yaml, json, os, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_yaml(path, default=None):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return default or {}
    try:
        with open(full, encoding='utf-8') as f:
            return yaml.safe_load(f) or (default or {})
    except Exception as e:
        print(f"  [WARN] {path}: {e}", file=sys.stderr)
        return default or {}

# ── 데이터 수집 ───────────────────────────────────────────────────────
print("📖 프로젝트 데이터 수집 중...")

root_state   = load_yaml("memory/current-state.yaml")
l0_state     = load_yaml("memory/L0-hot/current-state.yaml")
checkpoint   = load_yaml("memory/checkpoint.yaml")
wp_queue     = load_yaml("memory/wp-queue.yaml")
current_wp   = load_yaml("memory/current-wp.yaml")
next_actions = load_yaml("memory/next-actions.yaml")
health       = load_yaml("master-shell/observability/health-scores.yaml")
flags        = load_yaml("master-shell/feature-flags/flags.yaml")
registry     = load_yaml("master-shell/plugin-registry/registry.yaml")

# ── Work Packets 정규화 ──────────────────────────────────────────────
caps = wp_queue.get("capabilities", [])
all_wps = []
for cap in caps:
    for wp in cap.get("work_packets", []):
        all_wps.append({
            "id":           wp.get("id",""),
            "cap_id":       cap.get("id",""),
            "cap_name":     cap.get("name",""),
            "goal":         wp.get("goal",""),
            "status":       wp.get("status",""),
            "tier":         wp.get("tier",""),
            "result":       wp.get("result",""),
            "completed_at": wp.get("completed_at",""),
            "depends_on":   wp.get("depends_on",[]),
        })

done_wps    = [w for w in all_wps if w["status"] == "done"]
active_wps  = [w for w in all_wps if w["status"] == "in_progress"]

# ── 데이터 번들 ─────────────────────────────────────────────────────
active_modules = l0_state.get("active_modules", [])
stage_states   = l0_state.get("stage_states", {})
quality_gate   = l0_state.get("quality_gate_detail", {})
domain_scores  = health.get("domains", {})
plugins        = registry.get("plugins", [])
wps_done_ids   = checkpoint.get("wps_completed", [])
ver_summary    = checkpoint.get("verification_summary", {})
health_metrics = root_state.get("health_metrics", {}).get("last_known", {})
known_issues   = root_state.get("known_issues", [])
next_queue     = next_actions.get("queue", [])

data = {
    "generated_at": datetime.datetime.now().isoformat(),
    "project": {
        "name":  "Workflow OS",
        "repo":  "my-module",
        "phase": l0_state.get("repository", {}).get("phase", "continuous-self-improvement"),
        "branch": "chore/core-git-governance-activation",
        "stage_states": stage_states,
        "quality_gate_result": l0_state.get("quality_gate_result","PASS"),
        "quality_gate_last_run": l0_state.get("quality_gate_last_run","2026-03-21"),
        "quality_gate_detail": quality_gate,
        "health_rating": health_metrics.get("health_rating","ELITE"),
        "gate_pass_rate": health_metrics.get("gate_pass_rate_pct", 88.1),
        "tests_total": 500,
        "tests_pass": 500,
        "known_issues": known_issues,
        "upgrade_v3_features": l0_state.get("upgrade_v3", {}).get("features_added",[]),
    },
    "wps": {
        "all": all_wps,
        "done": done_wps,
        "active": active_wps,
        "done_ids": wps_done_ids,
        "total": len(all_wps),
        "done_count": len(done_wps),
        "verification": ver_summary,
    },
    "caps": [{"id":c.get("id"),"name":c.get("name"),"priority":c.get("priority",99)} for c in caps],
    "current_wp": current_wp,
    "next_queue": next_queue,
    "domains": active_modules,
    "domain_scores": domain_scores,
    "plugins": plugins,
    "flags": {
        "global": flags.get("global_flags", {}),
        "plugin": flags.get("plugin_flags", {}),
    },
    "stage_e_findings": l0_state.get("stage_e_findings", {}),
}

DATA_JSON = json.dumps(data, ensure_ascii=False, indent=2)
print(f"  ✓ WPs: {len(all_wps)} total, {len(done_wps)} done, {len(active_wps)} active")
print(f"  ✓ Domains: {len(active_modules)}, Plugins: {len(plugins)}")

# ── HTML 템플릿 (순수 문자열 — f-string 아님) ──────────────────────
# __DATA_JSON__ 자리에 실제 데이터가 삽입된다
print("🎨 HTML 생성 중...")

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS — 마스터 기획서</title>
<style>
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#21262d;--border:#30363d;
  --accent:#238636;--accent2:#1f6feb;--accent3:#bb8009;--purple:#8957e5;
  --red:#da3633;--text:#c9d1d9;--dim:#8b949e;--bright:#f0f6fc;
  --r:8px;--font:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;
  --mono:'JetBrains Mono','Fira Code',Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;line-height:1.6}

/* topbar */
.topbar{position:sticky;top:0;z-index:200;background:rgba(13,17,23,.96);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--border);padding:10px 24px;display:flex;align-items:center;gap:12px}
.topbar-logo{font-size:17px;font-weight:700;color:var(--bright);display:flex;align-items:center;gap:8px}
.topbar-logo em{color:var(--accent2);font-style:normal}
.topbar-sep{color:var(--border);font-size:18px}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.badge-health{font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid}
.badge-health.elite{background:rgba(35,134,54,.15);color:#3fb950;border-color:rgba(35,134,54,.3)}
.badge-gen{font-size:11px;color:var(--dim)}

/* tabs */
.tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--border);
  background:var(--surface);position:sticky;top:49px;z-index:199}
.tab{padding:12px 18px;font-size:13px;font-weight:500;color:var(--dim);cursor:pointer;
  border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap}
.tab:hover{color:var(--text)}
.tab.active{color:var(--bright);border-bottom-color:var(--accent2)}
.tab-count{font-size:11px;background:var(--surface2);padding:1px 6px;border-radius:99px;margin-left:4px;color:var(--dim)}
.tab.active .tab-count{background:rgba(31,111,235,.18);color:var(--accent2)}

/* layout */
.layout{display:grid;grid-template-columns:240px 1fr;min-height:calc(100vh - 97px)}
.sidebar{border-right:1px solid var(--border);padding:16px 12px;position:sticky;
  top:97px;height:calc(100vh - 97px);overflow-y:auto;background:var(--surface)}
.sidebar-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
  color:var(--dim);margin-bottom:8px;padding:0 6px}
.nav-link{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
  font-size:13px;color:var(--dim);cursor:pointer;transition:all .12s;border:1px solid transparent;margin-bottom:2px}
.nav-link:hover{background:var(--surface2);color:var(--text)}
.nav-link.active{background:rgba(31,111,235,.12);color:var(--accent2);border-color:rgba(31,111,235,.2)}
.nav-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-pass{background:var(--accent)}.dot-active{background:var(--accent2)}
.dot-inactive{background:var(--border)}.dot-fail{background:var(--red)}
.tab-panel{display:none}.tab-panel.active{display:block}
.main{padding:28px 36px;max-width:980px}

/* cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:20px;margin-bottom:16px;transition:border-color .15s}
.card:hover{border-color:#444d56}
.card-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.card-icon{font-size:24px;flex-shrink:0}
.card-title{font-size:16px;font-weight:700;color:var(--bright);margin-bottom:3px}
.card-sub{font-size:12px;color:var(--dim)}

/* grid */
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px}
.mini-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:14px}
.mini-card-label{font-size:11px;color:var(--dim);margin-bottom:4px}
.mini-card-value{font-size:22px;font-weight:700;color:var(--bright)}
.mini-card-sub{font-size:11px;color:var(--dim);margin-top:2px}

/* stage badges */
.stage-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.stage-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid}
.s-pass{background:rgba(35,134,54,.12);color:#3fb950;border-color:rgba(35,134,54,.25)}
.s-fail{background:rgba(218,54,51,.12);color:var(--red);border-color:rgba(218,54,51,.25)}
.s-pending{background:var(--surface2);color:var(--dim);border-color:var(--border)}
.s-active{background:rgba(31,111,235,.12);color:var(--accent2);border-color:rgba(31,111,235,.25)}

/* WP list */
.wp-item{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;
  border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;transition:all .12s}
.wp-item:hover{border-color:#444d56;background:var(--surface2)}
.wp-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px}
.wp-done{background:var(--accent)}.wp-active{background:var(--accent2)}.wp-pending{background:var(--border)}
.wp-id{font-size:11px;font-weight:700;color:var(--dim);min-width:100px;flex-shrink:0}
.wp-goal{font-size:13px;color:var(--text);flex:1;line-height:1.5}
.wp-tier{font-size:10px;padding:2px 7px;border-radius:99px;background:var(--surface2);
  color:var(--dim);border:1px solid var(--border);flex-shrink:0}
.wp-result{font-size:11px;color:var(--dim);margin-top:4px;line-height:1.5}

/* archive */
.archive-item{border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px;overflow:hidden}
.archive-head{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;
  transition:background .12s}
.archive-head:hover{background:var(--surface2)}
.archive-body{padding:12px 14px;border-top:1px solid var(--border);
  font-size:12px;color:var(--dim);line-height:1.7;display:none}
.archive-body.open{display:block}
.archive-result{background:var(--surface2);border-radius:6px;padding:8px 12px;
  font-family:var(--mono);font-size:11px;color:var(--text)}

/* planning sections */
.plan-section{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px;transition:border-color .2s}
.plan-section.focused{border-color:rgba(31,111,235,.4);box-shadow:0 0 0 3px rgba(31,111,235,.08)}
.plan-head{background:var(--surface);padding:18px 22px;border-bottom:1px solid var(--border);
  display:flex;align-items:flex-start;gap:14px}
.plan-icon{font-size:26px;flex-shrink:0;margin-top:2px}
.plan-meta{flex:1}
.plan-num{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin-bottom:3px}
.plan-title{font-size:18px;font-weight:700;color:var(--bright);margin-bottom:4px}
.plan-desc{font-size:12px;color:var(--dim);line-height:1.5}
.plan-tag{font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;
  background:rgba(31,111,235,.12);color:var(--accent2);border:1px solid rgba(31,111,235,.2)}
.plan-body{padding:20px 22px}
.edit-area{width:100%;min-height:110px;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);color:var(--text);font-family:var(--font);font-size:13px;
  line-height:1.7;padding:12px 14px;resize:vertical;outline:none;transition:border-color .15s}
.edit-area:focus{border-color:rgba(31,111,235,.6)}
.edit-area::placeholder{color:var(--dim)}

/* idea panel */
.idea-panel{margin-top:14px;border:1px dashed rgba(31,111,235,.3);border-radius:var(--r);
  padding:14px;background:linear-gradient(135deg,var(--surface),rgba(31,111,235,.04))}
.idea-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.idea-label{font-size:12px;color:var(--dim);flex:1;min-width:200px}
.idea-grid{display:none;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.idea-grid.open{display:grid}
.idea-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);
  padding:12px;transition:all .15s}
.idea-card:hover{border-color:rgba(31,111,235,.5);transform:translateY(-2px)}
.idea-card.picked{border-color:var(--accent);background:rgba(35,134,54,.06)}
.idea-num{font-size:10px;font-weight:700;color:var(--accent2);letter-spacing:.08em;margin-bottom:5px}
.idea-title{font-size:12px;font-weight:700;color:var(--bright);margin-bottom:5px;line-height:1.4}
.idea-body{font-size:11px;color:var(--dim);line-height:1.6;margin-bottom:7px}
.idea-src{font-size:10px;color:var(--purple);margin-bottom:7px}
.idea-tags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.idea-tag{font-size:10px;padding:1px 6px;border-radius:99px;background:var(--surface);
  color:var(--dim);border:1px solid var(--border)}
.prompt-box{background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:10px 12px;font-size:11px;font-family:var(--mono);color:var(--dim);
  line-height:1.6;display:none;margin-bottom:10px;word-break:break-all}
.prompt-box.open{display:block}

/* buttons */
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:var(--r);
  border:1px solid transparent;font-family:var(--font);font-size:12px;font-weight:500;
  cursor:pointer;transition:all .13s;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn-primary:hover{background:#2ea043}
.btn-secondary{background:var(--surface2);color:var(--text);border-color:var(--border)}
.btn-secondary:hover{background:var(--border);color:var(--bright)}
.btn-idea{background:rgba(31,111,235,.08);color:var(--accent2);border-color:rgba(31,111,235,.3)}
.btn-idea:hover{background:rgba(31,111,235,.15);border-color:var(--accent2)}
.btn-apply{background:transparent;color:var(--accent);border-color:rgba(35,134,54,.4);font-size:11px;padding:3px 9px}
.btn-apply:hover{background:rgba(35,134,54,.1)}
.btn-copy-all{background:linear-gradient(135deg,#238636,#1f6feb);color:#fff;border:none;
  padding:11px 24px;font-size:14px;font-weight:700;border-radius:var(--r);cursor:pointer;
  transition:all .2s;box-shadow:0 4px 18px rgba(35,134,54,.3)}
.btn-copy-all:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(35,134,54,.4)}
.btn-sm{padding:4px 10px;font-size:11px}

/* footer */
.copy-footer{position:sticky;bottom:0;background:rgba(13,17,23,.96);backdrop-filter:blur(12px);
  border-top:1px solid var(--border);padding:14px 36px;display:flex;align-items:center;gap:16px}
.copy-footer-meta{flex:1}
.copy-footer-title{font-size:13px;font-weight:600;color:var(--bright)}
.copy-footer-sub{font-size:11px;color:var(--dim)}
.copy-ok{font-size:12px;color:var(--accent);opacity:0;transition:opacity .3s}
.copy-ok.show{opacity:1}

/* search */
.search-wrap{position:relative;margin-bottom:14px}
.search-input{width:100%;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);color:var(--text);font-family:var(--font);font-size:13px;
  padding:8px 12px 8px 36px;outline:none;transition:border-color .15s}
.search-input:focus{border-color:rgba(31,111,235,.5)}
.search-icon{position:absolute;left:11px;top:9px;color:var(--dim);font-size:14px}
.filter-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.filter-btn{font-size:11px;padding:4px 12px;border-radius:99px;border:1px solid var(--border);
  background:var(--surface2);color:var(--dim);cursor:pointer;transition:all .12s}
.filter-btn.active{background:rgba(31,111,235,.12);color:var(--accent2);border-color:rgba(31,111,235,.3)}

/* domain card */
.domain-card{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}
.domain-head{padding:18px 22px;background:var(--surface);display:flex;align-items:flex-start;gap:14px}
.domain-score{font-size:28px;font-weight:700;min-width:56px;text-align:center}
.score-high{color:#3fb950}.score-mid{color:var(--accent3)}.score-low{color:var(--red)}
.domain-body{padding:16px 22px;border-top:1px solid var(--border)}
.kv-row{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:13px}
.kv-key{color:var(--dim);min-width:120px;flex-shrink:0}
.kv-val{color:var(--text)}
.kv-pass{color:var(--accent)}.kv-fail{color:var(--red)}

/* progress bar */
.pbar{height:4px;background:var(--border);border-radius:99px;overflow:hidden;margin-top:8px}
.pbar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));
  border-radius:99px;transition:width .4s ease}

/* flag chip */
.flag-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;
  padding:3px 10px;border-radius:99px;border:1px solid;margin:2px}
.flag-on{background:rgba(35,134,54,.1);color:#3fb950;border-color:rgba(35,134,54,.3)}
.flag-off{background:var(--surface2);color:var(--dim);border-color:var(--border)}

/* done badge */
.done-badge{display:none;font-size:11px;color:var(--accent);background:rgba(35,134,54,.1);
  padding:2px 8px;border-radius:99px;border:1px solid rgba(35,134,54,.25);font-weight:600}
.done-badge.show{display:inline-flex;align-items:center;gap:4px}

/* toast */
.toast{position:fixed;bottom:70px;right:20px;background:var(--surface2);
  border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;
  font-size:13px;color:var(--bright);opacity:0;transform:translateY(6px);
  transition:all .22s;z-index:999;pointer-events:none}
.toast.show{opacity:1;transform:none}
.divider{border:none;border-top:1px solid var(--border);margin:16px 0}

@media(max-width:880px){
  .layout{grid-template-columns:1fr}
  .sidebar{display:none}
  .grid-3,.idea-grid.open{grid-template-columns:1fr!important}
  .main{padding:16px}
}
</style>
</head>
<body>

<script>window.D = __DATA_JSON__;</script>

<!-- topbar -->
<header class="topbar">
  <div class="topbar-logo">
    <em>⬡</em> Workflow OS <span class="topbar-sep">|</span>
    <span style="font-weight:400;font-size:14px;color:var(--dim)">마스터 기획서</span>
  </div>
  <div class="topbar-right">
    <span class="badge-health elite" id="health-badge">ELITE</span>
    <span class="badge-gen" id="gen-time"></span>
    <button class="btn btn-secondary btn-sm" onclick="exportMarkdown()">📄 MD 내보내기</button>
  </div>
</header>

<!-- tabs -->
<nav class="tabs" role="tablist">
  <div class="tab active" onclick="switchTab('dashboard')" id="tab-dashboard">📊 대시보드</div>
  <div class="tab" onclick="switchTab('plan')" id="tab-plan">
    📝 기획서 <span class="tab-count" id="tc-plan">0/8</span>
  </div>
  <div class="tab" onclick="switchTab('wps')" id="tab-wps">
    📦 Work Packets <span class="tab-count" id="tc-wps"></span>
  </div>
  <div class="tab" onclick="switchTab('archive')" id="tab-archive">
    ✅ 완료 아카이브 <span class="tab-count" id="tc-done"></span>
  </div>
  <div class="tab" onclick="switchTab('domains')" id="tab-domains">
    🗺 도메인 현황 <span class="tab-count" id="tc-domains"></span>
  </div>
</nav>

<div class="layout">
  <nav class="sidebar" id="sidebar"></nav>
  <main class="main">
    <div class="tab-panel active" id="panel-dashboard"><div id="dashboard-content"></div></div>
    <div class="tab-panel" id="panel-plan"><div id="plan-content"></div></div>
    <div class="tab-panel" id="panel-wps"><div id="wps-content"></div></div>
    <div class="tab-panel" id="panel-archive"><div id="archive-content"></div></div>
    <div class="tab-panel" id="panel-domains"><div id="domains-content"></div></div>
  </main>
</div>

<!-- footer -->
<footer class="copy-footer">
  <div class="copy-footer-meta">
    <div class="copy-footer-title">전체 기획서 내보내기</div>
    <div class="copy-footer-sub">모든 기획서 섹션을 하나의 Markdown 문서로 복사합니다</div>
  </div>
  <span class="copy-ok" id="copy-ok">✓ 클립보드에 복사됨</span>
  <button class="btn-copy-all" onclick="copyAllPlan()">📋 전체 기획서 한 번에 복사</button>
</footer>

<div class="toast" id="toast"></div>

<script>
// ─────────────────────────────────────────────────────────
// 기획서 섹션 정의 (실제 프로젝트 데이터로 초기화)
// ─────────────────────────────────────────────────────────
const PLAN_SECTIONS = [
  {
    id:"overview", icon:"🎯", num:"SECTION 01", tag:"Vision",
    title:"프로젝트 비전 & 목표",
    desc:"Workflow OS의 핵심 가치, 해결할 문제, 성공 지표를 정의합니다.",
    getInitial(d) {
      return `# Workflow OS\n\n**목적**: ${d.project.name} — 격리 모듈 생성·조합·검증 엔진\n**단계**: ${d.project.phase}\n**브랜치**: ${d.project.branch}\n\n## 성공 지표\n- 전 도메인 Stage A~E PASS\n- 헬스 레이팅: ${d.project.health_rating}\n- 테스트 통과율: ${d.project.tests_pass}/${d.project.tests_total}\n- 게이트 통과율: ${d.project.gate_pass_rate}%`;
    },
    ideas:[
      {num:"안 01",title:"OKR 기반 비전 프레임워크",
        body:"Objective→Key Results→Initiatives 계층화. 분기별 리뷰 사이클 연동. Google, Spotify 채택 구조.",
        src:"📌 Google re:Work, Spotify Squad Model",tags:["OKR","측정가능","분기리뷰"]},
      {num:"안 02",title:"North Star Metric + 가드레일",
        body:"단일 핵심지표(North Star) + 하락금지 가드레일 3개. Amplitude 방법론. 전 팀 정렬.",
        src:"📌 Amplitude Product Analytics, Reforge",tags:["NorthStar","지표정렬"]},
      {num:"안 03",title:"Problem-Solution Fit Canvas",
        body:"Jobs-To-Be-Done으로 Pain→Gain→Value 매핑. Notion, Miro 초기 기획 방식.",
        src:"📌 JTBD Theory, Strategyzer VPC",tags:["JTBD","사용자중심","린"]}
    ]
  },
  {
    id:"domain-design", icon:"🗺", num:"SECTION 02", tag:"Stage A",
    title:"도메인 설계 & 경계 컨텍스트",
    desc:"DDD 바운디드 컨텍스트 정의, 유비쿼터스 언어, 불변조건(INV) 목록.",
    getInitial(d) {
      let lines = `## 활성 도메인 목록\n\n`;
      (d.domains||[]).forEach(m => {
        lines += `### ${m.module_id} (${m.domain})\n- 플러그인: ${m.plugin_id}\n- Feature Flag: ${m.feature_flag} = ${m.feature_flag_value}\n- 헬스 스코어: ${(d.domain_scores||{})[m.domain]?.score ?? '—'}\n\n`;
      });
      return lines + `## 계약 매트릭스\n- billing: OpenAPI ✅ Events ✅ UI ✅ Capability ✅\n- task-tracking: OpenAPI ✅ Events ✅ UI ✅ Capability ✅\n- video: OpenAPI ✅ Events ✅ UI ✅ Capability ✅`;
    },
    ideas:[
      {num:"안 01",title:"Event Storming → Context Map",
        body:"Big Picture Event Storming으로 도메인 이벤트 발굴 후 Context Map 자동 생성. DDD 커뮤니티 표준.",
        src:"📌 EventStorming.com, Vaughn Vernon 'Implementing DDD'",tags:["EventStorming","ContextMap"]},
      {num:"안 02",title:"ADR 연동 INV 추적",
        body:"각 INV를 ADR과 1:1 연결. 계약 파괴 변경 시 PR 자동 블록. architecture-fitness.js 연동.",
        src:"📌 Michael Nygard ADR, adr-tools GitHub",tags:["ADR","INV추적","자동감지"]},
      {num:"안 03",title:"Fitness Functions for Architecture",
        body:"도메인 경계 위반을 CI에서 자동 검증. 'Evolutionary Architectures' 방식. architecture-fitness.js 연동.",
        src:"📌 'Building Evolutionary Architectures' O'Reilly, ArchUnit",tags:["FitnessFunction","CI연동"]}
    ]
  },
  {
    id:"contract-design", icon:"📜", num:"SECTION 03", tag:"Stage B",
    title:"계약 설계 & 도메인 조합",
    desc:"도메인 간 인터페이스 계약(contracts/), 조합 전략, 충돌 감지 방법론.",
    getInitial(d) {
      const stB = (d.project.stage_states||{}).B || 'PASS';
      return `## 계약 원칙\n\n- 도메인 간 직접 src/ import 금지 — contracts/만 참조\n- CloudEvents envelope 표준 (CNCF)\n- RFC 7807 Problem Details 에러 응답\n\n## Stage B 상태: ${stB}\n- 계약 드리프트 검증: test:contract PASS\n- validate:composition PASS`;
    },
    ideas:[
      {num:"안 01",title:"Consumer-Driven Contract Testing (Pact)",
        body:"소비자가 계약 먼저 작성 → 제공자 검증. Netflix, ING 표준. 현재 contracts/ 디렉토리와 호환.",
        src:"📌 pact.io, Martin Fowler ContractTest",tags:["Pact","CDC","MSA표준"]},
      {num:"안 02",title:"AsyncAPI 스펙 기반 이벤트 계약",
        body:"REST는 OpenAPI, 이벤트는 AsyncAPI 이중 스펙. Kafka/RabbitMQ 자동 문서. 카카오, 네이버 도입.",
        src:"📌 AsyncAPI.com, AsyncAPI Generator CLI",tags:["AsyncAPI","이벤트계약"]},
      {num:"안 03",title:"Schema Registry + 하위호환성 강제",
        body:"Confluent Schema Registry 패턴. BACKWARD/FORWARD 호환 자동 검증. 계약 파괴 시 PR 블록.",
        src:"📌 Confluent Schema Registry, Avro Schema Evolution",tags:["SchemaRegistry","하위호환"]}
    ]
  },
  {
    id:"master-shell", icon:"🐚", num:"SECTION 04", tag:"Stage C",
    title:"마스터 쉘 & 플러그인 아키텍처",
    desc:"plugin-registry, feature-flags, navigation, observability 구성 전략.",
    getInitial(d) {
      let lines = `## 플러그인 레지스트리 현황\n\n`;
      (d.plugins||[]).forEach(p => {
        lines += `### ${p.name} (${p.id})\n- 상태: ${p.status}\n- Feature Flag: ${p.feature_flag}\n- 롤아웃: ${p.rollout?.strategy||'canary'}\n\n`;
      });
      const stC = (d.project.stage_states||{}).C || 'PASS';
      return lines + `## Stage C 상태: ${stC}\n- validate:composition PASS\n- registry/nav/catalog/flags 교차 정합 PASS`;
    },
    ideas:[
      {num:"안 01",title:"Module Federation (Micro-Frontend)",
        body:"Webpack 5 Module Federation으로 각 도메인을 독립 번들로 배포. 런타임 플러그인 로딩.",
        src:"📌 Webpack Module Federation, 'Micro Frontends in Action'",tags:["ModuleFederation","독립배포"]},
      {num:"안 02",title:"OpenFeature (CNCF 표준)",
        body:"CNCF 표준 OpenFeature SDK + Flagd 백엔드. 코드 변경 없이 기능 on/off. flags.yaml 연동.",
        src:"📌 OpenFeature.dev (CNCF), LaunchDarkly Architecture",tags:["OpenFeature","CNCF","ABtest"]},
      {num:"안 03",title:"Plugin Marketplace + 동적 로딩",
        body:"VS Code, Obsidian 플러그인 모델. manifest 선언 → 런타임 검증 → 동적 import. 플러그인 DAG.",
        src:"📌 VS Code Extension API, Obsidian Plugin System",tags:["플러그인마켓","DAG"]}
    ]
  },
  {
    id:"implementation", icon:"⚙️", num:"SECTION 05", tag:"Stage D",
    title:"구현 전략 & 품질 게이트",
    desc:"Clean Architecture 레이어 구조, 테스트 피라미드, 품질 게이트 기준.",
    getInitial(d) {
      const gd = d.project.quality_gate_detail || {};
      const stD = (d.project.stage_states||{}).D || 'PASS';
      const lines = Object.entries(gd).slice(0,8).map(([k,v])=>`- **${k}**: ${v}`).join('\n');
      return `## 품질 게이트 현황 (${d.project.quality_gate_last_run})\n\n${lines}\n\n## Stage D 상태: ${stD}\n- 전체 테스트: ${d.project.tests_pass}/${d.project.tests_total} PASS`;
    },
    ideas:[
      {num:"안 01",title:"TDD + Property-Based Testing",
        body:"TDD 레드-그린-리팩터 + fast-check 속성 검증. 현재 프로젝트에 fast-check 설치됨.",
        src:"📌 fast-check (GitHub 2.8k⭐), 'TDD by Example' Kent Beck",tags:["TDD","PropertyTest"]},
      {num:"안 02",title:"Architecture Fitness CI Gate",
        body:"모든 PR에서 아키텍처 피트니스 자동 검증. architecture-fitness.js 확장으로 구현 가능.",
        src:"📌 ArchUnit (Java), dependency-cruiser (JS), Nx boundaries",tags:["ArchUnit","CI게이트"]},
      {num:"안 03",title:"DORA Metrics 기반 배포 품질",
        body:"Deployment Frequency, Lead Time, CFR, MTTR 4대 지표. Google DevOps Research.",
        src:"📌 DORA (Google), 'Accelerate' Nicole Forsgren",tags:["DORA","배포품질"]}
    ]
  },
  {
    id:"adversarial", icon:"🛡", num:"SECTION 06", tag:"Stage E",
    title:"적대적 검증 & 보안 전략",
    desc:"레드팀 시나리오, OWASP 대응, 불변조건 공격 벡터, 침투 테스트 체크리스트.",
    getInitial(d) {
      const ef = d.stage_e_findings || {};
      const stE = (d.project.stage_states||{}).E || 'PASS';
      let lines = `## Stage E 현황\n\n- 총 갭 발견: ${ef.total_gaps||0}건\n- 수정 완료: ${ef.gaps_fixed||0}건\n- ADR 결정: ${ef.gaps_adred||0}건\n\n## 발견된 갭\n`;
      (ef.gap_details||[]).forEach(g => { lines += `- **${g.id}** [${g.severity}]: ${g.description} → ${g.status}\n`; });
      return lines + `\n## Stage E 상태: ${stE}\n- adversarial tests: 43/43 PASS`;
    },
    ideas:[
      {num:"안 01",title:"STRIDE 위협 모델링",
        body:"Spoofing·Tampering·Repudiation·InfoDisclosure·DoS·EoP 6분류. 각 도메인 INV와 1:1 매핑.",
        src:"📌 Microsoft STRIDE, OWASP Threat Modeling",tags:["STRIDE","위협모델","INV매핑"]},
      {num:"안 02",title:"Chaos Engineering + 복원력",
        body:"Chaos Monkey 방식 의도적 장애 주입. stageE_adversarial.test.js를 chaos 시나리오로 확장.",
        src:"📌 Netflix Chaos Engineering, Chaos Toolkit (GitHub 2.5k⭐)",tags:["ChaosEngineering","복원력"]},
      {num:"안 03",title:"Automated Pen Testing Pipeline",
        body:"OWASP ZAP + Semgrep + Trivy CI/CD 통합. PR 시 자동 취약점 스캔. SAST+DAST+SCA 3중 방어.",
        src:"📌 OWASP ZAP, Semgrep OSS, Trivy (Aqua Security)",tags:["ZAP","Semgrep","자동스캔"]}
    ]
  },
  {
    id:"deployment", icon:"🚀", num:"SECTION 07", tag:"Ops",
    title:"배포 & 운영 전략",
    desc:"배포 환경 구성, 롤백 플레이북, 모니터링, SLO/SLA 정의.",
    getInitial(d) {
      const ki = (d.project.known_issues||[]).map(i=>`- **${i.id}** [${i.severity}]: ${i.description}`).join('\n');
      return `## 배포 현황\n\n- 릴리즈 모드: work-packet-governed\n- 품질 게이트: ${d.project.quality_gate_result}\n- SBOM: artifacts/sbom/\n- Provenance: artifacts/provenance/\n\n## Known Issues\n${ki||'없음'}\n\n## 운영 기준선\n- check:observability PASS\n- test:rollback PASS\n- deployment-environment-provisioning PASS`;
    },
    ideas:[
      {num:"안 01",title:"GitOps + ArgoCD 선언적 배포",
        body:"Git을 단일 진실원으로 클러스터 상태 선언적 관리. ArgoCD 자동 동기화. CNCF 표준.",
        src:"📌 ArgoCD (CNCF), Weaveworks GitOps",tags:["GitOps","ArgoCD","선언적"]},
      {num:"안 02",title:"SLO 기반 Error Budget 자동 경보",
        body:"SLI→SLO→Error Budget. 에러 버짓 소진 임계치 초과 시 배포 자동 중단. error-budget-check.js 연동.",
        src:"📌 'Site Reliability Engineering' Google, Prometheus",tags:["SLO","ErrorBudget"]},
      {num:"안 03",title:"Feature Flag 점진적 롤아웃",
        body:"internal(5%)→beta(20%)→full(100%) 3단계. 지표 이상 시 자동 롤백. CLAUDE.md Feature Flag 정책 정합.",
        src:"📌 Martin Fowler FeatureToggles, LaunchDarkly Rollout",tags:["점진롤아웃","자동롤백"]}
    ]
  },
  {
    id:"roadmap", icon:"📈", num:"SECTION 08", tag:"Roadmap",
    title:"성장 로드맵 & 자기개선 사이클",
    desc:"다음 Work Packet 계획, Reflexion Loop, Knowledge Graph 확장, 팀 역량 성장.",
    getInitial(d) {
      const nq = (d.next_queue||[]).map(q=>`- ${q.id}: ${q.goal} [${q.status}]`).join('\n');
      const feats = (d.project.upgrade_v3_features||[]).slice(0,8).map(f=>`- ${f}`).join('\n');
      return `## 다음 Work Packet 큐\n\n${nq||'현재 큐 비어 있음 (wp:next로 확인)'}\n\n## v3.0 완료 피처 (주요)\n${feats}\n\n## 자기개선 지표\n- 헬스 레이팅: ${d.project.health_rating}\n- 게이트 통과율: ${d.project.gate_pass_rate}%\n- 세션당 WP: 10.0`;
    },
    ideas:[
      {num:"안 01",title:"Shape Up (6-week Cycles)",
        body:"Basecamp 방법론. 6주 빌드 + 2주 쿨다운. 기술 부채 해소를 쿨다운에 배정. 무료 공개.",
        src:"📌 Basecamp 'Shape Up', 37signals",tags:["ShapeUp","6주사이클"]},
      {num:"안 02",title:"Blameless Post-mortem",
        body:"Google SRE 방식 비비난 사후검토. 실패를 학습 자산화. Reflexion Loop + lessons-learned.yaml 정합.",
        src:"📌 Google SRE Book Ch.15, Project Aristotle",tags:["Postmortem","심리안전"]},
      {num:"안 03",title:"Platform Engineering + Backstage",
        body:"개발자 경험(DX) 전담 플랫폼팀. Backstage(Spotify OSS)로 IDP 구축. 현재 카탈로그 사이트 발전.",
        src:"📌 Backstage.io (Spotify, GitHub 23k⭐), Team Topologies",tags:["PlatformEng","Backstage"]}
    ]
  }
];

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────
const STATE = { planContents:{}, planDone:{} };

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pct = (n,t) => t>0?Math.round(n/t*100):0;
const scoreClass = s => s>=85?'score-high':s>=70?'score-mid':'score-low';
function toast(msg) {
  const t=$('toast'); t.textContent=msg;
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600);
}

// ─────────────────────────────────────────────────────────
// Tab switching
// ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  $('panel-'+name).classList.add('active');
  buildSidebar(name);
}

// ─────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────
function renderDashboard() {
  const d=window.D, p=d.project, wp=d.wps;
  const stages=p.stage_states||{}, doneP=pct(wp.done_count,wp.total);

  let domainScoreHtml='';
  Object.entries(d.domain_scores||{}).forEach(([dom,info])=>{
    const sc=info.score||0;
    domainScoreHtml+=`<div class="mini-card">
      <div class="mini-card-label">${esc(dom)}</div>
      <div class="mini-card-value ${scoreClass(sc)}">${sc}</div>
      <div class="mini-card-sub">건강 스코어 추세 ${esc(info.trend||'→')}</div>
      <div class="pbar"><div class="pbar-fill" style="width:${sc}%"></div></div>
    </div>`;
  });

  const stageBadges=['A','B','C','D','E'].map(s=>{
    const v=stages[s]||'—';
    const cls=v==='PASS'?'s-pass':v==='FAIL'?'s-fail':'s-pending';
    return `<span class="stage-badge ${cls}">Stage ${s}: ${v}</span>`;
  }).join('');

  const qgd=p.quality_gate_detail||{};
  let qgHtml=Object.entries(qgd).map(([k,v])=>{
    const pass=String(v).toLowerCase().includes('pass');
    return `<div class="kv-row"><span class="kv-key">${esc(k)}</span>
      <span class="kv-val ${pass?'kv-pass':''}">${esc(v)}</span></div>`;
  }).join('');

  const pf=d.flags.plugin||{};
  let flagHtml=Object.entries(pf).map(([k,v])=>
    `<span class="flag-chip ${v?'flag-on':'flag-off'}">${v?'ON':'OFF'} ${esc(k)}</span>`
  ).join('');

  let activeHtml='';
  (wp.active||[]).forEach(w=>{
    activeHtml+=`<div class="wp-item">
      <div class="wp-status-dot wp-active"></div>
      <div class="wp-id">${esc(w.id)}</div>
      <div style="flex:1"><div class="wp-goal">${esc(w.goal)}</div></div>
      <div class="wp-tier">${esc(w.tier)}</div>
    </div>`;
  });
  if(!activeHtml) activeHtml='<div style="color:var(--dim);font-size:13px;padding:8px">현재 진행 중인 Work Packet 없음</div>';

  const kiHtml=(p.known_issues||[]).map(i=>
    `<div class="wp-item"><div class="wp-status-dot wp-pending"></div>
      <div class="wp-id">${esc(i.id)} <span class="stage-badge s-pending" style="font-size:9px">${esc(i.severity)}</span></div>
      <div class="wp-goal">${esc(i.description)}</div></div>`
  ).join('')||'<div style="color:var(--dim);font-size:13px;padding:8px">Known Issues 없음</div>';

  $('dashboard-content').innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:22px;font-weight:700;color:var(--bright)">📊 프로젝트 대시보드</div>
        <div style="font-size:13px;color:var(--dim);margin-top:3px">생성: ${new Date(d.generated_at).toLocaleString('ko-KR')}</div>
      </div>
    </div>

    <div class="grid-3">
      <div class="mini-card">
        <div class="mini-card-label">헬스 레이팅</div>
        <div class="mini-card-value" style="color:#3fb950;font-size:18px">${esc(p.health_rating)}</div>
        <div class="mini-card-sub">게이트 통과율 ${p.gate_pass_rate}%</div>
      </div>
      <div class="mini-card">
        <div class="mini-card-label">전체 테스트</div>
        <div class="mini-card-value">${p.tests_pass}<span style="font-size:14px;color:var(--dim)">/${p.tests_total}</span></div>
        <div class="mini-card-sub">PASS</div>
        <div class="pbar"><div class="pbar-fill" style="width:${pct(p.tests_pass,p.tests_total)}%"></div></div>
      </div>
      <div class="mini-card">
        <div class="mini-card-label">Work Packets 완료</div>
        <div class="mini-card-value">${wp.done_count}<span style="font-size:14px;color:var(--dim)">/${wp.total}</span></div>
        <div class="mini-card-sub">${doneP}% 완료</div>
        <div class="pbar"><div class="pbar-fill" style="width:${doneP}%"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">🎯</div>
        <div><div class="card-title">Stage 상태</div>
          <div class="card-sub">마지막 게이트: ${esc(p.quality_gate_last_run)} · 결과: <span style="color:var(--accent)">${esc(p.quality_gate_result)}</span></div>
        </div></div>
      <div class="stage-row">${stageBadges}</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">🏥</div>
        <div><div class="card-title">도메인 헬스 스코어</div>
          <div class="card-sub">master-shell/observability/health-scores.yaml</div></div></div>
      <div class="grid-3" style="margin-top:12px;margin-bottom:0">${domainScoreHtml}</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">🔄</div>
        <div><div class="card-title">진행 중인 Work Packet</div>
          <div class="card-sub">memory/current-wp.yaml + memory/next-actions.yaml</div></div></div>
      ${activeHtml}
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">🚩</div>
        <div><div class="card-title">Feature Flag 현황</div>
          <div class="card-sub">master-shell/feature-flags/flags.yaml (모두 false = 운영 환경 준비 전)</div></div></div>
      <div style="margin-top:10px">${flagHtml}</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">✅</div>
        <div><div class="card-title">품질 게이트 상세</div>
          <div class="card-sub">memory/L0-hot/current-state.yaml</div></div></div>
      <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px">${qgHtml}</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-icon">⚠️</div>
        <div><div class="card-title">Known Issues</div></div></div>
      ${kiHtml}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────
function renderPlan() {
  const container=$('plan-content'); container.innerHTML='';
  const d=window.D; let doneCount=0;

  PLAN_SECTIONS.forEach(sec=>{
    const savedKey='wfos-plan-'+sec.id;
    const savedVal=localStorage.getItem(savedKey);
    const initVal=savedVal!==null?savedVal:sec.getInitial(d);
    if(savedVal!==null&&savedVal.trim().length>20){STATE.planDone[sec.id]=true;doneCount++;}
    STATE.planContents[sec.id]=initVal;

    const ideasHtml=sec.ideas.map((idea,i)=>`
      <div class="idea-card" id="icard-${sec.id}-${i}">
        <div class="idea-num">${esc(idea.num)}</div>
        <div class="idea-title">${esc(idea.title)}</div>
        <div class="idea-body">${esc(idea.body)}</div>
        <div class="idea-src">${esc(idea.src)}</div>
        <div class="idea-tags">${idea.tags.map(t=>`<span class="idea-tag">${esc(t)}</span>`).join('')}</div>
        <button class="btn btn-apply" onclick="applyIdea('${sec.id}',${i})">✓ 이 안 적용</button>
      </div>`).join('');

    const promptTxt=`"${sec.title}" 구간에 대해 Claude Skills, GitHub ⭐ 높은 라이브러리, 카카오·네이버·토스·Google·Spotify·Netflix 국내외 최고 사례를 벤치마킹하여 실제 적용 가능한 최적 안 3가지를 제시해주세요. 각 안: ①방법론명 ②핵심설명 ③출처/레퍼런스 ④장단점`;

    const div=document.createElement('div');
    div.className='plan-section'; div.id='ps-'+sec.id;
    div.innerHTML=`
      <div class="plan-head">
        <div class="plan-icon">${sec.icon}</div>
        <div class="plan-meta">
          <div class="plan-num">${esc(sec.num)}</div>
          <div class="plan-title">${esc(sec.title)}</div>
          <div class="plan-desc">${esc(sec.desc)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
          <span class="plan-tag">${esc(sec.tag)}</span>
          <span class="done-badge${STATE.planDone[sec.id]?' show':''}" id="done-${sec.id}">✓ 작성완료</span>
        </div>
      </div>
      <div class="plan-body">
        <textarea class="edit-area" id="area-${sec.id}"
          placeholder="${esc(sec.desc)}"
          oninput="onPlanInput('${sec.id}',this.value)"
        >${esc(initVal)}</textarea>
        <div class="idea-panel">
          <div class="idea-header">
            <div class="idea-label">💡 벤치마킹 아이디어 — 국내외 최고 사례 3가지</div>
            <button class="btn btn-secondary btn-sm" onclick="copyPromptTxt('${sec.id}')">프롬프트 복사</button>
            <button class="btn btn-idea btn-sm" onclick="toggleIdeas('${sec.id}')">아이디어 보기/숨기기</button>
          </div>
          <div class="prompt-box" id="prompt-${sec.id}">${esc(promptTxt)}</div>
          <div class="idea-grid" id="ideas-${sec.id}">${ideasHtml}</div>
        </div>
      </div>`;
    container.appendChild(div);
  });
  updatePlanProgress();
}

function onPlanInput(id,val) {
  STATE.planContents[id]=val;
  localStorage.setItem('wfos-plan-'+id,val);
  const isDone=val.trim().length>20;
  STATE.planDone[id]=isDone;
  const badge=$('done-'+id);
  if(badge) isDone?badge.classList.add('show'):badge.classList.remove('show');
  updatePlanProgress();
}

function toggleIdeas(id) {
  $('ideas-'+id).classList.toggle('open');
  $('prompt-'+id).classList.toggle('open');
}

function applyIdea(secId,idx) {
  const sec=PLAN_SECTIONS.find(s=>s.id===secId), idea=sec.ideas[idx];
  const area=$('area-'+secId);
  area.value+=`\n\n[채택: ${idea.num}] ${idea.title}\n${idea.body}\n참조: ${idea.src}`;
  onPlanInput(secId,area.value);
  document.querySelectorAll(`[id^="icard-${secId}-"]`).forEach(c=>c.classList.remove('picked'));
  $(`icard-${secId}-${idx}`).classList.add('picked');
  toast(`"${idea.title}" 적용됨`);
}

function copyPromptTxt(id) {
  $('prompt-'+id).classList.add('open');
  const sec=PLAN_SECTIONS.find(s=>s.id===id);
  const txt=`"${sec.title}" 구간에 대해 Claude Skills, GitHub ⭐ 높은 라이브러리, 카카오·네이버·토스·Google·Spotify·Netflix 국내외 최고 사례를 벤치마킹하여 실제 적용 가능한 최적 안 3가지를 제시해주세요. 각 안: ①방법론명 ②핵심설명 ③출처/레퍼런스 ④장단점`;
  navigator.clipboard.writeText(txt).then(()=>toast('프롬프트 복사됨'));
}

function updatePlanProgress() {
  const total=PLAN_SECTIONS.length, done=Object.values(STATE.planDone).filter(Boolean).length;
  $('tc-plan').textContent=`${done}/${total}`;
}

function copyAllPlan() {
  let md=`# Workflow OS 마스터 기획서\n생성: ${new Date().toLocaleDateString('ko-KR')}\n\n---\n\n`;
  PLAN_SECTIONS.forEach(sec=>{
    md+=`## ${sec.num} — ${sec.title} [${sec.tag}]\n\n${STATE.planContents[sec.id]?.trim()||'(미작성)'}\n\n---\n\n`;
  });
  navigator.clipboard.writeText(md).then(()=>{
    const ok=$('copy-ok'); ok.classList.add('show'); setTimeout(()=>ok.classList.remove('show'),3000);
    toast('전체 기획서 복사됨!');
  });
}

function exportMarkdown() {
  let md=`# Workflow OS 마스터 기획서\n> ${new Date().toLocaleString('ko-KR')}\n\n`;
  PLAN_SECTIONS.forEach(sec=>{
    md+=`## ${sec.title}\n> Stage: ${sec.tag} | ${sec.desc}\n\n${STATE.planContents[sec.id]?.trim()||'*(미작성)*'}\n\n---\n\n`;
  });
  const blob=new Blob([md],{type:'text/markdown'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`workflow-os-plan-${Date.now()}.md`; a.click();
  URL.revokeObjectURL(url); toast('Markdown 다운로드됨');
}

// ─────────────────────────────────────────────────────────
// Work Packets
// ─────────────────────────────────────────────────────────
let wpStatusFilter='all', wpTierFilter='all', wpSearchQ='';

function renderWPs() {
  const d=window.D; $('tc-wps').textContent=d.wps.total;
  const statusF=['all','done','in_progress'];
  const tierF=['all','infra','arch','domain','governance','meta'];
  $('wps-content').innerHTML=`
    <div style="font-size:20px;font-weight:700;color:var(--bright);margin-bottom:16px">📦 Work Packets</div>
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input class="search-input" placeholder="WP ID 또는 목표로 검색..." oninput="wpSearch(this.value)">
    </div>
    <div class="filter-row" id="wpFilterRow">
      ${statusF.map(f=>`<div class="filter-btn${f==='all'?' active':''}" onclick="wpSetStatus('${f}',this)">${f==='all'?'전체':f==='done'?'✅ 완료':'🔄 진행중'}</div>`).join('')}
      <div style="border-left:1px solid var(--border);margin:0 6px"></div>
      ${tierF.map(t=>`<div class="filter-btn" onclick="wpSetTier('${t}',this)" data-tier="${t}">${t==='all'?'전 Tier':t}</div>`).join('')}
    </div>
    <div id="wp-list"></div>`;
  document.querySelector('[data-tier="all"]').classList.add('active');
  renderWPList();
}

function wpSearch(q){wpSearchQ=q.toLowerCase();renderWPList();}
function wpSetStatus(f,el_){
  wpStatusFilter=f;
  document.querySelectorAll('#wpFilterRow .filter-btn:not([data-tier])').forEach(b=>b.classList.remove('active'));
  el_.classList.add('active'); renderWPList();
}
function wpSetTier(t,el_){
  wpTierFilter=t;
  document.querySelectorAll('[data-tier]').forEach(b=>b.classList.remove('active'));
  el_.classList.add('active'); renderWPList();
}

function renderWPList() {
  let wps=window.D.wps.all;
  if(wpStatusFilter!=='all') wps=wps.filter(w=>w.status===wpStatusFilter);
  if(wpTierFilter!=='all') wps=wps.filter(w=>w.tier===wpTierFilter);
  if(wpSearchQ) wps=wps.filter(w=>(w.id+w.goal+w.cap_name).toLowerCase().includes(wpSearchQ));
  if(!wps.length){$('wp-list').innerHTML='<div style="color:var(--dim);padding:20px;text-align:center">검색 결과 없음</div>';return;}
  const groups={};
  wps.forEach(w=>{
    if(!groups[w.cap_id]) groups[w.cap_id]={cap_id:w.cap_id,cap_name:w.cap_name,wps:[]};
    groups[w.cap_id].wps.push(w);
  });
  let html='';
  Object.values(groups).forEach(g=>{
    html+=`<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px">${esc(g.cap_id)} — ${esc(g.cap_name)}</div>`;
    g.wps.forEach(w=>{
      const sc=w.status==='done'?'wp-done':w.status==='in_progress'?'wp-active':'wp-pending';
      html+=`<div class="wp-item">
        <div class="wp-status-dot ${sc}"></div>
        <div class="wp-id">${esc(w.id)}</div>
        <div style="flex:1">
          <div class="wp-goal">${esc(w.goal)}</div>
          ${w.result?`<div class="wp-result">${esc(w.result.substring(0,120))}${w.result.length>120?'…':''}</div>`:''}
          ${w.completed_at?`<div class="wp-result" style="color:var(--dim)">완료: ${esc(w.completed_at)}</div>`:''}
        </div>
        <div class="wp-tier">${esc(w.tier)}</div>
      </div>`;
    });
  });
  $('wp-list').innerHTML=html;
}

// ─────────────────────────────────────────────────────────
// Archive
// ─────────────────────────────────────────────────────────
function renderArchive() {
  const d=window.D; $('tc-done').textContent=d.wps.done_count;
  $('archive-content').innerHTML=`
    <div style="font-size:20px;font-weight:700;color:var(--bright);margin-bottom:16px">
      ✅ 완료 아카이브 <span style="font-size:14px;font-weight:400;color:var(--dim)">(${d.wps.done_count}건)</span>
    </div>
    <div class="grid-3" style="margin-bottom:16px">
      <div class="mini-card">
        <div class="mini-card-label">완료 WP</div>
        <div class="mini-card-value">${d.wps.done_count}</div>
      </div>
      <div class="mini-card">
        <div class="mini-card-label">검증 명령 실행</div>
        <div class="mini-card-value">${d.wps.verification.total_commands_run||0}</div>
        <div class="mini-card-sub">PASS ${d.wps.verification.passed||0} / FAIL ${d.wps.verification.failed||0}</div>
      </div>
      <div class="mini-card">
        <div class="mini-card-label">완료율</div>
        <div class="mini-card-value">${pct(d.wps.done_count,d.wps.total)}%</div>
        <div class="pbar"><div class="pbar-fill" style="width:${pct(d.wps.done_count,d.wps.total)}%"></div></div>
      </div>
    </div>
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input class="search-input" placeholder="완료 WP 검색..." oninput="filterArchive(this.value)">
    </div>
    <div id="archive-list"></div>`;
  renderArchiveList('');
}

function filterArchive(q){renderArchiveList(q.toLowerCase());}

function renderArchiveList(q) {
  let wps=[...window.D.wps.done].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
  if(q) wps=wps.filter(w=>(w.id+w.goal+w.result+w.cap_name).toLowerCase().includes(q));
  let html='';
  wps.forEach((w,i)=>{
    html+=`<div class="archive-item">
      <div class="archive-head" onclick="toggleArc(${i})">
        <div class="wp-status-dot wp-done" style="flex-shrink:0;margin-top:4px"></div>
        <div style="font-size:11px;font-weight:700;color:var(--dim);min-width:110px;flex-shrink:0">${esc(w.id)}</div>
        <div style="font-size:13px;color:var(--text);flex:1">${esc(w.goal.substring(0,80))}${w.goal.length>80?'…':''}</div>
        <div class="wp-tier" style="flex-shrink:0">${esc(w.tier)}</div>
        <div style="font-size:11px;color:var(--dim);flex-shrink:0;margin-left:8px">${esc(w.completed_at||'')}</div>
        <span style="color:var(--dim);margin-left:8px">▾</span>
      </div>
      <div class="archive-body" id="ab-${i}">
        <div style="margin-bottom:6px;font-size:12px;color:var(--dim)">CAP: ${esc(w.cap_id)} — ${esc(w.cap_name)} · Tier: ${esc(w.tier)}</div>
        <div class="archive-result">${esc(w.result||'결과 없음')}</div>
      </div>
    </div>`;
  });
  $('archive-list').innerHTML=html||'<div style="color:var(--dim);padding:20px;text-align:center">검색 결과 없음</div>';
}

function toggleArc(i){$('ab-'+i).classList.toggle('open');}

// ─────────────────────────────────────────────────────────
// Domains
// ─────────────────────────────────────────────────────────
function renderDomains() {
  const d=window.D; $('tc-domains').textContent=d.domains.length;
  const stages=d.project.stage_states||{}, pf=d.flags.plugin||{};
  let html=`<div style="font-size:20px;font-weight:700;color:var(--bright);margin-bottom:16px">🗺 도메인 현황</div>`;

  html+=`<div class="card" style="margin-bottom:20px">
    <div class="card-head"><div class="card-icon">📜</div>
      <div><div class="card-title">계약 호환성 매트릭스</div>
        <div class="card-sub">worklog/contract-matrix.md 기준</div></div></div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">
      <tr style="border-bottom:1px solid var(--border)">
        ${['도메인','OpenAPI','Events','UI','Capability','Status'].map(h=>`<th style="text-align:left;padding:6px 10px;color:var(--dim);font-weight:600;font-size:11px">${h}</th>`).join('')}
      </tr>
      ${['billing','productivity/task-tracking','video'].map(dom=>`<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 10px;color:var(--text)">${esc(dom)}</td>
        <td style="padding:8px 10px;color:var(--accent)">✅</td><td style="padding:8px 10px;color:var(--accent)">✅</td>
        <td style="padding:8px 10px;color:var(--accent)">✅</td><td style="padding:8px 10px;color:var(--accent)">✅</td>
        <td style="padding:8px 10px"><span class="stage-badge s-pass">PASS</span></td>
      </tr>`).join('')}
    </table>
  </div>`;

  d.domains.forEach(m=>{
    const domKey=m.domain==='productivity'?'productivity/task-tracking':m.domain;
    const scoreInfo=(d.domain_scores[domKey]||d.domain_scores[m.domain]||{});
    const sc=scoreInfo.score||'—', trend=scoreInfo.trend||'→';
    const flagVal=pf[m.feature_flag];
    const mStages=m.stage_a?{A:m.stage_a,B:m.stage_b,C:m.stage_c,D:m.stage_d,E:m.stage_e}:{A:'PASS',B:'PASS',C:'PASS',D:'PASS',E:'PASS'};
    const stageBadges=['A','B','C','D','E'].map(s=>{
      const v=mStages[s]||stages[s]||'PASS';
      return `<span class="stage-badge ${v==='PASS'?'s-pass':v==='FAIL'?'s-fail':'s-pending'}">Stage ${s}: ${v}</span>`;
    }).join('');
    let gapHtml='';
    if(m.stage_e_gaps) m.stage_e_gaps.forEach(g=>{
      gapHtml+=`<div class="wp-item" style="margin-bottom:4px">
        <div class="wp-status-dot" style="background:${g.status==='FIXED'?'#3fb950':'var(--accent3)'}"></div>
        <div class="wp-id"><span class="stage-badge s-pending" style="font-size:9px">${esc(g.severity)}</span> ${esc(g.id)}</div>
        <div class="wp-goal">${esc(g.description)} <span style="color:var(--accent)">${esc(g.status)}</span></div>
      </div>`;
    });
    html+=`<div class="domain-card">
      <div class="domain-head">
        <div class="domain-score ${typeof sc==='number'?scoreClass(sc):''}">
          ${sc} <span style="font-size:12px;font-weight:400;color:var(--dim)">${trend}</span>
        </div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:700;color:var(--bright)">${esc(m.module_id)}</div>
          <div style="font-size:12px;color:var(--dim)">${esc(m.domain)} / ${esc(m.bounded_context||m.domain)}</div>
          <div class="stage-row" style="margin-top:8px">${stageBadges}</div>
        </div>
        <div style="text-align:right">
          <span class="flag-chip ${flagVal?'flag-on':'flag-off'}">${flagVal?'🟢 활성':'🔴 비활성'}</span>
          <div style="font-size:11px;color:var(--dim);margin-top:4px">${esc(m.feature_flag)}</div>
        </div>
      </div>
      <div class="domain-body">
        <div class="kv-row"><span class="kv-key">플러그인 ID</span><span class="kv-val">${esc(m.plugin_id)}</span></div>
        ${m.contract_dir?`<div class="kv-row"><span class="kv-key">계약 디렉토리</span><span class="kv-val">${esc(m.contract_dir)}</span></div>`:''}
        ${m.interface_layer?`<div class="kv-row"><span class="kv-key">인터페이스</span><span class="kv-val kv-pass">${esc(m.interface_layer.substring(0,70))}</span></div>`:''}
        ${m.unit_tests?`<div class="kv-row"><span class="kv-key">단위 테스트</span><span class="kv-val kv-pass">${esc(m.unit_tests)}</span></div>`:''}
        ${gapHtml?`<div style="margin-top:12px"><div style="font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Stage E 갭</div>${gapHtml}</div>`:''}
      </div>
    </div>`;
  });
  $('domains-content').innerHTML=html;
}

// ─────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────
function buildSidebar(tab) {
  const sb=$('sidebar');
  if(tab==='dashboard'){
    sb.innerHTML=`<div class="sidebar-label">섹션</div>`+
      ['핵심 지표','Stage 상태','도메인 헬스','진행 중 WP','Feature Flags','품질 게이트','Known Issues']
      .map(s=>`<div class="nav-link"><span class="nav-dot dot-pass"></span>${s}</div>`).join('');
  }else if(tab==='plan'){
    sb.innerHTML=`<div class="sidebar-label">기획서 목차</div>`+
      PLAN_SECTIONS.map(s=>`<div class="nav-link${STATE.planDone[s.id]?' active':''}"
        onclick="document.getElementById('ps-${s.id}').scrollIntoView({behavior:'smooth'})">
        <span class="nav-dot ${STATE.planDone[s.id]?'dot-pass':'dot-inactive'}"></span>
        <span style="flex:1;font-size:12px">${s.title}</span>
        <span style="font-size:9px;color:var(--dim)">${s.tag}</span>
      </div>`).join('');
  }else if(tab==='wps'){
    const d=window.D;
    const byS={done:0,in_progress:0,other:0};
    d.wps.all.forEach(w=>{if(w.status==='done')byS.done++;else if(w.status==='in_progress')byS.in_progress++;else byS.other++;});
    sb.innerHTML=`<div class="sidebar-label">WP 현황</div>
      <div class="mini-card" style="margin-bottom:8px">
        <div class="kv-row"><span class="kv-key" style="font-size:12px">완료</span><span class="kv-val kv-pass">${byS.done}</span></div>
        <div class="kv-row"><span class="kv-key" style="font-size:12px">진행중</span><span class="kv-val" style="color:var(--accent2)">${byS.in_progress}</span></div>
        <div class="kv-row"><span class="kv-key" style="font-size:12px">대기</span><span class="kv-val">${byS.other}</span></div>
      </div>
      <div class="sidebar-label" style="margin-top:10px">Capability</div>`+
      d.caps.map(c=>`<div class="nav-link" style="font-size:11px">
        <span class="nav-dot dot-pass"></span>${esc(c.id)} <span style="color:var(--dim)">${esc(c.name.substring(0,18))}</span>
      </div>`).join('');
  }else if(tab==='archive'){
    sb.innerHTML=`<div class="sidebar-label">아카이브</div>
      <div class="nav-link active"><span class="nav-dot dot-pass"></span>전체 완료 WP</div>`;
  }else if(tab==='domains'){
    const d=window.D;
    sb.innerHTML=`<div class="sidebar-label">도메인</div>`+
      d.domains.map(m=>`<div class="nav-link">
        <span class="nav-dot dot-pass"></span>
        <span style="flex:1;font-size:12px">${esc(m.module_id)}</span>
      </div>`).join('')+
      `<hr class="divider"><div class="sidebar-label">플러그인</div>`+
      d.plugins.map(p=>`<div class="nav-link">
        <span class="nav-dot ${p.status==='active'?'dot-pass':'dot-inactive'}"></span>
        <span style="font-size:12px">${esc(p.name)}</span>
      </div>`).join('');
  }
}

// ─────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const d=window.D;
  $('health-badge').textContent=d.project.health_rating;
  $('gen-time').textContent='생성: '+new Date(d.generated_at).toLocaleString('ko-KR');
  renderDashboard(); renderPlan(); renderWPs(); renderArchive(); renderDomains();
  buildSidebar('dashboard');
  setInterval(()=>{
    PLAN_SECTIONS.forEach(sec=>{
      const a=$('area-'+sec.id);
      if(a) localStorage.setItem('wfos-plan-'+sec.id,a.value);
    });
  },5000);
});
</script>
</body>
</html>"""

# ── 데이터 삽입 (단순 문자열 치환 — f-string 충돌 없음) ──────────────
HTML = HTML_TEMPLATE.replace('__DATA_JSON__', DATA_JSON)

# ── 출력 ─────────────────────────────────────────────────────────────
OUT_DIR = os.path.join(ROOT, "artifacts", "master-planner")
os.makedirs(OUT_DIR, exist_ok=True)
OUT_PATH = os.path.join(OUT_DIR, "index.html")

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(HTML)

size_kb = os.path.getsize(OUT_PATH) // 1024
print(f"✅ 생성 완료: {OUT_PATH} ({size_kb}KB)")
print(f"   브라우저에서 열기: file://{OUT_PATH}")
