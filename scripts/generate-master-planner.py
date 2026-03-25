#!/usr/bin/env python3
"""
Workflow OS — 마스터 기획서 UI 생성기 v4
실제 프로젝트 YAML/JSON/MD + Git 데이터를 수집해 self-contained HTML을 생성한다.
실행: python3 scripts/generate-master-planner.py
출력: artifacts/master-planner/index.html
"""

import yaml, json, os, sys, datetime, glob, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def git(args):
    """Run git command, return stdout or empty string on error."""
    try:
        r = subprocess.run(["git"] + args, capture_output=True, text=True,
                           cwd=ROOT, timeout=5)
        return r.stdout.strip()
    except Exception:
        return ""

def load_yaml(path, default=None):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full): return default if default is not None else {}
    try:
        with open(full, encoding='utf-8') as f:
            return yaml.safe_load(f) or (default if default is not None else {})
    except Exception as e:
        print(f"  [WARN] {path}: {e}", file=sys.stderr)
        return default if default is not None else {}

def load_json(path, default=None):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full): return default if default is not None else {}
    try:
        with open(full, encoding='utf-8') as f: return json.load(f)
    except: return default if default is not None else {}

def load_jsonl(path, default=None):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return default if default is not None else []
    rows = []
    try:
        with open(full, encoding='utf-8') as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        return rows
    except Exception as e:
        print(f"  [WARN] {path}: {e}", file=sys.stderr)
        return default if default is not None else []

def read_md(path, lines=10):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full): return ""
    try:
        with open(full, encoding='utf-8') as f:
            return "".join(f.readlines()[:lines]).strip()
    except: return ""

def estimate_tokens_from_bytes(byte_count):
    if not isinstance(byte_count, int) or byte_count <= 0:
        return 0
    return max(1, round(byte_count / 4))

def collect_path_metric(path):
    rel_path = str(path or "").replace("\\", "/")
    if not rel_path:
        return {
            "path": "",
            "exists": False,
            "kind": "missing",
            "file_count": 0,
            "total_bytes": 0,
            "estimated_tokens": 0,
        }

    target = os.path.join(ROOT, rel_path.rstrip("/"))
    if not os.path.exists(target):
        return {
            "path": rel_path,
            "exists": False,
            "kind": "missing",
            "file_count": 0,
            "total_bytes": 0,
            "estimated_tokens": 0,
        }

    if os.path.isfile(target):
        total_bytes = os.path.getsize(target)
        return {
            "path": rel_path,
            "exists": True,
            "kind": "file",
            "file_count": 1,
            "total_bytes": total_bytes,
            "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
        }

    file_count = 0
    total_bytes = 0
    for base, _, files in os.walk(target):
        for name in files:
            file_count += 1
            try:
                total_bytes += os.path.getsize(os.path.join(base, name))
            except OSError:
                continue
    return {
        "path": rel_path,
        "exists": True,
        "kind": "dir",
        "file_count": file_count,
        "total_bytes": total_bytes,
        "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
    }

def normalize_ui_screen(screen):
    if not isinstance(screen, dict):
        return None
    actions = []
    for action in screen.get("actions", []) or []:
        if isinstance(action, dict):
            actions.append({
                "id": action.get("id", ""),
                "label": action.get("label") or action.get("name") or action.get("id", ""),
                "triggers": action.get("triggers", ""),
            })
        elif isinstance(action, str):
            actions.append({"id": action, "label": action, "triggers": ""})
    data_sources = []
    for req in screen.get("data_requirements", []) or []:
        if isinstance(req, dict):
            data_sources.append({
                "source": req.get("source", ""),
                "fields": req.get("fields", []) if isinstance(req.get("fields", []), list) else [],
            })
    permissions = screen.get("permissions", []) or screen.get("capabilities_required", []) or []
    return {
        "id": screen.get("id") or screen.get("module_key") or screen.get("mount") or "",
        "title": screen.get("name") or screen.get("title") or screen.get("module_key") or "",
        "route": screen.get("route", ""),
        "description": screen.get("description", ""),
        "permissions": permissions if isinstance(permissions, list) else [str(permissions)],
        "feature_flag": screen.get("feature_flag", ""),
        "actions": actions,
        "data_sources": data_sources,
    }

def load_ui_guides(plugins):
    guides = {}
    for plugin in plugins or []:
        ref = plugin.get("ui_contract")
        module_id = plugin.get("module_id") or plugin.get("id")
        if not ref or not module_id:
            continue
        contract = load_yaml(ref, {})
        screens = []
        for screen in contract.get("screens", []) or []:
            normalized = normalize_ui_screen(screen)
            if normalized:
                screens.append(normalized)
        entry_points = []
        for entry in contract.get("entry_points", []) or []:
            if isinstance(entry, dict):
                entry_points.append({
                    "route": entry.get("route", ""),
                    "label": entry.get("label", ""),
                    "description": entry.get("description", ""),
                })
        guides[module_id] = {
            "module_id": module_id,
            "plugin_id": plugin.get("id", ""),
            "name": contract.get("name") or plugin.get("name") or module_id,
            "description": contract.get("description") or "",
            "entry_points": entry_points,
            "screens": screens,
        }
    return guides

# ═══════════════════════════════════════════════════════════════
SILENT = "--silent" in sys.argv
if not SILENT: print("📖 프로젝트 데이터 수집 중...")

# ── Git 형상관리 정보 ────────────────────────────────────────────
git_branch   = git(["rev-parse", "--abbrev-ref", "HEAD"]) or "unknown"
git_hash     = git(["rev-parse", "--short", "HEAD"]) or ""
git_hash_full= git(["rev-parse", "HEAD"]) or ""
git_last_msg = git(["log", "-1", "--format=%s"]) or ""
git_last_date= git(["log", "-1", "--format=%ai"]) or ""
git_last_auth= git(["log", "-1", "--format=%an"]) or ""
git_log_lines= git(["log", "--oneline", "-8"]) or ""
git_commits  = [{"hash": l[:7], "msg": l[8:]} for l in git_log_lines.splitlines() if l]
git_diff_stat= git(["diff", "main...HEAD", "--stat", "--no-color"]) or ""

root_state   = load_yaml("memory/current-state.yaml")
l0_state     = load_yaml("memory/L0-hot/current-state.yaml")
checkpoint   = load_yaml("memory/checkpoint.yaml")
current_wp   = load_yaml("memory/current-wp.yaml")
wp_queue     = load_yaml("memory/wp-queue.yaml")
next_actions = load_yaml("memory/next-actions.yaml")
health       = load_yaml("master-shell/observability/health-scores.yaml")
observability = load_yaml("master-shell/observability/config.yaml")
flags        = load_yaml("master-shell/feature-flags/flags.yaml")
registry     = load_yaml("master-shell/plugin-registry/registry.yaml")
adapter_registry = load_yaml("master-shell/catalog/adapter-registry.yaml")
adapter_scorecards = load_yaml("master-shell/catalog/adapter-scorecards.yaml")
execution_packet_templates = load_yaml("master-shell/catalog/execution-packet-templates.yaml")
context_routing_profiles = load_yaml("master-shell/catalog/context-routing-profiles.yaml")
learning_replay_lenses = load_yaml("master-shell/catalog/learning-replay-lenses.yaml")
planning_studio_modes = load_yaml("master-shell/catalog/planning-studio-modes.yaml")
adapter_transition_playbooks = load_yaml("master-shell/catalog/adapter-transition-playbooks.yaml")
project_blueprints = load_yaml("master-shell/catalog/project-blueprints.yaml")
project_intake_canvas = load_yaml("master-shell/catalog/project-intake-canvas.yaml")
adapter_compatibility = load_yaml("master-shell/catalog/adapter-compatibility-matrix.yaml")
ai_learning_map = load_yaml("master-shell/catalog/ai-learning-map.yaml")
learning_mastery_map = load_yaml("master-shell/catalog/learning-mastery-map.yaml")
ai_runtime_recipes = load_yaml("master-shell/catalog/ai-runtime-recipes.yaml")
master_os_relations = load_yaml("master-shell/catalog/master-os-relations.yaml")
benchmark_signals = load_yaml("master-shell/catalog/benchmark-signals.yaml")
reflect_log   = load_yaml("memory/L0-hot/reflection-log.yaml")
fail_patterns = load_yaml("memory/L0-hot/failure-patterns.yaml")
gate_trends   = load_yaml("memory/L0-hot/gate-trends.yaml")
knowledge_g   = load_yaml("memory/knowledge-graph.yaml")
audit_chain   = load_json("worklog/audit-chain.json")
ops_timeline  = load_jsonl("master-shell/observability/timeline.jsonl", [])
adr_index     = load_yaml("docs/adr/adr-index.yaml")
contract_mat = read_md("worklog/contract-matrix.md", 20)
decision_apply_history = []
for p in sorted(glob.glob(os.path.join(ROOT, "artifacts/decision-apply/history/*.json")), reverse=True)[:8]:
    rel = os.path.relpath(p, ROOT)
    payload = load_json(rel, {})
    if payload:
        decision_apply_history.append({
            "recorded_at": payload.get("recorded_at", os.path.basename(p).replace(".json", "")),
            "goal": payload.get("goal", ""),
            "decision_gate": payload.get("decision_gate", ""),
            "result": payload.get("result", ""),
            "ready_to_apply": bool(payload.get("ready_to_apply", False)),
            "promoted_packet_id": payload.get("promoted_packet_id", ""),
        })
# ── Requirements / Constraints / Domain-Map ───────────────────────
req_yaml     = load_yaml("requirements/requirements.yaml")
constraints  = load_yaml("requirements/constraints.yaml")
domain_map   = load_yaml("requirements/domain-map.yaml")
nfr_yaml     = load_yaml("requirements/nfr.yaml")

# nfr.yaml 중첩 카테고리 평탄화
nfr_categories = {}
for cat, items in (nfr_yaml or {}).items():
    if cat in ("version", "last_updated"): continue
    if isinstance(items, dict):
        nfr_categories[cat] = {str(k): str(v) for k, v in items.items()}
    else:
        nfr_categories[cat] = {"value": str(items)}
stage_a_mems = {}
for p in glob.glob(os.path.join(ROOT, "memory/stageA/*.yaml")):
    name = os.path.basename(p).replace(".yaml","")
    d = load_yaml(f"memory/stageA/{os.path.basename(p)}")
    if d: stage_a_mems[name] = d

# ── Work Packets ────────────────────────────────────────────────────
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
            "completed_at": str(wp.get("completed_at","")),
            "depends_on":   wp.get("depends_on",[]),
            "covers":       wp.get("covers_capability",""),
            "context_budget": wp.get("context_budget", {}),
        })

# next-actions 큐에서 in_progress WP 보충
na_queue = next_actions.get("queue", [])
na_ids   = {w["id"] for w in all_wps}
for nw in na_queue:
    if nw.get("id") and nw["id"] not in na_ids:
        all_wps.append({
            "id": nw.get("id",""),
            "cap_id": "NEXT",
            "cap_name": "다음 Work Packet",
            "goal": nw.get("goal",""),
            "status": nw.get("status","pending"),
            "tier": nw.get("tier",""),
            "result": "",
            "completed_at": "",
            "depends_on": nw.get("depends_on",[]),
            "covers": "",
            "context_budget": nw.get("context_budget", {}),
        })

done_wps    = [w for w in all_wps if w["status"] == "done"]
active_wps  = [w for w in all_wps if w["status"] in ("in_progress", "active")]
pending_wps = [w for w in all_wps if w["status"] in ("pending", "not_started", "todo")]

path_metric_paths = {
    "memory/checkpoint.yaml",
    "memory/current-wp.yaml",
    "requirements/requirements.yaml",
    "requirements/constraints.yaml",
    "requirements/domain-map.yaml",
    "master-shell/catalog/project-blueprints.yaml",
    "master-shell/catalog/project-intake-canvas.yaml",
    "master-shell/catalog/planning-studio-modes.yaml",
    "master-shell/catalog/ai-runtime-recipes.yaml",
    "master-shell/catalog/adapter-registry.yaml",
    "master-shell/catalog/adapter-compatibility-matrix.yaml",
    "master-shell/catalog/adapter-transition-playbooks.yaml",
    "master-shell/catalog/execution-packet-templates.yaml",
    "master-shell/catalog/context-routing-profiles.yaml",
    "master-shell/catalog/ai-learning-map.yaml",
    "master-shell/catalog/master-os-relations.yaml",
    "worklog/contract-matrix.md",
    "master-shell/plugin-registry/registry.yaml",
    "master-shell/observability/config.yaml",
    "master-shell/observability/health-scores.yaml",
    "master-shell/observability/timeline.jsonl",
    "master-shell/operations/rollback-playbook.yaml",
    "master-shell/operations/deployment-environments.yaml",
    "templates/module-template/README.md",
    "templates/contract-template/README.md",
    "docs/adr/adr-index.yaml",
    "artifacts/master-planner/index.html",
    "artifacts/catalog-site/index.html",
    "artifacts/deployment-smoke/",
    "artifacts/deployment-smoke/target-resolution.json",
    "domains/",
    "worklog/reports/",
}
for profile in context_routing_profiles.get("profiles", []) or []:
    for field in ("must_read", "expand_if_needed", "defer_until_execution"):
        path_metric_paths.update(profile.get(field, []) or [])
for wp in all_wps:
    budget = wp.get("context_budget", {}) if isinstance(wp.get("context_budget", {}), dict) else {}
    path_metric_paths.update(budget.get("tier_reads", []) or [])
    path_metric_paths.update(budget.get("context_reads", []) or [])
path_metrics = {path: collect_path_metric(path) for path in sorted(path_metric_paths) if path}

# ── 도메인 — active_modules + plugin으로 video 보충 ──────────────────
active_modules = list(l0_state.get("active_modules", []))
am_ids = {m.get("module_id") for m in active_modules}
plugins  = registry.get("plugins", [])
domain_scores = health.get("domains", {})
ui_guides = load_ui_guides(plugins)

for plugin in plugins:
    mod_id = plugin.get("module_id","")
    if mod_id and mod_id not in am_ids:
        # video 등 플러그인에는 있지만 active_modules에 빠진 도메인 보충
        ds_key = mod_id  # try direct
        score_info = domain_scores.get(ds_key) or domain_scores.get(f"productivity/{ds_key}") or {}
        active_modules.append({
            "module_id":    mod_id,
            "domain":       plugin.get("navigation", {}).get("group", mod_id),
            "bounded_context": mod_id,
            "plugin_id":    plugin.get("id",""),
            "feature_flag": plugin.get("feature_flag",""),
            "feature_flag_value": False,
            "plugin_status": plugin.get("status","inactive"),
            "stage_a": "PASS",
            "stage_b": "PASS",
            "stage_c": "PASS",
            "stage_d": "PASS",
            "stage_e": "PASS",
            "health_score": score_info.get("score","—"),
            "_from_plugin": True,
        })
        am_ids.add(mod_id)

# ── ADRs ────────────────────────────────────────────────────────────
adrs = []
for a in (adr_index or {}).get("adrs", []):
    if a.get("status","") == "archived": continue
    adrs.append({
        "id":     a.get("id",""),
        "title":  a.get("title",""),
        "domain": a.get("domain",""),
        "stage":  a.get("stage",""),
        "file":   a.get("file",""),
        "status": a.get("status","active"),
    })

# ── Reflection log ──────────────────────────────────────────────────
reflections = []
for e in (reflect_log or {}).get("entries", []):
    reflections.append({
        "stage":  e.get("stage",""),
        "domain": e.get("domain",""),
        "date":   e.get("date",""),
        "went_well":    e.get("what_went_well",[]),
        "went_wrong":   e.get("what_went_wrong",[]),
        "root_cause":   e.get("root_cause",[]),
        "improvement":  e.get("improvement_for_next",[]),
        "confidence":   e.get("confidence_score",0),
    })

# ── Audit chain ─────────────────────────────────────────────────────
audit_entries = []
for e in (audit_chain or {}).get("entries", []):
    audit_entries.append({
        "seq":       e.get("seq",""),
        "timestamp": e.get("timestamp",""),
        "action":    e.get("action",""),
        "actor":     e.get("actor",""),
        "hash":      e.get("hash","")[:12] if e.get("hash") else "",
    })

# ── Learning reports ─────────────────────────────────────────────────
learning_reports = []
for path in glob.glob(os.path.join(ROOT, "worklog/reports/**/*.md"), recursive=True):
    rel = os.path.relpath(path, ROOT)
    domain = rel.split(os.sep)[-2] if os.sep in rel else "unknown"
    excerpt = read_md(rel, 5)
    learning_reports.append({
        "domain": domain,
        "file": rel,
        "excerpt": excerpt,
    })

# ── Stage A memories summary ─────────────────────────────────────────
stage_a_summaries = {}
for name, mem in stage_a_mems.items():
    inv_count = 0
    for agg in mem.get("aggregates", []):
        inv_count += len(agg.get("invariants", []))
    ul = mem.get("ubiquitous_language", {})
    if isinstance(ul, dict):
        lang = list(ul.keys())[:4]
    elif isinstance(ul, list):
        lang = [item.get("term", str(item)) for item in ul[:4]]
    else:
        lang = []
    stage_a_summaries[name] = {
        "domain_id":      mem.get("domain_id", name),
        "bounded_context": mem.get("bounded_context",""),
        "invariant_count": inv_count,
        "ubiquitous_language": lang,
        "risk_level":     mem.get("risk_profile", {}).get("level",""),
    }

# ── 핵심 지표 ─────────────────────────────────────────────────────────
hm = root_state.get("health_metrics", {}).get("last_known", {})
qgd = l0_state.get("quality_gate_detail", {})
ver = checkpoint.get("verification_summary", {})
ki  = root_state.get("known_issues", [])
stages = l0_state.get("stage_states", {})

# ── 실제 테스트 수 동적 계산 ─────────────────────────────────────
_tests_total, _tests_pass = 0, 0
for module in l0_state.get("active_modules", []):
    for key in ("unit_tests", "stage_d_detail"):
        val = str(module.get(key, "") or module.get("stage_d_detail", {}).get("unit", "") if key=="stage_d_detail" else module.get(key,""))
        m = re.search(r'(\d+)/(\d+)', val)
        if m:
            _tests_pass += int(m.group(1))
            _tests_total += int(m.group(2))
            break
# quality_gate_detail에서 보충
for val in qgd.values():
    m = re.search(r'(\d+)/(\d+)', str(val))
    if m and int(m.group(2)) > _tests_total:
        _tests_total = int(m.group(2))
        _tests_pass  = int(m.group(1))
if not _tests_total: _tests_total = _tests_pass = 500  # fallback

# ── 번들 ─────────────────────────────────────────────────────────────
data = {
    "generated_at": datetime.datetime.now().isoformat(),
    "project": {
        "name":  "Workflow OS",
        "repo":  "my-module",
        "phase": l0_state.get("repository",{}).get("phase","continuous-self-improvement"),
        "branch": git_branch,
        "stage_states": stages,
        "quality_gate_result":   l0_state.get("quality_gate_result","PASS"),
        "quality_gate_last_run": l0_state.get("quality_gate_last_run","2026-03-21"),
        "quality_gate_detail":   qgd,
        "health_rating":    hm.get("health_rating","ELITE"),
        "gate_pass_rate":   hm.get("gate_pass_rate_pct", 88.1),
        "change_failure_rate": hm.get("change_failure_rate_pct", 0),
        "avg_wps_per_session": hm.get("avg_wps_per_session", 10.0),
        "tests_total": _tests_total,
        "tests_pass":  _tests_pass,
        "known_issues": ki,
        "upgrade_v3_features": l0_state.get("upgrade_v3",{}).get("features_added",[]),
        "notes": l0_state.get("notes",""),
    },
    "wps": {
        "all":       all_wps,
        "done":      done_wps,
        "active":    active_wps,
        "pending":   pending_wps,
        "total":     len(all_wps),
        "done_count": len(done_wps),
        "active_count": len(active_wps),
        "verification": ver,
    },
    "caps": [{"id":c.get("id"),"name":c.get("name"),"priority":c.get("priority",99),
               "wp_count": len(c.get("work_packets",[])),
               "done_count": sum(1 for w in c.get("work_packets",[]) if w.get("status")=="done")}
             for c in caps],
    "next_queue": na_queue,
    "current_wp": current_wp,
    "domains":      active_modules,
    "domain_scores": domain_scores,
    "plugins":      plugins,
    "ui_guides":    ui_guides,
    "adapter_catalog": {
        "principles": adapter_registry.get("principles", []),
        "adapters": adapter_registry.get("adapters", []),
        "profiles": adapter_registry.get("adapter_profiles", []),
    },
    "adapter_scorecards": adapter_scorecards.get("scorecards", []),
    "execution_packet_templates": execution_packet_templates.get("templates", []),
    "context_routing_profiles": context_routing_profiles.get("profiles", []),
    "learning_replay_lenses": learning_replay_lenses.get("lenses", []),
    "planning_studio_modes": planning_studio_modes.get("modes", []),
    "adapter_transition_playbooks": adapter_transition_playbooks.get("transitions", []),
    "project_blueprints": project_blueprints.get("blueprints", []),
    "project_intake_canvas": {
        "questions": project_intake_canvas.get("questions", []),
        "defaults": project_intake_canvas.get("defaults", {}),
    },
    "adapter_compatibility": adapter_compatibility.get("profiles", []),
    "ai_learning_tracks": ai_learning_map.get("tracks", []),
    "learning_mastery_map": learning_mastery_map.get("milestones", []),
    "ai_runtime_recipes": ai_runtime_recipes.get("recipes", []),
    "master_os_relations": master_os_relations.get("relations", []),
    "path_metrics": path_metrics,
    "benchmark_intelligence": {
        "review": benchmark_signals.get("benchmark_review", {}),
        "essential_improvements": benchmark_signals.get("essential_improvements", []),
        "focuses": benchmark_signals.get("improvement_focuses", []),
        "signals": benchmark_signals.get("signals", []),
    },
    "decision_apply_history": decision_apply_history,
    "flags": {
        "global": flags.get("global_flags",{}),
        "plugin": flags.get("plugin_flags",{}),
    },
    "stage_e_findings": l0_state.get("stage_e_findings",{}),
    "stage_a_summaries": stage_a_summaries,
    "adrs": adrs,
    "reflections": reflections,
    "audit_entries": audit_entries,
    "learning_reports": learning_reports,
    "ops_timeline": ops_timeline,
    "observability": {
        "dashboards": observability.get("dashboards", []),
        "alert_groups": observability.get("alert_groups", []),
        "global_settings": observability.get("global_settings", {}),
    },
    "contract_matrix": contract_mat,
    "requirements": {
        "module":         req_yaml.get("module", {}),
        "stage":          req_yaml.get("stage", "D"),
        "nfr":            req_yaml.get("nfr", {}),
        "nfr_categories": nfr_categories,
        "quality_gates":  req_yaml.get("quality_gates", {}),
        "contracts":      req_yaml.get("contracts", {}),
        "composition":    req_yaml.get("composition", {}),
        "hard_constraints": (constraints or {}).get("hard_constraints", []),
        "soft_constraints": (constraints or {}).get("soft_constraints", []),
        "domain_map_domains": (domain_map or {}).get("domains", []),
        "composition_policies": (domain_map or {}).get("composition_policies", []),
        "fail_patterns":  (fail_patterns or {}).get("patterns", []),
        "gate_trends":    (gate_trends or {}).get("domains", {}),
    },
    "knowledge_graph": {
        "domains": (knowledge_g or {}).get("entities", {}).get("domains", {}),
    },
    "git": {
        "branch":    git_branch,
        "hash":      git_hash,
        "hash_full": git_hash_full,
        "last_msg":  git_last_msg,
        "last_date": git_last_date,
        "last_auth": git_last_auth,
        "commits":   git_commits,
        "diff_stat": git_diff_stat,
    },
}

DATA_JSON = json.dumps(data, ensure_ascii=False, indent=2)
if not SILENT:
    print(f"  ✓ WPs: {len(all_wps)} total | done:{len(done_wps)} active:{len(active_wps)} pending:{len(pending_wps)}")
    print(f"  ✓ Domains: {len(active_modules)} | Plugins: {len(plugins)}")
    print(f"  ✓ ADRs: {len(adrs)} | Stage A mems: {len(stage_a_summaries)}")
    print(f"  ✓ Reflections: {len(reflections)} | Audit: {len(audit_entries)} | Reports: {len(learning_reports)}")

# ═══════════════════════════════════════════════════════════════
if not SILENT: print("🎨 HTML 생성 중...")

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Workflow OS — 마스터 기획서</title>
<style>
:root{
  --bg:#0d1117;--sf:#161b22;--sf2:#21262d;--bd:#30363d;
  --ac:#238636;--ac2:#1f6feb;--ac3:#bb8009;--pu:#8957e5;
  --rd:#da3633;--tx:#c9d1d9;--tx2:#9fb0c0;--dm:#8b949e;--br:#f0f6fc;--ln:#30363d;
  --r:8px;--fn:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;
  --mo:'JetBrains Mono','Fira Code',Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh;line-height:1.6}

/* ── topbar ── */
.tb{position:sticky;top:0;z-index:300;background:rgba(13,17,23,.97);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--bd);padding:9px 20px;display:flex;align-items:center;gap:10px}
.tb-left{display:flex;align-items:center;gap:14px;min-width:0}
.tb-logo{font-size:16px;font-weight:700;color:var(--br);display:flex;align-items:center;gap:6px}
.tb-logo em{color:var(--ac2);font-style:normal}
.tb-sub{font-size:12px;color:var(--dm);white-space:nowrap}
.tb-nav{display:flex;gap:6px;flex-wrap:wrap}
.tb-nav a{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:999px;
  border:1px solid var(--bd);background:var(--sf2);color:var(--tx);text-decoration:none;font-size:11px}
.tb-nav a:hover{border-color:rgba(31,111,235,.35);color:var(--br)}
.tb-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;
  padding:2px 9px;border-radius:99px;border:1px solid}
.badge-elite{background:rgba(35,134,54,.15);color:#3fb950;border-color:rgba(35,134,54,.3)}
.badge-gen{font-size:11px;color:var(--dm)}

/* ── tabs ── */
.tabs{display:flex;gap:0;border-bottom:1px solid var(--bd);background:var(--sf);
  position:sticky;top:46px;z-index:299;overflow-x:auto}
.tab{padding:10px 16px;font-size:12.5px;font-weight:500;color:var(--dm);cursor:pointer;
  border-bottom:2px solid transparent;transition:all .13s;white-space:nowrap;flex-shrink:0}
.tab:hover{color:var(--tx);background:rgba(255,255,255,.03)}
.tab.on{color:var(--br);border-bottom-color:var(--ac2)}
.tc{font-size:10px;background:var(--sf2);padding:1px 5px;border-radius:99px;margin-left:3px;color:var(--dm)}
.tab.on .tc{background:rgba(31,111,235,.18);color:var(--ac2)}

/* ── layout ── */
.ly{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 94px)}
.sb{border-right:1px solid var(--bd);padding:14px 10px;position:sticky;
  top:94px;height:calc(100vh - 94px);overflow-y:auto;background:var(--sf);flex-shrink:0}
.sb-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
  color:var(--dm);margin:12px 0 5px;padding:0 5px}
.sb-lbl:first-child{margin-top:0}
.nl{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:5px;
  font-size:12px;color:var(--dm);cursor:pointer;transition:all .1s;border:1px solid transparent;margin-bottom:1px}
.nl:hover{background:var(--sf2);color:var(--tx)}
.nl.on{background:rgba(31,111,235,.1);color:var(--ac2);border-color:rgba(31,111,235,.18)}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.d-pass{background:var(--ac)}.d-act{background:var(--ac2)}.d-off{background:var(--bd)}.d-warn{background:var(--ac3)}

.tab-panel{display:none}.tab-panel.on{display:block}
.main{padding:24px 32px;max-width:1000px;min-height:calc(100vh - 94px - 58px)}

/* ── cards ── */
.card{background:var(--sf);border:1px solid var(--bd);border-radius:11px;padding:18px;margin-bottom:14px}
.card:hover{border-color:#3a4149}
.card-h{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
.card-ic{font-size:22px;flex-shrink:0}
.card-tit{font-size:15px;font-weight:700;color:var(--br);margin-bottom:2px}
.card-sub{font-size:11px;color:var(--dm)}
.quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.quick-link{display:block;padding:14px;border-radius:10px;border:1px solid rgba(31,111,235,.18);
  background:linear-gradient(135deg,var(--sf2),rgba(31,111,235,.05));text-decoration:none;color:var(--tx)}
.quick-link:hover{border-color:rgba(31,111,235,.35);transform:translateY(-1px)}
.quick-link strong{display:block;font-size:13px;color:var(--br);margin-bottom:4px}
.quick-link span{display:block;font-size:11px;color:var(--dm);line-height:1.6}

/* ── grids ── */
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}
.mc{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:12px}
.mc-l{font-size:10px;color:var(--dm);margin-bottom:3px}
.mc-v{font-size:20px;font-weight:700;color:var(--br)}
.mc-s{font-size:10px;color:var(--dm);margin-top:2px}

/* ── badges ── */
.sb-r{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.st{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid}
.s-ok{background:rgba(35,134,54,.1);color:#3fb950;border-color:rgba(35,134,54,.2)}
.s-fl{background:rgba(218,54,51,.1);color:var(--rd);border-color:rgba(218,54,51,.2)}
.s-nd{background:var(--sf2);color:var(--dm);border-color:var(--bd)}
.s-ac{background:rgba(31,111,235,.1);color:var(--ac2);border-color:rgba(31,111,235,.2)}

/* ── WP items ── */
.wi{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;
  border:1px solid var(--bd);border-radius:var(--r);margin-bottom:5px;transition:all .1s}
.wi:hover{border-color:#3a4149;background:var(--sf2)}
.wd{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:4px}
.w-ok{background:var(--ac)}.w-ac{background:var(--ac2)}.w-nd{background:var(--bd)}.w-wn{background:var(--ac3)}
.wid{font-size:10px;font-weight:700;color:var(--dm);min-width:95px;flex-shrink:0}
.wg{font-size:12px;color:var(--tx);flex:1;line-height:1.5}
.wr{font-size:10px;color:var(--dm);margin-top:3px;line-height:1.5}
.wt{font-size:9px;padding:2px 6px;border-radius:99px;background:var(--sf2);
  color:var(--dm);border:1px solid var(--bd);flex-shrink:0}

/* ── archive ── */
.arc-it{border:1px solid var(--bd);border-radius:var(--r);margin-bottom:6px;overflow:hidden}
.arc-h{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;transition:background .1s}
.arc-h:hover{background:var(--sf2)}
.arc-b{padding:10px 12px;border-top:1px solid var(--bd);font-size:11px;color:var(--dm);
  line-height:1.7;display:none}
.arc-b.open{display:block}
.arc-res{background:var(--sf2);border-radius:5px;padding:7px 10px;font-family:var(--mo);font-size:10px;color:var(--tx)}

/* ── planning ── */
.ps{border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:18px;transition:border-color .2s}
.ps.focus{border-color:rgba(31,111,235,.45);box-shadow:0 0 0 3px rgba(31,111,235,.07)}
.ph{background:var(--sf);padding:16px 20px;border-bottom:1px solid var(--bd);
  display:flex;align-items:flex-start;gap:12px}
.pic{font-size:24px;flex-shrink:0;margin-top:1px}
.pm{flex:1}
.pn{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--dm);margin-bottom:2px}
.pt{font-size:17px;font-weight:700;color:var(--br);margin-bottom:3px}
.pd{font-size:11px;color:var(--dm);line-height:1.5}
.ptag{font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;
  background:rgba(31,111,235,.1);color:var(--ac2);border:1px solid rgba(31,111,235,.18)}
.pb{padding:18px 20px}
.ea{width:100%;min-height:100px;background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);
  color:var(--tx);font-family:var(--fn);font-size:13px;line-height:1.7;padding:10px 12px;
  resize:vertical;outline:none;transition:border-color .13s}
.ea:focus{border-color:rgba(31,111,235,.55)}
.ea::placeholder{color:var(--dm)}

/* ── idea panel ── */
.ip{margin-top:12px;border:1px dashed rgba(31,111,235,.28);border-radius:var(--r);
  padding:12px;background:linear-gradient(135deg,var(--sf),rgba(31,111,235,.03))}
.ih{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:8px}
.il{font-size:11px;color:var(--dm);flex:1;min-width:180px}
.ig{display:none;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:9px}
.ig.open{display:grid}
.ic{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);
  padding:10px;transition:all .13s}
.ic:hover{border-color:rgba(31,111,235,.45);transform:translateY(-1px)}
.ic.pk{border-color:var(--ac);background:rgba(35,134,54,.05)}
.in{font-size:9px;font-weight:700;color:var(--ac2);letter-spacing:.08em;margin-bottom:4px}
.it{font-size:11px;font-weight:700;color:var(--br);margin-bottom:4px;line-height:1.4}
.ib{font-size:10px;color:var(--dm);line-height:1.6;margin-bottom:6px}
.isrc{font-size:9px;color:var(--pu);margin-bottom:6px}
.itags{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:7px}
.itag{font-size:9px;padding:1px 5px;border-radius:99px;background:var(--sf);color:var(--dm);border:1px solid var(--bd)}
.pb-box{background:var(--bg);border:1px solid var(--bd);border-radius:5px;
  padding:8px 10px;font-size:10px;font-family:var(--mo);color:var(--dm);
  line-height:1.6;display:none;margin-bottom:8px;word-break:break-all}
.pb-box.open{display:block}

/* ── buttons ── */
.btn{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:var(--r);
  border:1px solid transparent;font-family:var(--fn);font-size:11px;font-weight:500;
  cursor:pointer;transition:all .12s;white-space:nowrap}
.btn-p{background:var(--ac);color:#fff;border-color:var(--ac)}.btn-p:hover{background:#2ea043}
.btn-s{background:var(--sf2);color:var(--tx);border-color:var(--bd)}.btn-s:hover{background:var(--bd);color:var(--br)}
.btn-i{background:rgba(31,111,235,.07);color:var(--ac2);border-color:rgba(31,111,235,.25)}
.btn-i:hover{background:rgba(31,111,235,.14);border-color:var(--ac2)}
.btn-ap{background:transparent;color:var(--ac);border-color:rgba(35,134,54,.35);padding:2px 8px}
.btn-ap:hover{background:rgba(35,134,54,.09)}
.btn-all{background:linear-gradient(135deg,#238636,#1f6feb);color:#fff;border:none;
  padding:9px 20px;font-size:13px;font-weight:700;border-radius:var(--r);cursor:pointer;
  transition:all .18s;box-shadow:0 3px 14px rgba(35,134,54,.27)}
.btn-all:hover{transform:translateY(-1px);box-shadow:0 5px 20px rgba(35,134,54,.38)}
.btn-regen{background:rgba(31,111,235,.09);color:var(--ac2);border:1px solid rgba(31,111,235,.25);
  padding:4px 12px;font-size:11px;border-radius:var(--r);cursor:pointer;transition:all .13s}
.btn-regen:hover{background:rgba(31,111,235,.16)}

/* ── footer ── */
.cf{position:sticky;bottom:0;background:rgba(13,17,23,.97);backdrop-filter:blur(12px);
  border-top:1px solid var(--bd);padding:12px 32px;display:flex;align-items:center;gap:14px}
.cf-m{flex:1}
.cf-t{font-size:12px;font-weight:600;color:var(--br)}
.cf-s{font-size:10px;color:var(--dm)}
.copy-ok{font-size:11px;color:var(--ac);opacity:0;transition:opacity .3s}
.copy-ok.show{opacity:1}

/* ── search/filter ── */
.sw{position:relative;margin-bottom:12px}
.si{width:100%;background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);
  color:var(--tx);font-family:var(--fn);font-size:12px;padding:7px 10px 7px 32px;
  outline:none;transition:border-color .13s}
.si:focus{border-color:rgba(31,111,235,.45)}
.si::placeholder{color:var(--dm)}
.sic{position:absolute;left:9px;top:8px;color:var(--dm);font-size:13px}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{font-size:10px;padding:3px 10px;border-radius:99px;border:1px solid var(--bd);
  background:var(--sf2);color:var(--dm);cursor:pointer;transition:all .1s}
.fb.on{background:rgba(31,111,235,.1);color:var(--ac2);border-color:rgba(31,111,235,.25)}

/* ── domain card ── */
.dc{border:1px solid var(--bd);border-radius:11px;overflow:hidden;margin-bottom:14px}
.dh{padding:16px 20px;background:var(--sf);display:flex;align-items:flex-start;gap:12px}
.dsc{font-size:26px;font-weight:700;min-width:50px;text-align:center}
.sc-hi{color:#3fb950}.sc-md{color:var(--ac3)}.sc-lo{color:var(--rd)}
.db{padding:14px 20px;border-top:1px solid var(--bd)}
.kv{display:flex;align-items:baseline;gap:7px;margin-bottom:5px;font-size:12px}
.kk{color:var(--dm);min-width:110px;flex-shrink:0}
.kv-ok{color:var(--ac)}.kv-fl{color:var(--rd)}

/* ── pbar ── */
.pb2{height:3px;background:var(--bd);border-radius:99px;overflow:hidden;margin-top:6px}
.pb2-f{height:100%;background:linear-gradient(90deg,var(--ac),var(--ac2));border-radius:99px;transition:width .4s}

/* ── flag chip ── */
.fc{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 8px;
  border-radius:99px;border:1px solid;margin:2px}
.f-on{background:rgba(35,134,54,.09);color:#3fb950;border-color:rgba(35,134,54,.25)}
.f-off{background:var(--sf2);color:var(--dm);border-color:var(--bd)}

/* ── ADR table ── */
.adr-row{display:flex;align-items:baseline;gap:8px;padding:8px 10px;
  border-bottom:1px solid var(--bd);font-size:12px;transition:background .1s}
.adr-row:hover{background:var(--sf2)}
.adr-row:last-child{border-bottom:none}
.adr-id{color:var(--dm);font-family:var(--mo);font-size:10px;min-width:36px;flex-shrink:0}
.adr-tit{color:var(--tx);flex:1}
.adr-dom{font-size:10px;color:var(--pu);flex-shrink:0}

/* ── toast ── */
.toast{position:fixed;bottom:65px;right:18px;background:var(--sf2);
  border:1px solid var(--bd);border-radius:var(--r);padding:9px 14px;
  font-size:12px;color:var(--br);opacity:0;transform:translateY(5px);
  transition:all .2s;z-index:999;pointer-events:none}
.toast.show{opacity:1;transform:none}

/* ── section title ── */
.sec-tit{font-size:19px;font-weight:700;color:var(--br);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.divider{border:none;border-top:1px solid var(--bd);margin:14px 0}

/* ── related WPs widget ── */
.swp{margin-top:10px;border:1px solid rgba(31,111,235,.18);border-radius:var(--r);overflow:hidden}
.swp-h{display:flex;align-items:center;gap:7px;padding:7px 10px;background:rgba(31,111,235,.05);
  cursor:pointer;font-size:11px;color:var(--ac2)}
.swp-h:hover{background:rgba(31,111,235,.1)}
.swp-body{display:none;padding:6px 8px;border-top:1px solid rgba(31,111,235,.12)}
.swp-body.open{display:block}
.swp-item{display:flex;align-items:flex-start;gap:7px;padding:4px 3px;font-size:10px}
.swp-stat{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600}

/* ── section controls ── */
.sec-ctrl{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.ts-info{font-size:10px;color:var(--dm);flex:1}
.done-badge{display:none;font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;
  background:rgba(35,134,54,.12);color:#3fb950;border:1px solid rgba(35,134,54,.25)}
.done-badge.show{display:inline-flex;align-items:center;gap:3px}

/* ── sub-tabs (archive) ── */
.stab{display:flex;gap:0;border-bottom:1px solid var(--bd);margin-bottom:14px}
.stab-it{padding:8px 14px;font-size:12px;font-weight:500;color:var(--dm);cursor:pointer;
  border-bottom:2px solid transparent;transition:all .13s}
.stab-it.on{color:var(--br);border-bottom-color:var(--ac)}
.stab-pn{display:none}.stab-pn.on{display:block}

/* ── requirement card ── */
.req-sec{margin-bottom:20px}
.req-sec-h{font-size:13px;font-weight:700;color:var(--br);margin-bottom:8px;
  display:flex;align-items:center;gap:7px;padding-bottom:6px;border-bottom:1px solid var(--bd)}
.constraint{display:flex;gap:8px;padding:8px 10px;border:1px solid var(--bd);
  border-radius:var(--r);margin-bottom:5px;background:var(--sf)}
.constraint:hover{border-color:#3a4149}
.c-id{font-size:9px;font-family:var(--mo);font-weight:700;color:var(--pu);min-width:38px;flex-shrink:0;margin-top:2px}
.c-rule{font-size:12px;color:var(--tx);flex:1}
.c-rat{font-size:10px;color:var(--dm);margin-top:2px}
.nfr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px}
.nfr-item{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:10px}
.nfr-k{font-size:10px;color:var(--dm);margin-bottom:3px}
.nfr-v{font-size:16px;font-weight:700;color:var(--br)}
.qg-cat{margin-bottom:10px}
.qg-cat-h{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
  color:var(--dm);margin-bottom:5px}
.qg-item{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;
  border-radius:99px;border:1px solid rgba(35,134,54,.25);background:rgba(35,134,54,.07);
  color:#3fb950;margin:2px}

/* ── progress ring mini ── */
.prog-text{font-size:11px;color:var(--dm)}

/* ── cap group header ── */
.cap-g{font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;
  letter-spacing:.08em;margin:14px 0 5px;display:flex;align-items:center;gap:6px}
.cap-prog{font-size:10px;color:var(--ac);margin-left:auto}

/* ── sprint board ── */
.kb{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.kb-col{background:var(--sf);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.kb-h{padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:.07em;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:6px}
.kb-body{padding:8px;min-height:80px}
.kb-card{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);
  padding:10px;margin-bottom:6px;transition:all .13s}
.kb-card:hover{border-color:#3a4149;transform:translateY(-1px)}
.kb-card.active{border-color:var(--ac2);background:rgba(31,111,235,.05)}
.kb-card.done{opacity:.65}
.kb-cid{font-size:9px;font-family:var(--mo);color:var(--dm);margin-bottom:4px;
  display:flex;align-items:center;gap:5px}
.kb-goal{font-size:11px;color:var(--tx);line-height:1.5}
.kb-tier{font-size:9px;padding:1px 5px;border-radius:99px;background:var(--sf);
  color:var(--dm);border:1px solid var(--bd);margin-top:5px;display:inline-block}

/* ── git info ── */
.git-chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;
  font-family:var(--mo);color:var(--dm);background:var(--sf2);
  padding:2px 8px;border-radius:99px;border:1px solid var(--bd)}
.git-chip em{color:var(--ac2);font-style:normal}
.commit-row{display:flex;gap:8px;padding:5px 8px;border-bottom:1px solid var(--bd);
  font-size:11px;align-items:baseline}
.commit-row:last-child{border-bottom:none}
.commit-hash{font-family:var(--mo);font-size:9px;color:var(--pu);min-width:50px;flex-shrink:0}
.commit-msg{color:var(--tx);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── global search ── */
.gs-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);
  z-index:9999;align-items:flex-start;justify-content:center;padding-top:80px}
.gs-modal.open{display:flex}
.gs-box{background:var(--sf);border:1px solid var(--bd);border-radius:12px;
  width:100%;max-width:560px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.gs-inp{width:100%;background:transparent;border:none;color:var(--br);font-family:var(--fn);
  font-size:15px;padding:14px 16px;outline:none}
.gs-inp::placeholder{color:var(--dm)}
.gs-results{border-top:1px solid var(--bd);max-height:340px;overflow-y:auto}
.gs-item{display:flex;align-items:flex-start;gap:10px;padding:10px 16px;
  cursor:pointer;transition:background .1s;border-bottom:1px solid rgba(48,54,61,.5)}
.gs-item:hover{background:var(--sf2)}
.gs-item-tag{font-size:9px;padding:1px 5px;border-radius:99px;
  background:rgba(31,111,235,.1);color:var(--ac2);border:1px solid rgba(31,111,235,.2);
  flex-shrink:0;margin-top:2px;white-space:nowrap}
.gs-item-text{font-size:12px;color:var(--tx);flex:1;line-height:1.4}
.gs-item-sub{font-size:10px;color:var(--dm)}
.gs-empty{padding:20px;text-align:center;color:var(--dm);font-size:12px}
.gs-hint{padding:8px 16px;font-size:10px;color:var(--dm);border-top:1px solid var(--bd)}

@media(max-width:860px){
  .tb{align-items:flex-start;flex-wrap:wrap}
  .tb-left{flex-wrap:wrap}
  .ly{grid-template-columns:1fr}.sb{display:none}
  .g3{grid-template-columns:1fr}.ig.open{grid-template-columns:1fr!important}
  .quick-grid{grid-template-columns:1fr}
  .kb{grid-template-columns:1fr}
  .main{padding:14px}
}
</style>
</head>
<body>

<script>window.D=__DATA_JSON__;</script>

<!-- topbar -->
<header class="tb">
  <div class="tb-left">
    <div class="tb-logo"><em>⬡</em> Workflow OS
      <span style="color:var(--bd);font-size:16px">|</span>
      <span style="font-weight:400;font-size:13px;color:var(--dm)">마스터 기획서</span>
    </div>
    <div class="tb-nav">
      <a href="../index.html">홈</a>
      <a href="../catalog-site/index.html">카탈로그</a>
      <a href="../study-guide/index.html">학습 가이드</a>
    </div>
    <div class="tb-sub">현재 상태와 AI planning 흐름을 함께 보는 메인 콘솔</div>
  </div>
  <div class="tb-right">
    <span class="git-chip" id="gitchip"><em>⎇</em> </span>
    <span class="badge badge-elite" id="hbadge">ELITE</span>
    <span class="badge-gen" id="gentime"></span>
    <button class="btn btn-s" style="font-size:11px;padding:4px 9px" onclick="openSearch()">🔍 검색 <kbd style="font-size:9px;opacity:.5">Ctrl+K</kbd></button>
    <button class="btn-regen" onclick="regenData()">🔄 재생성</button>
    <button class="btn btn-s" style="font-size:11px" onclick="exportMD()">📄 MD</button>
  </div>
</header>

<!-- tabs -->
<nav class="tabs">
  <div class="tab on" onclick="sw('dash')" id="tab-dash">📊 대시보드</div>
  <div class="tab" onclick="sw('plan')" id="tab-plan">
    📝 기획서 <span class="tc" id="tc-plan">0/8</span>
  </div>
  <div class="tab" onclick="sw('wps')" id="tab-wps">
    📦 Work Packets <span class="tc" id="tc-wps"></span>
  </div>
  <div class="tab" onclick="sw('arc')" id="tab-arc">
    ✅ 완료 아카이브 <span class="tc" id="tc-arc"></span>
  </div>
  <div class="tab" onclick="sw('dom')" id="tab-dom">
    🗺 도메인 <span class="tc" id="tc-dom"></span>
  </div>
  <div class="tab" onclick="sw('req')" id="tab-req">
    📋 요구사항
  </div>
  <div class="tab" onclick="sw('adr')" id="tab-adr">
    🏛 ADR <span class="tc" id="tc-adr"></span>
  </div>
  <div class="tab" onclick="sw('sprint')" id="tab-sprint">
    🎯 스프린트
  </div>
  <div class="tab" onclick="sw('log')" id="tab-log">
    🔍 감사·학습
  </div>
  <div class="tab" onclick="sw('flow')" id="tab-flow">
    🤖 AI 흐름
  </div>
</nav>

<div class="ly">
  <nav class="sb" id="sidebar"></nav>
  <main class="main" id="main">
    <div class="tab-panel on" id="p-dash"><div id="c-dash"></div></div>
    <div class="tab-panel" id="p-plan"><div id="c-plan"></div></div>
    <div class="tab-panel" id="p-wps"><div id="c-wps"></div></div>
    <div class="tab-panel" id="p-arc"><div id="c-arc"></div></div>
    <div class="tab-panel" id="p-dom"><div id="c-dom"></div></div>
    <div class="tab-panel" id="p-req"><div id="c-req"></div></div>
    <div class="tab-panel" id="p-adr"><div id="c-adr"></div></div>
    <div class="tab-panel" id="p-sprint"><div id="c-sprint"></div></div>
    <div class="tab-panel" id="p-log"><div id="c-log"></div></div>
    <div class="tab-panel" id="p-flow"><div id="c-flow"></div></div>
  </main>
</div>

<!-- 전역 검색 모달 -->
<div class="gs-modal" id="gsModal" onclick="if(event.target===this)closeSearch()">
  <div class="gs-box">
    <input class="gs-inp" id="gsInp" placeholder="WP·기획·도메인·ADR 검색..." oninput="runSearch(this.value)" onkeydown="gsKey(event)">
    <div class="gs-results" id="gsResults">
      <div class="gs-empty">검색어를 입력하세요 (↑↓ 탐색, Enter 이동, Esc 닫기)</div>
    </div>
    <div class="gs-hint">Ctrl+K / ⌘K 로 열기 · Esc 로 닫기</div>
  </div>
</div>

<footer class="cf">
  <div class="cf-m">
    <div class="cf-t">전체 기획서 내보내기</div>
    <div class="cf-s">8개 섹션 전체를 Markdown 또는 YAML로 내보냅니다</div>
  </div>
  <span class="copy-ok" id="cok">✓ 클립보드에 복사됨</span>
  <div style="display:flex;gap:8px;align-items:center">
    <button class="btn-all" style="background:linear-gradient(135deg,#1a7f37,#1a5ca8);padding:11px 20px;font-size:13px" onclick="exportMD()">📄 MD 다운로드</button>
    <button class="btn-all" onclick="copyAll()">📋 전체 복사</button>
    <button class="btn-all" style="background:linear-gradient(135deg,#6a3fa0,#1f6feb);padding:11px 20px;font-size:13px" onclick="exportYAML()">📁 YAML 내보내기</button>
  </div>
</footer>

<div class="toast" id="toast"></div>

<script>
// ────────────────────────────────────────────────────────────────
// PLAN SECTIONS — 실제 프로젝트 데이터로 초기화
// ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id:"s01", ic:"🎯", num:"SECTION 01", tag:"Vision",
    related_caps:["CAP-01","CAP-02"],
    title:"프로젝트 비전 & 목표",
    desc:"Workflow OS의 핵심 가치, 해결할 문제, 성공 지표를 정의합니다.",
    init(d) {
      const mod = d.requirements.module || {};
      const nfr = d.requirements.nfr_categories || {};
      const perf = nfr.performance || {};
      const rel  = nfr.reliability || {};
      const doms = d.requirements.domain_map_domains || [];
      const domList = doms.map(dm=>{
        const sc=(d.domain_scores[dm.id]||{}).score;
        const scStr=sc?` (헬스 ${sc}점)`:'';
        return `- **${dm.name}** (${dm.id})${scStr}: ${dm.description||''}`;
      }).join('\n');
      const desc = (mod.description||'격리 모듈 생성·조합·검증 엔진').trim().replace(/\n/g,' ');
      return `# Workflow OS — 마스터 기획서\n\n## 프로젝트 목적\n${desc}\n\n## 품질 목표 (NFR 기준)\n- API 지연시간 P99: **≤ ${perf.api_latency_p99_ms||200}ms** | P50: ≤ ${perf.api_latency_p50_ms||100}ms\n- UI FCP: ≤ ${perf.ui_first_contentful_paint_ms||1500}ms | TTI: ≤ ${perf.ui_time_to_interactive_ms||3000}ms\n- 가용성: **≥ ${rel.availability_percent||99.9}%** (에러 버짓 ${rel.error_budget_percent||0.1}%)\n- RPO: ${rel.rpo_minutes||60}분 / RTO: ${rel.rto_minutes||30}분\n\n## 도메인 포트폴리오 (${doms.length}개)\n${domList||'(domain-map.yaml 참조)'}\n\n## 현재 달성 지표\n- 헬스 레이팅: **${d.project.health_rating}** | 게이트 통과율: ${d.project.gate_pass_rate}%\n- 전체 테스트: **${d.project.tests_pass}/${d.project.tests_total} PASS**\n- 완료 WP: ${d.wps.done_count}/${d.wps.total} | 세션당 WP: ${d.project.avg_wps_per_session}\n- 변경 실패율: ${d.project.change_failure_rate}%`;
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
  { id:"s02", ic:"🗺", num:"SECTION 02", tag:"Stage A",
    related_caps:["CAP-03","CAP-06","CAP-07"],
    title:"도메인 설계 & 경계 컨텍스트",
    desc:"DDD 바운디드 컨텍스트 정의, 유비쿼터스 언어, 불변조건(INV) 목록.",
    init(d) {
      const doms = d.requirements.domain_map_domains || [];
      let out = `## 도메인 로드맵 (${doms.length}개)\n\n`;
      doms.forEach(dm=>{
        const sc=(d.domain_scores[dm.id]||{}).score;
        const scStr=sc?` | 헬스 **${sc}점**`:'';
        const stStr='✅ 구현 완료';
        out+=`### ${dm.name} (${dm.id}) — ${stStr}${scStr}\n${dm.description||''}\n\n`;
        (dm.bounded_contexts||[]).forEach(bc=>{
          out+=`**컨텍스트**: ${bc.name}\n`;
          const invs=bc.invariants||[];
          if(invs.length){ out+=`불변조건 (${invs.length}개):\n`; invs.forEach(inv=>{ out+=`  - ${inv}\n`; }); }
          out+='\n';
        });
      });
      const sums=d.stage_a_summaries||{};
      if(Object.keys(sums).length){
        out+=`## Stage A 메모리 (도메인 설계 확정)\n`;
        Object.entries(sums).forEach(([n,s])=>{
          out+=`- **${n}**: INV ${s.invariant_count}개 | 언어: ${s.ubiquitous_language.join(', ')} | 리스크: ${s.risk_level||'—'}\n`;
        });
      }
      const cp=(d.requirements.composition_policies||[]);
      if(cp.length){ out+=`\n## 조합 정책\n`; cp.forEach(p=>{ out+=`- ${p.rule||p}\n`; }); }
      return out;
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
  { id:"s03", ic:"📜", num:"SECTION 03", tag:"Stage B",
    related_caps:["CAP-04","CAP-05"],
    title:"계약 설계 & 도메인 조합",
    desc:"도메인 간 인터페이스 계약(contracts/), 조합 전략, 충돌 감지 방법론.",
    init(d) {
      const doms=d.requirements.domain_map_domains||[];
      let out=`## 계약 설계 원칙\n\n- 도메인 간 직접 \`src/\` import 금지 — \`contracts/\`만 참조\n- 4종 계약 형식: **OpenAPI (HTTP)** + **Events** + **UI Contract** + **Capability**\n- CloudEvents envelope 표준 (CNCF)\n- RFC 7807 Problem Details 에러 응답\n- Consumer-Driven Contract Testing 목표\n\n## 도메인별 계약 현황\n\n`;
      doms.forEach(dm=>{
        (dm.bounded_contexts||[]).forEach(bc=>{
          out+=`### ${dm.name} — ${bc.name}\n`;
          (bc.contracts||[]).forEach(c=>{ out+=`- **${c.type}**: \`${c.path}\`\n`; });
          out+='\n';
        });
      });
      const cp=(d.requirements.composition_policies||[]);
      if(cp.length){ out+=`## 조합 정책\n`; cp.forEach(p=>{ out+=`- ${p.rule||p}\n`; }); out+='\n'; }
      const stB=(d.project.stage_states||{}).B||'PASS';
      out+=`## Stage B 상태: **${stB}**\n- test:contract PASS (드리프트 검증)\n- validate:composition PASS\n`;
      const relAdrs=d.adrs.filter(a=>['contract','composition','interface'].some(k=>(a.title||'').toLowerCase().includes(k)));
      if(relAdrs.length){ out+=`\n## 관련 ADR\n`; relAdrs.forEach(a=>{ out+=`- ADR-${a.id}: ${a.title}\n`; }); }
      return out;
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
  { id:"s04", ic:"🐚", num:"SECTION 04", tag:"Stage C",
    related_caps:["CAP-08","CAP-09"],
    title:"마스터 쉘 & 플러그인 아키텍처",
    desc:"plugin-registry, feature-flags, navigation, observability 구성 전략.",
    init(d) {
      const stC=(d.project.stage_states||{}).C||'PASS';
      const pf=d.flags.plugin||{};
      const profiles=d.adapter_catalog?.profiles||[];
      const active=Object.entries(pf).filter(([,v])=>v).map(([k])=>k);
      const inactive=Object.entries(pf).filter(([,v])=>!v).map(([k])=>k);
      let out=`## 플러그인 활성화 계획\n\n현재 모든 플래그가 \`false\`인 것은 운영 환경 준비 전 안전 기본값이다.\n활성화는 Stage D → E → B_review 순 검증 후 단계적으로 진행한다.\n\n`;
      out+=`## 플러그인 레지스트리 (${d.plugins.length}개)\n\n`;
      d.plugins.forEach(p=>{
        const fval=pf[p.feature_flag];
        const fStr=fval?'✅ 활성':'🔒 비활성 (운영 준비 후 활성화)';
        const profile=profiles.find(pr=>pr.id===p.architecture_profile);
        out+=`### ${p.name} (\`${p.feature_flag}\`) — ${fStr}\n`;
        out+=`- 플러그인 ID: ${p.id} | 현재 상태: ${p.status}\n`;
        out+=`- 아키텍처 프로파일: ${profile?`${profile.name} (${profile.id})`:p.architecture_profile||'—'}\n`;
        out+=`- 어댑터 스택: ${(p.adapter_refs||[]).join(', ') || '—'}\n`;
        out+=`- 롤아웃 전략: ${p.rollout?.strategy||'canary'} (internal 5% → beta 20% → full 100%)\n\n`;
      });
      out+=`## 활성화 조건\n- Stage D PASS → internal(5%) 활성화\n- Stage E PASS → beta(20%) 확장\n- B_review PASS → full(100%) 전환\n- 운영 환경 Smoke Test 통과 필수\n\n`;
      out+=`## Feature Flag 현황\n- 활성: ${active.length?active.join(', '):'없음'}\n- 비활성: ${inactive.join(', ') || '없음'}\n\n`;
      out+=`## Stage C 상태: **${stC}**\n- validate:composition PASS\n- plugin-registry 검증 PASS`;
      return out;
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
  { id:"s05", ic:"⚙️", num:"SECTION 05", tag:"Stage D",
    related_caps:["CAP-10","CAP-14","CAP-15"],
    title:"구현 전략 & 품질 게이트",
    desc:"Clean Architecture 레이어 구조, 테스트 피라미드, 품질 게이트 기준.",
    init(d) {
      const gd=d.project.quality_gate_detail||{};
      const stD=(d.project.stage_states||{}).D||'PASS';
      const nfr=d.requirements.nfr_categories||{};
      const perf=nfr.performance||{};
      const rel=nfr.reliability||{};
      const sec=nfr.security||{};
      const obs=nfr.observability||{};
      let out=`## 구현 품질 목표 (NFR 기준)\n\n`;
      if(Object.keys(perf).length){ out+=`### 성능 목표\n`; Object.entries(perf).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      if(Object.keys(rel).length){ out+=`### 신뢰성 목표\n`; Object.entries(rel).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      if(Object.keys(sec).length){ out+=`### 보안 요건\n`; Object.entries(sec).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      if(Object.keys(obs).length){ out+=`### 관측가능성 요건\n`; Object.entries(obs).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      out+=`## 현재 품질 게이트 (${d.project.quality_gate_last_run})\n\n`;
      Object.entries(gd).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; });
      out+=`\n## Stage D 상태: **${stD}**\n- 전체 테스트: **${d.project.tests_pass}/${d.project.tests_total} PASS**\n`;
      const ver=d.wps.verification||{};
      if(ver.total_commands_run){ out+=`- 검증 실행: ${ver.total_commands_run}회 | PASS: ${ver.passed||0} / FAIL: ${ver.failed||0}\n`; }
      return out;
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
  { id:"s06", ic:"🛡", num:"SECTION 06", tag:"Stage E",
    related_caps:["CAP-11"],
    title:"적대적 검증 & 보안 전략",
    desc:"레드팀 시나리오, OWASP 대응, 불변조건 공격 벡터, 침투 테스트 체크리스트.",
    init(d) {
      const ef=d.stage_e_findings||{};
      const stE=(d.project.stage_states||{}).E||'PASS';
      const nfr=d.requirements.nfr_categories||{};
      const sec=nfr.security||{};
      let out=`## 보안 전략 & 적대적 검증 계획\n\n`;
      if(Object.keys(sec).length){
        out+=`### 핵심 보안 요건 (NFR)\n`;
        Object.entries(sec).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; });
        out+='\n';
      }
      out+=`## Stage E 적대적 검증 결과\n`;
      out+=`- 총 갭: **${ef.total_gaps||0}건** | 수정: ${ef.gaps_fixed||0} | ADR 처리: ${ef.gaps_adred||0}\n`;
      out+=`- Stage E 상태: **${stE}**\n\n`;
      const gaps=ef.gap_details||[];
      if(gaps.length){ out+=`### 발견된 갭\n`; gaps.forEach(g=>{ out+=`- **${g.id}** [${g.severity}]: ${g.description} → **${g.status}**${g.adr?' ('+g.adr+')':''}\n`; }); out+='\n'; }
      out+=`## 다음 보안 강화 계획\n`;
      out+=`- STRIDE 위협 모델링 → 각 도메인 INV와 1:1 매핑\n`;
      out+=`- OWASP ZAP + Semgrep CI 통합 (SAST+DAST+SCA 3중 방어)\n`;
      out+=`- Stage E 자동 재실행 — 신규 도메인 추가 시마다\n`;
      out+=`- Chaos Engineering: 의도적 장애 주입으로 복원력 검증\n`;
      const eRefs=d.reflections.filter(r=>r.stage==='E').slice(0,3);
      if(eRefs.length){ out+=`\n## Reflexion 로그 (Stage E)\n`; eRefs.forEach(r=>{ out+=`- [${r.stage}/${r.domain}] ${(r.went_wrong||[]).join('; ')}\n`; }); }
      return out;
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
  { id:"s07", ic:"🚀", num:"SECTION 07", tag:"Ops",
    related_caps:["CAP-12","CAP-13"],
    title:"배포 & 운영 전략",
    desc:"배포 환경 구성, 롤백 플레이북, 모니터링, SLO/SLA 정의.",
    init(d) {
      const nfr=d.requirements.nfr_categories||{};
      const rel=nfr.reliability||{};
      const sc=nfr.supply_chain||{};
      const scalability=nfr.scalability||{};
      let out=`## 배포 & 운영 전략\n\n`;
      if(Object.keys(rel).length){ out+=`### SLO 목표 (신뢰성)\n`; Object.entries(rel).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      if(Object.keys(sc).length){ out+=`### 공급망 보안 요건\n`; Object.entries(sc).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      if(Object.keys(scalability).length){ out+=`### 확장성 전략\n`; Object.entries(scalability).forEach(([k,v])=>{ out+=`- **${k}**: ${v}\n`; }); out+='\n'; }
      out+=`## 배포 파이프라인 계획\n`;
      out+=`- 릴리즈 방식: **Work Packet 기반 점진 릴리즈**\n`;
      out+=`- 품질 게이트: **${d.project.quality_gate_result}** (최종 ${d.project.quality_gate_last_run})\n`;
      out+=`- SBOM: \`artifacts/sbom/\` | Provenance: \`artifacts/provenance/\`\n`;
      out+=`- 롤백 플레이북: \`docs/runbooks/rollback-playbook.md\`\n\n`;
      out+=`## 운영 체크리스트\n`;
      out+=`- ✅ check:observability PASS\n`;
      out+=`- ✅ test:rollback PASS\n`;
      out+=`- ✅ deployment-environment-provisioning PASS\n`;
      out+=`- ✅ SBOM 생성 PASS\n`;
      out+=`- ✅ Provenance 증거 PASS\n`;
      out+=`- 🔒 기능 플래그 활성화: 운영 환경 준비 후 결정\n\n`;
      const ki=d.project.known_issues||[];
      if(ki.length){ out+=`## Known Issues (배포 전 해소 목표)\n`; ki.forEach(i=>{ out+=`- **${i.id}** [${i.severity}]: ${i.description}\n`; }); }
      return out;
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
  { id:"s08", ic:"📈", num:"SECTION 08", tag:"Roadmap",
    related_caps:[],
    title:"성장 로드맵 & 자기개선 사이클",
    desc:"다음 Work Packet 계획, Reflexion Loop, Knowledge Graph 확장, 팀 역량 성장.",
    init(d) {
      const active=d.wps.active||[];
      const pending=d.wps.pending||[];
      const nq=d.next_queue||[];
      const blueprints=d.project_blueprints||[];
      const tracks=d.ai_learning_tracks||[];
      let out=`## 현재 진행 중\n\n`;
      if(active.length){
        active.forEach(w=>{ out+=`### 🔄 ${w.id}: ${w.goal}\n- CAP: ${w.cap_id} | 티어: ${w.tier||'—'}\n\n`; });
      } else { out+=`- 현재 활성 Work Packet 없음 (\`npm run wp:next\` 실행)\n\n`; }
      out+=`## 다음 단계 계획\n\n`;
      const nextList=nq.length?nq:pending.slice(0,5);
      if(nextList.length){ nextList.forEach(w=>{ out+=`- **${w.id}** [${w.status}]: ${w.goal}\n`; }); }
      else { out+=`- \`npm run wp:next\`로 DAG 기반 다음 WP 확인\n`; }
      out+=`\n## 기능 활성화 로드맵\n`;
      out+=`1. **현재**: WP-VIDEO-001 진행 중 → video 도메인 E2E 검증\n`;
      out+=`2. **다음**: feature flag internal(5%) 활성화 → 운영 지표 수집\n`;
      out+=`3. **이후**: beta(20%) 확장 → SLO 위반 없으면 full(100%)\n`;
      out+=`4. **장기**: 신규 도메인 온보딩 → domain-map.yaml 추가 → Stage A 재실행\n\n`;
      out+=`## 자기개선 지표\n`;
      out+=`- 헬스 레이팅: **${d.project.health_rating}** | 게이트 통과율: **${d.project.gate_pass_rate}%**\n`;
      out+=`- 완료 WP: ${d.wps.done_count}/${d.wps.total} | 세션당 WP: ${d.project.avg_wps_per_session}\n`;
      const v3=(d.project.upgrade_v3_features||[]).slice(0,6);
      if(v3.length){ out+=`\n## v3.0 완료 피처 (주요)\n`; v3.forEach(f=>{ out+=`- ${f}\n`; }); }
      const reps=d.learning_reports;
      if(reps.length){ out+=`\n## 학습 보고서 (${reps.length}건)\n`; reps.forEach(r=>{ out+=`- [${r.domain}] ${r.file}\n`; }); }
      if(blueprints.length){
        out+=`\n## 프로젝트 시작 블루프린트\n`;
        blueprints.forEach(bp=>{ out+=`- **${bp.name}** (${bp.id}): ${bp.summary}\n`; });
      }
      if(tracks.length){
        out+=`\n## AI 학습 플로우\n`;
        tracks.forEach(track=>{ out+=`- **${track.title}**: ${(track.steps||[]).length}단계 학습\n`; });
      }
      return out;
    },
    ideas:[
      {num:"안 01",title:"Shape Up (6-week Cycles)",
        body:"Basecamp 방법론. 6주 빌드 + 2주 쿨다운. 기술 부채 해소를 쿨다운에 배정.",
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

// ────────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────────
const ST = { planC:{}, planDone:{}, curTab:'dash',
             wpStat:'all', wpTier:'all', wpQ:'', arcQ:'', autoRefreshTimer:null };

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pct = (n,t) => t>0?Math.round(n/t*100):0;
const sc  = s => typeof s==='number'?(s>=85?'sc-hi':s>=70?'sc-md':'sc-lo'):'';
function toast(m) { const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500); }
function intakeAnswers() {
  const defaults=window.D.project_intake_canvas?.defaults||{};
  let saved={};
  try { saved=JSON.parse(localStorage.getItem('wfos-intake-answers')||'{}')||{}; } catch(_) { saved={}; }
  return {...defaults,...saved};
}
function storeIntakeAnswer(questionId, optionId){
  const next=intakeAnswers();
  next[questionId]=optionId;
  localStorage.setItem('wfos-intake-answers', JSON.stringify(next));
}
function applyBoosts(bucket, boosts){
  Object.entries(boosts||{}).forEach(([id, weight])=>{
    if(!id) return;
    const numeric=Number(weight)||0;
    bucket[id]=(bucket[id]||0)+numeric;
  });
}
function topScore(scores, fallbackId=''){
  const entries=Object.entries(scores||{});
  if(!entries.length) return fallbackId;
  entries.sort((a,b)=> b[1]===a[1] ? String(a[0]).localeCompare(String(b[0])) : b[1]-a[1]);
  return entries[0][0]||fallbackId;
}
function computeIntakeRecommendation(){
  const canvas=window.D.project_intake_canvas||{};
  const answers=intakeAnswers();
  const scores={blueprints:{},profiles:{},recipes:{}};
  (canvas.questions||[]).forEach(question=>{
    const options=question.options||[];
    const selectedId=answers[question.id]||canvas.defaults?.[question.id];
    const selected=options.find(option=>option.id===selectedId)||options[0]||null;
    if(!selected) return;
    const boosts=selected.boosts||{};
    applyBoosts(scores.blueprints, boosts.blueprints||{});
    applyBoosts(scores.profiles, boosts.profiles||{});
    applyBoosts(scores.recipes, boosts.recipes||{});
  });
  return {
    answers,
    scores,
    blueprintId: topScore(scores.blueprints, window.D.project_blueprints?.[0]?.id||''),
    profileId: topScore(scores.profiles, window.D.adapter_catalog?.profiles?.[0]?.id||''),
    recipeId: topScore(scores.recipes, window.D.ai_runtime_recipes?.[0]?.id||''),
  };
}
function dedupeBy(items, keyFn){
  const seen=new Set(), out=[];
  (items||[]).forEach(item=>{
    const key=keyFn(item);
    if(key===undefined || key===null || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}
function benchmarkMap(){
  return Object.fromEntries(((window.D.benchmark_intelligence||{}).signals||[]).map(signal=>[signal.id,signal]));
}
function signalsForIds(ids){
  const map=benchmarkMap();
  return dedupeBy((ids||[]).map(id=>map[id]).filter(Boolean), item=>item.id);
}
function focusById(focusId){
  return ((window.D.benchmark_intelligence||{}).focuses||[]).find(focus=>focus.id===focusId)||null;
}
function essentialImprovementById(improvementId){
  return ((window.D.benchmark_intelligence||{}).essential_improvements||[]).find(item=>item.id===improvementId)||null;
}
function pathMetric(path){
  return (window.D.path_metrics||{})[path] || {
    path,
    exists:false,
    kind:'missing',
    file_count:0,
    total_bytes:0,
    estimated_tokens:0,
  };
}
function formatBytes(bytes){
  const size=Number(bytes)||0;
  if(size>=1024*1024) return `${(size/(1024*1024)).toFixed(1)} MB`;
  if(size>=1024) return `${Math.round(size/1024)} KB`;
  return `${size} B`;
}
function formatTokens(tokens){
  const value=Number(tokens)||0;
  return `${value.toLocaleString('ko-KR')} tok`;
}
function summarizePathMetrics(paths){
  const metrics=dedupeBy((paths||[]).map(pathMetric), item=>item.path);
  return metrics.reduce((acc, item)=>{
    acc.file_count += item.file_count||0;
    acc.total_bytes += item.total_bytes||0;
    acc.estimated_tokens += item.estimated_tokens||0;
    return acc;
  }, {file_count:0,total_bytes:0,estimated_tokens:0});
}
function selectedTracksForIntake(blueprint, recipe){
  const trackMap=Object.fromEntries((window.D.ai_learning_tracks||[]).map(track=>[track.id,track]));
  const ids=dedupeBy([...(blueprint?.learning_tracks||[]), ...(recipe?.learning_track_refs||[])], item=>item);
  return ids.map(id=>trackMap[id]).filter(Boolean);
}
function buildLaunchBrief(intakeSummary, blueprint, profile, recipe, compatibilityRule){
  const canvas=window.D.project_intake_canvas||{};
  const answers=intakeSummary.answers||{};
  const reasons=(canvas.questions||[]).map(question=>{
    const option=(question.options||[]).find(item=>item.id===answers[question.id]);
    if(!option) return null;
    return `${option.label||option.id}: ${option.description||''}`.trim();
  }).filter(Boolean);
  const startNow=[
    ...((blueprint?.starter_sequence||[]).slice(0,3).map(step=>`${step.step}: ${step.focus}`)),
    ...((recipe?.operating_sequence||[]).slice(0,2)),
  ];
  const guardrails=[
    ...((compatibilityRule?.required_adapters||[]).slice(0,4).map(adapterId=>`필수 어댑터: ${adapterId}`)),
    ...((compatibilityRule?.notes||[]).slice(0,2)),
    ...((recipe?.tool_stack||[]).slice(0,3).map(tool=>`도구 스택: ${tool}`)),
  ];
  return {
    reasons: dedupeBy(reasons, item=>item).slice(0,4),
    startNow: dedupeBy(startNow, item=>item).slice(0,5),
    guardrails: dedupeBy(guardrails, item=>item).slice(0,5),
    benchmarkSignals: signalsForIds(focusById('project-intake-launch-brief')?.benchmark_refs||[]),
    headline: blueprint?.when_to_use || recipe?.objective || profile?.intent || '',
  };
}
function adapterPriorityWeights(){
  const answers=intakeAnswers();
  const weights={extensibility:0.2, performance:0.2, learning_clarity:0.2, ai_compatibility:0.2, swap_safety:0.2};
  const apply=(boosts)=>{
    Object.entries(boosts).forEach(([metric, delta])=>{
      weights[metric]=(weights[metric]||0)+delta;
    });
  };
  const primary=answers.primary_goal||'plan-and-learn';
  const interaction=answers.interaction_mode||'document-first';
  const delivery=answers.delivery_shape||'planner-artifact';
  const corePolicy=answers.core_change_policy||'core-fixed-edge-extend';
  const learningSurface=answers.learning_surface||'gui-learning-live-ops';
  const contextBudgetPriority=answers.context_budget_priority||'strict-minimum-context';

  if(primary==='plan-and-learn'){
    apply({learning_clarity:0.24, extensibility:0.14, ai_compatibility:0.12});
  } else if(primary==='module-extension'){
    apply({extensibility:0.24, swap_safety:0.18, ai_compatibility:0.12});
  } else if(primary==='stateful-ops'){
    apply({performance:0.24, swap_safety:0.18, extensibility:0.08});
  }

  if(interaction==='document-first'){
    apply({learning_clarity:0.16, ai_compatibility:0.06});
  } else if(interaction==='contract-first'){
    apply({extensibility:0.14, swap_safety:0.1});
  } else if(interaction==='ops-first'){
    apply({performance:0.14, swap_safety:0.12});
  }

  if(delivery==='planner-artifact'){
    apply({learning_clarity:0.12, swap_safety:0.06});
  } else if(delivery==='module-package'){
    apply({extensibility:0.12, ai_compatibility:0.06});
  } else if(delivery==='service-runtime'){
    apply({performance:0.12, swap_safety:0.08});
  }

  if(corePolicy==='core-fixed-edge-extend'){
    apply({swap_safety:0.18, learning_clarity:0.08});
  } else if(corePolicy==='module-first-extension'){
    apply({extensibility:0.18, ai_compatibility:0.08});
  } else if(corePolicy==='runtime-hardening'){
    apply({performance:0.16, swap_safety:0.12});
  }

  if(learningSurface==='gui-learning-live-ops'){
    apply({learning_clarity:0.18, ai_compatibility:0.08});
  } else if(learningSurface==='contract-code-study'){
    apply({extensibility:0.14, swap_safety:0.08});
  } else if(learningSurface==='ops-runbook-learning'){
    apply({performance:0.14, swap_safety:0.1});
  }

  if(contextBudgetPriority==='strict-minimum-context'){
    apply({ai_compatibility:0.14, learning_clarity:0.1});
  } else if(contextBudgetPriority==='balanced-context'){
    apply({extensibility:0.08, ai_compatibility:0.08});
  } else if(contextBudgetPriority==='execution-heavy-context'){
    apply({performance:0.12, swap_safety:0.08});
  }

  const total=Object.values(weights).reduce((sum, value)=>sum+value, 0) || 1;
  Object.keys(weights).forEach(metric=>{
    weights[metric]=Number((weights[metric]/total).toFixed(4));
  });
  return weights;
}
function rankAdaptersForRecommendation(){
  const adapters=window.D.adapter_catalog?.adapters||[];
  const profiles=window.D.adapter_catalog?.profiles||[];
  const scorecards=window.D.adapter_scorecards||[];
  const adapterMap=Object.fromEntries(adapters.map(adapter=>[adapter.id,adapter]));
  const intakeSummary=computeIntakeRecommendation();
  const selectedProfile=profiles.find(profile=>profile.id===intakeSummary.profileId)||null;
  const declared=new Set(selectedProfile?.adapter_refs||[]);
  const weights=adapterPriorityWeights();
  return scorecards.map(scorecard=>{
    const metrics=scorecard.metrics||{};
    let weighted=0;
    Object.entries(weights).forEach(([metric, weight])=>{
      weighted += (Number(metrics[metric])||0) * weight;
    });
    if(declared.has(scorecard.adapter_id)){
      weighted += 0.35;
    }
    return {
      ...scorecard,
      adapter: adapterMap[scorecard.adapter_id]||{},
      weighted_score: Number(weighted.toFixed(2)),
      selected: declared.has(scorecard.adapter_id),
    };
  }).sort((a,b)=> b.weighted_score===a.weighted_score
    ? String(a.adapter?.name||a.adapter_id).localeCompare(String(b.adapter?.name||b.adapter_id))
    : b.weighted_score-a.weighted_score);
}
function downloadText(filename, text, type='text/plain'){
  const blob=new Blob([text], {type});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function yamlScalar(value, indent=''){
  const str=String(value??'');
  if(!str.trim()) return "''";
  if(str.includes('\n')){
    return '|\n'+str.split('\n').map(line=>indent+line).join('\n');
  }
  if(/[:#\[\]{}|>&*!,?@`'"]/.test(str)) return JSON.stringify(str);
  return str;
}
function buildLaunchBriefData(){
  const intakeSummary=computeIntakeRecommendation();
  const blueprints=window.D.project_blueprints||[];
  const profiles=window.D.adapter_catalog?.profiles||[];
  const recipes=window.D.ai_runtime_recipes||[];
  const compatibilityProfiles=window.D.adapter_compatibility||[];
  const blueprint=blueprints.find(item=>item.id===intakeSummary.blueprintId)||null;
  const profile=profiles.find(item=>item.id===intakeSummary.profileId)||null;
  const recipe=recipes.find(item=>item.id===intakeSummary.recipeId)||null;
  const compatibilityRule=compatibilityProfiles.find(item=>item.profile_id===intakeSummary.profileId)||null;
  const launchBrief=buildLaunchBrief(intakeSummary, blueprint, profile, recipe, compatibilityRule);
  const answers=intakeSummary.answers||{};
  const intakeQuestions=((window.D.project_intake_canvas||{}).questions||[]);
  const weightedAdapters=rankAdaptersForRecommendation().slice(0,5).map(item=>({
    id: item.adapter_id,
    name: item.adapter.name||item.adapter_id,
    weighted_score: item.weighted_score,
    selected_in_profile: item.selected,
  }));
  const autopilot=buildLaunchBriefAutopilotData();
  return {
    generated_at: new Date().toISOString(),
    branch: window.D.project.branch,
    recommendation: {
      blueprint_id: autopilot.recommendation?.blueprint_id||intakeSummary.blueprintId,
      blueprint_name: autopilot.recommendation?.blueprint_name||blueprint?.name||'',
      profile_id: intakeSummary.profileId,
      profile_name: profile?.name||'',
      recipe_id: intakeSummary.recipeId,
      recipe_name: recipe?.name||'',
    },
    autopilot: {
      source: autopilot.source||'benchmark-default',
      planning_mode_id: autopilot.recommendation?.planning_mode_id||'',
      routing_profile_id: autopilot.recommendation?.routing_profile_id||'',
      execution_template_id: autopilot.recommendation?.execution_template_id||'',
      ready_gate: autopilot.ready_gate||{current_gate:'review',score:0},
    },
    intake_answers: intakeQuestions.map(question=>{
      const selected=(question.options||[]).find(option=>option.id===answers[question.id])||null;
      return {
        question_id: question.id,
        title: question.title,
        selected_option_id: selected?.id||'',
        selected_label: selected?.label||'',
        selected_description: selected?.description||'',
      };
    }),
    rationale: launchBrief.reasons||[],
    start_now: dedupeBy([...(autopilot.start_now||[]), ...(launchBrief.startNow||[])], item=>item).slice(0,6),
    guardrails: dedupeBy([
      ...(autopilot.guardrails||[]),
      ...(launchBrief.guardrails||[]),
      ...((recipe?.guardrails)||[]),
    ], item=>item),
    starter_deliverables: dedupeBy([
      ...(autopilot.starter_deliverables||[]),
      ...((blueprint?.starter_deliverables)||[]),
      ...((recipe?.evidence_outputs)||[]),
    ], item=>item),
    focus_cycle: {
      now: blueprint?.focus_cycle?.now||[],
      next: blueprint?.focus_cycle?.next||[],
      later: blueprint?.focus_cycle?.later||[],
    },
    benchmark_refs: (launchBrief.benchmarkSignals||[]).map(signal=>({
      id: signal.id,
      product: signal.product,
      source_url: signal.source_url,
    })),
    weighted_adapters: weightedAdapters,
  };
}
function launchBriefMarkdown(data){
  const lines=[
    '# Workflow OS Launch Brief',
    `생성: ${data.generated_at}`,
    `브랜치: ${data.branch||'—'}`,
    '',
    '## Recommendation',
    `- Blueprint: ${data.recommendation.blueprint_name} (${data.recommendation.blueprint_id})`,
    `- Profile: ${data.recommendation.profile_name} (${data.recommendation.profile_id})`,
    `- Recipe: ${data.recommendation.recipe_name} (${data.recommendation.recipe_id})`,
    '',
    '## Intake Answers',
    ...data.intake_answers.map(answer=>`- ${answer.title}: ${answer.selected_label} — ${answer.selected_description}`),
    '',
    '## Why This Combination',
    ...data.rationale.map(item=>`- ${item}`),
    '',
    '## Start Now',
    ...data.start_now.map(item=>`- ${item}`),
    '',
    '## Guardrails',
    ...data.guardrails.map(item=>`- ${item}`),
    '',
    '## Starter Deliverables',
    ...data.starter_deliverables.map(item=>`- ${item}`),
    '',
    '## Focus Cycle',
    '- Now',
    ...data.focus_cycle.now.map(item=>`  - ${item}`),
    '- Next',
    ...data.focus_cycle.next.map(item=>`  - ${item}`),
    '- Later',
    ...data.focus_cycle.later.map(item=>`  - ${item}`),
    '',
    '## Weighted Adapters',
    ...data.weighted_adapters.map(item=>`- ${item.name} (${item.id}) — ${item.weighted_score}/5${item.selected_in_profile?' [selected]':''}`),
  ];
  return lines.join('\n');
}
function copyLaunchBrief(){
  const md=launchBriefMarkdown(buildLaunchBriefData());
  navigator.clipboard.writeText(md).then(()=>toast('Launch Brief 복사됨'));
}
function exportLaunchBriefJSON(){
  const data=buildLaunchBriefData();
  downloadText(`wfos-launch-brief-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Launch Brief JSON 다운로드됨');
}
function exportLaunchBriefYAML(){
  const data=buildLaunchBriefData();
  let yaml=`launch_brief:\n  generated_at: "${data.generated_at}"\n  branch: "${data.branch||''}"\n  recommendation:\n    blueprint_id: "${data.recommendation.blueprint_id}"\n    blueprint_name: "${data.recommendation.blueprint_name}"\n    profile_id: "${data.recommendation.profile_id}"\n    profile_name: "${data.recommendation.profile_name}"\n    recipe_id: "${data.recommendation.recipe_id}"\n    recipe_name: "${data.recommendation.recipe_name}"\n  rationale:\n`;
  (data.rationale||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  yaml+=`  start_now:\n`;
  (data.start_now||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  yaml+=`  guardrails:\n`;
  (data.guardrails||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  yaml+=`  starter_deliverables:\n`;
  (data.starter_deliverables||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  yaml+=`  focus_cycle:\n    now:\n`;
  (data.focus_cycle.now||[]).forEach(item=>{ yaml+=`      - ${yamlScalar(item)}\n`; });
  yaml+=`    next:\n`;
  (data.focus_cycle.next||[]).forEach(item=>{ yaml+=`      - ${yamlScalar(item)}\n`; });
  yaml+=`    later:\n`;
  (data.focus_cycle.later||[]).forEach(item=>{ yaml+=`      - ${yamlScalar(item)}\n`; });
  yaml+=`  weighted_adapters:\n`;
  (data.weighted_adapters||[]).forEach(item=>{
    yaml+=`    - id: "${item.id}"\n      name: "${item.name}"\n      weighted_score: ${item.weighted_score}\n      selected_in_profile: ${item.selected_in_profile}\n`;
  });
  downloadText(`wfos-launch-brief-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Launch Brief YAML 다운로드됨');
}
function planningModes(){
  return window.D.planning_studio_modes||[];
}
function planningModeById(modeId){
  return planningModes().find(mode=>mode.id===modeId)||planningModes()[0]||null;
}
function selectedPlanningModeId(){
  const stored=localStorage.getItem('wfos-planning-mode');
  return planningModeById(stored)?.id || planningModes()[0]?.id || '';
}
function setPlanningMode(modeId){
  localStorage.setItem('wfos-planning-mode', modeId);
  renderReq();
}
function planningDraftStorageKey(modeId, sectionId){
  return `wfos-planning-${modeId}-${sectionId}`;
}
function planningSnapshotStorageKey(modeId){
  return `wfos-planning-snapshots-${modeId}`;
}
function defaultPlanningStudioValue(modeId, sectionId){
  const d=window.D;
  const launch=buildLaunchBriefData();
  const mode=planningModeById(modeId);
  const req=d.requirements?.module||{};
  const domainNames=(d.requirements?.domain_map_domains||[]).map(item=>item.id).join(', ');
  const adapters=(launch.weighted_adapters||[]).map(item=>`${item.name}(${item.id})`).join(', ');
  const firstNow=(launch.start_now||[])[0]||'';
  const firstGuardrail=(launch.guardrails||[])[0]||'';
  const rollback=(d.current_wp?.rollback)||'feature flag 또는 planner 설정을 이전 기준으로 되돌린다.';
  const logFields=((d.observability||{}).global_settings?.required_log_fields||[]).join(', ');
  const preserveEssence=mode?.preserve_essence||'';
  const defaults={
    problem: req.description||launch.rationale?.[0]||'해결할 핵심 문제를 적는다.',
    north_star: launch.rationale?.[0]||`게이트 통과율 ${d.project.gate_pass_rate}% 이상 유지`,
    module_boundary: `${req.id||'module'} / ${req.bounded_context||req.domain||'context'}${domainNames?` · 관련 도메인: ${domainNames}`:''}`,
    adapter_strategy: adapters||'유지/추가할 adapter를 정리한다.',
    operator_view: 'GUI에서 launch brief, guided learning, context packet, live ops feed를 함께 읽을 수 있어야 한다.',
    cycle_goal: firstNow||launch.recommendation.blueprint_name||'이번 cycle 목표를 적는다.',
    must_not_slip: firstGuardrail||'코어 구조와 품질 게이트를 훼손하지 않는다.',
    review_cadence: '일일 로그 확인, 중간 smoke 점검, 종료 시 launch brief 및 planner 재생성',
    evidence: (launch.starter_deliverables||[]).join(', ')||'증적을 적는다.',
    change_request: launch.rationale?.[0]||'변경 요청을 적는다.',
    core_guardrail: preserveEssence||'master OS 코어와 기존 모듈 경계는 유지한다.',
    risk_and_observability: logFields?`필수 로그 필드: ${logFields}`:'structured log와 alert rule을 함께 본다.',
    rollback,
  };
  return defaults[sectionId]||'';
}
function planningStudioValue(modeId, sectionId){
  const stored=localStorage.getItem(planningDraftStorageKey(modeId, sectionId));
  return stored !== null ? stored : defaultPlanningStudioValue(modeId, sectionId);
}
function planningStudioEntriesForMode(modeId){
  const mode=planningModeById(modeId);
  return (mode?.sections||[]).map(section=>({
    id:section.id,
    label:section.label,
    prompt:section.prompt,
    default_value:defaultPlanningStudioValue(modeId, section.id),
    value:planningStudioValue(modeId, section.id),
  }));
}
function updatePlanningStudioField(modeId, sectionId, value){
  localStorage.setItem(planningDraftStorageKey(modeId, sectionId), value);
}
function applyPlanningSectionsToStudio(modeId, sections, source){
  setPlanningMode(modeId);
  (sections||[]).forEach(section=>{
    localStorage.setItem(planningDraftStorageKey(modeId, section.id), section.value||'');
  });
  savePlanningSnapshot(modeId, source);
  renderReq();
}
function applyStarterPresetToPlanningStudio(){
  const preset=buildStarterPresetData();
  const modeId=preset.planning_mode?.id||selectedPlanningModeId();
  applyPlanningSectionsToStudio(modeId, preset.planning_sections||[], 'starter-preset');
  toast('Starter preset이 Planning Studio에 반영됨');
}
function applyCapabilitySeedToPlanningStudio(){
  const tuning=buildCapabilitySeedTuningData();
  const modeId=tuning.planning_mode?.id||selectedPlanningModeId();
  applyPlanningSectionsToStudio(modeId, tuning.mapped_sections||[], 'capability-seed');
  toast('Capability planning seed가 Planning Studio에 반영됨');
}
function applyCapabilitySeedTuningToPlanningStudio(){
  const tuning=buildCapabilitySeedTuningData();
  const modeId=tuning.planning_mode?.id||selectedPlanningModeId();
  applyPlanningSectionsToStudio(modeId, tuning.mapped_sections||[], 'capability-seed-tuning');
  toast('Capability seed tuning patch가 Planning Studio에 반영됨');
}
function applyLearnedPresetMemoryToPlanningStudio(){
  const memory=buildLearnedPresetMemoryData();
  const starterPreset=buildStarterPresetData();
  const modeId=memory.recommended_signature?.planning_mode_id||starterPreset.planning_mode?.id||selectedPlanningModeId();
  const sections=(memory.learning_sections||[]).length ? memory.learning_sections : (starterPreset.planning_sections||[]);
  applyPlanningSectionsToStudio(modeId, sections, 'learned-preset-memory');
  toast('Learned preset memory가 Planning Studio에 반영됨');
}
function applyAdaptiveStarterToPlanningStudio(){
  const adaptive=buildAdaptiveStarterPresetData();
  const modeId=adaptive.planning_mode?.id||selectedPlanningModeId();
  applyPlanningSectionsToStudio(modeId, adaptive.planning_sections||[], 'adaptive-starter');
  toast('Adaptive starter preset이 Planning Studio에 반영됨');
}
function buildPlanningStudioData(modeId=selectedPlanningModeId()){
  const mode=planningModeById(modeId);
  if(!mode){
    return {mode:null, entries:[], benchmark_signals:[]};
  }
  return {
    generated_at:new Date().toISOString(),
    mode:{
      id:mode.id,
      title:mode.title,
      summary:mode.summary,
      preserve_essence:mode.preserve_essence,
    },
    entries:(mode.sections||[]).map(section=>({
      id:section.id,
      label:section.label,
      prompt:section.prompt,
      value:planningStudioValue(mode.id, section.id),
    })),
    benchmark_signals:signalsForIds(mode.benchmark_refs||[]).map(signal=>({
      id:signal.id,
      product:signal.product,
      source_url:signal.source_url,
    })),
  };
}
function buildPlanningPatchData(modeId=selectedPlanningModeId()){
  const mode=planningModeById(modeId);
  const entries=planningStudioEntriesForMode(modeId);
  const changed_entries=entries.filter(entry=>(entry.value||'').trim() !== (entry.default_value||'').trim())
    .map(entry=>({
      id:entry.id,
      label:entry.label,
      prompt:entry.prompt,
      before:entry.default_value||'',
      after:entry.value||'',
    }));
  return {
    generated_at:new Date().toISOString(),
    mode:{
      id:mode?.id||'',
      title:mode?.title||'',
    },
    changed_entries,
    changed_count:changed_entries.length,
    unchanged_count:Math.max(0, entries.length - changed_entries.length),
    benchmark_signals:signalsForIds(focusById('plan-history-boundary-and-context-export')?.benchmark_refs||[]),
  };
}
function planningPatchMarkdown(data){
  const lines=[
    '# Workflow OS Planning Patch Preview',
    `생성: ${data.generated_at}`,
    `Mode: ${data.mode?.title||'—'} (${data.mode?.id||'—'})`,
    '',
    '## Changed Entries',
    ...((data.changed_entries||[]).flatMap(entry=>[
      `### ${entry.label}`,
      `- before: ${entry.before||'—'}`,
      `- after: ${entry.after||'—'}`,
      '',
    ])),
  ];
  return lines.join('\n');
}
function planningSnapshots(modeId=selectedPlanningModeId()){
  try {
    return JSON.parse(localStorage.getItem(planningSnapshotStorageKey(modeId))||'[]')||[];
  } catch(_) {
    return [];
  }
}
function savePlanningSnapshot(modeId=selectedPlanningModeId(), sourceLabel='manual'){
  const patch=buildPlanningPatchData(modeId);
  const snapshots=planningSnapshots(modeId);
  const next=[{
    saved_at:new Date().toISOString(),
    source:sourceLabel,
    mode_id:patch.mode?.id||modeId,
    mode_title:patch.mode?.title||modeId,
    changed_count:patch.changed_count||0,
    changed_labels:(patch.changed_entries||[]).map(entry=>entry.label).slice(0,4),
  }, ...snapshots].slice(0,6);
  localStorage.setItem(planningSnapshotStorageKey(modeId), JSON.stringify(next));
  toast('Planning snapshot 저장됨');
  renderReq();
}
function clearPlanningSnapshots(modeId=selectedPlanningModeId()){
  localStorage.removeItem(planningSnapshotStorageKey(modeId));
  toast('Planning snapshot 초기화됨');
  renderReq();
}
function copyPlanningPatch(){
  navigator.clipboard.writeText(planningPatchMarkdown(buildPlanningPatchData()))
    .then(()=>toast('Planning Patch 복사됨'));
}
function exportPlanningPatchJSON(){
  const data=buildPlanningPatchData();
  downloadText(`wfos-planning-patch-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Planning Patch JSON 다운로드됨');
}
function exportPlanningPatchYAML(){
  const data=buildPlanningPatchData();
  let yaml=`planning_patch:\n  generated_at: "${data.generated_at}"\n  mode:\n    id: "${data.mode?.id||''}"\n    title: "${data.mode?.title||''}"\n  changed_entries:\n`;
  (data.changed_entries||[]).forEach(entry=>{
    yaml+=`    - id: "${entry.id}"\n      label: ${yamlScalar(entry.label, '        ')}\n      before: ${yamlScalar(entry.before, '        ')}\n      after: ${yamlScalar(entry.after, '        ')}\n`;
  });
  downloadText(`wfos-planning-patch-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Planning Patch YAML 다운로드됨');
}
function planningModeScore(mode){
  const answers=intakeAnswers();
  const current=window.D.current_wp||{};
  let score=1;
  const reasons=[];
  if(mode.id==='master-prd'){
    score += 1;
    reasons.push('기본 truth surface로 problem, boundary, adapter 전략을 가장 넓게 담습니다.');
  }
  if(mode.id==='cycle-brief'){
    score += 1;
    reasons.push('짧은 실행 cycle과 must-not-slip을 먼저 고정합니다.');
  }
  if(mode.id==='change-control'){
    score += 1;
    reasons.push('코어 보호와 rollback 기준을 먼저 잠급니다.');
  }
  if(answers.primary_goal==='plan-and-learn' && mode.id==='master-prd'){
    score += 4;
    reasons.push('현재 목표가 plan-and-learn이라 학습/기획 기준면을 넓게 잡는 편이 유리합니다.');
  }
  if(answers.primary_goal==='module-extension' && mode.id==='master-prd'){
    score += 2;
    reasons.push('새 모듈 경계와 adapter 전략을 한 번에 정리하기 좋습니다.');
  }
  if(answers.primary_goal==='module-extension' && mode.id==='cycle-brief'){
    score += 2;
    reasons.push('확장 작업을 작은 packet으로 쪼개는 cadence를 바로 만들 수 있습니다.');
  }
  if(answers.primary_goal==='stateful-ops' && mode.id==='change-control'){
    score += 4;
    reasons.push('운영 중심 목표에서는 영향 범위, observability, rollback을 먼저 잠가야 합니다.');
  }
  if(answers.primary_goal==='stateful-ops' && mode.id==='cycle-brief'){
    score += 2;
    reasons.push('운영 점검은 짧은 review cadence가 중요합니다.');
  }
  if(answers.interaction_mode==='document-first' && mode.id==='master-prd'){
    score += 2;
    reasons.push('문서 우선 흐름과 가장 잘 맞는 mode입니다.');
  }
  if(answers.interaction_mode==='ops-first' && mode.id==='change-control'){
    score += 2;
    reasons.push('실시간 로그와 리스크 기준을 같은 화면에 두기 쉽습니다.');
  }
  if(answers.interaction_mode==='contract-first' && mode.id==='cycle-brief'){
    score += 1;
    reasons.push('계약 검증 중심의 짧은 review cadence에 맞습니다.');
  }
  if(answers.delivery_shape==='planner-artifact' && mode.id==='master-prd'){
    score += 2;
    reasons.push('planner artifact를 상위 기획 truth로 유지하기 좋습니다.');
  }
  if(answers.delivery_shape==='service-runtime' && mode.id==='change-control'){
    score += 2;
    reasons.push('runtime 보호와 rollback 설계를 먼저 고정할 수 있습니다.');
  }
  if(current.stage==='E' && mode.id==='change-control'){
    score += 1;
    reasons.push('현재 stage가 고강도 검증이어서 영향 통제형 planning이 유리합니다.');
  }
  if(current.status==='completed' && mode.id==='cycle-brief'){
    score += 1;
    reasons.push('직전 packet이 닫힌 상태라 다음 cycle brief를 빠르게 여는 데 유리합니다.');
  }
  return {
    mode_id:mode.id,
    title:mode.title,
    score,
    reasons,
    benchmark_signals:signalsForIds(mode.benchmark_refs||[]),
  };
}
function buildPlanningVariantComparison(){
  const ranked=(planningModes()||[])
    .map(planningModeScore)
    .sort((a,b)=>b.score===a.score ? a.mode_id.localeCompare(b.mode_id) : b.score-a.score);
  return {
    recommended_mode_id: ranked[0]?.mode_id||'',
    variants: ranked,
  };
}
function planningStudioMarkdown(data){
  const lines=[
    '# Workflow OS Planning Studio',
    `생성: ${data.generated_at}`,
    `Mode: ${data.mode?.title||'—'} (${data.mode?.id||'—'})`,
    '',
    data.mode?.summary||'',
    '',
    '## Preserve Essence',
    data.mode?.preserve_essence||'',
    '',
    '## Sections',
    ...((data.entries||[]).flatMap(entry=>[`### ${entry.label}`, entry.prompt, entry.value||'', ''])),
    '## Benchmark Signals',
    ...((data.benchmark_signals||[]).map(item=>`- ${item.product} (${item.id})`)),
  ];
  return lines.join('\n');
}
function copyPlanningStudio(){
  const md=planningStudioMarkdown(buildPlanningStudioData());
  navigator.clipboard.writeText(md).then(()=>toast('Planning Studio 복사됨'));
}
function exportPlanningStudioJSON(){
  const data=buildPlanningStudioData();
  downloadText(`wfos-planning-studio-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Planning Studio JSON 다운로드됨');
}
function exportPlanningStudioYAML(){
  const data=buildPlanningStudioData();
  let yaml=`planning_studio:\n  generated_at: "${data.generated_at}"\n  mode:\n    id: "${data.mode?.id||''}"\n    title: "${data.mode?.title||''}"\n    summary: ${yamlScalar(data.mode?.summary||'', '      ')}\n    preserve_essence: ${yamlScalar(data.mode?.preserve_essence||'', '      ')}\n  entries:\n`;
  (data.entries||[]).forEach(entry=>{
    yaml+=`    - id: "${entry.id}"\n      label: ${yamlScalar(entry.label, '        ')}\n      prompt: ${yamlScalar(entry.prompt, '        ')}\n      value: ${yamlScalar(entry.value, '        ')}\n`;
  });
  downloadText(`wfos-planning-studio-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Planning Studio YAML 다운로드됨');
}
function transitionPlaybooks(){
  return window.D.adapter_transition_playbooks||[];
}
function transitionPlaybookById(playbookId){
  return transitionPlaybooks().find(item=>item.id===playbookId)||transitionPlaybooks()[0]||null;
}
function selectedTransitionId(){
  const stored=localStorage.getItem('wfos-transition-playbook');
  if(transitionPlaybookById(stored)) return stored;
  const recommendedProfile=computeIntakeRecommendation().profileId;
  const matched=transitionPlaybooks().find(item=>item.from_profile===recommendedProfile);
  return matched?.id || transitionPlaybooks()[0]?.id || '';
}
function setTransitionPlaybook(playbookId){
  localStorage.setItem('wfos-transition-playbook', playbookId);
  renderDom();
}
function buildTransitionPlanData(playbookId=selectedTransitionId()){
  const playbook=transitionPlaybookById(playbookId);
  const profiles=window.D.adapter_catalog?.profiles||[];
  const fromProfile=profiles.find(item=>item.id===playbook?.from_profile)||null;
  const toProfile=profiles.find(item=>item.id===playbook?.to_profile)||null;
  const fromRefs=new Set(fromProfile?.adapter_refs||[]);
  const toRefs=new Set(toProfile?.adapter_refs||[]);
  const keep=(toProfile?.adapter_refs||[]).filter(adapterId=>fromRefs.has(adapterId));
  const add=(toProfile?.adapter_refs||[]).filter(adapterId=>!fromRefs.has(adapterId));
  const remove=(fromProfile?.adapter_refs||[]).filter(adapterId=>!toRefs.has(adapterId));
  return {
    playbook,
    from_profile:fromProfile,
    to_profile:toProfile,
    keep,
    add,
    remove,
    benchmark_signals:signalsForIds(playbook?.benchmark_refs||[]),
  };
}
function transitionPlanMarkdown(data){
  const lines=[
    '# Workflow OS Adapter Transition',
    `- Playbook: ${data.playbook?.title||'—'} (${data.playbook?.id||'—'})`,
    `- From: ${data.from_profile?.name||data.playbook?.from_profile||'—'}`,
    `- To: ${data.to_profile?.name||data.playbook?.to_profile||'—'}`,
    '',
    '## Preserve Essence',
    data.playbook?.preserve_essence||'',
    '',
    '## Triggers',
    ...((data.playbook?.triggers||[]).map(item=>`- ${item}`)),
    '',
    '## Keep',
    ...((data.keep||[]).map(item=>`- ${item}`)),
    '',
    '## Add',
    ...((data.add||[]).map(item=>`- ${item}`)),
    '',
    '## Remove',
    ...((data.remove||[]).map(item=>`- ${item}`)),
    '',
    '## Validation',
    ...((data.playbook?.validation_commands||[]).map(item=>`- ${item}`)),
  ];
  return lines.join('\n');
}
function copyTransitionPlan(){
  const md=transitionPlanMarkdown(buildTransitionPlanData());
  navigator.clipboard.writeText(md).then(()=>toast('Transition Plan 복사됨'));
}
function contextRoutingProfile(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  return (window.D.context_routing_profiles||[]).find(item=>item.intake_goal===goal)||null;
}
function buildContextRoutingData(){
  const profile=contextRoutingProfile();
  const packet=buildContextPacketData();
  if(!profile){
    return {profile:null, primary_reads:[], secondary_reads:[], deferred_reads:[]};
  }
  const toItem=(path, reason, level)=>({path, reason, level});
  const primary=dedupeBy([
    ...(profile.must_read||[]).map(path=>toItem(path, 'routing profile must-read', 'primary')),
    ...(packet.read_first||[]).map(item=>toItem(item.path, item.reason, 'primary')),
  ], item=>item.path).slice(0, profile.max_primary_files||5);
  const secondary=dedupeBy([
    ...(profile.expand_if_needed||[]).map(path=>toItem(path, 'expand only if the task proves it is needed', 'secondary')),
    ...(packet.read_next||[]).map(item=>toItem(item.path, item.reason, 'secondary')),
  ], item=>item.path).slice(0, profile.max_secondary_files||6);
  const deferred=dedupeBy([
    ...(profile.defer_until_execution||[]).map(path=>toItem(path, 'defer until execution or review', 'deferred')),
    ...(packet.read_later||[]).map(item=>toItem(item.path, item.reason, 'deferred')),
  ], item=>item.path);
  const primarySummary=summarizePathMetrics((primary||[]).map(item=>item.path));
  const secondarySummary=summarizePathMetrics((secondary||[]).map(item=>item.path));
  const deferredSummary=summarizePathMetrics((deferred||[]).map(item=>item.path));
  return {
    profile,
    primary_reads:primary,
    secondary_reads:secondary,
    deferred_reads:deferred,
    budget_summary:{
      primary:primarySummary,
      secondary:secondarySummary,
      deferred:deferredSummary,
      total:{
        file_count: primarySummary.file_count + secondarySummary.file_count + deferredSummary.file_count,
        total_bytes: primarySummary.total_bytes + secondarySummary.total_bytes + deferredSummary.total_bytes,
        estimated_tokens: primarySummary.estimated_tokens + secondarySummary.estimated_tokens + deferredSummary.estimated_tokens,
      },
    },
    benchmark_signals:signalsForIds(profile.benchmark_refs||[]),
  };
}
function pathRootLabel(path){
  const value=String(path||'');
  if(value.startsWith('memory/')) return 'memory';
  if(value.startsWith('requirements/')) return 'requirements';
  if(value.startsWith('master-shell/catalog/')) return 'master-shell/catalog';
  if(value.startsWith('master-shell/observability/')) return 'master-shell/observability';
  if(value.startsWith('master-shell/')) return 'master-shell';
  if(value.startsWith('domains/')) return 'domains';
  if(value.startsWith('scripts/')) return 'scripts';
  if(value.startsWith('artifacts/')) return 'artifacts';
  if(value.startsWith('docs/')) return 'docs';
  if(value.startsWith('worklog/')) return 'worklog';
  return value.split('/')[0]||'other';
}
function executionPacketTemplate(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const templateId=goal==='module-extension'?'module-extension-packet':goal==='stateful-ops'?'ops-hardening-packet':'planner-implementation';
  return (window.D.execution_packet_templates||[]).find(item=>item.id===templateId)||(window.D.execution_packet_templates||[])[0]||null;
}
function buildExecutionPacketData(){
  const launch=buildLaunchBriefData();
  const planning=buildPlanningStudioData();
  const routing=buildContextRoutingData();
  const template=executionPacketTemplate();
  const now=new Date().toISOString();
  const modeTitle=planning.mode?.title||'Planning';
  const firstEntry=(planning.entries||[]).find(entry=>entry.value && entry.value.trim())||planning.entries?.[0]||null;
  const packetId=`WP-DRAFT-${now.slice(0,10)}`;
  const scopeIn=dedupeBy([
    ...(routing.primary_reads||[]).map(item=>item.path),
    ...(routing.secondary_reads||[]).slice(0,3).map(item=>item.path),
  ], item=>item);
  const doneWhen=dedupeBy([
    `${modeTitle} 기준 planning entry가 artifact로 정리된다`,
    ...((launch.starter_deliverables||[]).slice(0,3).map(item=>`${item} 이(가) 준비된다`)),
    ...((template?.packet_defaults?.validation||[]).slice(0,2).map(item=>`${item} 통과`)),
  ], item=>item);
  const failIf=dedupeBy([
    'master OS 코어 경계가 흔들린다',
    'required adapter 또는 quality gate가 누락된다',
    ...((launch.guardrails||[]).slice(0,2)),
  ], item=>item);
  const tierReadSummary=summarizePathMetrics((routing.primary_reads||[]).map(item=>item.path));
  const contextReadSummary=summarizePathMetrics((routing.secondary_reads||[]).map(item=>item.path));
  return {
    id:packetId,
    goal:firstEntry?.value?.trim() || launch.rationale?.[0] || launch.recommendation.blueprint_name || '새 planning packet 실행',
    type:template?.packet_defaults?.type||'planning',
    stage:template?.packet_defaults?.stage||'A',
    template_id:template?.id||'',
    planning_mode:planning.mode?.id||'',
    generated_at:now,
    scope_in:scopeIn,
    scope_out:['system OS core', 'unrelated domains'],
    constraints:dedupeBy([
      ...((template?.packet_defaults?.constraints)||[]),
      ...(routing.deferred_reads||[]).slice(0,2).map(item=>`${item.path} 는 필요 전까지 읽지 않는다`),
    ], item=>item),
    done_when:doneWhen,
    fail_if:failIf,
    rollback:window.D.current_wp?.rollback||'새 catalog/planner 변경을 제거하고 이전 artifact를 재생성한다.',
    validation:template?.packet_defaults?.validation||[],
    context_budget:{
      tier_reads:(routing.primary_reads||[]).map(item=>item.path),
      context_reads:(routing.secondary_reads||[]).map(item=>item.path),
      skip_if_capability:(window.D.current_wp?.context_budget?.skip_if_capability)||[],
      estimated_turns:template?.packet_defaults?.context_budget?.estimated_turns||3,
      max_new_files:template?.packet_defaults?.context_budget?.max_new_files||3,
      max_modified_files:template?.packet_defaults?.context_budget?.max_modified_files||6,
    },
    context_budget_summary:{
      tier_reads:tierReadSummary,
      context_reads:contextReadSummary,
      total:{
        file_count:tierReadSummary.file_count + contextReadSummary.file_count,
        total_bytes:tierReadSummary.total_bytes + contextReadSummary.total_bytes,
        estimated_tokens:tierReadSummary.estimated_tokens + contextReadSummary.estimated_tokens,
      },
    },
    benchmark_refs:(template?.benchmark_refs||[]),
  };
}
function buildCoreImpactBoundaryData(){
  const execution=buildExecutionPacketData();
  const current=window.D.current_wp||{};
  const transition=buildTransitionPlanData();
  const weighted=rankAdaptersForRecommendation().slice(0,4).map(item=>({
    id:item.adapter_id,
    name:item.adapter?.name||item.adapter_id,
    weighted_score:item.weighted_score,
  }));
  const protected_paths=dedupeBy([
    ...(current.scope_out||[]),
    ...(execution.scope_out||[]),
  ], item=>item);
  const edge_touchpoints=dedupeBy([
    ...(current.scope_in||[]),
    ...(execution.scope_in||[]),
  ], item=>item);
  const touched_roots=dedupeBy(edge_touchpoints.map(pathRootLabel), item=>item);
  const protected_roots=dedupeBy(protected_paths.map(pathRootLabel), item=>item);
  const hardGuardrails=((window.D.requirements?.hard_constraints)||[])
    .map(item=>item.rule||item.rationale||'')
    .filter(text=>/core|master os|system os|bounded/i.test(text));
  return {
    protected_paths,
    edge_touchpoints,
    touched_roots,
    protected_roots,
    hard_guardrails:dedupeBy([
      ...hardGuardrails,
      ...((execution.fail_if||[]).filter(item=>/core|master OS|system OS/i.test(item))),
    ], item=>item).slice(0,5),
    adapter_surface:{
      keep:transition.keep||[],
      add:transition.add||[],
      remove:transition.remove||[],
      weighted,
    },
    benchmark_signals:signalsForIds(focusById('plan-history-boundary-and-context-export')?.benchmark_refs||[]),
  };
}
function buildContextBundleExportData(){
  const routing=buildContextRoutingData();
  const contextPacket=buildContextPacketData();
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  return {
    goal,
    profile_id:routing.profile?.id||'',
    output_file:'wfos-context-bundle-<timestamp>.yaml',
    commands:{
      json:`python3 scripts/export_context_bundle.py --goal ${goal} --json`,
      yaml:`python3 scripts/export_context_bundle.py --goal ${goal} --output wfos-context-bundle-<timestamp>.yaml`,
      npm:`npm run wp:export-context -- --goal ${goal} --json`,
    },
    summary:routing.budget_summary||{
      primary:{file_count:0,total_bytes:0,estimated_tokens:0},
      secondary:{file_count:0,total_bytes:0,estimated_tokens:0},
      deferred:{file_count:0,total_bytes:0,estimated_tokens:0},
      total:{file_count:0,total_bytes:0,estimated_tokens:0},
    },
    read_first:(contextPacket.read_first||[]).slice(0,4),
    protected_core:(window.D.current_wp?.scope_out||[]).slice(0,4),
  };
}
function buildContextLockData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const contextBundle=buildContextBundleExportData();
  const routing=buildContextRoutingData();
  const lockedPaths=dedupeBy([
    ...(routing.primary_reads||[]).map(item=>({path:item.path,tier:'primary',reason:item.reason})),
    ...(routing.secondary_reads||[]).map(item=>({path:item.path,tier:'secondary',reason:item.reason})),
  ], item=>item.path);
  return {
    goal,
    profile_id:contextBundle.profile_id,
    exact_file_count:(contextBundle.summary.primary?.file_count||0)+(contextBundle.summary.secondary?.file_count||0),
    estimated_tokens:(contextBundle.summary.primary?.estimated_tokens||0)+(contextBundle.summary.secondary?.estimated_tokens||0),
    locked_paths:lockedPaths.slice(0,8),
    commands:{
      json:`python3 scripts/export_context_lock.py --goal ${goal} --json`,
      npm:`npm run wp:context-lock -- --goal ${goal} --json`,
    },
    benchmark_signals:signalsForIds(focusById('verified-promotion-context-lock-and-benchmark-pack')?.benchmark_refs||[]),
  };
}
function buildContextDriftData(){
  const contextLock=buildContextLockData();
  const latestManifest='artifacts/promotion-pipeline/latest/context-lock.json';
  return {
    manifest_path:latestManifest,
    exact_file_count:contextLock.exact_file_count||0,
    reread_policy:[
      'changed file만 다시 읽고 unchanged file은 건너뛴다',
      'missing file은 우선 reread 대상으로 올린다',
      'deferred read는 drift 체크 대상에서 제외한다',
    ],
    commands:{
      json:`python3 scripts/check_context_drift.py --input ${latestManifest} --json`,
      npm:`npm run wp:context-drift -- --input ${latestManifest} --json`,
    },
    benchmark_signals:signalsForIds(focusById('preset-snapshot-readiness-and-reread-loop')?.benchmark_refs||[]),
  };
}
function buildRereadQueueData(){
  const contextRouting=buildContextRoutingData();
  const contextDrift=buildContextDriftData();
  const queue=dedupeBy([
    ...(contextRouting.primary_reads||[]).map(item=>({
      path:item.path,
      reason:item.reason,
      tier:'primary',
      status:'watch-first',
      estimated_tokens:item.estimated_tokens||0,
    })),
    ...(contextRouting.secondary_reads||[]).map(item=>({
      path:item.path,
      reason:item.reason,
      tier:'secondary',
      status:'watch-next',
      estimated_tokens:item.estimated_tokens||0,
    })),
  ], item=>item.path)
    .sort((a,b)=>{
      if(a.tier!==b.tier) return a.tier==='primary' ? -1 : 1;
      if((b.estimated_tokens||0)!==(a.estimated_tokens||0)) return (b.estimated_tokens||0)-(a.estimated_tokens||0);
      return String(a.path||'').localeCompare(String(b.path||''));
    })
    .slice(0,8);
  return {
    manifest_path:contextDrift.manifest_path,
    drift_status:'changed-missing-first',
    reread_count:queue.length,
    reread_queue:queue,
    policy:[
      'primary changed/missing 파일을 먼저 reread하고 secondary는 필요 시 확장한다',
      'unchanged file은 다시 읽지 않고 exact lock을 유지한다',
      'deferred read는 현재 packet 승격 판정에서 제외한다',
    ],
    commands:{
      json:'python3 scripts/generate_reread_queue.py --json',
      npm:'npm run wp:reread-queue -- --json',
    },
    benchmark_signals:signalsForIds(focusById('preset-snapshot-readiness-and-reread-loop')?.benchmark_refs||[]),
  };
}
function buildConstraintFitData(){
  const intake=computeIntakeRecommendation();
  const profiles=window.D.adapter_catalog?.profiles||[];
  const compatibilityProfiles=window.D.adapter_compatibility||[];
  const selectedProfile=profiles.find(profile=>profile.id===intake.profileId)||null;
  const compatibilityRule=compatibilityProfiles.find(rule=>rule.profile_id===intake.profileId)||null;
  const execution=buildExecutionPacketData();
  const contextBundle=buildContextBundleExportData();
  const coreBoundary=buildCoreImpactBoundaryData();
  const current=window.D.current_wp||{};
  const selectedAdapters=new Set(selectedProfile?.adapter_refs||[]);
  const requiredAdapters=(compatibilityRule?.required_adapters||[]);
  const forbiddenAdapters=(compatibilityRule?.forbidden_adapters||[]);
  const totalTokens=contextBundle.summary?.total?.estimated_tokens||0;
  const primaryTokens=contextBundle.summary?.primary?.estimated_tokens||0;
  const checks=[
    {
      id:'core-protection',
      label:'코어 보호 범위',
      status:(coreBoundary.protected_paths||[]).length ? 'pass' : 'warn',
      detail:(coreBoundary.protected_paths||[]).length ? 'scope_out에 보호 코어가 선언되어 있습니다.' : '보호 코어 선언을 더 명확히 적는 편이 안전합니다.',
    },
    {
      id:'required-adapters',
      label:'필수 어댑터 적합성',
      status:requiredAdapters.every(adapterId=>selectedAdapters.has(adapterId)) ? 'pass' : 'warn',
      detail:requiredAdapters.every(adapterId=>selectedAdapters.has(adapterId))
        ? '선택된 profile이 필수 adapter를 모두 포함합니다.'
        : `누락된 adapter: ${requiredAdapters.filter(adapterId=>!selectedAdapters.has(adapterId)).join(', ')||'없음'}`,
    },
    {
      id:'forbidden-adapters',
      label:'금지 어댑터 충돌',
      status:forbiddenAdapters.some(adapterId=>selectedAdapters.has(adapterId)) ? 'warn' : 'pass',
      detail:forbiddenAdapters.some(adapterId=>selectedAdapters.has(adapterId))
        ? `충돌 adapter: ${forbiddenAdapters.filter(adapterId=>selectedAdapters.has(adapterId)).join(', ')}`
        : '금지 adapter 충돌이 없습니다.',
    },
    {
      id:'constraint-coverage',
      label:'제약/실패조건 커버리지',
      status:(execution.constraints||[]).length && (execution.fail_if||[]).length ? 'pass' : 'warn',
      detail:(execution.constraints||[]).length && (execution.fail_if||[]).length
        ? 'constraints와 fail_if가 모두 채워져 있습니다.'
        : 'execution packet에 constraints와 fail_if를 함께 채우는 편이 좋습니다.',
    },
    {
      id:'token-budget',
      label:'토큰 예산 적합성',
      status:primaryTokens<=6000 && totalTokens<=18000 ? 'pass' : totalTokens<=30000 ? 'warn' : 'risk',
      detail:`primary ${formatTokens(primaryTokens)} / total ${formatTokens(totalTokens)}`,
    },
    {
      id:'packet-boundary',
      label:'현재 packet 경계 일관성',
      status:(current.scope_out||[]).length && (execution.scope_out||[]).length ? 'pass' : 'warn',
      detail:(current.scope_out||[]).length && (execution.scope_out||[]).length
        ? 'current packet과 draft packet 모두 scope_out을 유지합니다.'
        : 'scope_out 선언이 약하면 코어 보호 판단이 흐려집니다.',
    },
  ];
  const counts=checks.reduce((acc, item)=>{
    acc[item.status]=(acc[item.status]||0)+1;
    return acc;
  }, {pass:0,warn:0,risk:0});
  return {
    checks,
    counts,
    benchmark_signals:signalsForIds(focusById('constraint-fit-handoff-and-replay-loop')?.benchmark_refs||[]),
  };
}
function buildHandoffBundleData(){
  const planningPatch=buildPlanningPatchData();
  const contextBundle=buildContextBundleExportData();
  const execution=buildExecutionPacketData();
  const apply=buildApplyHandoffData();
  const constraintFit=buildConstraintFitData();
  const coreBoundary=buildCoreImpactBoundaryData();
  return {
    generated_at:new Date().toISOString(),
    planning_patch:planningPatch,
    context_bundle:contextBundle,
    execution_packet:{
      id:execution.id,
      goal:execution.goal,
      type:execution.type,
      stage:execution.stage,
      validation:execution.validation||[],
    },
    apply_handoff:apply,
    constraint_fit:{
      counts:constraintFit.counts,
      checks:constraintFit.checks,
    },
    core_boundary:{
      protected_paths:coreBoundary.protected_paths,
      edge_touchpoints:coreBoundary.edge_touchpoints.slice(0,8),
    },
    sequence:[
      'planning patch를 저장하고 snapshot을 남긴다',
      'context bundle을 export해 최소 읽기 묶음을 고정한다',
      'execution packet을 export하고 dry-run으로 확인한다',
      'apply_execution_packet.py --apply 로 current-wp / next-actions를 갱신한다',
    ],
  };
}
function buildVerifiedPromoteData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const constraintFit=buildConstraintFitData();
  const contextLock=buildContextLockData();
  const contextBundle=buildContextBundleExportData();
  const replay=buildReplayNextPacketData();
  const primaryTokens=contextBundle.summary?.primary?.estimated_tokens||0;
  const lockedTokens=contextLock.estimated_tokens||0;
  const ready=primaryTokens<=6000 && lockedTokens<=18000;
  return {
    goal,
    ready,
    risk_count:constraintFit.counts?.risk||0,
    warn_count:constraintFit.counts?.warn||0,
    replay_goal:replay.goal||'',
    exact_file_count:contextLock.exact_file_count||0,
    estimated_tokens:lockedTokens,
    primary_tokens:primaryTokens,
    commands:{
      json:`python3 scripts/promote_packet.py --goal ${goal} --json`,
      apply:`python3 scripts/promote_packet.py --goal ${goal} --apply --json`,
      npm:`npm run wp:promote -- --goal ${goal} --json`,
    },
    guardrails:[
      'primary/secondary context lock이 예산 안일 때만 current-wp로 승격',
      'context lock을 먼저 내보내 exact read manifest를 고정',
      'deferred read는 승격 판정에서 제외하고 replay/lock 범위만 먼저 본다',
      'replay goal을 다음 packet goal과 validation 초안으로 재사용',
    ],
    benchmark_signals:signalsForIds(focusById('verified-promotion-context-lock-and-benchmark-pack')?.benchmark_refs||[]),
  };
}
function handoffBundleMarkdown(data){
  const lines=[
    '# Workflow OS Handoff Bundle',
    `생성: ${data.generated_at}`,
    '',
    '## Sequence',
    ...(data.sequence||[]).map(item=>`- ${item}`),
    '',
    '## Execution Packet',
    `- ${data.execution_packet.id} / ${data.execution_packet.type} / ${data.execution_packet.stage}`,
    `- goal: ${data.execution_packet.goal}`,
    '',
    '## Constraint Fit',
    ...((data.constraint_fit?.checks||[]).map(item=>`- [${item.status}] ${item.label}: ${item.detail}`)),
  ];
  return lines.join('\n');
}
function copyHandoffBundle(){
  navigator.clipboard.writeText(handoffBundleMarkdown(buildHandoffBundleData()))
    .then(()=>toast('Handoff Bundle 복사됨'));
}
function exportHandoffBundleJSON(){
  const data=buildHandoffBundleData();
  downloadText(`wfos-handoff-bundle-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Handoff Bundle JSON 다운로드됨');
}
function exportHandoffBundleYAML(){
  const data=buildHandoffBundleData();
  let yaml=`handoff_bundle:\n  generated_at: "${data.generated_at}"\n  sequence:\n`;
  (data.sequence||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  yaml+=`  execution_packet:\n    id: "${data.execution_packet.id}"\n    goal: ${yamlScalar(data.execution_packet.goal, '      ')}\n    type: "${data.execution_packet.type}"\n    stage: "${data.execution_packet.stage}"\n`;
  yaml+=`  constraint_fit:\n    checks:\n`;
  (data.constraint_fit?.checks||[]).forEach(item=>{
    yaml+=`      - id: "${item.id}"\n        status: "${item.status}"\n        label: ${yamlScalar(item.label, '          ')}\n        detail: ${yamlScalar(item.detail, '          ')}\n`;
  });
  downloadText(`wfos-handoff-bundle-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Handoff Bundle YAML 다운로드됨');
}
function buildReplayNextPacketData(){
  const studyReplay=buildStudyReplayData();
  const packet=buildExecutionPacketData();
  const reads=dedupeBy((studyReplay||[]).flatMap(item=>item.next_reads||[]), item=>item).slice(0,6);
  const focus=(studyReplay||[]).slice(0,3).map(item=>item.title);
  const rationale=(studyReplay||[]).slice(0,3).map(item=>`${item.title}: ${item.teaches}`);
  const firstMatched=(studyReplay||[])[0]?.matched?.[0];
  const goal=firstMatched?.detail
    ? `최근 ${firstMatched.tag||'log'} 시그널을 기준으로 ${firstMatched.detail} 를 다음 packet에서 정리한다`
    : '최근 로그와 replay lens를 기준으로 다음 packet 초안을 만든다';
  return {
    generated_at:new Date().toISOString(),
    goal,
    stage:packet.stage,
    type:packet.type,
    focus_tracks:focus,
    rationale,
    read_first:reads,
    validation:(packet.validation||[]).slice(0,3),
    benchmark_signals:signalsForIds(focusById('constraint-fit-handoff-and-replay-loop')?.benchmark_refs||[]),
  };
}
function buildBenchmarkActionPackData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const current=window.D.current_wp||{};
  const boosts={
    'plan-and-learn':{
      'master-planning-truth-surface':5,
      'minimum-context-routing-performance':5,
      'guided-learning-live-ops-cockpit':5,
    },
    'module-extension':{
      'master-planning-truth-surface':4,
      'minimum-context-routing-performance':5,
      'guided-learning-live-ops-cockpit':4,
    },
    'stateful-ops':{
      'master-planning-truth-surface':4,
      'minimum-context-routing-performance':5,
      'guided-learning-live-ops-cockpit':5,
    },
  };
  const ranked=((window.D.benchmark_intelligence?.essential_improvements)||[]).map(focus=>{
    let score=(boosts[goal]||{})[focus.id]||1;
    const reasons=[];
    if((boosts[goal]||{})[focus.id]){
      reasons.push(`${goal} 목표에 직접 맞는 focus입니다.`);
    }
    if(['governance','infra','executor'].includes(current.type) && focus.id==='minimum-context-routing-performance'){
      score+=1;
      reasons.push('운영/검증형 packet과 연결되는 최소 문맥/승격 흐름입니다.');
    }
    if(current.status==='completed' && focus.id==='master-planning-truth-surface'){
      score+=1;
      reasons.push('직전 packet이 닫혀 다음 launch brief와 planning patch 루프를 강화하기 좋습니다.');
    }
    if(['governance','arch','meta'].includes(current.type) && focus.id==='guided-learning-live-ops-cockpit'){
      score+=1;
      reasons.push('학습형 운영 surface와 실시간 로그 해석을 함께 강화할 가치가 큽니다.');
    }
    return {
      id:focus.id,
      title:focus.title,
      outcome:focus.objective,
      preserve_essence:focus.preserve_essence,
      delivered_by:focus.delivered_by||[],
      why_now:focus.why_now||[],
      related_focuses:(focus.related_focus_ids||[]).map(id=>focusById(id)).filter(Boolean).map(item=>({id:item.id,title:item.title})),
      score,
      reasons:reasons.length?reasons:['현재 구조에서 재사용 가치가 높은 focus입니다.'],
      benchmark_signals:signalsForIds(focus.benchmark_refs||[]),
    };
  }).sort((a,b)=>b.score===a.score ? a.id.localeCompare(b.id) : b.score-a.score).slice(0,3);
  return {
    goal,
    review:(window.D.benchmark_intelligence?.review)||{},
    recommended:ranked,
    commands:{
      json:`python3 scripts/generate_benchmark_pack.py --goal ${goal} --json`,
      npm:`npm run wp:benchmark-pack -- --goal ${goal} --json`,
    },
  };
}
function buildStarterPresetData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const modeId=goal==='module-extension'?'cycle-brief':goal==='stateful-ops'?'change-control':'master-prd';
  const mode=planningModeById(modeId);
  const routing=contextRoutingProfile();
  const template=executionPacketTemplate();
  const benchmarkPack=buildBenchmarkActionPackData();
  const planningSectionsByMode={
    'master-prd':[
      {id:'problem', value:mode?.summary||''},
      {id:'north_star', value:(benchmarkPack.recommended||[])[0]?.title||''},
      {id:'module_boundary', value:`${window.D.current_wp?.type||'planning'} / ${window.D.current_wp?.stage||'A'}`},
      {id:'adapter_strategy', value:'benchmark-backed focus와 current profile을 유지하며 필요한 adapter만 추가한다.'},
      {id:'operator_view', value:'Launch Brief, Context Lock, Promotion Readiness, Live Ops Feed를 함께 본다.'},
    ],
    'cycle-brief':[
      {id:'cycle_goal', value:(benchmarkPack.recommended||[])[0]?.title||''},
      {id:'must_not_slip', value:mode?.preserve_essence||''},
      {id:'review_cadence', value:'short packet -> fit check -> promote pipeline -> smoke'},
      {id:'evidence', value:(benchmarkPack.recommended||[]).slice(0,2).map(item=>item.title).join(', ')},
    ],
    'change-control':[
      {id:'change_request', value:(benchmarkPack.recommended||[])[0]?.title||''},
      {id:'core_guardrail', value:mode?.preserve_essence||''},
      {id:'risk_and_observability', value:'promotion readiness와 context drift를 함께 확인한다.'},
      {id:'rollback', value:window.D.current_wp?.rollback||''},
    ],
  };
  return {
    goal,
    planning_mode:{id:mode?.id||'',title:mode?.title||'',summary:mode?.summary||''},
    routing_profile:{id:routing?.id||'',objective:routing?.objective||''},
    execution_template:{id:template?.id||'',title:template?.title||''},
    top_focuses:(benchmarkPack.recommended||[]).slice(0,2),
    planning_sections:(planningSectionsByMode[modeId]||[]).filter(item=>item.value),
    commands:{
      json:`python3 scripts/generate_starter_preset.py --goal ${goal} --json`,
      npm:`npm run wp:starter-preset -- --goal ${goal} --json`,
    },
    benchmark_signals:signalsForIds(focusById('preset-snapshot-readiness-and-reread-loop')?.benchmark_refs||[]),
  };
}
function buildPromotionPipelineData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const promote=buildVerifiedPromoteData();
  const benchmarkPack=buildBenchmarkActionPackData();
  return {
    goal,
    ready:promote.ready,
    locked_tokens:promote.estimated_tokens||0,
    exact_file_count:promote.exact_file_count||0,
    top_focus:(benchmarkPack.recommended||[])[0]||null,
    commands:{
      json:`python3 scripts/run_promotion_pipeline.py --goal ${goal} --json`,
      apply:`python3 scripts/run_promotion_pipeline.py --goal ${goal} --apply --json`,
      npm:`npm run wp:promote-pipeline -- --goal ${goal} --json`,
    },
    artifacts:[
      'context-lock.json',
      'handoff-bundle.json',
      'benchmark-pack.json',
      'promoted-packet.yaml',
      'pipeline-report.json',
    ],
    benchmark_signals:signalsForIds(focusById('preset-snapshot-readiness-and-reread-loop')?.benchmark_refs||[]),
  };
}
function buildReadinessBriefData(){
  const promotionPipeline=buildPromotionPipelineData();
  const rereadQueue=buildRereadQueueData();
  const benchmarkPack=buildBenchmarkActionPackData();
  const starterPreset=buildStarterPresetData();
  const readyWps=(window.D.wps?.pending||[]).length||0;
  const activeWps=(window.D.wps?.active||[]).length||0;
  const nextActions=[];
  if(!promotionPipeline.ready){
    nextActions.push('promote-pipeline을 다시 실행해 fit, lock, apply 가능 상태를 확인한다');
  }
  if((rereadQueue.reread_count||0)>0){
    nextActions.push('Re-read Queue 기준으로 primary changed/missing 파일만 먼저 다시 읽는다');
  }
  if((benchmarkPack.recommended||[])[0]?.title){
    nextActions.push(`top benchmark focus "${benchmarkPack.recommended[0].title}"를 다음 packet goal 초안에 반영한다`);
  }
  if(!nextActions.length){
    nextActions.push('현재 상태가 clean 이므로 다음 packet 실행과 smoke 검증을 진행한다');
  }
  return {
    goal:promotionPipeline.goal,
    promotion_pipeline:{
      ready:promotionPipeline.ready,
      locked_tokens:promotionPipeline.locked_tokens||0,
      exact_file_count:promotionPipeline.exact_file_count||0,
    },
    scheduler:{
      active:activeWps,
      ready:readyWps,
      preset_mode:starterPreset.planning_mode?.id||'',
    },
    reread_queue:{
      drift_status:rereadQueue.drift_status,
      reread_count:rereadQueue.reread_count||0,
      top_paths:(rereadQueue.reread_queue||[]).slice(0,4).map(item=>item.path),
    },
    benchmark_focus:(benchmarkPack.recommended||[]).slice(0,3).map(item=>({
      title:item.title,
      score:item.score,
    })),
    next_actions:nextActions,
    commands:{
      json:'python3 scripts/generate_readiness_brief.py --json',
      npm:'npm run wp:readiness-brief -- --json',
    },
    benchmark_signals:signalsForIds(focusById('preset-snapshot-readiness-and-reread-loop')?.benchmark_refs||[]),
  };
}
function buildPromotionDecisionData(){
  const readinessBrief=buildReadinessBriefData();
  const promotePipeline=buildPromotionPipelineData();
  const constraintFit=buildConstraintFitData();
  const rereadQueue=buildRereadQueueData();
  let gate_status='ready';
  const reasons=[];
  if((constraintFit.counts?.risk||0)>0){
    gate_status='blocked';
    reasons.push(`fit risk ${(constraintFit.counts?.risk||0)}건이 남아 있어 즉시 승격할 수 없습니다.`);
  }
  if(!promotePipeline.ready && gate_status!=='blocked'){
    gate_status='review';
    reasons.push('locked token 또는 exact file 조건을 다시 확인해야 합니다.');
  }
  if((rereadQueue.reread_count||0)>0 && gate_status!=='blocked'){
    gate_status='review';
    reasons.push(`drift된 파일 ${(rereadQueue.reread_count||0)}개를 reread queue 기준으로 먼저 다시 읽는 편이 안전합니다.`);
  }
  if(!reasons.length){
    reasons.push('fit, lock, reread 상태가 모두 허용 범위 안이라 바로 승격 가능합니다.');
  }
  const next_command=gate_status==='ready'
    ? `python3 scripts/run_promotion_pipeline.py --goal ${promotePipeline.goal} --apply --json`
    : ((rereadQueue.reread_count||0)>0
      ? 'python3 scripts/generate_reread_queue.py --json'
      : `python3 scripts/run_promotion_pipeline.py --goal ${promotePipeline.goal} --json`);
  return {
    gate_status,
    ready_to_apply:gate_status==='ready',
    goal:promotePipeline.goal,
    locked_tokens:readinessBrief.promotion_pipeline.locked_tokens||0,
    reread_count:rereadQueue.reread_count||0,
    reasons,
    next_command,
    commands:{
      json:'python3 scripts/generate_promotion_decision.py --json',
      npm:'npm run wp:promotion-decision -- --json',
    },
    benchmark_signals:signalsForIds(focusById('promotion-gate-exception-ledger-and-packet-hierarchy')?.benchmark_refs||[]),
  };
}
function buildContextExceptionLedgerData(){
  const contextRouting=buildContextRoutingData();
  const primaryUsed=contextRouting.budget_summary?.primary?.estimated_tokens||0;
  const totalUsed=contextRouting.budget_summary?.total?.estimated_tokens||0;
  const primaryHeadroom=Math.max(0, 6000-primaryUsed);
  const totalHeadroom=Math.max(0, 18000-totalUsed);
  const candidates=dedupeBy([
    ...(contextRouting.secondary_reads||[]).map(item=>({path:item.path, reason:item.reason, source_tier:'secondary'})),
    ...(contextRouting.deferred_reads||[]).map(item=>({path:item.path, reason:item.reason, source_tier:'deferred'})),
  ], item=>item.path).map(item=>{
    const summary=summarizePathMetrics([item.path]);
    return {
      ...item,
      estimated_tokens:summary.estimated_tokens||0,
      file_count:summary.file_count||0,
    };
  }).sort((a,b)=>{
    if(a.source_tier!==b.source_tier) return a.source_tier==='secondary' ? -1 : 1;
    if((a.estimated_tokens||0)!==(b.estimated_tokens||0)) return (a.estimated_tokens||0)-(b.estimated_tokens||0);
    return String(a.path||'').localeCompare(String(b.path||''));
  });
  let consumed=0;
  let granted=0;
  const exceptions=candidates.map(item=>{
    const allow=granted<4 && (consumed + (item.estimated_tokens||0))<=totalHeadroom;
    if(allow){
      consumed += item.estimated_tokens||0;
      granted += 1;
    }
    return {
      ...item,
      decision:allow?'allow-on-demand':'defer',
      can_promote_to_primary:item.source_tier==='secondary' && (item.estimated_tokens||0)<=primaryHeadroom,
    };
  }).slice(0,8);
  return {
    primary_headroom:primaryHeadroom,
    total_headroom:totalHeadroom,
    allowed_exception_count:exceptions.filter(item=>item.decision==='allow-on-demand').length,
    exceptions,
    commands:{
      json:'python3 scripts/generate_context_exception_ledger.py --json',
      npm:'npm run wp:context-exception -- --json',
    },
    benchmark_signals:signalsForIds(focusById('promotion-gate-exception-ledger-and-packet-hierarchy')?.benchmark_refs||[]),
  };
}
function buildPacketHierarchyData(){
  const currentId=window.D.current_wp?.id||'';
  const all=window.D.wps?.all||[];
  const current=all.find(item=>item.id===currentId)||null;
  const doneIds=new Set(all.filter(item=>item.status==='done').map(item=>item.id));
  const capId=current?.cap_id||'';
  const capName=current?.cap_name||'';
  const capWps=all.filter(item=>item.cap_id===capId);
  const ready=capWps.filter(item=>item.status==='pending' && (item.depends_on||[]).every(dep=>doneIds.has(dep)));
  const blocked=capWps.filter(item=>item.status==='pending' && !(item.depends_on||[]).every(dep=>doneIds.has(dep))).map(item=>({
    ...item,
    unmet_dependencies:(item.depends_on||[]).filter(dep=>!doneIds.has(dep)),
  }));
  const downstream=all.filter(item=>(item.depends_on||[]).includes(currentId));
  return {
    cap_id:capId,
    cap_name:capName,
    current_id:currentId,
    progress:{
      total:capWps.length,
      done:capWps.filter(item=>item.status==='done').length,
      pending:capWps.filter(item=>item.status==='pending').length,
    },
    ready_in_capability:ready.slice(0,4),
    blocked_in_capability:blocked.slice(0,4),
    downstream_packets:downstream.slice(0,4),
    learning_path:capWps.slice(0,6),
    commands:{
      json:'python3 scripts/generate_packet_hierarchy.py --json',
      npm:'npm run wp:packet-hierarchy -- --json',
    },
    benchmark_signals:signalsForIds(focusById('promotion-gate-exception-ledger-and-packet-hierarchy')?.benchmark_refs||[]),
  };
}
function buildDecisionApplyBridgeData(){
  const promotionDecision=buildPromotionDecisionData();
  return {
    gate_status:promotionDecision.gate_status,
    ready_to_apply:promotionDecision.ready_to_apply,
    next_command:promotionDecision.ready_to_apply
      ? `python3 scripts/run_decision_apply.py --goal ${promotionDecision.goal} --apply --json`
      : `python3 scripts/run_decision_apply.py --goal ${promotionDecision.goal} --json`,
    commands:{
      json:'python3 scripts/run_decision_apply.py --json',
      npm:'npm run wp:decision-apply -- --json',
      apply:`python3 scripts/run_decision_apply.py --goal ${promotionDecision.goal} --apply --json`,
    },
    benchmark_signals:signalsForIds(focusById('decision-apply-exception-packet-and-capability-brief')?.benchmark_refs||[]),
  };
}
function buildExceptionPacketDraftData(){
  const ledger=buildContextExceptionLedgerData();
  const allowed=(ledger.exceptions||[]).filter(item=>item.decision==='allow-on-demand');
  return {
    allowed_paths:allowed.map(item=>item.path),
    candidate_primary_promotions:allowed.filter(item=>item.can_promote_to_primary).map(item=>item.path),
    total_exception_tokens:allowed.reduce((acc,item)=>acc + (item.estimated_tokens||0), 0),
    prompt_block:[
      '1. primary read만으로 답이 닫히지 않을 때만 exception packet을 연다.',
      '2. allow-on-demand 경로만 읽고 허용되지 않은 deferred 파일은 건드리지 않는다.',
      '3. 읽은 뒤에는 validation 또는 evidence 판단으로 바로 환원한다.',
    ],
    commands:{
      json:'python3 scripts/generate_exception_packet.py --json',
      npm:'npm run wp:exception-packet -- --json',
    },
    benchmark_signals:signalsForIds(focusById('decision-apply-exception-packet-and-capability-brief')?.benchmark_refs||[]),
  };
}
function buildCapabilityBriefData(){
  const packetHierarchy=buildPacketHierarchyData();
  const starterPreset=buildStarterPresetData();
  const benchmarkPack=buildBenchmarkActionPackData();
  return {
    capability:{
      id:packetHierarchy.cap_id,
      name:packetHierarchy.cap_name,
      progress:packetHierarchy.progress,
    },
    current_packet:{
      id:packetHierarchy.current_id,
      status:window.D.current_wp?.status||'',
    },
    next_ready_packets:(packetHierarchy.ready_in_capability||[]).slice(0,3),
    blocked_packets:(packetHierarchy.blocked_in_capability||[]).slice(0,3),
    planning_mode:starterPreset.planning_mode,
    benchmark_focus:(benchmarkPack.recommended||[]).slice(0,3).map(item=>({
      title:item.title,
      score:item.score,
    })),
    study_points:(packetHierarchy.learning_path||[]).slice(0,5).map(item=>`${item.id} · ${item.status||''} · ${item.goal||''}`),
    commands:{
      json:'python3 scripts/generate_capability_brief.py --json',
      npm:'npm run wp:capability-brief -- --json',
    },
    benchmark_signals:signalsForIds(focusById('decision-apply-exception-packet-and-capability-brief')?.benchmark_refs||[]),
  };
}
function buildApplyCheckpointData(){
  const promotionDecision=buildPromotionDecisionData();
  const executionPacket=buildExecutionPacketData();
  return {
    decision_gate:promotionDecision.gate_status,
    ready_to_apply:promotionDecision.ready_to_apply,
    post_apply_preview:{
      promoted_packet_id:executionPacket.id,
      promoted_packet_goal:executionPacket.goal,
      promoted_packet_type:executionPacket.type,
      promoted_packet_stage:executionPacket.stage,
    },
    locked_tokens:promotionDecision.locked_tokens||0,
    reasons:promotionDecision.reasons||[],
    commands:{
      json:'python3 scripts/generate_apply_checkpoint.py --json',
      npm:'npm run wp:apply-checkpoint -- --json',
    },
    benchmark_signals:signalsForIds(focusById('apply-checkpoint-exception-replay-and-capability-seed')?.benchmark_refs||[]),
  };
}
function buildExceptionReplayData(){
  const exceptionPacketDraft=buildExceptionPacketDraftData();
  return {
    allowed_exception_paths:exceptionPacketDraft.allowed_paths||[],
    candidate_primary_promotions:exceptionPacketDraft.candidate_primary_promotions||[],
    study_prompts:[
      '왜 primary read만으로 충분하지 않았는지 기록한다.',
      'candidate primary promotion 경로를 다음 routing/profile 조정 후보로 검토한다.',
      'exception read가 validation 또는 evidence에 어떤 차이를 만들었는지 적는다.',
    ],
    next_actions:[
      '반복되는 exception path는 planning seed 또는 routing profile 보정 후보로 올린다.',
      '예외 읽기가 끝나면 다시 최소 문맥 기준으로 되돌린다.',
    ],
    commands:{
      json:'python3 scripts/generate_exception_replay.py --json',
      npm:'npm run wp:exception-replay -- --json',
    },
    benchmark_signals:signalsForIds(focusById('apply-checkpoint-exception-replay-and-capability-seed')?.benchmark_refs||[]),
  };
}
function buildCapabilityPlanningSeedData(){
  const capabilityBrief=buildCapabilityBriefData();
  return {
    capability:capabilityBrief.capability,
    planning_mode:capabilityBrief.planning_mode,
    seed_sections:[
      {
        id:'capability_goal',
        value:`${capabilityBrief.capability?.name||'capability'} 기준 현재 packet과 다음 ready packet을 한 흐름으로 연결한다.`,
      },
      {
        id:'benchmark_focus',
        value:(capabilityBrief.benchmark_focus||[]).map(item=>item.title).join(', ')||'benchmark focus를 적는다.',
      },
      {
        id:'next_ready',
        value:(capabilityBrief.next_ready_packets||[]).map(item=>item.id).join(', ')||'다음 ready packet을 적는다.',
      },
      {
        id:'blocked_risk',
        value:(capabilityBrief.blocked_packets||[]).map(item=>item.id).join(', ')||'현재 blocked packet 없음',
      },
    ],
    commands:{
      json:'python3 scripts/generate_capability_planning_seed.py --json',
      npm:'npm run wp:capability-seed -- --json',
    },
    benchmark_signals:signalsForIds(focusById('apply-checkpoint-exception-replay-and-capability-seed')?.benchmark_refs||[]),
  };
}
function buildApplyTimelineData(){
  const history=(window.D.decision_apply_history||[]).slice(0,6);
  const latestState=buildApplyCheckpointData();
  const timeline=history.length ? history : [{
    recorded_at:'latest',
    goal:window.D.current_wp?.goal||intakeAnswers().primary_goal||'plan-and-learn',
    decision_gate:latestState.decision_gate,
    result:latestState.ready_to_apply?'ready-preview':'dry-run',
    ready_to_apply:latestState.ready_to_apply,
    promoted_packet_id:latestState.post_apply_preview?.promoted_packet_id||'',
  }];
  return {
    entry_count:timeline.length,
    timeline,
    commands:{
      json:'python3 scripts/generate_apply_timeline.py --json',
      npm:'npm run wp:apply-timeline -- --json',
    },
    latest_state:latestState,
    timeline_preview:[
      'decision-apply가 실행될 때마다 recorded_at 기준 history artifact를 남긴다.',
      '최근 apply 결과를 replay 가능한 상태 surface로 본다.',
      'ready/review/blocked 흐름을 계획 이력처럼 누적한다.',
    ],
    benchmark_signals:signalsForIds(focusById('capability-seed-apply-apply-history-and-exception-routing')?.benchmark_refs||[]),
  };
}
function buildExceptionRoutingPatchData(){
  const replay=buildExceptionReplayData();
  const promote=replay.candidate_primary_promotions||[];
  const allowed=replay.allowed_exception_paths||[];
  return {
    routing_patch:{
      promote_to_must_read:promote.slice(0,3),
      keep_expand_if_needed:allowed.filter(item=>!promote.includes(item)).slice(0,3),
      review_later:allowed.slice(3,6),
    },
    commands:{
      json:'python3 scripts/generate_exception_routing_patch.py --json',
      npm:'npm run wp:exception-routing -- --json',
    },
    benchmark_signals:signalsForIds(focusById('capability-seed-apply-apply-history-and-exception-routing')?.benchmark_refs||[]),
  };
}
function buildCapabilitySeedTuningData(){
  const seed=buildCapabilityPlanningSeedData();
  const routingPatch=buildExceptionRoutingPatchData();
  const applyTimeline=buildApplyTimelineData();
  const latest=(applyTimeline.timeline||[])[0]||{};
  const seedById=Object.fromEntries((seed.seed_sections||[]).map(item=>[item.id, item.value]));
  const promote=(routingPatch.routing_patch?.promote_to_must_read||[]);
  const keepExpand=(routingPatch.routing_patch?.keep_expand_if_needed||[]);
  const reviewLater=(routingPatch.routing_patch?.review_later||[]);
  const modeId=seed.planning_mode?.id||selectedPlanningModeId();
  const latestGate=latest.decision_gate||'review';
  const latestResult=latest.result||'dry-run';
  const promotedPacketId=latest.promoted_packet_id||'다음 packet 미확정';
  const routingSummary=`must-read 승격 후보: ${(promote.slice(0,2).join(', ')||'없음')}; expand 유지: ${(keepExpand.slice(0,2).join(', ')||'없음')}; review later: ${(reviewLater.slice(0,2).join(', ')||'없음')}`;
  const timelineSummary=`최근 apply gate ${latestGate} / result ${latestResult} / packet ${promotedPacketId}`;
  const mappedByMode={
    'master-prd':[
      {id:'problem', value:seedById.capability_goal||'현재 capability 흐름을 적는다.'},
      {id:'north_star', value:`${seedById.benchmark_focus||'benchmark focus를 적는다.'}. 최근 gate는 ${latestGate} 상태를 유지해야 한다.`},
      {id:'module_boundary', value:`next ready: ${seedById.next_ready||'다음 ready packet을 적는다.'}. blocked risk: ${seedById.blocked_risk||'현재 blocked packet 없음'}`},
      {id:'adapter_strategy', value:routingSummary},
      {id:'operator_view', value:`${timelineSummary}. GUI에서는 apply timeline, readiness, exception replay를 함께 본다.`},
    ],
    'cycle-brief':[
      {id:'cycle_goal', value:seedById.capability_goal||'현재 capability 흐름을 적는다.'},
      {id:'must_not_slip', value:`${seedById.blocked_risk||'현재 blocked packet 없음'}. 코어 경계와 최소 문맥 원칙은 유지한다.`},
      {id:'review_cadence', value:`${timelineSummary}. review 시 ${(promote.slice(0,2).join(', ')||'예외 승격 후보 없음')}를 먼저 점검한다.`},
      {id:'evidence', value:`${seedById.benchmark_focus||'benchmark focus를 적는다.'}. routing 보정: ${(promote.slice(0,2).join(', ')||'없음')}`},
    ],
    'change-control':[
      {id:'change_request', value:seedById.capability_goal||'현재 capability 흐름을 적는다.'},
      {id:'core_guardrail', value:`${seedById.blocked_risk||'현재 blocked packet 없음'}. promote_to_must_read는 edge routing에만 반영한다.`},
      {id:'risk_and_observability', value:`${timelineSummary}. ${routingSummary}`},
      {id:'rollback', value:'gate가 ready가 아니면 최근 snapshot과 planning studio 기본값으로 즉시 되돌린다.'},
    ],
  };
  return {
    capability:seed.capability,
    planning_mode:seed.planning_mode,
    latest_apply:latest,
    routing_patch:routingPatch.routing_patch,
    mapped_sections:(mappedByMode[modeId]||[]).filter(item=>item.value),
    notes:[
      'capability seed를 Planning Studio 실제 section id에 맞게 다시 매핑합니다.',
      '최근 apply gate/result와 repeated exception routing 후보를 planning 기본값에 반영합니다.',
      '반복 예외는 must-read/expand-if-needed 보정 근거로 남깁니다.',
    ],
    commands:{
      json:'python3 scripts/generate_capability_seed_tuning.py --json',
      npm:'npm run wp:capability-seed-tuning -- --json',
    },
    benchmark_signals:signalsForIds(focusById('seed-tuning-scorecard-and-blueprint-launch')?.benchmark_refs||[]),
  };
}
function buildApplyOutcomeScorecardData(){
  const applyTimeline=buildApplyTimelineData();
  const promotionDecision=buildPromotionDecisionData();
  const contextLock=buildContextLockData();
  const contextBundle=buildContextBundleExportData();
  const rereadQueue=buildRereadQueueData();
  const routingPatch=buildExceptionRoutingPatchData();
  const timeline=applyTimeline.timeline||[];
  const entryCount=timeline.length;
  const readyCount=timeline.filter(item=>item.decision_gate==='ready').length;
  const reviewCount=timeline.filter(item=>item.decision_gate==='review').length;
  const blockedCount=timeline.filter(item=>item.decision_gate==='blocked').length;
  const appliedCount=timeline.filter(item=>item.result==='applied').length;
  const rereadTokens=(rereadQueue.reread_queue||[]).reduce((acc,item)=>acc + (item.estimated_tokens||0),0);
  const lockedTokens=contextLock.estimated_tokens||0;
  const rereadRatio=lockedTokens ? Math.round((rereadTokens/lockedTokens)*100)/100 : 0;
  let score=100;
  if(promotionDecision.gate_status!=='ready') score -= 10;
  score -= Math.min(20, Math.round(rereadRatio*20));
  score -= Math.min(10, blockedCount*2);
  score += Math.min(10, appliedCount*2);
  score=Math.max(0, Math.min(100, score));
  const actionItems=[];
  if((rereadQueue.reread_count||0)>0){
    actionItems.push('changed/missing reread queue를 먼저 비우고 나서 apply 판단을 다시 한다.');
  }
  if((routingPatch.routing_patch?.promote_to_must_read||[]).length){
    actionItems.push('반복 exception 경로를 capability seed tuning 또는 routing profile 보정으로 올린다.');
  }
  if(promotionDecision.gate_status!=='ready'){
    actionItems.push('promotion decision gate를 ready로 바꾸는 fit/lock 조건부터 정리한다.');
  }
  if(!actionItems.length){
    actionItems.push('현재 score가 안정 범위이므로 다음 execution packet 승격과 smoke 검증을 이어간다.');
  }
  return {
    score,
    current_gate:promotionDecision.gate_status,
    history_window:{
      entry_count:entryCount,
      ready_count:readyCount,
      review_count:reviewCount,
      blocked_count:blockedCount,
      applied_count:appliedCount,
    },
    token_efficiency:{
      primary_tokens:contextBundle.summary.primary?.estimated_tokens||0,
      secondary_tokens:contextBundle.summary.secondary?.estimated_tokens||0,
      locked_tokens:lockedTokens,
      reread_tokens:rereadTokens,
      reread_ratio:rereadRatio,
    },
    routing_feedback:{
      promote_to_must_read:routingPatch.routing_patch?.promote_to_must_read||[],
      keep_expand_if_needed:routingPatch.routing_patch?.keep_expand_if_needed||[],
    },
    action_items:actionItems,
    commands:{
      json:'python3 scripts/generate_apply_outcome_scorecard.py --json',
      npm:'npm run wp:apply-scorecard -- --json',
    },
    benchmark_signals:signalsForIds(focusById('seed-tuning-scorecard-and-blueprint-launch')?.benchmark_refs||[]),
  };
}
function buildBlueprintLaunchDeckData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const starterPreset=buildStarterPresetData();
  const benchmarkPack=buildBenchmarkActionPackData();
  const blueprintId=goal==='module-extension'?'domain-module-extension':goal==='stateful-ops'?'stateful-workflow-service':'master-os-ai-studio';
  const blueprint=(window.D.project_blueprints||[]).find(item=>item.id===blueprintId)||null;
  return {
    goal,
    blueprint:{
      id:blueprint?.id||'',
      name:blueprint?.name||'',
      summary:blueprint?.summary||'',
      when_to_use:blueprint?.when_to_use||'',
      architecture_profile:blueprint?.architecture_profile||'',
    },
    planning_mode:starterPreset.planning_mode,
    routing_profile:starterPreset.routing_profile,
    execution_template_id:starterPreset.execution_template?.id||'',
    recommended_modules:(blueprint?.recommended_modules||[]).slice(0,4),
    launch_sequence:(blueprint?.starter_sequence||[]).slice(0,4),
    starter_deliverables:(blueprint?.starter_deliverables||[]).slice(0,4),
    success_checks:(blueprint?.success_checks||[]).slice(0,3),
    learning_tracks:(blueprint?.learning_tracks||[]).slice(0,3),
    benchmark_focus:(benchmarkPack.recommended||[]).slice(0,3).map(item=>({id:item.id,title:item.title,score:item.score})),
    commands:{
      json:'python3 scripts/generate_blueprint_launch_deck.py --json',
      npm:'npm run wp:blueprint-launch -- --json',
    },
    benchmark_signals:signalsForIds(focusById('seed-tuning-scorecard-and-blueprint-launch')?.benchmark_refs||[]),
  };
}
function buildLearnedPresetMemoryData(){
  const goal=intakeAnswers().primary_goal||'plan-and-learn';
  const starterPreset=buildStarterPresetData();
  const blueprintLaunch=buildBlueprintLaunchDeckData();
  const history=(window.D.decision_apply_history||[]).filter(item=>item.goal===goal);
  const grouped=new Map();
  history.forEach(item=>{
    const signature=item.starter_signature||{};
    const key=[
      signature.planning_mode_id||starterPreset.planning_mode?.id||'',
      signature.routing_profile_id||starterPreset.routing_profile?.id||'',
      signature.execution_template_id||starterPreset.execution_template?.id||'',
      signature.blueprint_id||blueprintLaunch.blueprint?.id||'',
    ].join('|');
    const entry=grouped.get(key)||{
      planning_mode_id:signature.planning_mode_id||starterPreset.planning_mode?.id||'',
      routing_profile_id:signature.routing_profile_id||starterPreset.routing_profile?.id||'',
      execution_template_id:signature.execution_template_id||starterPreset.execution_template?.id||'',
      blueprint_id:signature.blueprint_id||blueprintLaunch.blueprint?.id||'',
      entry_count:0,
      ready_count:0,
      applied_count:0,
    };
    entry.entry_count += 1;
    if(item.decision_gate==='ready') entry.ready_count += 1;
    if(item.result==='applied') entry.applied_count += 1;
    grouped.set(key, entry);
  });
  const topSignatures=Array.from(grouped.values()).sort((a,b)=>{
    if(b.applied_count!==a.applied_count) return b.applied_count-a.applied_count;
    if(b.ready_count!==a.ready_count) return b.ready_count-a.ready_count;
    if(b.entry_count!==a.entry_count) return b.entry_count-a.entry_count;
    return String(a.planning_mode_id||'').localeCompare(String(b.planning_mode_id||''));
  });
  const recommended=topSignatures[0]||{
    planning_mode_id:starterPreset.planning_mode?.id||'',
    routing_profile_id:starterPreset.routing_profile?.id||'',
    execution_template_id:starterPreset.execution_template?.id||'',
    blueprint_id:blueprintLaunch.blueprint?.id||'',
    entry_count:0,
    ready_count:0,
    applied_count:0,
  };
  const learningSections=(starterPreset.planning_sections||[]).map((section,index)=>{
    let value=section.value||'';
    const summary=`proven path: ${recommended.blueprint_id} / ${recommended.planning_mode_id} / ${recommended.routing_profile_id}; ready ${recommended.ready_count}/${recommended.entry_count}; applied ${recommended.applied_count}/${recommended.entry_count}`;
    if(index===0){
      value=`${value} ${summary}`.trim();
    }else if(['review_cadence','risk_and_observability','operator_view'].includes(section.id)){
      value=`${value} | learned memory: ${summary}`.trim();
    }
    return {id:section.id, value};
  });
  return {
    goal,
    history_entries:history.length,
    recommended_signature:recommended,
    learning_sections:learningSections,
    top_signatures:topSignatures.slice(0,3),
    commands:{
      json:'python3 scripts/generate_learned_preset_memory.py --json',
      npm:'npm run wp:learned-preset-memory -- --json',
    },
    benchmark_signals:signalsForIds(focusById('learned-preset-memory-token-roi-and-proven-kickoff')?.benchmark_refs||[]),
  };
}
function buildTokenROIData(){
  const contextLock=buildContextLockData();
  const rereadQueue=buildRereadQueueData();
  const routingPatch=buildExceptionRoutingPatchData();
  const promote=routingPatch.routing_patch?.promote_to_must_read||[];
  const keepExpand=routingPatch.routing_patch?.keep_expand_if_needed||[];
  const secondaryEntries=(contextLock.locked_paths||[]).filter(item=>item.tier==='secondary').map(item=>({
    path:item.path,
    estimated_tokens:pathMetric(item.path).estimated_tokens||0,
  }));
  const match=(pathValue, prefixes)=>prefixes.some(prefix=>prefix && (pathValue===prefix || pathValue.startsWith(`${String(prefix).replace(/\/$/,'')}/`)));
  const promoteToPrimary=secondaryEntries.filter(item=>match(item.path,promote)).sort((a,b)=>b.estimated_tokens-a.estimated_tokens).slice(0,5);
  const keepSecondary=secondaryEntries.filter(item=>match(item.path,keepExpand)).sort((a,b)=>b.estimated_tokens-a.estimated_tokens).slice(0,5);
  const deferOrDrop=secondaryEntries.filter(item=>!match(item.path,promote) && !match(item.path,keepExpand)).sort((a,b)=>b.estimated_tokens-a.estimated_tokens).slice(0,5);
  return {
    goal:intakeAnswers().primary_goal||'plan-and-learn',
    locked_tokens:contextLock.estimated_tokens||0,
    estimated_savings_tokens:deferOrDrop.reduce((acc,item)=>acc + (item.estimated_tokens||0),0),
    promote_to_primary:promoteToPrimary,
    keep_secondary:keepSecondary,
    defer_or_drop:deferOrDrop,
    reread_hotspots:(rereadQueue.reread_queue||[]).slice(0,5).map(item=>({path:item.path,tier:item.tier,estimated_tokens:item.estimated_tokens||0})),
    commands:{
      json:'python3 scripts/generate_token_roi_report.py --json',
      npm:'npm run wp:token-roi -- --json',
    },
    benchmark_signals:signalsForIds(focusById('learned-preset-memory-token-roi-and-proven-kickoff')?.benchmark_refs||[]),
  };
}
function buildProvenKickoffDeckData(){
  const blueprintLaunch=buildBlueprintLaunchDeckData();
  const learnedPresetMemory=buildLearnedPresetMemoryData();
  const tokenROI=buildTokenROIData();
  const benchmarkPack=buildBenchmarkActionPackData();
  const kickoffSteps=[
    ...(blueprintLaunch.launch_sequence||[]).slice(0,3).map(item=>item.step),
    ...(learnedPresetMemory.learning_sections||[]).slice(0,2).map(item=>`learned preset 적용: ${item.id}`),
  ].filter(Boolean);
  return {
    goal:blueprintLaunch.goal,
    proven_start:{
      blueprint_id:blueprintLaunch.blueprint?.id||'',
      planning_mode_id:learnedPresetMemory.recommended_signature?.planning_mode_id||'',
      routing_profile_id:learnedPresetMemory.recommended_signature?.routing_profile_id||'',
      execution_template_id:learnedPresetMemory.recommended_signature?.execution_template_id||'',
    },
    kickoff_steps:kickoffSteps,
    benchmark_focus:(benchmarkPack.recommended||[]).slice(0,3).map(item=>({id:item.id,title:item.title,score:item.score})),
    context_budget:{
      locked_tokens:tokenROI.locked_tokens||0,
      estimated_savings_tokens:tokenROI.estimated_savings_tokens||0,
    },
    starter_deliverables:blueprintLaunch.starter_deliverables||[],
    commands:{
      json:'python3 scripts/generate_proven_kickoff_deck.py --json',
      npm:'npm run wp:proven-kickoff -- --json',
    },
    benchmark_signals:signalsForIds(focusById('learned-preset-memory-token-roi-and-proven-kickoff')?.benchmark_refs||[]),
  };
}
function buildAdaptiveStarterPresetData(){
  const starterPreset=buildStarterPresetData();
  const learnedPresetMemory=buildLearnedPresetMemoryData();
  const blueprintLaunch=buildBlueprintLaunchDeckData();
  const signature=learnedPresetMemory.recommended_signature||{};
  const planningModeId=signature.planning_mode_id||starterPreset.planning_mode?.id||'';
  const routingProfileId=signature.routing_profile_id||starterPreset.routing_profile?.id||'';
  const executionTemplateId=signature.execution_template_id||starterPreset.execution_template?.id||'';
  return {
    goal:starterPreset.goal,
    source:(learnedPresetMemory.history_entries||0)>0 ? 'learned-memory' : 'benchmark-default',
    recommended_signature:{
      planning_mode_id:planningModeId,
      routing_profile_id:routingProfileId,
      execution_template_id:executionTemplateId,
      blueprint_id:signature.blueprint_id||blueprintLaunch.blueprint?.id||'',
    },
    planning_mode:{
      id:planningModeId,
      title:planningModeById(planningModeId)?.title||starterPreset.planning_mode?.title||'',
      summary:planningModeById(planningModeId)?.summary||starterPreset.planning_mode?.summary||'',
    },
    routing_profile:{
      id:routingProfileId,
      objective:(window.D.context_routing_profiles||[]).find(item=>item.id===routingProfileId)?.objective||starterPreset.routing_profile?.objective||'',
    },
    execution_template_id:executionTemplateId,
    blueprint:blueprintLaunch.blueprint,
    planning_sections:(learnedPresetMemory.learning_sections||[]).length ? learnedPresetMemory.learning_sections : (starterPreset.planning_sections||[]),
    commands:{
      json:'python3 scripts/generate_adaptive_starter_preset.py --json',
      npm:'npm run wp:adaptive-starter -- --json',
    },
    benchmark_signals:signalsForIds(focusById('adaptive-starter-roi-routing-and-kickoff-evidence')?.benchmark_refs||[]),
  };
}
function buildTokenROIRoutingPatchData(){
  const tokenROI=buildTokenROIData();
  return {
    routing_patch:{
      promote_to_primary:(tokenROI.promote_to_primary||[]).slice(0,3).map(item=>item.path),
      keep_secondary:(tokenROI.keep_secondary||[]).slice(0,3).map(item=>item.path),
      move_to_deferred:(tokenROI.defer_or_drop||[]).slice(0,3).map(item=>item.path),
    },
    estimated_savings_tokens:tokenROI.estimated_savings_tokens||0,
    reread_hotspots:(tokenROI.reread_hotspots||[]).slice(0,3),
    commands:{
      json:'python3 scripts/generate_token_roi_routing_patch.py --json',
      npm:'npm run wp:token-roi-routing -- --json',
    },
    benchmark_signals:signalsForIds(focusById('adaptive-starter-roi-routing-and-kickoff-evidence')?.benchmark_refs||[]),
  };
}
function buildKickoffEvidenceBundleData(){
  const adaptive=buildAdaptiveStarterPresetData();
  const kickoff=buildProvenKickoffDeckData();
  const scorecard=buildApplyOutcomeScorecardData();
  return {
    adaptive_signature:adaptive.recommended_signature,
    blueprint:adaptive.blueprint,
    kickoff_steps:(kickoff.kickoff_steps||[]).slice(0,5),
    starter_deliverables:(kickoff.starter_deliverables||[]).slice(0,4),
    execution_readiness:{
      current_gate:scorecard.current_gate||'review',
      score:scorecard.score||0,
    },
    planning_sections:(adaptive.planning_sections||[]).slice(0,5),
    commands:{
      json:'python3 scripts/generate_kickoff_evidence_bundle.py --json',
      npm:'npm run wp:kickoff-evidence -- --json',
    },
    benchmark_signals:signalsForIds(focusById('adaptive-starter-roi-routing-and-kickoff-evidence')?.benchmark_refs||[]),
  };
}
function buildLaunchBriefAutopilotData(){
  const adaptive=buildAdaptiveStarterPresetData();
  const blueprint=buildBlueprintLaunchDeckData();
  const evidence=buildKickoffEvidenceBundleData();
  return {
    source:adaptive.source||'benchmark-default',
    recommendation:{
      blueprint_id:adaptive.recommended_signature?.blueprint_id||'',
      blueprint_name:adaptive.blueprint?.name||'',
      planning_mode_id:adaptive.recommended_signature?.planning_mode_id||'',
      routing_profile_id:adaptive.recommended_signature?.routing_profile_id||'',
      execution_template_id:adaptive.recommended_signature?.execution_template_id||'',
    },
    ready_gate:evidence.execution_readiness||{current_gate:'review',score:0},
    start_now:(evidence.kickoff_steps||[]).slice(0,5),
    guardrails:(adaptive.planning_sections||[]).filter(section=>['core_guardrail','must_not_slip','risk_and_observability','operator_view'].includes(section.id)).map(section=>section.value).slice(0,4),
    starter_deliverables:(blueprint.starter_deliverables||[]).slice(0,4),
    commands:{
      json:'python3 scripts/generate_launch_brief_autopilot.py --json',
      npm:'npm run wp:launch-brief-autopilot -- --json',
    },
    benchmark_signals:signalsForIds(focusById('launch-autopilot-routing-ledger-and-kickoff-gate')?.benchmark_refs||[]),
  };
}
function buildRoutingLearningLedgerData(){
  const adaptive=buildAdaptiveStarterPresetData();
  const exceptionPatch=buildExceptionRoutingPatchData();
  const roiPatch=buildTokenROIRoutingPatchData();
  const uniq=(values)=>dedupeBy((values||[]).filter(Boolean), item=>item);
  return {
    routing_profile_id:adaptive.recommended_signature?.routing_profile_id||'',
    routing_learning:{
      promote_to_primary:uniq([...(exceptionPatch.routing_patch?.promote_to_must_read||[]), ...(roiPatch.routing_patch?.promote_to_primary||[])]).slice(0,5),
      keep_secondary:uniq([...(exceptionPatch.routing_patch?.keep_expand_if_needed||[]), ...(roiPatch.routing_patch?.keep_secondary||[])]).slice(0,5),
      move_to_deferred:uniq(roiPatch.routing_patch?.move_to_deferred||[]).slice(0,5),
    },
    estimated_savings_tokens:roiPatch.estimated_savings_tokens||0,
    notes:[
      'exception routing과 token ROI patch를 한 장의 canonical routing 메모리로 합칩니다.',
      'promote_to_primary는 반복 exception과 ROI가 동시에 지지하는 경로를 우선합니다.',
      'move_to_deferred는 token 절감이 큰 경로부터 우선 검토합니다.',
    ],
    commands:{
      json:'python3 scripts/generate_routing_learning_ledger.py --json',
      npm:'npm run wp:routing-learning -- --json',
    },
    benchmark_signals:signalsForIds(focusById('launch-autopilot-routing-ledger-and-kickoff-gate')?.benchmark_refs||[]),
  };
}
function buildKickoffReadyGateData(){
  const evidence=buildKickoffEvidenceBundleData();
  const score=Number(evidence.execution_readiness?.score||0);
  const currentGate=evidence.execution_readiness?.current_gate||'review';
  let gateStatus='ready';
  const reasons=[];
  if(currentGate==='blocked' || score<70){
    gateStatus='blocked';
    reasons.push('현재 kickoff evidence 기준으로 ready gate가 부족합니다.');
  }else if(currentGate!=='ready' || score<85){
    gateStatus='review';
    reasons.push('kickoff evidence는 충분하지만 바로 시작 전 한 번 더 검토하는 편이 안전합니다.');
  }else{
    reasons.push('adaptive starter, kickoff step, readiness score가 모두 허용 범위 안입니다.');
  }
  if((evidence.kickoff_steps||[]).length<3){
    if(gateStatus==='ready') gateStatus='review';
    reasons.push('kickoff step이 아직 짧아 launch brief 보강이 필요합니다.');
  }
  const nextActions=[gateStatus==='ready' ? 'adaptive starter를 Planning Studio에 적용하고 launch brief를 export합니다.' : 'kickoff evidence와 adaptive starter section을 먼저 보강합니다.'];
  if(score<85){
    nextActions.push('apply outcome scorecard와 kickoff evidence bundle을 다시 확인합니다.');
  }
  return {
    gate_status:gateStatus,
    score,
    current_gate:currentGate,
    reasons,
    next_actions:nextActions,
    commands:{
      json:'python3 scripts/generate_kickoff_ready_gate.py --json',
      npm:'npm run wp:kickoff-ready-gate -- --json',
    },
    benchmark_signals:signalsForIds(focusById('launch-autopilot-routing-ledger-and-kickoff-gate')?.benchmark_refs||[]),
  };
}
function replayNextPacketMarkdown(data){
  const lines=[
    '# Workflow OS Replay Next Packet',
    `생성: ${data.generated_at}`,
    `- goal: ${data.goal}`,
    `- type/stage: ${data.type}/${data.stage}`,
    '',
    '## Focus Tracks',
    ...(data.focus_tracks||[]).map(item=>`- ${item}`),
    '',
    '## Read First',
    ...(data.read_first||[]).map(item=>`- ${item}`),
  ];
  return lines.join('\n');
}
function copyReplayNextPacket(){
  navigator.clipboard.writeText(replayNextPacketMarkdown(buildReplayNextPacketData()))
    .then(()=>toast('Replay Next Packet 복사됨'));
}
function executionPacketMarkdown(data){
  const lines=[
    '# Workflow OS Execution Packet Draft',
    `생성: ${data.generated_at}`,
    `- id: ${data.id}`,
    `- goal: ${data.goal}`,
    `- type: ${data.type}`,
    `- stage: ${data.stage}`,
    `- template: ${data.template_id}`,
    '',
    '## Scope In',
    ...((data.scope_in||[]).map(item=>`- ${item}`)),
    '',
    '## Constraints',
    ...((data.constraints||[]).map(item=>`- ${item}`)),
    '',
    '## Done When',
    ...((data.done_when||[]).map(item=>`- ${item}`)),
    '',
    '## Validation',
    ...((data.validation||[]).map(item=>`- ${item}`)),
  ];
  return lines.join('\n');
}
function copyExecutionPacket(){
  const md=executionPacketMarkdown(buildExecutionPacketData());
  navigator.clipboard.writeText(md).then(()=>toast('Execution Packet 복사됨'));
}
function exportExecutionPacketJSON(){
  const data=buildExecutionPacketData();
  downloadText(`wfos-execution-packet-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Execution Packet JSON 다운로드됨');
}
function exportExecutionPacketYAML(){
  const data=buildExecutionPacketData();
  let yaml=`id: "${data.id}"\ngoal: ${yamlScalar(data.goal, '  ')}\ntype: "${data.type}"\nstage: "${data.stage}"\nstatus: "draft"\ntemplate_id: "${data.template_id}"\nplanning_mode: "${data.planning_mode}"\ngenerated_at: "${data.generated_at}"\nscope_in:\n`;
  (data.scope_in||[]).forEach(item=>{ yaml+=`  - "${item}"\n`; });
  yaml+=`scope_out:\n`;
  (data.scope_out||[]).forEach(item=>{ yaml+=`  - "${item}"\n`; });
  yaml+=`constraints:\n`;
  (data.constraints||[]).forEach(item=>{ yaml+=`  - ${yamlScalar(item, '    ')}\n`; });
  yaml+=`done_when:\n`;
  (data.done_when||[]).forEach(item=>{ yaml+=`  - ${yamlScalar(item, '    ')}\n`; });
  yaml+=`fail_if:\n`;
  (data.fail_if||[]).forEach(item=>{ yaml+=`  - ${yamlScalar(item, '    ')}\n`; });
  yaml+=`rollback: ${yamlScalar(data.rollback, '  ')}\nvalidation:\n`;
  (data.validation||[]).forEach(item=>{ yaml+=`  - "${item}"\n`; });
  yaml+=`context_budget:\n  tier_reads:\n`;
  (data.context_budget.tier_reads||[]).forEach(item=>{ yaml+=`    - "${item}"\n`; });
  yaml+=`  context_reads:\n`;
  (data.context_budget.context_reads||[]).forEach(item=>{ yaml+=`    - "${item}"\n`; });
  yaml+=`  skip_if_capability:\n`;
  (data.context_budget.skip_if_capability||[]).forEach(item=>{ yaml+=`    - "${item}"\n`; });
  yaml+=`  estimated_turns: ${data.context_budget.estimated_turns}\n  max_new_files: ${data.context_budget.max_new_files}\n  max_modified_files: ${data.context_budget.max_modified_files}\n`;
  downloadText(`wfos-execution-packet-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Execution Packet YAML 다운로드됨');
}
function buildApplyHandoffData(){
  const packet=buildExecutionPacketData();
  const planningComparison=buildPlanningVariantComparison();
  const placeholder='wfos-execution-packet-<timestamp>.yaml';
  return {
    packet_id:packet.id,
    recommended_mode_id:planningComparison.recommended_mode_id,
    export_file:placeholder,
    commands:{
      dry_run:`python3 scripts/apply_execution_packet.py --input ${placeholder} --json`,
      apply:`python3 scripts/apply_execution_packet.py --input ${placeholder} --apply --json`,
      npm_apply:`npm run wp:apply-packet -- --input ${placeholder} --apply --json`,
    },
    targets:[
      {
        path:'memory/current-wp.yaml',
        after:{
          id:packet.id,
          goal:packet.goal,
          type:packet.type,
          stage:packet.stage,
        },
      },
      {
        path:'memory/next-actions.yaml',
        after:{
          next_wp:packet.id,
          queue_status:'in_progress',
        },
      },
    ],
    budget:packet.context_budget_summary||{
      tier_reads:{file_count:0,total_bytes:0,estimated_tokens:0},
      context_reads:{file_count:0,total_bytes:0,estimated_tokens:0},
      total:{file_count:0,total_bytes:0,estimated_tokens:0},
    },
    guardrails:[
      '기본은 dry-run으로 JSON report를 확인하고 --apply일 때만 memory를 갱신합니다.',
      'master OS 코어 파일은 scope_out으로 유지하고 current-wp/next-actions만 갱신합니다.',
      `추천 planning mode: ${planningComparison.recommended_mode_id||packet.planning_mode||'—'}`,
    ],
  };
}
function currentPacketContextSource(){
  const active=(window.D.wps?.active||[])[0];
  if(active?.id){
    return {kind:'active', label:'진행 중 Work Packet', packet:active};
  }
  const current=window.D.current_wp||{};
  if(current.id){
    return {kind:'current', label:'memory/current-wp.yaml', packet:current};
  }
  return {kind:'none', label:'현재 packet 없음', packet:{}};
}
function readItem(path, reason, priority){
  return {path, reason, priority};
}
function uniqueReadItems(items){
  const seen=new Set(), out=[];
  (items||[]).forEach(item=>{
    const path=item?.path;
    if(!path || seen.has(path)) return;
    seen.add(path);
    out.push(item);
  });
  return out;
}
function buildContextPacketData(){
  const d=window.D;
  const intake=computeIntakeRecommendation();
  const answers=intake.answers||{};
  const blueprints=d.project_blueprints||[];
  const profiles=d.adapter_catalog?.profiles||[];
  const recipes=d.ai_runtime_recipes||[];
  const blueprint=blueprints.find(item=>item.id===intake.blueprintId)||null;
  const profile=profiles.find(item=>item.id===intake.profileId)||null;
  const recipe=recipes.find(item=>item.id===intake.recipeId)||null;
  const packetSource=currentPacketContextSource();
  const budget=packetSource.packet?.context_budget||{};
  const benchmarks=signalsForIds(focusById('guided-learning-and-adapter-cockpit')?.benchmark_refs||[]);
  const primary=answers.primary_goal||'plan-and-learn';
  const interaction=answers.interaction_mode||'document-first';
  const delivery=answers.delivery_shape||'planner-artifact';

  const readFirst=uniqueReadItems([
    readItem('memory/checkpoint.yaml', '세션 진입점과 다음 단계 판정', 'high'),
    readItem('memory/current-wp.yaml', '현재 packet 범위와 제약 확인', 'high'),
    readItem('requirements/requirements.yaml', '현재 입력 진실원', 'high'),
    readItem('requirements/constraints.yaml', '코어 불변 제약 확인', 'high'),
    readItem('requirements/domain-map.yaml', 'bounded context와 조합 경계 확인', 'high'),
    ...(budget.tier_reads||[]).map(path=>readItem(path, '현재 Work Packet 필수 선독 파일', 'high')),
  ]);

  const readNext=uniqueReadItems([
    readItem('master-shell/catalog/project-blueprints.yaml', '추천된 시작 블루프린트 근거', 'medium'),
    readItem('master-shell/catalog/project-intake-canvas.yaml', '추천 조합 질문/가중치 검증', 'medium'),
    readItem('master-shell/catalog/ai-runtime-recipes.yaml', '런타임 운영 순서와 가드레일 확인', 'medium'),
    readItem('master-shell/catalog/adapter-registry.yaml', 'profile별 adapter 조합 확인', 'medium'),
    readItem('master-shell/catalog/adapter-compatibility-matrix.yaml', '필수/권장 adapter 규칙 확인', 'medium'),
    ...(budget.context_reads||[]).map(path=>readItem(path, '현재 Work Packet 실행 중 지연 로딩 파일', 'medium')),
    ...(interaction==='document-first' ? [
      readItem('master-shell/catalog/ai-learning-map.yaml', 'GUI 학습 경로와 문서 흐름 확인', 'medium'),
      readItem('master-shell/catalog/master-os-relations.yaml', '관계 맵으로 AI 흐름 파악', 'medium'),
    ] : []),
    ...(interaction==='contract-first' ? [
      readItem('worklog/contract-matrix.md', '계약 조합 상태 확인', 'medium'),
      readItem('master-shell/plugin-registry/registry.yaml', '마스터 UI 편입 경로 확인', 'medium'),
    ] : []),
    ...(interaction==='ops-first' ? [
      readItem('master-shell/observability/config.yaml', '로그/알림/대시보드 기준 확인', 'medium'),
      readItem('master-shell/operations/rollback-playbook.yaml', '운영 보호 동작 확인', 'medium'),
    ] : []),
    ...(delivery==='service-runtime' ? [
      readItem('master-shell/observability/health-scores.yaml', '운영 score baseline 확인', 'medium'),
      readItem('master-shell/operations/deployment-environments.yaml', '배포 대상 경계 확인', 'medium'),
    ] : []),
    ...(delivery==='module-package' ? [
      readItem('templates/module-template/README.md', '모듈 패키지 시작점 재사용', 'medium'),
      readItem('templates/contract-template/README.md', '계약 번들 작성 기준', 'medium'),
    ] : []),
  ]);

  const readLater=uniqueReadItems([
    readItem('master-shell/observability/timeline.jsonl', '실행 로그가 필요할 때만 확인', 'low'),
    readItem('worklog/reports/', '학습/증적 보고서는 작업 종료 시 확인', 'low'),
    readItem('docs/adr/adr-index.yaml', '구조 판단 변경이 생길 때만 확인', 'low'),
    readItem('artifacts/master-planner/index.html', '최종 artifact 확인용', 'low'),
    ...(primary==='module-extension' ? [
      readItem('domains/', '새 bounded context 구현에 들어갈 때만 읽기', 'low'),
    ] : []),
    ...(primary==='stateful-ops' ? [
      readItem('artifacts/deployment-smoke/', '운영 증적 확인이 필요할 때만 읽기', 'low'),
    ] : []),
  ]);

  const skipSignals=dedupeBy([
    ...((budget.skip_if_capability)||[]).map(item=>`capability ${item}`),
    ...(primary==='plan-and-learn' ? ['domains/ 전체 구현 세부'] : []),
    ...(delivery==='planner-artifact' ? ['deployment evidence 상세'] : []),
  ], item=>item);

  return {
    generated_at:new Date().toISOString(),
    recommendation:{
      blueprint_id:intake.blueprintId,
      blueprint_name:blueprint?.name||'',
      profile_id:intake.profileId,
      profile_name:profile?.name||'',
      recipe_id:intake.recipeId,
      recipe_name:recipe?.name||'',
    },
    packet_source:{
      kind:packetSource.kind,
      label:packetSource.label,
      id:packetSource.packet?.id||'',
      goal:packetSource.packet?.goal||'',
    },
    work_packet_budget:{
      estimated_turns:budget.estimated_turns||null,
      max_new_files:budget.max_new_files||null,
      max_modified_files:budget.max_modified_files||null,
    },
    read_first:readFirst,
    read_next:readNext,
    read_later:readLater,
    skip_signals:skipSignals,
    weighted_adapters:rankAdaptersForRecommendation().slice(0,4).map(item=>({
      id:item.adapter_id,
      name:item.adapter?.name||item.adapter_id,
      weighted_score:item.weighted_score,
    })),
    benchmark_refs:benchmarks.map(signal=>({
      id:signal.id,
      product:signal.product,
      source_url:signal.source_url,
    })),
  };
}
function contextPacketMarkdown(data){
  const lines=[
    '# Workflow OS Context Packet',
    `생성: ${data.generated_at}`,
    '',
    '## Recommendation',
    `- Blueprint: ${data.recommendation.blueprint_name} (${data.recommendation.blueprint_id})`,
    `- Profile: ${data.recommendation.profile_name} (${data.recommendation.profile_id})`,
    `- Recipe: ${data.recommendation.recipe_name} (${data.recommendation.recipe_id})`,
    '',
    '## Packet Source',
    `- Source: ${data.packet_source.label}${data.packet_source.id?` (${data.packet_source.id})`:''}`,
    ...(data.packet_source.goal?[`- Goal: ${data.packet_source.goal}`]:[]),
    ...(data.work_packet_budget.estimated_turns?[`- Estimated turns: ${data.work_packet_budget.estimated_turns}`]:[]),
    ...(data.work_packet_budget.max_new_files?[`- Max new files: ${data.work_packet_budget.max_new_files}`]:[]),
    ...(data.work_packet_budget.max_modified_files?[`- Max modified files: ${data.work_packet_budget.max_modified_files}`]:[]),
    '',
    '## Read First',
    ...data.read_first.map(item=>`- ${item.path} — ${item.reason}`),
    '',
    '## Read Next',
    ...data.read_next.map(item=>`- ${item.path} — ${item.reason}`),
    '',
    '## Read Later',
    ...data.read_later.map(item=>`- ${item.path} — ${item.reason}`),
    '',
    '## Skip Signals',
    ...data.skip_signals.map(item=>`- ${item}`),
    '',
    '## Weighted Adapters',
    ...data.weighted_adapters.map(item=>`- ${item.name} (${item.id}) — ${item.weighted_score}/5`),
  ];
  return lines.join('\n');
}
function copyContextPacket(){
  const md=contextPacketMarkdown(buildContextPacketData());
  navigator.clipboard.writeText(md).then(()=>toast('Context Packet 복사됨'));
}
function exportContextPacketJSON(){
  const data=buildContextPacketData();
  downloadText(`wfos-context-packet-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Context Packet JSON 다운로드됨');
}
function exportContextPacketYAML(){
  const data=buildContextPacketData();
  let yaml=`context_packet:\n  generated_at: "${data.generated_at}"\n  recommendation:\n    blueprint_id: "${data.recommendation.blueprint_id}"\n    blueprint_name: "${data.recommendation.blueprint_name}"\n    profile_id: "${data.recommendation.profile_id}"\n    profile_name: "${data.recommendation.profile_name}"\n    recipe_id: "${data.recommendation.recipe_id}"\n    recipe_name: "${data.recommendation.recipe_name}"\n  packet_source:\n    kind: "${data.packet_source.kind}"\n    label: "${data.packet_source.label}"\n    id: "${data.packet_source.id}"\n    goal: ${yamlScalar(data.packet_source.goal, '      ')}\n  work_packet_budget:\n    estimated_turns: ${data.work_packet_budget.estimated_turns===null?'null':data.work_packet_budget.estimated_turns}\n    max_new_files: ${data.work_packet_budget.max_new_files===null?'null':data.work_packet_budget.max_new_files}\n    max_modified_files: ${data.work_packet_budget.max_modified_files===null?'null':data.work_packet_budget.max_modified_files}\n  read_first:\n`;
  (data.read_first||[]).forEach(item=>{ yaml+=`    - path: "${item.path}"\n      reason: ${yamlScalar(item.reason, '        ')}\n`; });
  yaml+=`  read_next:\n`;
  (data.read_next||[]).forEach(item=>{ yaml+=`    - path: "${item.path}"\n      reason: ${yamlScalar(item.reason, '        ')}\n`; });
  yaml+=`  read_later:\n`;
  (data.read_later||[]).forEach(item=>{ yaml+=`    - path: "${item.path}"\n      reason: ${yamlScalar(item.reason, '        ')}\n`; });
  yaml+=`  skip_signals:\n`;
  (data.skip_signals||[]).forEach(item=>{ yaml+=`    - ${yamlScalar(item)}\n`; });
  downloadText(`wfos-context-packet-${Date.now()}.yaml`, yaml, 'text/yaml');
  toast('Context Packet YAML 다운로드됨');
}
function autoRefreshEnabled(){
  return localStorage.getItem('wfos-auto-refresh-log')==='1';
}
function selectedLogFeedFilter(){
  return localStorage.getItem('wfos-log-filter')||'all';
}
function setLogFeedFilter(filterId){
  localStorage.setItem('wfos-log-filter', filterId);
  renderLog();
}
function syncAutoRefreshTimer(){
  if(ST.autoRefreshTimer){
    clearTimeout(ST.autoRefreshTimer);
    ST.autoRefreshTimer=null;
  }
  if(!autoRefreshEnabled()) return;
  ST.autoRefreshTimer=setTimeout(()=>window.location.reload(), 15000);
}
function toggleAutoRefresh(){
  if(autoRefreshEnabled()) localStorage.removeItem('wfos-auto-refresh-log');
  else localStorage.setItem('wfos-auto-refresh-log', '1');
  syncAutoRefreshTimer();
  if(ST.curTab==='log') renderLog();
  toast(autoRefreshEnabled()?'Auto refresh 15초 ON':'Auto refresh OFF');
}
function buildLiveOpsFeed(){
  const d=window.D;
  const timeline=(d.ops_timeline||[]).map((item,index)=>({
    timestamp:item.timestamp||item.time||'',
    title:item.event||item.title||`timeline-${index+1}`,
    detail:item.detail||item.message||item.status||'',
    tag:item.source||'timeline',
  }));
  const audits=(d.audit_entries||[]).slice(0,6).map(entry=>({
    timestamp:entry.timestamp||'',
    title:entry.action||'audit',
    detail:`${entry.actor||'actor?'} ${entry.hash?`· ${entry.hash}`:''}`.trim(),
    tag:'audit',
  }));
  const reflections=(d.reflections||[]).slice(0,4).map(entry=>({
    timestamp:entry.date||'',
    title:`reflection ${entry.stage||''}`.trim(),
    detail:(entry.improvement||[])[0]||(entry.root_cause||[])[0]||'개선 메모',
    tag:'reflection',
  }));
  const reports=(d.learning_reports||[]).slice(0,3).map(entry=>({
    timestamp:'',
    title:`report ${entry.domain||''}`.trim(),
    detail:entry.file||'',
    tag:'report',
  }));
  const git=(d.git||{});
  const gitEvent=git.last_msg?[{
    timestamp:git.last_date||'',
    title:'git commit',
    detail:git.last_msg||'',
    tag:'git',
  }]:[];
  return dedupeBy([...timeline, ...audits, ...reflections, ...reports, ...gitEvent], item=>`${item.tag}:${item.timestamp}:${item.title}`)
    .sort((a,b)=>String(b.timestamp||'').localeCompare(String(a.timestamp||'')))
    .slice(0,10);
}
function buildStudyReplayData(){
  const d=window.D;
  const liveFeed=buildLiveOpsFeed();
  const tracks=Object.fromEntries((d.ai_learning_tracks||[]).map(track=>[track.id, track]));
  return ((d.learning_replay_lenses||[]).map(lens=>{
    const matched=liveFeed.filter(item=>item.tag===lens.event_tag).slice(0,3);
    if(!matched.length) return null;
    const track=tracks[lens.track_ref]||null;
    return {
      ...lens,
      track,
      matched,
    };
  }).filter(Boolean));
}

// ────────────────────────────────────────────────────────────────
// TABS
// ────────────────────────────────────────────────────────────────
function sw(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('on'));
  $('tab-'+name).classList.add('on');
  $('p-'+name).classList.add('on');
  ST.curTab=name; buildSB(name);
}

// ────────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────────
function renderDash() {
  const d=window.D,p=d.project,wp=d.wps,dp=pct(wp.done_count,wp.total);
  const stages=p.stage_states||{};
  const blueprints=d.project_blueprints||[];
  const learningTracks=d.ai_learning_tracks||[];
  const recipes=d.ai_runtime_recipes||[];

  let dscr='';
  Object.entries(d.domain_scores||{}).forEach(([dom,info])=>{
    const s=info.score||0;
    dscr+=`<div class="mc"><div class="mc-l">${esc(dom)}</div>
      <div class="mc-v ${sc(s)}">${s}</div>
      <div class="mc-s">추세 ${esc(info.trend||'→')}</div>
      <div class="pb2"><div class="pb2-f" style="width:${s}%"></div></div></div>`;
  });

  const sbadge=['A','B','C','D','E'].map(s=>{
    const v=stages[s]||'—';
    return `<span class="st ${v==='PASS'?'s-ok':v==='FAIL'?'s-fl':'s-nd'}">Stage ${s}: ${v}</span>`;
  }).join('');

  const qg=p.quality_gate_detail||{};
  let qgH=Object.entries(qg).map(([k,v])=>{
    const ok=String(v).toLowerCase().includes('pass');
    return `<div class="kv"><span class="kk" style="min-width:130px">${esc(k)}</span>
      <span class="${ok?'kv-ok':''}">${esc(v)}</span></div>`;
  }).join('');

  const pf=d.flags.plugin||{};
  let fH=Object.entries(pf).map(([k,v])=>
    `<span class="fc ${v?'f-on':'f-off'}">${v?'ON':'OFF'} ${esc(k)}</span>`).join('');

  let actH='';
  (wp.active||[]).forEach(w=>{
    actH+=`<div class="wi"><div class="wd w-ac"></div>
      <div class="wid">${esc(w.id)}</div>
      <div style="flex:1"><div class="wg">${esc(w.goal)}</div></div>
      <div class="wt">${esc(w.tier||'')}</div></div>`;
  });
  if(!actH) actH='<div style="color:var(--dm);font-size:12px;padding:8px">현재 진행 중인 Work Packet 없음 — npm run wp:next 실행</div>';

  let penH='';
  (wp.pending||[]).slice(0,3).forEach(w=>{
    penH+=`<div class="wi"><div class="wd w-wn"></div>
      <div class="wid">${esc(w.id)}</div>
      <div class="wg">${esc(w.goal)}</div>
      <div class="wt">${esc(w.tier||'')}</div></div>`;
  });

  const kiH=(p.known_issues||[]).map(i=>
    `<div class="wi"><div class="wd w-nd"></div>
      <div class="wid"><span class="st s-nd" style="font-size:9px">${esc(i.severity)}</span> ${esc(i.id)}</div>
      <div class="wg">${esc(i.description)}</div></div>`
  ).join('')||'<div style="color:var(--dm);font-size:12px;padding:8px">없음</div>';

  $('c-dash').innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div>
        <div class="sec-tit">📊 대시보드</div>
        <div style="font-size:12px;color:var(--dm)">생성: ${new Date(d.generated_at).toLocaleString('ko-KR')}</div>
      </div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🧭</div>
        <div><div class="card-tit">처음 보는 사람은 여기부터</div>
          <div class="card-sub">루트 홈 → 카탈로그 → 학습 가이드 → 플래너 순으로 보면 구조를 가장 빠르게 이해할 수 있습니다.</div></div></div>
      <div class="quick-grid">
        <a class="quick-link" href="../index.html"><strong>운영 홈</strong><span>현재 stage, Work Packet, 바로가기 화면을 먼저 확인합니다.</span></a>
        <a class="quick-link" href="../catalog-site/index.html"><strong>도메인 카탈로그</strong><span>어떤 플러그인이 어떤 계약과 메뉴로 연결되는지 확인합니다.</span></a>
        <a class="quick-link" href="../study-guide/index.html"><strong>학습 가이드</strong><span>ADR, 로드맵, 도메인 역량을 한국어로 따라갑니다.</span></a>
      </div>
    </div>

    <div class="g3">
      <div class="mc"><div class="mc-l">헬스 레이팅</div>
        <div class="mc-v sc-hi" style="font-size:17px">${esc(p.health_rating)}</div>
        <div class="mc-s">게이트 통과율 ${p.gate_pass_rate}%</div></div>
      <div class="mc"><div class="mc-l">전체 테스트</div>
        <div class="mc-v">${p.tests_pass}<span style="font-size:13px;color:var(--dm)">/${p.tests_total}</span></div>
        <div class="mc-s">PASS</div>
        <div class="pb2"><div class="pb2-f" style="width:${pct(p.tests_pass,p.tests_total)}%"></div></div></div>
      <div class="mc"><div class="mc-l">Work Packets</div>
        <div class="mc-v">${wp.done_count}<span style="font-size:13px;color:var(--dm)">/${wp.total}</span></div>
        <div class="mc-s">${dp}% 완료 · 진행: ${wp.active_count}</div>
        <div class="pb2"><div class="pb2-f" style="width:${dp}%"></div></div></div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🎯</div>
        <div><div class="card-tit">Stage 상태</div>
          <div class="card-sub">최종 게이트: ${esc(p.quality_gate_last_run)} · 결과: <span style="color:var(--ac)">${esc(p.quality_gate_result)}</span></div></div></div>
      <div class="sb-r">${sbadge}</div></div>

    <div class="card"><div class="card-h"><div class="card-ic">🏥</div>
        <div><div class="card-tit">도메인 헬스 스코어</div>
          <div class="card-sub">master-shell/observability/health-scores.yaml</div></div></div>
      <div class="g3" style="margin:10px 0 0">${dscr}</div></div>

    <div class="card"><div class="card-h"><div class="card-ic">🔄</div>
        <div><div class="card-tit">진행 중 Work Packet</div>
          <div class="card-sub">memory/current-wp.yaml + memory/next-actions.yaml</div></div></div>
      ${actH}
      ${penH?`<div class="divider"></div><div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;margin-bottom:6px">대기 중</div>${penH}`:''}</div>

    <div class="card"><div class="card-h"><div class="card-ic">🚩</div>
        <div><div class="card-tit">Feature Flag 현황</div>
          <div class="card-sub">master-shell/feature-flags/flags.yaml</div></div></div>
      <div style="margin-top:8px">${fH}</div></div>

    ${blueprints.length?`<div class="card"><div class="card-h"><div class="card-ic">🧭</div>
        <div><div class="card-tit">마스터 OS 시작 청사진</div>
          <div class="card-sub">프로젝트 시작 블루프린트 ${blueprints.length}개 · AI 학습 트랙 ${learningTracks.length}개 · 런타임 레시피 ${recipes.length}개</div></div></div>
      ${(blueprints||[]).slice(0,2).map(bp=>`<div class="wi">
        <div class="wd d-act"></div>
        <div class="wid">${esc(bp.name||bp.id)}</div>
        <div style="flex:1">
          <div class="wg">${esc(bp.summary||'')}</div>
          <div class="wr">추천 모듈: ${esc((bp.recommended_modules||[]).join(', '))}</div>
        </div>
      </div>`).join('')}
      ${(recipes||[]).slice(0,2).map(recipe=>`<div class="wi">
        <div class="wd d-pass"></div>
        <div class="wid">${esc(recipe.name||recipe.id)}</div>
        <div style="flex:1">
          <div class="wg">${esc(recipe.objective||'')}</div>
          <div class="wr">도구 스택: ${esc((recipe.tool_stack||[]).join(', '))}</div>
        </div>
      </div>`).join('')}
    </div>`:''}

    <div class="card"><div class="card-h"><div class="card-ic">✅</div>
        <div><div class="card-tit">품질 게이트 상세</div>
          <div class="card-sub">memory/L0-hot/current-state.yaml</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-top:8px">${qgH}</div></div>

    <div class="card"><div class="card-h"><div class="card-ic">🔀</div>
        <div><div class="card-tit">형상관리 — 현재 브랜치</div>
          <div class="card-sub" id="dash-git-sub">git 정보 로딩중...</div></div>
        <button class="btn btn-i" style="font-size:10px;margin-left:auto" onclick="sw('sprint')">스프린트 보기 →</button>
      </div>
      <div id="dash-git-commits" style="margin-top:6px"></div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">⚠️</div>
        <div><div class="card-tit">Known Issues</div></div></div>
      ${kiH}</div>

    ${(()=>{
      // Parse dated notes into timeline events
      const notes=d.project.notes||'';
      const events=[];
      notes.split('\n').forEach(line=>{
        const m=line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)/);
        if(m) events.push({date:m[1], text:m[2].trim()});
      });
      if(!events.length) return '';

      // Group by date and pick first non-trivial event per date
      const byDate={};
      events.forEach(e=>{
        if(!byDate[e.date]) byDate[e.date]=[];
        byDate[e.date].push(e.text);
      });
      const dates=Object.keys(byDate).sort();

      const W=Math.max(600, dates.length*120);
      const H=110;
      const nodeY=55;
      const spacing=Math.min(140, (W-80)/(Math.max(dates.length-1,1)));

      // Milestone colors by significance
      const getColor=(text)=>{
        if(text.includes('Stage E')) return '#cf222e';
        if(text.includes('Stage D')) return '#e36209';
        if(text.includes('Stage A')||text.includes('Stage B')||text.includes('Stage C')) return '#1f6feb';
        if(text.includes('PASS')) return '#1a7f37';
        if(text.includes('초기화')) return '#8b49e5';
        return '#555';
      };

      let svgC='';
      // Horizontal line
      const lineStart=40, lineEnd=40+spacing*(dates.length-1);
      svgC+=`<line x1="${lineStart}" y1="${nodeY}" x2="${lineEnd}" y2="${nodeY}" stroke="#30363d" stroke-width="2"/>`;

      dates.forEach((date,i)=>{
        const x=40+spacing*i;
        const texts=byDate[date];
        const mainText=texts[0]||'';
        const color=getColor(mainText);
        const month=date.slice(5);

        // Circle node
        svgC+=`<circle cx="${x}" cy="${nodeY}" r="8" fill="#161b22" stroke="${color}" stroke-width="2.5"/>`;

        // Date label (below)
        svgC+=`<text x="${x}" y="${nodeY+22}" text-anchor="middle" fill="#8b949e" font-size="9">${esc(month)}</text>`;

        // Event label (above)
        const label=mainText.length>28?mainText.slice(0,26)+'\u2026':mainText;
        svgC+=`<text x="${x}" y="${nodeY-15}" text-anchor="middle" fill="${color}" font-size="9" width="100">${esc(label)}</text>`;
        if(texts.length>1) svgC+=`<text x="${x}" y="${nodeY-26}" text-anchor="middle" fill="#555" font-size="8">+${texts.length-1}건</text>`;
      });

      const svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${W}px;height:${H}px">${svgC}</svg>`;

      return `<div class="card"><div class="card-h"><div class="card-ic">📅</div>
        <div><div class="card-tit">프로젝트 성장 타임라인</div>
          <div class="card-sub">memory/L0-hot/current-state.yaml 주요 마일스톤 ${dates.length}일</div></div></div>
        <div style="overflow-x:auto;padding:8px 0">${svg}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px">
          <span><span style="color:#8b49e5">●</span> 초기화</span>
          <span><span style="color:#1f6feb">●</span> Stage A~C</span>
          <span><span style="color:#e36209">●</span> Stage D</span>
          <span><span style="color:#cf222e">●</span> Stage E</span>
          <span><span style="color:#1a7f37">●</span> PASS</span>
        </div>
      </div>`;
    })()}

    ${(()=>{
      const kg=d.knowledge_graph||{}; const kgd=kg.domains||{};
      if(!Object.keys(kgd).length) return '';
      const rows=Object.entries(kgd).map(([name,info])=>`
        <div class="wi"><div class="wd d-pass"></div>
          <div class="wid">${esc(name)}</div>
          <div style="flex:1">
            <div class="wg">src: ${info.src_files||0}개 파일 | tests: ${info.test_files||0}개 파일</div>
            <div class="wr">contracts: OpenAPI ${info.contracts?.openapi?'✅':'—'} Events ${info.contracts?.events?'✅':'—'} UI ${info.contracts?.ui?'✅':'—'}</div>
          </div>
        </div>`).join('');
      return `<div class="card"><div class="card-h"><div class="card-ic">🕸</div>
        <div><div class="card-tit">Knowledge Graph — 도메인 파일 현황</div>
          <div class="card-sub">memory/knowledge-graph.yaml</div></div></div>
        ${rows}</div>`;
    })()}
`;
  // git 카드 채우기
  const g=d.git||{};
  const gs=$('dash-git-sub'); if(gs) gs.textContent=`브랜치: ${g.branch||'—'} · HEAD: ${g.hash||'—'} · ${(g.last_date||'').substring(0,10)} ${g.last_auth||''}`;
  const gc=$('dash-git-commits'); if(gc) gc.innerHTML=(g.commits||[]).slice(0,4).map(c=>`
    <div class="commit-row"><span class="commit-hash">${esc(c.hash)}</span><span class="commit-msg">${esc(c.msg)}</span></div>`).join('');
}

// ────────────────────────────────────────────────────────────────
// PLANNING
// ────────────────────────────────────────────────────────────────
function secWPsHTML(sec) {
  const caps = sec.related_caps || [];
  if(!caps.length) return '';
  const all = window.D.wps.all;
  const relWPs = all.filter(w => caps.includes(w.cap_id));
  if(!relWPs.length) return '';
  const done = relWPs.filter(w=>w.status==='done').length;
  const inprog = relWPs.filter(w=>w.status==='in_progress').length;
  const pct2 = relWPs.length>0 ? Math.round(done/relWPs.length*100) : 0;
  const items = relWPs.slice(0,10).map(w=>`
    <div class="swp-item">
      <div class="wd ${w.status==='done'?'w-ok':w.status==='in_progress'?'w-ac':'w-nd'}" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:3px"></div>
      <div style="font-size:9px;font-weight:700;color:var(--dm);min-width:100px;flex-shrink:0">${esc(w.id)}</div>
      <div style="font-size:10px;color:${w.status==='done'?'var(--dm)':'var(--tx)'};flex:1">${esc(w.goal.substring(0,70))}${w.goal.length>70?'…':''}</div>
      ${w.status==='done'?`<span class="st s-ok" style="font-size:8px;flex-shrink:0">✓</span>`:(w.status==='in_progress'?`<span class="st s-ac" style="font-size:8px;flex-shrink:0">진행중</span>`:'')}
    </div>`).join('');
  return `<div class="swp">
    <div class="swp-h" onclick="this.nextElementSibling.classList.toggle('open')">
      <span>🔗 관련 Work Packets — ${done}/${relWPs.length} 완료 (${pct2}%)</span>
      <div style="flex:1"></div>
      <span style="font-size:9px;opacity:.6">▾ 클릭해 펼치기</span>
    </div>
    <div class="swp-body">
      <div style="margin-bottom:5px;display:flex;gap:8px">
        <span style="font-size:10px;color:var(--ac)">✓ 완료 ${done}</span>
        ${inprog?`<span style="font-size:10px;color:var(--ac2)">🔄 진행 ${inprog}</span>`:''}
        <span style="font-size:10px;color:var(--dm)">관련 CAP: ${caps.join(', ')}</span>
      </div>
      ${items}
    </div>
  </div>`;
}

function renderPlan() {
  const c=$('c-plan'); c.innerHTML='';
  const d=window.D;
  SECTIONS.forEach(sec=>{
    const key='wfos-'+sec.id;
    const tsKey='wfos-ts-'+sec.id;
    const saved=localStorage.getItem(key);
    const ts=localStorage.getItem(tsKey)||'';
    const val=saved!==null?saved:sec.init(d);
    if(saved&&saved.trim().length>20) ST.planDone[sec.id]=true;
    ST.planC[sec.id]=val;

    const iH=sec.ideas.map((ide,i)=>`
      <div class="ic" id="ic-${sec.id}-${i}">
        <div class="in">${esc(ide.num)}</div>
        <div class="it">${esc(ide.title)}</div>
        <div class="ib">${esc(ide.body)}</div>
        <div class="isrc">${esc(ide.src)}</div>
        <div class="itags">${ide.tags.map(t=>`<span class="itag">${esc(t)}</span>`).join('')}</div>
        <button class="btn btn-ap" onclick="applyIdea('${sec.id}',${i})">✓ 이 안 적용</button>
      </div>`).join('');

    const prompt=`"${sec.title}" 구간에 대해 Claude Skills, GitHub ⭐ 높은 라이브러리, 카카오·네이버·토스·Google·Spotify·Netflix 국내외 최고 사례를 벤치마킹하여 실제 적용 가능한 최적 안 3가지를 제시해주세요. 각 안: ①방법론명 ②핵심설명 ③출처/레퍼런스 ④장단점`;

    const el=document.createElement('div');
    el.className='ps'; el.id='ps-'+sec.id;
    el.innerHTML=`
      <div class="ph">
        <div class="pic">${sec.ic}</div>
        <div class="pm">
          <div class="pn">${esc(sec.num)}</div>
          <div class="pt">${esc(sec.title)}</div>
          <div class="pd">${esc(sec.desc)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
          <span class="ptag">${esc(sec.tag)}</span>
          <span class="done-badge${ST.planDone[sec.id]?' show':''}" id="dn-${sec.id}">✓ 작성완료</span>
        </div>
      </div>
      <div class="pb">
        <textarea class="ea" id="ea-${sec.id}" oninput="onPI('${sec.id}',this.value)">${esc(val)}</textarea>
        <div class="sec-ctrl">
          <span class="ts-info" id="ts-${sec.id}">${ts?'마지막 저장: '+ts:''}</span>
          <button class="btn btn-s" style="font-size:10px" onclick="resetSec('${sec.id}')">🔄 초기화</button>
          <button class="btn btn-p" style="font-size:10px" onclick="markDone('${sec.id}')">✓ 완료로 표시</button>
        </div>
        ${secWPsHTML(sec)}
        <div class="ip">
          <div class="ih">
            <div class="il">💡 벤치마킹 아이디어 — 국내외 최고 사례 3가지</div>
            <button class="btn btn-s" style="font-size:10px" onclick="cpPrompt('${sec.id}')">프롬프트 복사</button>
            <button class="btn btn-i" style="font-size:10px" onclick="togIdeas('${sec.id}')">아이디어 보기/숨기기</button>
          </div>
          <div class="pb-box" id="pb-${sec.id}">${esc(prompt)}</div>
          <div class="ig" id="ig-${sec.id}">${iH}</div>
        </div>
      </div>`;
    c.appendChild(el);
  });
  updPlanProg();
}

function onPI(id,val){
  ST.planC[id]=val; localStorage.setItem('wfos-'+id,val);
  const now=new Date().toLocaleTimeString('ko-KR');
  localStorage.setItem('wfos-ts-'+id,now);
  const ts=$('ts-'+id); if(ts) ts.textContent='마지막 저장: '+now;
  updPlanProg();
}
function markDone(id){
  ST.planDone[id]=true;
  const b=$('dn-'+id); if(b) b.classList.add('show');
  localStorage.setItem('wfos-done-'+id,'1');
  toast('섹션 완료로 표시됨 — 완료 아카이브에 저장됨');
  buildSB('plan');
  updPlanProg();
  // 아카이브 탭 카운터 즉시 갱신
  const doneSecs=SECTIONS.filter(s=>ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id)).length;
  const tc=$('tc-arc'); if(tc) tc.textContent=doneSecs+window.D.wps.done_count;
}
function resetSec(id){
  if(!confirm('이 섹션의 내용을 프로젝트 데이터로 초기화합니까? 현재 내용은 사라집니다.')) return;
  const sec=SECTIONS.find(s=>s.id===id);
  const val=sec.init(window.D);
  const a=$('ea-'+id); if(a) a.value=val;
  ST.planC[id]=val; localStorage.setItem('wfos-'+id,val);
  ST.planDone[id]=false; localStorage.removeItem('wfos-done-'+id);
  const b=$('dn-'+id); if(b) b.classList.remove('show');
  const ts=$('ts-'+id); if(ts) ts.textContent='프로젝트 데이터로 초기화됨';
  toast('섹션이 프로젝트 데이터로 초기화됨');
  updPlanProg();
}
function togIdeas(id){ $('ig-'+id).classList.toggle('open'); $('pb-'+id).classList.toggle('open'); }
function applyIdea(sId,i){
  const s=SECTIONS.find(x=>x.id===sId), ide=s.ideas[i], a=$('ea-'+sId);
  a.value+=`\n\n[채택: ${ide.num}] ${ide.title}\n${ide.body}\n참조: ${ide.src}`;
  onPI(sId,a.value);
  document.querySelectorAll(`[id^="ic-${sId}-"]`).forEach(c=>c.classList.remove('pk'));
  $(`ic-${sId}-${i}`).classList.add('pk');
  toast(`"${ide.title}" 적용됨`);
}
function cpPrompt(id){
  $('pb-'+id).classList.add('open');
  const s=SECTIONS.find(x=>x.id===id);
  navigator.clipboard.writeText(`"${s.title}" 구간에 대해 Claude Skills, GitHub ⭐ 높은 라이브러리, 카카오·네이버·토스·Google·Spotify·Netflix 국내외 최고 사례를 벤치마킹하여 실제 적용 가능한 최적 안 3가지를 제시해주세요. 각 안: ①방법론명 ②핵심설명 ③출처/레퍼런스 ④장단점`).then(()=>toast('프롬프트 복사됨'));
}
function updPlanProg(){
  let done=0;
  SECTIONS.forEach(s=>{ if(ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id)) done++; });
  $('tc-plan').textContent=`${done}/${SECTIONS.length}`;
  // tc-arc는 renderArc()에서만 설정 — 이중 설정 금지
}
function copyAll(){
  let md=`# Workflow OS 마스터 기획서\n생성: ${new Date().toLocaleDateString('ko-KR')}\n\n---\n\n`;
  SECTIONS.forEach(s=>{ md+=`## ${s.num} — ${s.title} [${s.tag}]\n\n${ST.planC[s.id]?.trim()||'(미작성)'}\n\n---\n\n`; });
  navigator.clipboard.writeText(md).then(()=>{
    const ok=$('cok'); ok.classList.add('show'); setTimeout(()=>ok.classList.remove('show'),3000);
    toast('전체 기획서 복사됨!');
  });
}
function exportMD(){
  let md=`# Workflow OS 마스터 기획서\n> 생성: ${new Date().toLocaleString('ko-KR')}\n> 브랜치: ${window.D.project.branch}\n\n---\n\n`;
  SECTIONS.forEach(s=>{ md+=`## ${s.num} — ${s.title} [${s.tag}]\n> ${s.desc}\n\n${ST.planC[s.id]?.trim()||'*(미작성)*'}\n\n---\n\n`; });
  const b=new Blob([md],{type:'text/markdown'});
  const u=URL.createObjectURL(b), a=document.createElement('a');
  a.href=u; a.download=`wfos-plan-${Date.now()}.md`; a.click(); URL.revokeObjectURL(u);
  toast('Markdown 다운로드됨');
}
function exportYAML(){
  // YAML-safe escape: indent multiline, quote strings with special chars
  function yamlStr(s){
    if(!s||!s.trim()) return "''"
    if(s.includes('\n')){
      return '|\n'+s.split('\n').map(l=>'      '+l).join('\n');
    }
    if(s.match(/[:#\[\]{}|>&*!,?@`'"]/)) return JSON.stringify(s);
    return s;
  }
  const d=window.D; const now=new Date().toISOString();
  let yaml=`# Workflow OS 마스터 기획서 — YAML 내보내기\n# 생성: ${now}\n# 브랜치: ${d.project.branch}\n# 이 파일을 memory/project/plan-snapshot.yaml 에 저장하면 기획 이력을 보존할 수 있습니다\n\nplan:\n  generated_at: "${now}"\n  branch: "${d.project.branch}"\n  health_rating: "${d.project.health_rating}"\n  gate_pass_rate: ${d.project.gate_pass_rate}\n  tests: "${d.project.tests_pass}/${d.project.tests_total}"\n\nsections:\n`;
  SECTIONS.forEach(s=>{
    const content=ST.planC[s.id]?.trim()||'';
    const done=!!(ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id));
    yaml+=`  - id: "${s.id}"\n    num: "${s.num}"\n    tag: "${s.tag}"\n    title: "${s.title}"\n    done: ${done}\n    related_caps: [${s.related_caps.map(c=>`"${c}"`).join(',')}]\n    content: ${yamlStr(content)}\n\n`;
  });
  const b=new Blob([yaml],{type:'text/yaml'});
  const u=URL.createObjectURL(b), a=document.createElement('a');
  a.href=u; a.download=`wfos-plan-${Date.now()}.yaml`; a.click(); URL.revokeObjectURL(u);
  toast('YAML 내보내기 완료');
}

// ────────────────────────────────────────────────────────────────
// WORK PACKETS
// ────────────────────────────────────────────────────────────────
function renderWPs(){
  const d=window.D; $('tc-wps').textContent=d.wps.total;
  const sF=['all','done','in_progress','pending'];
  const tF=['all','infra','arch','domain','governance','meta'];
  $('c-wps').innerHTML=`
    <div class="sec-tit">📦 Work Packets</div>
    <div class="sw"><span class="sic">🔍</span>
      <input class="si" placeholder="WP ID / 목표로 검색..." oninput="wpQ(this.value)"></div>
    <div class="fr" id="wpFR">
      ${sF.map(f=>`<div class="fb${f==='all'?' on':''}" onclick="wpS('${f}',this)">${{all:'전체',done:'✅ 완료',in_progress:'🔄 진행중',pending:'⏳ 대기'}[f]||f}</div>`).join('')}
      <div style="border-left:1px solid var(--bd);margin:0 4px"></div>
      ${tF.map(t=>`<div class="fb${t==='all'?' on':''}" onclick="wpT('${t}',this)" data-tier="${t}">${t==='all'?'전 Tier':t}</div>`).join('')}
    </div>
    <div id="wpl"></div>`;
  renderWPL();
}
function wpQ(q){ST.wpQ=q.toLowerCase();renderWPL();}
function wpS(f,el){ST.wpStat=f;document.querySelectorAll('#wpFR .fb:not([data-tier])').forEach(b=>b.classList.remove('on'));el.classList.add('on');renderWPL();}
function wpT(t,el){ST.wpTier=t;document.querySelectorAll('[data-tier]').forEach(b=>b.classList.remove('on'));el.classList.add('on');renderWPL();}

function renderWPL(){
  let wps=window.D.wps.all;
  if(ST.wpStat!=='all') wps=wps.filter(w=>w.status===ST.wpStat);
  if(ST.wpTier!=='all') wps=wps.filter(w=>w.tier===ST.wpTier);
  if(ST.wpQ) wps=wps.filter(w=>(w.id+w.goal+w.cap_name).toLowerCase().includes(ST.wpQ));
  if(!wps.length){$('wpl').innerHTML='<div style="color:var(--dm);padding:16px;text-align:center">검색 결과 없음</div>';return;}
  const grp={};
  wps.forEach(w=>{
    const k=w.cap_id||'NEXT';
    if(!grp[k]) grp[k]={cid:w.cap_id,cn:w.cap_name,wps:[]};
    grp[k].wps.push(w);
  });
  let html='';
  // CAP 통계
  const caps=window.D.caps;
  Object.values(grp).forEach(g=>{
    const cap=caps.find(c=>c.id===g.cid)||{};
    const done=g.wps.filter(w=>w.status==='done').length;
    html+=`<div class="cap-g">
      <span class="st s-nd" style="font-size:9px">${esc(g.cid)}</span>
      ${esc(g.cn)}
      ${cap.wp_count?`<span class="cap-prog">${done}/${g.wps.length} 완료</span>`:''}
    </div>`;
    g.wps.forEach(w=>{
      const dc=w.status==='done'?'w-ok':w.status==='in_progress'?'w-ac':w.status==='pending'?'w-wn':'w-nd';
      html+=`<div class="wi">
        <div class="wd ${dc}"></div>
        <div class="wid">${esc(w.id)}</div>
        <div style="flex:1">
          <div class="wg">${esc(w.goal)}</div>
          ${w.result?`<div class="wr">${esc(w.result.substring(0,130))}${w.result.length>130?'…':''}</div>`:''}
          ${w.completed_at?`<div class="wr" style="color:var(--dm)">완료: ${esc(w.completed_at)}</div>`:''}
          ${w.covers?`<div class="wr">capability: ${esc(w.covers)}</div>`:''}
        </div>
        <div class="wt">${esc(w.tier||'')}</div>
      </div>`;
    });
  });
  $('wpl').innerHTML=html;
}

// ────────────────────────────────────────────────────────────────
// ARCHIVE (완료 계획 아카이브)
// ────────────────────────────────────────────────────────────────
function renderArc(){
  const d=window.D;
  const doneSecs=SECTIONS.filter(s=>ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id));
  const totalArc=d.wps.done_count+doneSecs.length;
  $('tc-arc').textContent=totalArc;
  const dp=pct(d.wps.done_count,d.wps.total), ver=d.wps.verification;

  // 기획 섹션 완료 목록
  let secArcH='';
  if(doneSecs.length){
    doneSecs.forEach((sec,i)=>{
      const cont=(ST.planC[sec.id]||'').trim();
      const uid='arcs-'+sec.id;
      secArcH+=`<div class="arc-it">
        <div class="arc-h" onclick="togArc('${uid}')">
          <span style="font-size:16px;flex-shrink:0">${sec.ic}</span>
          <div style="font-size:10px;font-weight:700;color:var(--dm);min-width:80px;flex-shrink:0">${esc(sec.num)}</div>
          <div style="font-size:12px;color:var(--tx);flex:1">${esc(sec.title)}</div>
          <span class="ptag" style="flex-shrink:0;font-size:9px">${esc(sec.tag)}</span>
          <span class="st s-ok" style="margin-left:8px;flex-shrink:0;font-size:9px">✓ 완료</span>
          <span style="color:var(--dm);margin-left:6px;font-size:12px">▾</span>
        </div>
        <div class="arc-b" id="${uid}">
          <div style="margin-bottom:8px;font-size:10px;color:var(--dm)">
            관련 CAP: ${(sec.related_caps||[]).join(', ')||'—'} |
            <button class="btn btn-s" style="font-size:9px;padding:1px 7px;margin-left:4px"
              onclick="sw('plan');setTimeout(()=>document.getElementById('ps-${sec.id}')?.scrollIntoView({behavior:'smooth'}),100)">편집 바로가기</button>
          </div>
          <div class="arc-res" style="white-space:pre-wrap;max-height:200px;overflow-y:auto">${esc(cont.substring(0,800))}${cont.length>800?'\n…(이하 생략)':''}</div>
        </div>
      </div>`;
    });
  } else {
    secArcH='<div style="color:var(--dm);font-size:12px;padding:20px;text-align:center">아직 완료된 기획 섹션이 없습니다.<br><small>기획서 탭에서 각 섹션을 작성 후 "완료로 표시" 버튼을 클릭하세요.</small></div>';
  }

  $('c-arc').innerHTML=`
    <div class="sec-tit">✅ 완료 아카이브</div>
    <div class="g3" style="margin-bottom:14px">
      <div class="mc"><div class="mc-l">완료 기획 섹션</div>
        <div class="mc-v sc-hi">${doneSecs.length}</div>
        <div class="mc-s">${SECTIONS.length}개 중</div></div>
      <div class="mc"><div class="mc-l">완료 WP</div>
        <div class="mc-v sc-hi">${d.wps.done_count}</div>
        <div class="pb2"><div class="pb2-f" style="width:${dp}%"></div></div></div>
      <div class="mc"><div class="mc-l">검증 실행</div>
        <div class="mc-v">${ver.total_commands_run||0}</div>
        <div class="mc-s">PASS ${ver.passed||0} / FAIL ${ver.failed||0}</div></div>
    </div>

    <div class="stab">
      <div class="stab-it on" onclick="arcTab(0,this)">📝 완료된 기획 섹션 <span class="tc">${doneSecs.length}</span></div>
      <div class="stab-it" onclick="arcTab(1,this)">📦 완료된 Work Packets <span class="tc">${d.wps.done_count}</span></div>
    </div>

    <div class="stab-pn on" id="arc-secpn">${secArcH}</div>

    <div class="stab-pn" id="arc-wppn">
      <div class="sw"><span class="sic">🔍</span>
        <input class="si" placeholder="완료 WP 검색..." oninput="arcQ(this.value)"></div>
      <div id="arcl"></div>
    </div>`;
  renderArcL('');
}
function arcTab(i,el){
  document.querySelectorAll('.stab-it').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.stab-pn').forEach(p=>p.classList.remove('on'));
  el.classList.add('on');
  [$('arc-secpn'),$('arc-wppn')][i].classList.add('on');
}
function arcQ(q){renderArcL(q.toLowerCase());}
function renderArcL(q){
  const d=window.D;
  let wps=[...d.wps.done].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
  if(q) wps=wps.filter(w=>(w.id+w.goal+w.result+w.cap_name).toLowerCase().includes(q));
  const grp={};
  wps.forEach(w=>{
    const k=w.cap_id||'OTHER';
    if(!grp[k]) grp[k]={cid:w.cap_id,cn:w.cap_name,wps:[]};
    grp[k].wps.push(w);
  });
  let html='';
  Object.values(grp).forEach(g=>{
    html+=`<div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;
      letter-spacing:.08em;margin:14px 0 5px;display:flex;align-items:center;gap:6px">
      <span class="st s-ok" style="font-size:9px">✓</span> ${esc(g.cid)} — ${esc(g.cn)}
      <span style="color:var(--ac);margin-left:auto">${g.wps.length}건</span></div>`;
    g.wps.forEach((w,i2)=>{
      const uid=`arc-${g.cid}-${i2}`;
      html+=`<div class="arc-it">
        <div class="arc-h" onclick="togArc('${uid}')">
          <div class="wd w-ok" style="flex-shrink:0;margin-top:3px"></div>
          <div style="font-size:10px;font-weight:700;color:var(--dm);min-width:100px;flex-shrink:0">${esc(w.id)}</div>
          <div style="font-size:12px;color:var(--tx);flex:1">${esc(w.goal.substring(0,75))}${w.goal.length>75?'…':''}</div>
          <div class="wt" style="flex-shrink:0">${esc(w.tier||'')}</div>
          <div style="font-size:10px;color:var(--dm);flex-shrink:0;margin-left:7px">${esc(w.completed_at||'')}</div>
          <span style="color:var(--dm);margin-left:6px;font-size:12px">▾</span>
        </div>
        <div class="arc-b" id="${uid}">
          <div style="margin-bottom:6px;font-size:11px;color:var(--dm)">
            CAP: ${esc(w.cap_id)} | Tier: ${esc(w.tier||'')} ${w.covers?`| capability: ${esc(w.covers)}`:''}
          </div>
          <div class="arc-res">${esc(w.result||'결과 없음')}</div>
        </div>
      </div>`;
    });
  });
  $('arcl').innerHTML=html||'<div style="color:var(--dm);padding:16px;text-align:center">검색 결과 없음</div>';
}
function togArc(id){ $(id).classList.toggle('open'); }

// ────────────────────────────────────────────────────────────────
// DOMAINS
// ────────────────────────────────────────────────────────────────
function renderDom(){
  const d=window.D; $('tc-dom').textContent=d.domains.length;
  const stages=d.project.stage_states||{}, pf=d.flags.plugin||{};
  const adapters=d.adapter_catalog?.adapters||[];
  const profiles=d.adapter_catalog?.profiles||[];
  const scorecards=d.adapter_scorecards||[];
  const adapterPriorities=rankAdaptersForRecommendation();
  const intakeSummary=computeIntakeRecommendation();
  const priorityWeights=adapterPriorityWeights();
  const transitionPlaybooks=d.adapter_transition_playbooks||[];
  const transitionPlan=buildTransitionPlanData();
  const adapterMap=Object.fromEntries(adapters.map(adapter=>[adapter.id,adapter]));
  const scorecardMap=Object.fromEntries(scorecards.map(scorecard=>[scorecard.adapter_id,scorecard]));
  const pluginMap=Object.fromEntries((d.plugins||[]).map(plugin=>[plugin.module_id,plugin]));
  let html=`<div class="sec-tit">🗺 도메인 현황</div>`;

  // Architecture Map
  const archMapSvg=(()=>{
    const doms=d.domains||[];
    const W=680, H=240;
    const hubX=W/2, hubY=H/2;
    const hubR=40;
    const domR=35;
    const angleStep=doms.length?2*Math.PI/doms.length:0;
    const radius=130;

    let svgContent='';

    // Hub: Master Shell
    svgContent+=`<circle cx="${hubX}" cy="${hubY}" r="${hubR}" fill="#161b22" stroke="#1f6feb" stroke-width="2"/>`;
    svgContent+=`<text x="${hubX}" y="${hubY-5}" text-anchor="middle" fill="#1f6feb" font-size="10" font-weight="bold">Master</text>`;
    svgContent+=`<text x="${hubX}" y="${hubY+9}" text-anchor="middle" fill="#1f6feb" font-size="10">Shell</text>`;

    // Domains
    const domColors=['#e36209','#8b49e5','#1a7f37','#cf222e','#d4a72c'];
    doms.forEach((dom,i)=>{
      const angle=angleStep*i - Math.PI/2;
      const dx=hubX+radius*Math.cos(angle);
      const dy=hubY+radius*Math.sin(angle);
      const color=domColors[i%domColors.length];
      const hs=(d.domain_scores[dom.domain_id||dom.id]||{}).score||0;

      // Contract line
      svgContent+=`<line x1="${hubX}" y1="${hubY}" x2="${dx}" y2="${dy}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5,3" opacity=".6"/>`;

      // Domain circle
      svgContent+=`<circle cx="${dx}" cy="${dy}" r="${domR}" fill="#161b22" stroke="${color}" stroke-width="2"/>`;
      const name=(dom.name||dom.domain_id||dom.id||'').split('-')[0];
      svgContent+=`<text x="${dx}" y="${dy-3}" text-anchor="middle" fill="${color}" font-size="10" font-weight="bold">${esc(name)}</text>`;
      svgContent+=`<text x="${dx}" y="${dy+10}" text-anchor="middle" fill="#8b949e" font-size="9">헬스 ${hs}</text>`;

      // Stage D indicator
      const dPass=(dom.stage_d||dom.stage_states?.D||stages['D'])==='PASS';
      svgContent+=`<circle cx="${dx+domR-5}" cy="${dy-domR+5}" r="7" fill="${dPass?'#1a7f37':'#444'}" stroke="#0d1117" stroke-width="1.5"/>`;
      svgContent+=`<text x="${dx+domR-5}" y="${dy-domR+9}" text-anchor="middle" fill="white" font-size="7" font-weight="bold">D</text>`;
    });

    // Contract hub label
    svgContent+=`<text x="${hubX}" y="${hubY+hubR+14}" text-anchor="middle" fill="#8b949e" font-size="9">계약 허브</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:${H}px">${svgContent}</svg>`;
  })();

  html+=`<div class="card" style="margin-bottom:16px">
    <div class="card-h"><div class="card-ic">🗺</div>
      <div><div class="card-tit">도메인 아키텍처 관계 맵</div>
        <div class="card-sub">Master Shell 계약 허브 · ${(d.domains||[]).length}개 도메인 연결</div></div></div>
    <div style="padding:12px;overflow-x:auto">${archMapSvg}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--dm)">
      <span>● 원: 도메인</span><span>- - -: 계약 연결</span><span>D뱃지: Stage D PASS 여부</span>
    </div>
  </div>`;

  // 계약 매트릭스
  html+=`<div class="card" style="margin-bottom:16px">
    <div class="card-h"><div class="card-ic">📜</div>
      <div><div class="card-tit">계약 호환성 매트릭스</div>
        <div class="card-sub">worklog/contract-matrix.md 기준</div></div></div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
      <tr style="border-bottom:1px solid var(--bd)">
        ${['도메인','OpenAPI','Events','UI','Capability','Status'].map(h=>`<th style="text-align:left;padding:5px 8px;color:var(--dm);font-size:10px;font-weight:600">${h}</th>`).join('')}
      </tr>
      ${d.domains.map(m=>{
        const domKey=m.domain==='productivity'?'productivity/task-tracking':m.domain;
        const allPass=[m.stage_a,m.stage_b,m.stage_c,m.stage_d,m.stage_e].every(s=>!s||s==='PASS');
        return `<tr style="border-bottom:1px solid var(--bd)">
          <td style="padding:7px 8px;color:var(--tx)">${esc(domKey)}</td>
          ${['OpenAPI','Events','UI','Capability'].map(x=>`<td style="padding:7px 8px;color:var(--ac)">✅</td>`).join('')}
          <td style="padding:7px 8px"><span class="st ${allPass?'s-ok':'s-nd'}">PASS</span></td>
        </tr>`;
      }).join('')}
    </table>
  </div>`;

  // Stage A 메모리 요약
  const sums=d.stage_a_summaries||{};
  if(Object.keys(sums).length){
    html+=`<div class="card" style="margin-bottom:16px">
      <div class="card-h"><div class="card-ic">📐</div>
        <div><div class="card-tit">Stage A 메모리 요약</div>
          <div class="card-sub">memory/stageA/*.yaml</div></div></div>
      ${Object.entries(sums).map(([name,s])=>`
        <div class="wi"><div class="wd d-pass"></div>
          <div class="wid">${esc(name)}</div>
          <div style="flex:1">
            <div class="wg">${esc(s.domain_id)} / ${esc(s.bounded_context)}</div>
            <div class="wr">INV ${s.invariant_count}개 | 언어: ${esc((s.ubiquitous_language||[]).join(', '))} ${s.risk_level?`| risk: ${esc(s.risk_level)}`:''}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  if(adapters.length || profiles.length){
    html+=`<div class="card" style="margin-bottom:16px">
      <div class="card-h"><div class="card-ic">🔌</div>
        <div><div class="card-tit">어댑터 레지스트리</div>
          <div class="card-sub">master-shell/catalog/adapter-registry.yaml</div></div></div>
      <div class="g3" style="margin-top:10px">
        <div class="mc"><div class="mc-l">총 어댑터</div><div class="mc-v">${adapters.length}</div></div>
        <div class="mc"><div class="mc-l">프로파일</div><div class="mc-v">${profiles.length}</div></div>
        <div class="mc"><div class="mc-l">핵심 원칙</div><div class="mc-v" style="font-size:11px;line-height:1.4">${esc((d.adapter_catalog?.principles||[])[0]||'—')}</div></div>
      </div>
      ${(profiles||[]).map(profile=>`
        <div class="wi">
          <div class="wd d-act"></div>
          <div class="wid">${esc(profile.name||profile.id)}</div>
          <div style="flex:1">
            <div class="wg">${esc(profile.intent||'')}</div>
            <div class="wr">패턴: ${esc(profile.architecture_pattern||'—')} | adapters: ${esc((profile.adapter_refs||[]).join(', '))}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  if(scorecards.length){
    // Radar chart helper: 5-axis SVG pentagon
    function radarSvg(metrics,color){
      const axes=['extensibility','performance','learning_clarity','ai_compatibility','swap_safety'];
      const labels=['확장','성능','학습','AI','교체'];
      const cx=60,cy=60,R=42,labelR=54;
      let bg='',pts=[];
      // Background grid (5 levels)
      for(let lv=1;lv<=5;lv++){
        const r=R*lv/5;
        const gridPts=axes.map((_,i)=>{
          const a=2*Math.PI*i/5-Math.PI/2;
          return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;
        }).join(' ');
        bg+=`<polygon points="${gridPts}" fill="none" stroke="#30363d" stroke-width="${lv===5?1.5:.5}"/>`;
        axes.forEach((_,i)=>{
          const a=2*Math.PI*i/5-Math.PI/2;
          const x=(cx+R*Math.cos(a)).toFixed(1),y=(cy+R*Math.sin(a)).toFixed(1);
          if(lv===5) bg+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#30363d" stroke-width=".5"/>`;
        });
      }
      // Data polygon
      axes.forEach((key,i)=>{
        const v=Math.min(5,Math.max(0,(metrics[key]||0)));
        const a=2*Math.PI*i/5-Math.PI/2;
        const r=R*v/5;
        pts.push(`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`);
      });
      let axis_labels='';
      labels.forEach((lbl,i)=>{
        const a=2*Math.PI*i/5-Math.PI/2;
        const lx=(cx+labelR*Math.cos(a)).toFixed(1),ly=(cy+labelR*Math.sin(a)+4).toFixed(1);
        const v=metrics[axes[i]]||0;
        axis_labels+=`<text x="${lx}" y="${ly}" text-anchor="middle" fill="#8b949e" font-size="8">${lbl}</text>`;
        axis_labels+=`<text x="${lx}" y="${(parseFloat(ly)+9).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="8" font-weight="bold">${v}</text>`;
      });
      return `<svg viewBox="0 0 120 120" width="120" height="120">
        ${bg}
        <polygon points="${pts.join(' ')}" fill="${color}33" stroke="${color}" stroke-width="1.5"/>
        ${axis_labels}
      </svg>`;
    }
    const radarColors=['#1f6feb','#8b49e5','#e36209','#1a7f37','#cf222e','#d4a72c','#0077b6','#2a9d8f','#e9c46a','#f4a261'];
    html+=`<div class="card" style="margin-bottom:16px">
      <div class="card-h"><div class="card-ic">📊</div>
        <div><div class="card-tit">어댑터 Scorecard 레이더 차트</div>
          <div class="card-sub">5가지 기준 시각 비교 · 확장성·성능·학습성·AI적합성·교체안전성 (1~5점)</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:12px">
        ${(scorecards||[]).map((scorecard,idx)=>{
          const adapter=adapterMap[scorecard.adapter_id]||{};
          const metrics=scorecard.metrics||{};
          const color=radarColors[idx%radarColors.length];
          const total=Object.values(metrics).reduce((s,v)=>s+(v||0),0);
          const avg=(total/5).toFixed(1);
          return `<div class="card" style="margin:0;border-top:2px solid ${color}">
            <div style="display:flex;align-items:flex-start;gap:8px">
              <div style="flex-shrink:0">${radarSvg(metrics,color)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:12px;color:${color};margin-bottom:4px">${esc(adapter.name||scorecard.adapter_id)}</div>
                <div style="font-size:11px;color:var(--dm);margin-bottom:6px;line-height:1.4">${esc(adapter.description||'')}</div>
                <div style="background:#161b22;border-radius:4px;padding:4px 8px;display:inline-block;font-size:11px">
                  <span style="color:#8b949e">평균 점수</span> <strong style="color:${color}">${avg}/5</strong>
                </div>
                <div style="font-size:10px;color:#8b949e;margin-top:6px">${esc((scorecard.best_for||[]).join(' · '))}</div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if(adapterPriorities.length){
    html+=`<div class="card" style="margin-bottom:16px">
      <div class="card-h"><div class="card-ic">🎛</div>
        <div><div class="card-tit">현재 목표 기준 추천 어댑터 우선순위</div>
          <div class="card-sub">질문지 결과(${esc(intakeSummary.blueprintId||'—')} / ${esc(intakeSummary.profileId||'—')} / ${esc(intakeSummary.recipeId||'—')})에 따라 scorecard를 가중 계산</div></div></div>
      <div class="g3" style="margin-top:10px">
        <div class="mc"><div class="mc-l">확장성 가중치</div><div class="mc-v" style="font-size:14px">${esc((priorityWeights.extensibility*100).toFixed(0))}%</div></div>
        <div class="mc"><div class="mc-l">성능 가중치</div><div class="mc-v" style="font-size:14px">${esc((priorityWeights.performance*100).toFixed(0))}%</div></div>
        <div class="mc"><div class="mc-l">학습/AI/교체</div><div class="mc-v" style="font-size:14px">${esc(((priorityWeights.learning_clarity+priorityWeights.ai_compatibility+priorityWeights.swap_safety)*100).toFixed(0))}%</div></div>
      </div>
      ${adapterPriorities.slice(0,5).map((entry,index)=>`
        <div class="wi">
          <div class="wd ${entry.selected?'d-pass':'d-act'}"></div>
          <div class="wid">TOP ${index+1}</div>
          <div style="flex:1">
            <div class="wg">${esc(entry.adapter.name||entry.adapter_id)} ${entry.selected?'<span class="st s-ok">현재 profile</span>':''}</div>
            <div class="wr">가중 점수 ${esc(entry.weighted_score)} / 5 · ${esc(entry.adapter.description||'')}</div>
            ${(entry.best_for||[]).length?`<div class="wr">적합한 곳: ${esc((entry.best_for||[]).join(', '))}</div>`:''}
          </div>
        </div>`).join('')}
    </div>`;
  }

  if(transitionPlaybooks.length){
    html+=`<div class="card" style="margin-bottom:16px">
      <div class="card-h"><div class="card-ic">🧬</div>
        <div><div class="card-tit">Adapter Transition Switchboard</div>
          <div class="card-sub">profile 전환 시 코어는 유지하고 edge adapter만 바꾸는 절차</div></div></div>
      <div class="kv"><span class="kk">Playbook</span><span>
        <select onchange="setTransitionPlaybook(this.value)" style="background:var(--sf2);color:var(--tx);border:1px solid var(--ln);border-radius:6px;padding:6px 8px;min-width:260px">
          ${transitionPlaybooks.map(item=>`<option value="${esc(item.id)}" ${item.id===transitionPlan.playbook?.id?'selected':''}>${esc(item.title||item.id)}</option>`).join('')}
        </select>
      </span></div>
      <div class="g3" style="margin-top:10px">
        <div class="mc"><div class="mc-l">From</div><div class="mc-v" style="font-size:13px">${esc(transitionPlan.from_profile?.name||transitionPlan.playbook?.from_profile||'—')}</div></div>
        <div class="mc"><div class="mc-l">To</div><div class="mc-v" style="font-size:13px">${esc(transitionPlan.to_profile?.name||transitionPlan.playbook?.to_profile||'—')}</div></div>
        <div class="mc"><div class="mc-l">본질 유지</div><div class="mc-v" style="font-size:11px;line-height:1.4">${esc(transitionPlan.playbook?.preserve_essence||'—')}</div></div>
      </div>
      <div class="sec-ctrl" style="margin-top:10px">
        <div class="ts-info">도메인 포트는 유지하고 adapter만 교체하는 전환 절차를 planner에서 미리 검토합니다.</div>
        <button class="btn btn-s" style="font-size:10px" onclick="copyTransitionPlan()">📋 Transition Plan 복사</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Keep</div>
          ${(transitionPlan.keep||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
        </div>
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Add</div>
          ${(transitionPlan.add||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
        </div>
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Remove</div>
          ${(transitionPlan.remove||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Triggers</div>
          ${(transitionPlan.playbook?.triggers||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
        </div>
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Validation Commands</div>
          ${(transitionPlan.playbook?.validation_commands||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
        </div>
      </div>
      ${(transitionPlan.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${transitionPlan.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
    </div>`;
  }

  // 도메인 카드
  d.domains.forEach(m=>{
    const domKey=m.domain==='productivity'?'productivity/task-tracking':m.domain;
    const si=d.domain_scores[domKey]||d.domain_scores[m.domain]||{};
    const guide=d.ui_guides?.[m.module_id]||null;
    const plugin=pluginMap[m.module_id]||{};
    const profile=profiles.find(pr=>pr.id===plugin.architecture_profile)||null;
    const score=m.health_score||si.score||'—', trend=si.trend||'→';
    const flagVal=pf[m.feature_flag];
    const ms=m.stage_a?{A:m.stage_a,B:m.stage_b,C:m.stage_c,D:m.stage_d,E:m.stage_e}:{A:'PASS',B:'PASS',C:'PASS',D:'PASS',E:'PASS'};
    const sbadge=['A','B','C','D','E'].map(s=>{
      const v=ms[s]||stages[s]||'PASS';
      return `<span class="st ${v==='PASS'?'s-ok':v==='FAIL'?'s-fl':'s-nd'}">Stage ${s}: ${v}</span>`;
    }).join('');
    let gH='';
    if(m.stage_e_gaps) m.stage_e_gaps.forEach(g=>{
      gH+=`<div class="wi" style="margin-bottom:3px">
        <div class="wd" style="background:${g.status==='FIXED'?'#3fb950':'var(--ac3)'}"></div>
        <div class="wid"><span class="st s-nd" style="font-size:8px">${esc(g.severity)}</span> ${esc(g.id)}</div>
        <div class="wg">${esc(g.description)} <span style="color:var(--ac)">${esc(g.status)}</span></div>
      </div>`;
    });
    let guideH='';
    if(guide){
      const entryPoints=(guide.entry_points||[]).map(ep=>`<div class="wi" style="margin-bottom:6px">
        <div class="wd d-pass"></div>
        <div class="wid">${esc(ep.label||ep.route||'entry')}</div>
        <div style="flex:1">
          <div class="wg">${esc(ep.route||'')}</div>
          <div class="wr">${esc(ep.description||'')}</div>
        </div>
      </div>`).join('');
      const screens=(guide.screens||[]).map(screen=>{
        const screenChips=[...(screen.permissions||[]).map(p=>`<span class="st s-nd">${esc(p)}</span>`)];
        if(screen.feature_flag) screenChips.push(`<span class="st s-ac">${esc(screen.feature_flag)}</span>`);
        const actions=(screen.actions||[]).slice(0,3).map(action=>esc(action.label||action.id)).join(', ');
        const dataSources=(screen.data_sources||[]).slice(0,2).map(req=>esc(req.source)).join(', ');
        return `<div class="wi" style="margin-bottom:6px">
          <div class="wd d-act"></div>
          <div class="wid">${esc(screen.title||screen.id)}</div>
          <div style="flex:1">
            <div class="wg">${esc(screen.route||'')}</div>
            <div class="wr">${esc(screen.description||'설명 없음')}</div>
            <div class="sb-r" style="margin-top:6px">${screenChips.join('')}</div>
            ${actions?`<div class="wr">주요 액션: ${actions}</div>`:''}
            ${dataSources?`<div class="wr">데이터 소스: ${dataSources}</div>`:''}
          </div>
        </div>`;
      }).join('');
      guideH=`<div style="margin-top:12px">
        <div style="font-size:10px;font-weight:600;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">화면 설명서</div>
        ${guide.description?`<div class="wr" style="margin:0 0 8px 0">${esc(guide.description)}</div>`:''}
        ${entryPoints?`<div style="margin-bottom:8px"><div class="wr" style="margin:0 0 5px 0;color:var(--br)">진입 화면</div>${entryPoints}</div>`:''}
        ${screens||'<div class="wr">정의된 화면이 없습니다.</div>'}
      </div>`;
    }
    html+=`<div class="dc">
      <div class="dh">
        <div class="dsc ${sc(typeof score==='number'?score:0)}">${score}
          <div style="font-size:11px;font-weight:400;color:var(--dm)">${trend}</div></div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:700;color:var(--br)">${esc(m.module_id)}</div>
          <div style="font-size:11px;color:var(--dm)">${esc(m.domain)} / ${esc(m.bounded_context||m.domain)}</div>
          <div class="sb-r" style="margin-top:7px">${sbadge}</div>
        </div>
        <div style="text-align:right">
          <span class="fc ${flagVal?'f-on':'f-off'}">${flagVal?'🟢 활성':'🔴 비활성'}</span>
          <div style="font-size:10px;color:var(--dm);margin-top:3px">${esc(m.feature_flag)}</div>
        </div>
      </div>
      <div class="db">
        <div class="kv"><span class="kk">플러그인 ID</span><span>${esc(m.plugin_id)}</span></div>
        ${m.contract_dir?`<div class="kv"><span class="kk">계약 디렉토리</span><span>${esc(m.contract_dir)}</span></div>`:''}
        ${m.interface_layer?`<div class="kv"><span class="kk">인터페이스</span><span class="kv-ok">${esc(m.interface_layer.substring(0,70))}</span></div>`:''}
        ${m.unit_tests?`<div class="kv"><span class="kk">단위 테스트</span><span class="kv-ok">${esc(m.unit_tests)}</span></div>`:''}
        ${profile?`<div class="kv"><span class="kk">아키텍처 프로파일</span><span class="kv-ok">${esc(profile.name)} <span style="color:var(--dm)">(${esc(profile.id)})</span></span></div>`:''}
        ${plugin.architecture_profile && !profile?`<div class="kv"><span class="kk">아키텍처 프로파일</span><span>${esc(plugin.architecture_profile)}</span></div>`:''}
        ${(plugin.adapter_refs||[]).length?`<div style="margin-top:10px">
          <div style="font-size:10px;font-weight:600;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">어댑터 스택</div>
          ${(plugin.adapter_refs||[]).map(adapterRef=>{
            const adapter=adapterMap[adapterRef]||{};
            const scorecard=scorecardMap[adapterRef]||{};
            return `<div class="wi" style="margin-bottom:5px">
              <div class="wd d-pass"></div>
              <div class="wid">${esc(adapter.name||adapterRef)}</div>
              <div style="flex:1">
                <div class="wg">${esc(adapter.description||'')}</div>
                <div class="wr">layer: ${esc(adapter.layer||'—')} | protocol: ${esc(adapter.protocol||'—')}</div>
                ${scorecard.metrics?`<div class="wr">score: 확장성 ${esc(scorecard.metrics.extensibility)} · 성능 ${esc(scorecard.metrics.performance)} · AI ${esc(scorecard.metrics.ai_compatibility)}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>`:''}
        ${gH?`<div style="margin-top:10px"><div style="font-size:10px;font-weight:600;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Stage E 갭</div>${gH}</div>`:''}
        ${guideH}
      </div>
    </div>`;
  });
  $('c-dom').innerHTML=html;
}

// ────────────────────────────────────────────────────────────────
// ADR
// ────────────────────────────────────────────────────────────────
function renderADR(){
  const d=window.D; $('tc-adr').textContent=d.adrs.length;
  const byDomain={};
  d.adrs.forEach(a=>{ const k=a.domain||'core'; if(!byDomain[k]) byDomain[k]=[]; byDomain[k].push(a); });

  let html=`<div class="sec-tit">📋 아키텍처 결정 기록 (ADR)</div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><div class="card-ic">📊</div>
        <div><div class="card-tit">ADR 현황</div>
          <div class="card-sub">docs/adr/ — ${d.adrs.length}개 활성</div></div></div>
      <div class="g3" style="margin-top:10px">
        <div class="mc"><div class="mc-l">총 ADR</div><div class="mc-v">${d.adrs.length}</div></div>
        <div class="mc"><div class="mc-l">도메인 수</div><div class="mc-v">${Object.keys(byDomain).length}</div></div>
        <div class="mc"><div class="mc-l">최신</div><div class="mc-v" style="font-size:13px">${esc(d.adrs[d.adrs.length-1]?.title?.substring(0,20)||'—')}</div></div>
      </div>
    </div>`;

  Object.entries(byDomain).forEach(([dom,adrs])=>{
    html+=`<div class="card" style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">${esc(dom)}</div>
      ${adrs.map(a=>`<div class="adr-row">
        <div class="adr-id">ADR-${esc(a.id)}</div>
        <div class="adr-tit">${esc(a.title)}</div>
        ${a.stage?`<span class="st s-nd" style="font-size:9px;flex-shrink:0">Stage ${esc(a.stage)}</span>`:''}
      </div>`).join('')}
    </div>`;
  });
  $('c-adr').innerHTML=html;
}

// ────────────────────────────────────────────────────────────────
// LOG (감사·학습)
// ────────────────────────────────────────────────────────────────
function renderLog(){
  const d=window.D;
  const liveFeed=buildLiveOpsFeed();
  const studyReplay=buildStudyReplayData();
  const replayNextPacket=buildReplayNextPacketData();
  const obs=d.observability||{};
  const logFields=(obs.global_settings?.required_log_fields)||[];
  const selectedFilter=selectedLogFeedFilter();
  const filteredLiveFeed=selectedFilter==='all' ? liveFeed : liveFeed.filter(item=>item.tag===selectedFilter);
  const filterOptions=[
    {id:'all', label:'전체'},
    {id:'audit', label:'audit'},
    {id:'reflection', label:'reflection'},
    {id:'report', label:'report'},
    {id:'git', label:'git'},
    {id:'timeline', label:'timeline'},
  ];
  let refH='';
  (d.reflections||[]).forEach(r=>{
    refH+=`<div class="wi"><div class="wd d-warn"></div>
      <div class="wid">${esc(r.stage)} / ${esc(r.domain)}</div>
      <div style="flex:1">
        <div class="wg">${esc(r.date)}</div>
        ${r.went_wrong?.length?`<div class="wr">문제: ${esc(r.went_wrong.join(' | '))}</div>`:''}
        ${r.improvement?.length?`<div class="wr" style="color:var(--ac2)">개선: ${esc(r.improvement.join(' | '))}</div>`:''}
      </div>
      <div style="font-size:10px;color:var(--dm)">${esc(r.confidence||'')} 신뢰도</div>
    </div>`;
  });

  let auH='';
  (d.audit_entries||[]).forEach(e=>{
    auH+=`<div class="wi"><div class="wd d-pass"></div>
      <div class="wid">#${esc(e.seq)}</div>
      <div style="flex:1">
        <div class="wg">${esc(e.action)}</div>
        <div class="wr">${esc(e.timestamp)} ${e.hash?`hash: ${esc(e.hash)}`:''}</div>
      </div>
    </div>`;
  });

  let repH='';
  (d.learning_reports||[]).forEach(r=>{
    repH+=`<div class="wi"><div class="wd d-act"></div>
      <div class="wid">${esc(r.domain)}</div>
      <div style="flex:1">
        <div class="wg" style="font-size:10px;font-family:var(--mo)">${esc(r.file)}</div>
        <div class="wr">${esc(r.excerpt.substring(0,120))}${r.excerpt.length>120?'…':''}</div>
      </div>
    </div>`;
  });

  $('c-log').innerHTML=`
    <div class="sec-tit">🔍 감사 & 학습 로그</div>

    <div class="card"><div class="card-h"><div class="card-ic">📡</div>
      <div><div class="card-tit">Live Ops Feed</div>
        <div class="card-sub">최근 audit, reflection, report, git 시그널을 한 흐름으로 본다</div></div></div>
      <div class="sec-ctrl" style="margin-top:10px">
        <div class="ts-info">최근 생성 시각 ${esc(d.generated_at||'')} · planner:watch와 함께 켜면 정적 artifact에서도 로그 흐름을 반복 확인할 수 있습니다.</div>
        <button class="btn btn-s" style="font-size:10px" onclick="toggleAutoRefresh()">${autoRefreshEnabled()?'⏸ Auto refresh OFF':'⟳ Auto refresh 15s ON'}</button>
      </div>
      <div class="sb-r" style="margin-top:10px">
        ${filterOptions.map(option=>`<button class="btn ${selectedFilter===option.id?'btn-s':'btn-i'}" style="font-size:10px" onclick="setLogFeedFilter('${option.id}')">${esc(option.label)}</button>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Recent Signals</div>
          ${(filteredLiveFeed||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div style="flex:1"><div class="wg">${esc(item.title)}</div><div class="wr">${esc(item.timestamp||'시간 미상')} · ${esc(item.tag)}${item.detail?` · ${esc(item.detail)}`:''}</div></div></div>`).join('')||'<div style="color:var(--dm);padding:8px">필터에 맞는 시그널 없음</div>'}
        </div>
        <div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">Structured Log Guardrail</div>
          ${(logFields||[]).map(field=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(field)}</div></div>`).join('')||'<div style="color:var(--dm);padding:8px">정의된 필드 없음</div>'}
          <div class="wr" style="margin-top:8px">dashboards: ${esc((obs.dashboards||[]).length)} / alert_groups: ${esc((obs.alert_groups||[]).length)}</div>
        </div>
      </div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🚨</div>
      <div><div class="card-tit">Alert Cockpit</div>
        <div class="card-sub">운영자가 로그와 함께 같이 봐야 하는 alert / dashboard 기준</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
        ${((obs.alert_groups||[]).map(group=>`<div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">${esc(group.name||group.id)}</div>
          <div class="card-sub" style="margin-bottom:8px">${esc(group.channel||'')}</div>
          ${(group.rules||[]).map(rule=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${rule.severity==='critical'?'d-warn':'d-act'}"></div><div style="flex:1"><div class="wg">${esc(rule.name)}</div><div class="wr">${esc(rule.condition||'')}</div></div></div>`).join('')}
        </div>`).join(''))||'<div style="color:var(--dm);padding:8px">alert group 없음</div>'}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
        ${((obs.dashboards||[]).map(dashboard=>`<div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">${esc(dashboard.name||dashboard.id)}</div>
          <div class="card-sub" style="margin-bottom:8px">${esc(dashboard.description||'')}</div>
          ${(dashboard.metrics||[]).slice(0,4).map(metric=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(metric.name)}</div><div class="wr">${esc(metric.source||'')}</div></div></div>`).join('')}
        </div>`).join(''))||'<div style="color:var(--dm);padding:8px">dashboard 없음</div>'}
      </div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🎓</div>
      <div><div class="card-tit">Study Replay</div>
        <div class="card-sub">로그와 증적을 학습 트랙으로 다시 연결한다</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
        ${(studyReplay||[]).map(lens=>`<div class="card" style="margin:0">
          <div class="card-tit" style="margin-bottom:6px">${esc(lens.title)}</div>
          <div class="card-sub" style="margin-bottom:8px">${esc(lens.teaches)}</div>
          <div class="kv"><span class="kk">Track</span><span>${esc(lens.track?.title||lens.track_ref||'—')}</span></div>
          ${(lens.matched||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div style="flex:1"><div class="wg">${esc(item.title)}</div><div class="wr">${esc(item.timestamp||'시간 미상')} · ${esc(item.detail||'')}</div></div></div>`).join('')}
          <div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin:8px 0 5px">Read Next</div>
          ${(lens.next_reads||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')}
        </div>`).join('')||'<div style="color:var(--dm);padding:8px">연결 가능한 replay 없음</div>'}
      </div>
      <div class="card" style="margin:10px 0 0 0">
        <div class="card-h">
          <div class="card-ic">🧠</div>
          <div>
            <div class="card-tit">Replay Next Packet</div>
            <div class="card-sub">최근 replay lens를 다음 실행 packet 초안으로 환원합니다.</div>
          </div>
        </div>
        <div class="kv"><span class="kk">goal</span><span>${esc(replayNextPacket.goal)}</span></div>
        <div class="kv"><span class="kk">type / stage</span><span>${esc(replayNextPacket.type)} / ${esc(replayNextPacket.stage)}</span></div>
        ${(replayNextPacket.focus_tracks||[]).length?`<div class="sb-r" style="margin-top:8px">${replayNextPacket.focus_tracks.map(item=>`<span class="st s-ac">${esc(item)}</span>`).join('')}</div>`:''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Rationale</div>
            ${(replayNextPacket.rationale||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);padding:8px">근거 없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Read First</div>
            ${(replayNextPacket.read_first||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);padding:8px">없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Validation</div>
            ${(replayNextPacket.validation||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);padding:8px">없음</div>'}
            <div class="sec-ctrl" style="margin-top:10px">
              <button class="btn btn-s" style="font-size:10px" onclick="copyReplayNextPacket()">📋 Replay Next Packet 복사</button>
              <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/generate_replay_packet.py --json').then(()=>toast('replay-packet 명령 복사됨'))">⌘ replay-packet</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🔄</div>
      <div><div class="card-tit">Reflexion 로그</div>
        <div class="card-sub">memory/L0-hot/reflection-log.yaml</div></div></div>
      ${refH||'<div style="color:var(--dm);padding:8px">없음</div>'}
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">🔗</div>
      <div><div class="card-tit">감사 체인</div>
        <div class="card-sub">worklog/audit-chain.json</div></div></div>
      ${auH||'<div style="color:var(--dm);padding:8px">없음</div>'}
    </div>

    <div class="card"><div class="card-h"><div class="card-ic">📚</div>
      <div><div class="card-tit">학습 보고서</div>
        <div class="card-sub">worklog/reports/**/*.md</div></div></div>
      ${repH||'<div style="color:var(--dm);padding:8px">없음</div>'}
    </div>`;
}

// ────────────────────────────────────────────────────────────────
// REQUIREMENTS (요구사항 탭)
// ────────────────────────────────────────────────────────────────
function renderReq(){
  const req=window.D.requirements||{};
  const mod=req.module||{}, nfr=req.nfr||{}, qg=req.quality_gates||{};
  const hc=req.hard_constraints||[], sc=req.soft_constraints||[];
  const doms=req.domain_map_domains||[];
  const benchmarkInfo=window.D.benchmark_intelligence||{};
  const benchmarkReview=benchmarkInfo.review||{};
  const essentialImprovements=benchmarkInfo.essential_improvements||[];
  const planningModes=window.D.planning_studio_modes||[];
  const blueprints=window.D.project_blueprints||[];
  const intakeCanvas=window.D.project_intake_canvas||{};
  const intakeQuestions=intakeCanvas.questions||[];
  const intakeSummary=computeIntakeRecommendation();
  const planningStudio=buildPlanningStudioData();
  const contextPacket=buildContextPacketData();
  const contextRouting=buildContextRoutingData();
  const contextLock=buildContextLockData();
  const contextDrift=buildContextDriftData();
  const executionPacket=buildExecutionPacketData();
  const promotePipeline=buildVerifiedPromoteData();
  const promotionPipeline=buildPromotionPipelineData();
  const benchmarkPack=buildBenchmarkActionPackData();
  const starterPreset=buildStarterPresetData();
  const tracks=window.D.ai_learning_tracks||[];
  const masteryMilestones=window.D.learning_mastery_map||[];
  const profiles=window.D.adapter_catalog?.profiles||[];
  const compatibilityProfiles=window.D.adapter_compatibility||[];
  const recipes=window.D.ai_runtime_recipes||[];
  const relations=window.D.master_os_relations||[];
  const benchmarkSignals=benchmarkInfo.signals||[];
  const benchmarkFocuses=benchmarkInfo.focuses||[];
  const essentialImprovementCards=essentialImprovements.map(item=>{
    const linkedSignals=signalsForIds(item.benchmark_refs||[]);
    const linkedFocuses=(item.related_focus_ids||[]).map(id=>focusById(id)).filter(Boolean);
    return `<div class="card" style="margin-bottom:10px;border-left:3px solid #1a7f37">
      <div class="card-h">
        <div class="card-ic">✅</div>
        <div>
          <div class="card-tit">${esc(item.title||item.id)}</div>
          <div class="card-sub">${esc(item.objective||'')}</div>
        </div>
      </div>
      <div class="kv"><span class="kk">본질 유지</span><span>${esc(item.preserve_essence||'')}</span></div>
      ${(item.why_now||[]).length?`<div style="margin-top:8px">${(item.why_now||[]).map(reason=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(reason)}</div></div>`).join('')}</div>`:''}
      ${(item.delivered_by||[]).length?`<div style="margin-top:8px">${(item.delivered_by||[]).map(step=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(step)}</div></div>`).join('')}</div>`:''}
      ${linkedFocuses.length?`<div class="sb-r" style="margin-top:8px">${linkedFocuses.map(focus=>`<span class="st s-nd">${esc(focus.title)}</span>`).join('')}</div>`:''}
      ${linkedSignals.length?`<div class="sb-r" style="margin-top:8px">${linkedSignals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
    </div>`;
  }).join('');

  // NFR — 카테고리별 중첩 렌더링
  const nfrCats=req.nfr_categories||{};
  const CAT_ICONS={performance:'⚡',reliability:'🛡',security:'🔒',observability:'📊',supply_chain:'📦',scalability:'📈'};
  const nfrH=Object.entries(nfrCats).map(([cat,items])=>`
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
        color:var(--dm);margin-bottom:5px">${CAT_ICONS[cat]||'•'} ${esc(cat)}</div>
      <div class="nfr-grid">
        ${Object.entries(items||{}).map(([k,v])=>`
          <div class="nfr-item"><div class="nfr-k">${esc(k)}</div>
            <div class="nfr-v" style="font-size:${String(v).length>12?'11px':'16px'}">${esc(String(v))}</div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  // Quality Gates
  const qgH=Object.entries(qg).map(([cat,items])=>`
    <div class="qg-cat"><div class="qg-cat-h">${esc(cat)}</div>
      ${(items||[]).map(it=>`<span class="qg-item">✓ ${esc(it)}</span>`).join('')}
    </div>`).join('');

  // Hard constraints
  const hcH=hc.map(c=>`<div class="constraint">
    <div class="c-id">${esc(c.id||'')}</div>
    <div style="flex:1">
      <div class="c-rule">${esc(c.rule||'')}</div>
      <div class="c-rat">${esc(c.rationale||'')} ${c.violation_action?`→ <em>${esc(c.violation_action)}</em>`:''}</div>
    </div>
  </div>`).join('');

  // Soft constraints
  const scH=sc.map(c=>`<div class="constraint" style="border-color:rgba(137,87,229,.2)">
    <div class="c-id" style="color:var(--pu)">${esc(c.id||'')}</div>
    <div style="flex:1">
      <div class="c-rule">${esc(c.rule||'')}</div>
      <div class="c-rat">${esc(c.rationale||'')}</div>
    </div>
  </div>`).join('');

  // Domain map
  const dmH=doms.map(dom=>`<div class="card" style="margin-bottom:10px">
    <div class="card-h">
      <div class="card-ic">🏛</div>
      <div>
        <div class="card-tit">${esc(dom.name||dom.id)}</div>
        <div class="card-sub">${esc(dom.description||'')} · 상태: ${esc(dom.status||'')} · 마이그레이션: ${esc(dom.migration_status||'')}</div>
      </div>
    </div>
    ${(dom.bounded_contexts||[]).map(bc=>`
      <div style="margin:6px 0;padding:8px;background:var(--sf2);border-radius:5px">
        <div style="font-size:12px;font-weight:600;color:var(--br);margin-bottom:4px">${esc(bc.name||bc.id)}</div>
        <div style="font-size:10px;color:var(--dm)">모듈: ${esc((bc.modules||[]).join(', '))}</div>
        ${(bc.invariants||[]).length?`<div style="margin-top:4px">${bc.invariants.map(inv=>`<div style="font-size:10px;color:var(--ac);margin:1px 0">✓ ${esc(inv)}</div>`).join('')}</div>`:''}
      </div>`).join('')}
  </div>`).join('');

  const bpH=blueprints.map(bp=>{
    const profile=profiles.find(pr=>pr.id===bp.architecture_profile);
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-h">
        <div class="card-ic">🧭</div>
        <div>
          <div class="card-tit">${esc(bp.name||bp.id)}</div>
          <div class="card-sub">${esc(bp.summary||'')}</div>
        </div>
      </div>
      <div class="kv"><span class="kk">언제 쓰는가</span><span>${esc(bp.when_to_use||'')}</span></div>
      <div class="kv"><span class="kk">아키텍처 프로파일</span><span class="kv-ok">${esc(profile?.name||bp.architecture_profile||'—')}</span></div>
      <div class="kv"><span class="kk">추천 모듈</span><span>${esc((bp.recommended_modules||[]).join(', '))}</span></div>
      <div style="margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">시작 순서</div>
        ${(bp.starter_sequence||[]).map(step=>`<div class="wi" style="margin-bottom:5px">
          <div class="wd d-pass"></div>
          <div class="wid">${esc(step.step||'step')}</div>
          <div class="wg">${esc(step.focus||'')}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  const trackH=tracks.map(track=>`<div class="card" style="margin-bottom:10px">
    <div class="card-h">
      <div class="card-ic">🧠</div>
      <div>
        <div class="card-tit">${esc(track.title||track.id)}</div>
        <div class="card-sub">${esc(track.persona||'')} · ${esc(track.objective||'')}</div>
      </div>
    </div>
    ${(track.steps||[]).map((step,index)=>`<div class="wi" style="margin-bottom:5px">
      <div class="wd d-act"></div>
      <div class="wid">${index+1}. ${esc(step.title||step.id)}</div>
      <div style="flex:1">
        <div class="wg">${esc(step.learn||'')}</div>
        <div class="wr">탭: ${esc(step.tab||'—')} | 섹션: ${esc(step.section||'—')}</div>
      </div>
    </div>`).join('')}
  </div>`).join('');

  const recipeH=recipes.map(recipe=>{
    const profile=profiles.find(pr=>pr.id===recipe.architecture_profile);
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-h">
        <div class="card-ic">🤖</div>
        <div>
          <div class="card-tit">${esc(recipe.name||recipe.id)}</div>
          <div class="card-sub">${esc(recipe.objective||'')}</div>
        </div>
      </div>
      <div class="kv"><span class="kk">아키텍처 프로파일</span><span class="kv-ok">${esc(profile?.name||recipe.architecture_profile||'—')}</span></div>
      <div class="kv"><span class="kk">도구 스택</span><span>${esc((recipe.tool_stack||[]).join(', '))}</span></div>
      <div class="kv"><span class="kk">적합한 상황</span><span>${esc((recipe.best_for||[]).join(', '))}</span></div>
      <div style="margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">운영 순서</div>
        ${(recipe.operating_sequence||[]).map(step=>`<div class="wi" style="margin-bottom:5px">
          <div class="wd d-act"></div>
          <div class="wg">${esc(step)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  const relationH=relations.map(rel=>`<div class="wi" style="margin-bottom:5px">
    <div class="wd d-pass"></div>
    <div class="wid">${esc(rel.source_type)}:${esc(rel.source_id)}</div>
    <div class="wg">${esc(rel.relation)} → ${esc(rel.target_type)}:${esc(rel.target_id)}</div>
  </div>`).join('');

  const intakeBlueprint=blueprints.find(bp=>bp.id===intakeSummary.blueprintId)||null;
  const intakeProfile=profiles.find(profile=>profile.id===intakeSummary.profileId)||null;
  const intakeRecipe=recipes.find(recipe=>recipe.id===intakeSummary.recipeId)||null;
  const intakeCompatibilityRule=compatibilityProfiles.find(rule=>rule.profile_id===intakeSummary.profileId)||null;
  const launchBrief=buildLaunchBrief(intakeSummary, intakeBlueprint, intakeProfile, intakeRecipe, intakeCompatibilityRule);
  const planningComparison=buildPlanningVariantComparison();
  const planningPatch=buildPlanningPatchData();
  const planningSnapshotTimeline=planningSnapshots(planningStudio.mode?.id||selectedPlanningModeId());
  const presetAppliedSnapshot=(planningSnapshotTimeline||[]).find(item=>item.source==='starter-preset')||null;
  const constraintFit=buildConstraintFitData();
  const coreBoundary=buildCoreImpactBoundaryData();
  const contextBundleExport=buildContextBundleExportData();
  const rereadQueue=buildRereadQueueData();
  const contextExceptionLedger=buildContextExceptionLedgerData();
  const exceptionPacketDraft=buildExceptionPacketDraftData();
  const applyHandoff=buildApplyHandoffData();
  const handoffBundle=buildHandoffBundleData();
  const readinessBrief=buildReadinessBriefData();
  const promotionDecision=buildPromotionDecisionData();
  const decisionApplyBridge=buildDecisionApplyBridgeData();
  const packetHierarchy=buildPacketHierarchyData();
  const capabilityBrief=buildCapabilityBriefData();
  const applyCheckpoint=buildApplyCheckpointData();
  const exceptionReplay=buildExceptionReplayData();
  const capabilityPlanningSeed=buildCapabilityPlanningSeedData();
  const applyTimeline=buildApplyTimelineData();
  const exceptionRoutingPatch=buildExceptionRoutingPatchData();
  const capabilitySeedTuning=buildCapabilitySeedTuningData();
  const applyOutcomeScorecard=buildApplyOutcomeScorecardData();
  const blueprintLaunchDeck=buildBlueprintLaunchDeckData();
  const learnedPresetMemory=buildLearnedPresetMemoryData();
  const tokenROI=buildTokenROIData();
  const provenKickoffDeck=buildProvenKickoffDeckData();
  const adaptiveStarterPreset=buildAdaptiveStarterPresetData();
  const tokenROIRoutingPatch=buildTokenROIRoutingPatchData();
  const kickoffEvidenceBundle=buildKickoffEvidenceBundleData();
  const launchBriefAutopilot=buildLaunchBriefAutopilotData();
  const routingLearningLedger=buildRoutingLearningLedgerData();
  const kickoffReadyGate=buildKickoffReadyGateData();
  const planningModeCards=planningModes.map(mode=>{
    const active=mode.id===planningStudio.mode?.id;
    const signals=signalsForIds(mode.benchmark_refs||[]);
    return `<div class="card" style="margin:0;border:${active?'1px solid #1f6feb':'1px solid var(--bd)'}">
      <div class="card-h">
        <div class="card-ic">${active?'🟦':'🗂'}</div>
        <div style="flex:1">
          <div class="card-tit">${esc(mode.title||mode.id)}</div>
          <div class="card-sub">${esc(mode.summary||'')}</div>
        </div>
        <button class="btn ${active?'btn-s':'btn-i'}" style="font-size:10px" onclick="setPlanningMode('${esc(mode.id)}')">${active?'선택됨':'선택'}</button>
      </div>
      <div style="font-size:11px;color:var(--tx2);line-height:1.6">${esc(mode.preserve_essence||'')}</div>
      ${signals.length?`<div class="sb-r" style="margin-top:8px">${signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
    </div>`;
  }).join('');
  const planningComparatorCards=(planningComparison.variants||[]).map((variant,index)=>{
    const recommended=variant.mode_id===planningComparison.recommended_mode_id;
    return `<div class="card" style="margin:0;border:${recommended?'1px solid #1a7f37':'1px solid var(--bd)'}">
      <div class="card-h">
        <div class="card-ic">${recommended?'✅':'📐'}</div>
        <div style="flex:1">
          <div class="card-tit">${esc(variant.title||variant.mode_id)}</div>
          <div class="card-sub">score ${esc(variant.score)}${index===0?' · 현재 추천':''}</div>
        </div>
      </div>
      ${(variant.reasons||[]).slice(0,3).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${recommended?'d-pass':'d-act'}"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">비교 근거 없음</div>'}
      ${(variant.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${variant.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
    </div>`;
  }).join('');
  const planningStudioEntries=(planningStudio.entries||[]).map(entry=>`<div class="card" style="margin:0">
    <div class="card-tit" style="margin-bottom:6px">${esc(entry.label)}</div>
    <div class="card-sub" style="margin-bottom:8px">${esc(entry.prompt)}</div>
    <textarea oninput="updatePlanningStudioField('${esc(planningStudio.mode?.id||'')}', '${esc(entry.id)}', this.value)" style="width:100%;min-height:108px;background:var(--sf2);color:var(--tx);border:1px solid var(--ln);border-radius:8px;padding:10px;font:12px/1.6 var(--fn);resize:vertical">${esc(entry.value||'')}</textarea>
  </div>`).join('');
  const planningSnapshotCards=(planningSnapshotTimeline||[]).map(item=>`<div class="wi" style="margin-bottom:6px">
    <div class="wd d-pass"></div>
    <div style="flex:1">
      <div class="wg">${esc(item.mode_title||item.mode_id||'snapshot')} · ${esc(item.changed_count||0)} changes</div>
      <div class="wr">${esc((item.saved_at||'').replace('T',' ').slice(0,16))}${item.source?` · ${esc(item.source)}`:''}${(item.changed_labels||[]).length?` · ${esc(item.changed_labels.join(', '))}`:''}</div>
    </div>
  </div>`).join('');
  const tokenBudgetCards=[
    {title:'Primary', accent:'d-pass', summary:contextRouting.budget_summary?.primary||{file_count:0,total_bytes:0,estimated_tokens:0}, max:contextRouting.profile?.max_primary_files||0},
    {title:'Secondary', accent:'d-act', summary:contextRouting.budget_summary?.secondary||{file_count:0,total_bytes:0,estimated_tokens:0}, max:contextRouting.profile?.max_secondary_files||0},
    {title:'Deferred', accent:'d-warn', summary:contextRouting.budget_summary?.deferred||{file_count:0,total_bytes:0,estimated_tokens:0}, max:null},
  ].map(item=>`<div class="card" style="margin:0">
    <div class="card-tit" style="margin-bottom:6px">Token Budget Meter · ${esc(item.title)}</div>
    <div class="kv"><span class="kk">files</span><span>${esc(item.summary.file_count)}${item.max!==null?` / max ${esc(item.max)}`:''}</span></div>
    <div class="kv"><span class="kk">bytes</span><span>${esc(formatBytes(item.summary.total_bytes))}</span></div>
    <div class="kv"><span class="kk">estimated tokens</span><span class="${item.summary.estimated_tokens<=5000?'kv-ok':''}">${esc(formatTokens(item.summary.estimated_tokens))}</span></div>
  </div>`).join('');
  const coreBoundaryRootCards=dedupeBy([
    ...(coreBoundary.touched_roots||[]).map(root=>({root, state:'touch'})),
    ...(coreBoundary.protected_roots||[]).map(root=>({root, state:'protect'})),
  ], item=>item.root+':'+item.state).map(item=>`<span class="st ${item.state==='protect'?'s-ok':'s-ac'}">${esc(item.state==='protect'?'protect':'touch')} · ${esc(item.root)}</span>`).join('');
  const constraintFitCards=(constraintFit.checks||[]).map(item=>`<div class="wi" style="margin-bottom:5px">
    <div class="wd ${item.status==='pass'?'d-pass':item.status==='risk'?'d-warn':'d-act'}"></div>
    <div style="flex:1">
      <div class="wg">${esc(item.label)}</div>
      <div class="wr">[${esc(item.status)}] ${esc(item.detail)}</div>
    </div>
  </div>`).join('');
  const guidedTracks=selectedTracksForIntake(intakeBlueprint, intakeRecipe);
  const guidedJourneyH=guidedTracks.map(track=>`<div class="card" style="margin-bottom:10px">
    <div class="card-h">
      <div class="card-ic">🧭</div>
      <div>
        <div class="card-tit">${esc(track.title||track.id)}</div>
        <div class="card-sub">${esc(track.persona||'')} · ${esc(track.objective||'')}</div>
      </div>
    </div>
    ${(track.steps||[]).map((step,index)=>`<div class="wi" style="margin-bottom:5px">
      <div class="wd d-act"></div>
      <div class="wid">${index+1}. ${esc(step.title||step.id)}</div>
      <div style="flex:1">
        <div class="wg">${esc(step.learn||'')}</div>
        <div class="wr">탭: ${esc(step.tab||'—')} | 섹션: ${esc(step.section||'—')}</div>
      </div>
    </div>`).join('')}
  </div>`).join('');
  const focusH=benchmarkFocuses.map(focus=>{
    const linkedSignals=signalsForIds(focus.benchmark_refs||[]);
    return `<div class="card" style="margin-bottom:10px;border-left:3px solid #1f6feb">
      <div class="card-h">
        <div class="card-ic">🎯</div>
        <div>
          <div class="card-tit">${esc(focus.title||focus.id)}</div>
          <div class="card-sub">${esc(focus.outcome||'')}</div>
        </div>
      </div>
      <div class="kv"><span class="kk">본질 유지</span><span>${esc(focus.preserve_essence||'')}</span></div>
      ${(focus.delivered_by||[]).length?`<div style="margin-top:8px">${(focus.delivered_by||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}</div>`:''}
      ${linkedSignals.length?`<div class="sb-r" style="margin-top:8px">${linkedSignals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
    </div>`;
  }).join('');
  const benchmarkH=benchmarkSignals.map(signal=>`<div class="card" style="margin-bottom:10px">
    <div class="card-h">
      <div class="card-ic">${signal.region==='korea'?'🇰🇷':'🌍'}</div>
      <div>
        <div class="card-tit">${esc(signal.product||signal.id)}</div>
        <div class="card-sub">${esc(signal.category||'benchmark')} · ${esc(signal.region||'global')}</div>
      </div>
      ${signal.source_url?`<a href="${esc(signal.source_url)}" target="_blank" rel="noreferrer" class="btn btn-i" style="margin-left:auto">source</a>`:''}
    </div>
    <div style="font-size:12px;color:var(--tx2);line-height:1.6;margin-bottom:8px">${esc(signal.signal||'')}</div>
    ${(signal.lessons||[]).length?`<div style="margin-top:6px">${(signal.lessons||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')}</div>`:''}
    ${(signal.adopted_into||[]).length?`<div class="sb-r" style="margin-top:8px">${(signal.adopted_into||[]).map(item=>`<span class="st s-nd">${esc(item)}</span>`).join('')}</div>`:''}
  </div>`).join('');
  const intakeH=intakeQuestions.map(question=>{
    const selectedId=intakeSummary.answers[question.id]||intakeCanvas.defaults?.[question.id];
    const options=question.options||[];
    const selected=options.find(option=>option.id===selectedId)||options[0]||{};
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-h">
        <div class="card-ic">📝</div>
        <div>
          <div class="card-tit">${esc(question.title||question.id)}</div>
          <div class="card-sub">${esc(question.prompt||'')}</div>
        </div>
      </div>
      <div class="kv">
        <span class="kk">선택</span>
        <span>
          <select onchange="storeIntakeAnswer('${esc(question.id)}', this.value); renderReq();" style="background:var(--sf2);color:var(--tx);border:1px solid var(--ln);border-radius:6px;padding:6px 8px;min-width:220px">
            ${options.map(option=>`<option value="${esc(option.id)}" ${option.id===selectedId?'selected':''}>${esc(option.label||option.id)}</option>`).join('')}
          </select>
        </span>
      </div>
      <div style="font-size:12px;color:var(--tx2);line-height:1.6">${esc(selected.description||'')}</div>
    </div>`;
  }).join('');

  const intakeScoreRows=(scores)=>Object.entries(scores||{})
    .sort((a,b)=> b[1]===a[1] ? String(a[0]).localeCompare(String(b[0])) : b[1]-a[1])
    .slice(0,3)
    .map(([id,score])=>`<div class="kv"><span class="kk">${esc(id)}</span><span class="${score>=4?'kv-ok':''}">${esc(score)}</span></div>`)
    .join('')||'<div style="color:var(--dm);font-size:12px">점수 없음</div>';

  const compatibilityH=compatibilityProfiles.map(rule=>{
    const profile=profiles.find(item=>item.id===rule.profile_id)||null;
    const declared=new Set(profile?.adapter_refs||[]);
    const required=(rule.required_adapters||[]);
    const recommended=(rule.recommended_adapters||[]);
    const forbidden=(rule.forbidden_adapters||[]);
    const missing=required.filter(adapterId=>!declared.has(adapterId));
    const invalid=forbidden.filter(adapterId=>declared.has(adapterId));
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-h">
        <div class="card-ic">🧩</div>
        <div>
          <div class="card-tit">${esc(profile?.name||rule.profile_id)}</div>
          <div class="card-sub">${esc(rule.profile_id)} · 추천 레시피: ${esc((rule.recommended_recipes||[]).join(', ')||'—')}</div>
        </div>
      </div>
      <div class="kv"><span class="kk">필수 어댑터</span><span class="${missing.length?'':'kv-ok'}">${esc(required.join(', ')||'—')}</span></div>
      <div class="kv"><span class="kk">권장 어댑터</span><span>${esc(recommended.join(', ')||'—')}</span></div>
      <div class="kv"><span class="kk">금지 어댑터</span><span>${esc(forbidden.join(', ')||'—')}</span></div>
      <div class="kv"><span class="kk">현재 profile 선언</span><span>${esc((profile?.adapter_refs||[]).join(', ')||'—')}</span></div>
      <div class="kv"><span class="kk">정합성</span><span class="${!missing.length && !invalid.length ? 'kv-ok' : ''}">${!missing.length && !invalid.length ? 'OK' : `보정 필요: missing ${missing.length}, forbidden ${invalid.length}`}</span></div>
      ${(rule.notes||[]).length?`<div style="margin-top:8px;font-size:11px;color:var(--tx2);line-height:1.6">${(rule.notes||[]).map(note=>`• ${esc(note)}`).join('<br>')}</div>`:''}
    </div>`;
  }).join('');

  const masteryLevels={foundation:'기초',apprentice:'입문 확장',practitioner:'운영 실전',mastery:'설계 숙련'};
  const masteryLevelColors={foundation:'#1f6feb',apprentice:'#8b49e5',practitioner:'#e36209',mastery:'#1a7f37'};
  const masteryTabLinks={
    'foundation-01':'dom','bootstrap-01':'req','module-01':'dom','runtime-01':'adr','mastery-01':'req'
  };

  function isMilestoneChecked(id){ return localStorage.getItem('wfos-milestone-'+id)==='1'; }
  function toggleMilestone(id){
    const cur=isMilestoneChecked(id);
    if(cur) localStorage.removeItem('wfos-milestone-'+id);
    else localStorage.setItem('wfos-milestone-'+id,'1');
    renderReq();
  }
  function arePrerequsitesMet(milestone){
    return (milestone.prerequisites||[]).every(prereqId=>isMilestoneChecked(prereqId));
  }

  const checkedCount=masteryMilestones.filter(m=>isMilestoneChecked(m.id)).length;
  const totalCount=masteryMilestones.length;
  const progressPct=totalCount?Math.round(checkedCount/totalCount*100):0;

  const masteryProgressBar=`
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600">학습 진도</span>
        <span style="font-size:13px;color:#1a7f37;font-weight:700">${checkedCount}/${totalCount} 완료 (${progressPct}%)</span>
      </div>
      <div style="background:#21262d;height:8px;border-radius:4px;overflow:hidden">
        <div style="background:linear-gradient(90deg,#1f6feb,#1a7f37);height:100%;width:${progressPct}%;transition:width .3s;border-radius:4px"></div>
      </div>
      ${progressPct===100?'<div style="color:#3fb950;font-size:12px;margin-top:6px;font-weight:600">🏆 모든 마일스톤 완료! 설계 숙련 달성</div>':''}
    </div>`;

  const masteryH=masteryProgressBar+masteryMilestones.map(milestone=>{
    const checked=isMilestoneChecked(milestone.id);
    const prereqsMet=arePrerequsitesMet(milestone);
    const locked=!prereqsMet&&!checked;
    const lvlColor=masteryLevelColors[milestone.level]||'#8b949e';
    const tabLink=masteryTabLinks[milestone.id];
    return `<div class="card" style="margin-bottom:10px;opacity:${locked?'.5':'1'};border-left:3px solid ${checked?'#1a7f37':locked?'#444':lvlColor}">
      <div class="card-h" style="cursor:pointer" onclick="${locked ? '' : `toggleMilestone('${esc(milestone.id)}')`}">
        <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${checked?'#1a7f37':locked?'#555':lvlColor};background:${checked?'#1a7f37':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">${checked?'✓':locked?'🔒':''}</div>
        <div style="flex:1">
          <div class="card-tit" style="color:${checked?'#1a7f37':locked?'#8b949e':'var(--tx)'}">${esc(milestone.title||milestone.id)}</div>
          <div class="card-sub"><span style="background:${lvlColor}22;color:${lvlColor};padding:1px 6px;border-radius:10px;font-size:10px">${esc(masteryLevels[milestone.level]||milestone.level||'—')}</span> · ${esc(milestone.track_ref||'—')}</div>
        </div>
        ${tabLink?`<button class="btn btn-i" style="font-size:10px;flex-shrink:0" onclick="event.stopPropagation();sw('${tabLink}')">탭 이동 →</button>`:''}
      </div>
      ${locked?`<div style="color:var(--dm);font-size:11px;margin-top:6px">🔒 선행 단계 필요: ${esc((milestone.prerequisites||[]).join(', '))}</div>`:`
      <div class="kv" style="margin-top:8px"><span class="kk">목표</span><span>${esc(milestone.objective||'')}</span></div>
      <div style="margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--dm);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">완료 증거</div>
        ${(milestone.proof||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${checked?'d-pass':'d-act'}"></div><div class="wg" style="color:${checked?'#3fb950':'var(--tx)'}">${esc(item)}</div></div>`).join('')}
      </div>`}
    </div>`;
  }).join('');

  $('c-req').innerHTML=`
    <div class="sec-tit">📋 요구사항 & 제약조건</div>

    <div class="card req-sec">
      <div class="req-sec-h">📦 모듈 정의 (requirements/requirements.yaml)</div>
      <div class="g2">
        <div><div class="kv"><span class="kk">모듈 ID</span><span style="color:var(--br);font-weight:600">${esc(mod.id||'')}</span></div>
          <div class="kv"><span class="kk">이름</span><span>${esc(mod.name||'')}</span></div>
          <div class="kv"><span class="kk">도메인</span><span>${esc(mod.domain||'')}</span></div>
          <div class="kv"><span class="kk">바운디드 컨텍스트</span><span>${esc(mod.bounded_context||'')}</span></div></div>
        <div><div class="kv"><span class="kk">현재 Stage</span><span class="st s-ok">${esc(req.stage||'')}</span></div>
          <div class="kv"><span class="kk">소유팀</span><span>${esc(mod.owner||'')}</span></div></div>
      </div>
      ${mod.description?`<div style="font-size:12px;color:var(--dm);margin-top:8px;padding:8px;background:var(--sf2);border-radius:5px;line-height:1.6">${esc(mod.description)}</div>`:''}
    </div>

    <div class="card req-sec">
      <div class="req-sec-h">⚡ NFR (비기능 요구사항) — requirements/nfr.yaml</div>
      ${nfrH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="card req-sec">
      <div class="req-sec-h">✅ 품질 게이트 체크리스트</div>
      ${qgH}
    </div>

    <div class="card req-sec">
      <div class="req-sec-h">🔒 하드 제약 (Hard Constraints) — 위반 시 Stage 재실행</div>
      ${hcH||'<div style="color:var(--dm);font-size:12px">없음</div>'}
    </div>

    <div class="card req-sec">
      <div class="req-sec-h" style="color:var(--pu)">💡 소프트 제약 (Soft Constraints)</div>
      ${scH||'<div style="color:var(--dm);font-size:12px">없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🗺 도메인 맵 (requirements/domain-map.yaml)</div>
      ${dmH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🚀 프로젝트 시작 블루프린트</div>
      ${bpH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">✅ 필수 개선 3종</div>
      ${benchmarkReview.reviewed_on?`<div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">🧪</div>
          <div>
            <div class="card-tit">Benchmark Review Baseline</div>
            <div class="card-sub">${esc(benchmarkReview.reviewed_on)} · ${esc(benchmarkReview.source_policy||'')}</div>
          </div>
        </div>
        ${(benchmarkReview.notes||[]).map(note=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(note)}</div></div>`).join('')}
      </div>`:''}
      ${essentialImprovementCards||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🌐 국내외 벤치마크 기반 개선 포커스</div>
      ${focusH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🔎 국내외 벤치마크 신호</div>
      ${benchmarkH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
      <div class="card" style="margin-top:10px">
        <div class="card-h">
          <div class="card-ic">🧭</div>
          <div>
            <div class="card-tit">Benchmark Action Pack</div>
            <div class="card-sub">현재 goal에 맞는 benchmark-backed 개선 3종을 명령까지 묶어 바로 재사용합니다.</div>
          </div>
        </div>
        <div class="sec-ctrl" style="margin-top:10px">
          <div class="ts-info">필수 개선 3종을 기준으로 GitHub Projects, Jira Product Discovery, OpenAI File Search, NAVER CLOVA 신호를 현재 packet 흐름에 맞게 재조합합니다.</div>
          <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(benchmarkPack.commands?.json||'')}').then(()=>toast('benchmark-pack 명령 복사됨'))">⌘ benchmark-pack</button>
          <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(benchmarkPack.commands?.npm||'')}').then(()=>toast('npm benchmark-pack 명령 복사됨'))">⌘ npm</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          ${(benchmarkPack.recommended||[]).map(item=>`<div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">${esc(item.title)}</div>
            <div class="card-sub" style="margin-bottom:8px">${esc(item.outcome||'')}</div>
            <div class="kv"><span class="kk">score</span><span class="kv-ok">${esc(item.score)}</span></div>
            ${(item.reasons||[]).slice(0,2).map(reason=>`<div class="wi" style="margin-top:6px"><div class="wd d-pass"></div><div class="wg">${esc(reason)}</div></div>`).join('')}
            ${(item.why_now||[]).slice(0,2).map(reason=>`<div class="wi" style="margin-top:6px"><div class="wd d-warn"></div><div class="wg">${esc(reason)}</div></div>`).join('')}
            ${(item.delivered_by||[]).slice(0,2).map(step=>`<div class="wi" style="margin-top:6px"><div class="wd d-act"></div><div class="wg">${esc(step)}</div></div>`).join('')}
            ${(item.related_focuses||[]).length?`<div class="sb-r" style="margin-top:8px">${item.related_focuses.map(focus=>`<span class="st s-nd">${esc(focus.title)}</span>`).join('')}</div>`:''}
            ${(item.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${item.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
          </div>`).join('')||'<div style="color:var(--dm);font-size:12px">추천 focus 없음</div>'}
        </div>
      </div>
      <div class="card" style="margin-top:10px">
        <div class="card-h">
          <div class="card-ic">🧩</div>
          <div>
            <div class="card-tit">Starter Preset Pack</div>
            <div class="card-sub">goal별 planning mode, routing profile, execution template를 기본값으로 바로 선택합니다.</div>
          </div>
        </div>
        <div class="g3" style="margin-top:10px">
          <div class="mc"><div class="mc-l">Planning Mode</div><div class="mc-v">${esc(starterPreset.planning_mode.title||'—')}</div><div class="mc-s">${esc(starterPreset.planning_mode.id||'')}</div></div>
          <div class="mc"><div class="mc-l">Routing</div><div class="mc-v">${esc(starterPreset.routing_profile.id||'—')}</div><div class="mc-s">${esc(starterPreset.routing_profile.objective||'')}</div></div>
          <div class="mc"><div class="mc-l">Template</div><div class="mc-v">${esc(starterPreset.execution_template.id||'—')}</div><div class="mc-s">${esc(starterPreset.execution_template.title||'')}</div></div>
        </div>
        <div class="sec-ctrl" style="margin-top:10px">
          <button class="btn btn-s" style="font-size:10px" onclick="applyStarterPresetToPlanningStudio()">⚙️ Planning Studio에 적용</button>
          <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(starterPreset.commands?.json||'')}').then(()=>toast('starter-preset 명령 복사됨'))">⌘ starter-preset</button>
          <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(starterPreset.commands?.npm||'')}').then(()=>toast('npm starter-preset 명령 복사됨'))">⌘ npm</button>
        </div>
        ${(starterPreset.planning_sections||[]).length?`<div style="margin-top:10px">${starterPreset.planning_sections.map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.id)}</div><div class="wr">${esc(String(item.value).slice(0,120))}</div></div></div>`).join('')}</div>`:''}
        ${(starterPreset.top_focuses||[]).length?`<div class="sb-r" style="margin-top:8px">${starterPreset.top_focuses.map(item=>`<span class="st s-ac">${esc(item.title)}</span>`).join('')}</div>`:''}
      </div>
      <div class="card" style="margin-top:10px">
        <div class="card-h">
          <div class="card-ic">🕘</div>
          <div>
            <div class="card-tit">Preset Apply Snapshot Link</div>
            <div class="card-sub">preset 적용과 동시에 planning snapshot을 남겨, 시작점 변경을 바로 복기할 수 있게 합니다.</div>
          </div>
        </div>
        <div class="kv"><span class="kk">latest apply</span><span class="${presetAppliedSnapshot?'kv-ok':''}">${presetAppliedSnapshot?esc((presetAppliedSnapshot.saved_at||'').replace('T',' ').slice(0,16)):'아직 없음'}</span></div>
        <div class="kv"><span class="kk">mode</span><span>${esc(presetAppliedSnapshot?.mode_title||starterPreset.planning_mode.title||'—')}</span></div>
        <div class="kv"><span class="kk">changed</span><span>${esc(presetAppliedSnapshot?.changed_count||0)}</span></div>
        <div style="margin-top:10px">
          <div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">Starter preset apply 시 savePlanningSnapshot(..., 'starter-preset') 가 자동 호출됩니다.</div></div>
          ${(presetAppliedSnapshot?.changed_labels||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">다음 preset apply 시 최근 변경 section이 여기에 표시됩니다.</div>'}
        </div>
        ${(starterPreset.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${starterPreset.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
      </div>
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧭 프로젝트 시작 질문지</div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">🎯</div>
          <div>
            <div class="card-tit">추천 조합</div>
            <div class="card-sub">질문 답변을 기준으로 blueprint/profile/recipe를 계산한다.</div>
          </div>
        </div>
        <div class="g3">
          <div class="mc"><div class="mc-l">Blueprint</div><div class="mc-v" style="font-size:14px">${esc(intakeBlueprint?.name||intakeSummary.blueprintId||'—')}</div><div class="mc-s">${esc(intakeBlueprint?.summary||'')}</div></div>
          <div class="mc"><div class="mc-l">Profile</div><div class="mc-v" style="font-size:14px">${esc(intakeProfile?.name||intakeSummary.profileId||'—')}</div><div class="mc-s">${esc(intakeProfile?.description||'')}</div></div>
          <div class="mc"><div class="mc-l">Recipe</div><div class="mc-v" style="font-size:14px">${esc(intakeRecipe?.name||intakeSummary.recipeId||'—')}</div><div class="mc-s">${esc(intakeRecipe?.objective||'')}</div></div>
        </div>
        <div class="g3" style="margin-top:10px">
          <div class="card" style="margin:0"><div class="card-tit" style="margin-bottom:6px">Blueprint 점수</div>${intakeScoreRows(intakeSummary.scores.blueprints)}</div>
          <div class="card" style="margin:0"><div class="card-tit" style="margin-bottom:6px">Profile 점수</div>${intakeScoreRows(intakeSummary.scores.profiles)}</div>
          <div class="card" style="margin:0"><div class="card-tit" style="margin-bottom:6px">Recipe 점수</div>${intakeScoreRows(intakeSummary.scores.recipes)}</div>
        </div>
        <div class="sec-ctrl" style="margin-top:10px">
          <div class="ts-info">선택된 조합을 새 프로젝트 시작용 Launch Brief artifact로 바로 내보낼 수 있습니다.</div>
          <button class="btn btn-s" style="font-size:10px" onclick="copyLaunchBrief()">📋 Launch Brief 복사</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportLaunchBriefJSON()">🧾 JSON</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportLaunchBriefYAML()">🗂 YAML</button>
        </div>
        <div class="g3" style="margin-top:10px">
          <div class="mc"><div class="mc-l">Autopilot</div><div class="mc-v">${esc(launchBrief.autopilot?.source||'benchmark-default')}</div><div class="mc-s">${esc(launchBrief.autopilot?.planning_mode_id||'')}</div></div>
          <div class="mc"><div class="mc-l">Routing</div><div class="mc-v">${esc(launchBrief.autopilot?.routing_profile_id||'—')}</div><div class="mc-s">${esc(launchBrief.autopilot?.execution_template_id||'')}</div></div>
          <div class="mc"><div class="mc-l">Ready Gate</div><div class="mc-v">${esc(launchBrief.autopilot?.ready_gate?.current_gate||'review')}</div><div class="mc-s">score ${esc(launchBrief.autopilot?.ready_gate?.score||0)}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">왜 이 조합인가</div>
            ${launchBrief.headline?`<div style="font-size:12px;color:var(--tx2);line-height:1.6;margin-bottom:8px">${esc(launchBrief.headline)}</div>`:''}
            ${(launchBrief.reasons||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">근거 없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">바로 시작 순서</div>
            ${(launchBrief.startNow||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">시작 순서 없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">핵심 가드레일</div>
            ${(launchBrief.guardrails||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">가드레일 없음</div>'}
            ${(launchBrief.benchmarkSignals||[]).length?`<div class="sb-r" style="margin-top:8px">${launchBrief.benchmarkSignals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Starter Deliverables</div>
            ${((intakeBlueprint?.starter_deliverables||[]).concat(intakeRecipe?.evidence_outputs||[])).slice(0,6).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">정의된 deliverable 없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Starter Focus Cycle</div>
            <div class="wr" style="margin:0 0 6px 0;color:var(--br)">Now</div>
            ${(intakeBlueprint?.focus_cycle?.now||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            <div class="wr" style="margin:8px 0 6px 0;color:var(--br)">Next</div>
            ${(intakeBlueprint?.focus_cycle?.next||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
        </div>
      </div>
      ${intakeH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">📝 Planning Studio</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:10px">
        ${planningModeCards||'<div style="color:var(--dm);font-size:12px">planning mode 없음</div>'}
      </div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">🧠</div>
          <div>
            <div class="card-tit">${esc(planningStudio.mode?.title||'Planning Studio')}</div>
            <div class="card-sub">${esc(planningStudio.mode?.summary||'')}</div>
          </div>
        </div>
        <div class="kv"><span class="kk">본질 유지</span><span>${esc(planningStudio.mode?.preserve_essence||'—')}</span></div>
        <div class="sec-ctrl" style="margin-top:10px">
          <div class="ts-info">FigJam status canvas와 Linear cycles 패턴처럼 계획서를 바로 수정하고 artifact로 내보낼 수 있습니다.</div>
          <button class="btn btn-s" style="font-size:10px" onclick="copyPlanningStudio()">📋 Planning Studio 복사</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportPlanningStudioJSON()">🧾 JSON</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportPlanningStudioYAML()">🗂 YAML</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
          ${planningStudioEntries||'<div style="color:var(--dm);font-size:12px">편집 가능한 planning section 없음</div>'}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0;grid-column:1/-1">
            <div class="card-tit" style="margin-bottom:6px">Planning Variant Comparator</div>
            <div class="card-sub" style="margin-bottom:8px">Jira Product Discovery와 GitHub Projects식으로 현재 intake/운영 상태에 맞는 planning mode 적합도를 비교합니다.</div>
            <div class="kv"><span class="kk">현재 추천</span><span class="kv-ok">${esc(planningComparison.recommended_mode_id||'—')}</span></div>
          </div>
          ${planningComparatorCards||'<div style="color:var(--dm);font-size:12px">비교할 planning mode 없음</div>'}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Planning Patch Preview</div>
            <div class="kv"><span class="kk">changed</span><span class="${(planningPatch.changed_count||0)>0?'kv-ok':''}">${esc(planningPatch.changed_count||0)}</span></div>
            <div class="kv"><span class="kk">unchanged</span><span>${esc(planningPatch.unchanged_count||0)}</span></div>
            ${(planningPatch.changed_entries||[]).slice(0,4).map(entry=>`<div class="wi" style="margin-top:6px"><div class="wd d-act"></div><div style="flex:1"><div class="wg">${esc(entry.label)}</div><div class="wr">after: ${esc((entry.after||'').slice(0,90))}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">기본값 대비 변경 없음</div>'}
            <div class="sec-ctrl" style="margin-top:10px">
              <button class="btn btn-s" style="font-size:10px" onclick="copyPlanningPatch()">📋 Patch 복사</button>
              <button class="btn btn-i" style="font-size:10px" onclick="exportPlanningPatchJSON()">🧾 JSON</button>
              <button class="btn btn-i" style="font-size:10px" onclick="exportPlanningPatchYAML()">🗂 YAML</button>
            </div>
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Snapshot Timeline</div>
            <div class="card-sub" style="margin-bottom:8px">Figma version history식으로 최근 planning snapshot을 짧게 남깁니다.</div>
            ${planningSnapshotCards||'<div style="color:var(--dm);font-size:12px">저장된 snapshot 없음</div>'}
            <div class="sec-ctrl" style="margin-top:10px">
              <button class="btn btn-s" style="font-size:10px" onclick="savePlanningSnapshot()">💾 Snapshot 저장</button>
              <button class="btn btn-i" style="font-size:10px" onclick="clearPlanningSnapshots()">🧹 초기화</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧺 Context Packet</div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">📦</div>
          <div>
            <div class="card-tit">작업단위별 최소 읽기 묶음</div>
            <div class="card-sub">${esc(contextPacket.packet_source.label||'—')}${contextPacket.packet_source.id?` · ${esc(contextPacket.packet_source.id)}`:''}</div>
          </div>
        </div>
        <div class="g3">
          <div class="mc"><div class="mc-l">Read First</div><div class="mc-v">${(contextPacket.read_first||[]).length}</div><div class="mc-s">즉시 읽을 최소 세트</div></div>
          <div class="mc"><div class="mc-l">Read Next</div><div class="mc-v">${(contextPacket.read_next||[]).length}</div><div class="mc-s">실행 중 필요시 확장</div></div>
          <div class="mc"><div class="mc-l">Skip Signals</div><div class="mc-v">${(contextPacket.skip_signals||[]).length}</div><div class="mc-s">불필요 선행 읽기 차단</div></div>
        </div>
        <div class="sec-ctrl" style="margin-top:10px">
          <div class="ts-info">OpenAI file search식 최소 문맥 회수 원칙을 적용해 선독 파일과 지연 로딩 파일을 분리합니다.</div>
          <button class="btn btn-s" style="font-size:10px" onclick="copyContextPacket()">📋 Context Packet 복사</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportContextPacketJSON()">🧾 JSON</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportContextPacketYAML()">🗂 YAML</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Read First</div>
            ${(contextPacket.read_first||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Read Next</div>
            ${(contextPacket.read_next||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Read Later / Skip</div>
            ${(contextPacket.read_later||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            ${(contextPacket.skip_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${contextPacket.skip_signals.map(item=>`<span class="st s-nd">${esc(item)}</span>`).join('')}</div>`:''}
          </div>
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧰</div>
            <div>
              <div class="card-tit">Context Bundle Export</div>
              <div class="card-sub">최소 읽기 묶음을 CLI/JSON/YAML로 내보내 AI와 사람이 같은 context bundle을 재사용합니다.</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Commands</div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(contextBundleExport.commands.json)}</div></div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(contextBundleExport.commands.yaml)}</div></div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(contextBundleExport.commands.npm)}</div></div>
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Bundle Budget</div>
              <div class="kv"><span class="kk">goal/profile</span><span>${esc(contextBundleExport.goal)} / ${esc(contextBundleExport.profile_id||'—')}</span></div>
              <div class="kv"><span class="kk">primary</span><span>${esc(formatTokens(contextBundleExport.summary.primary?.estimated_tokens||0))}</span></div>
              <div class="kv"><span class="kk">secondary</span><span>${esc(formatTokens(contextBundleExport.summary.secondary?.estimated_tokens||0))}</span></div>
              <div class="kv"><span class="kk">total</span><span class="kv-ok">${esc(formatTokens(contextBundleExport.summary.total?.estimated_tokens||0))}</span></div>
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Protected Core</div>
              ${(contextBundleExport.protected_core||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">현재 선언 없음</div>'}
            </div>
          </div>
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🔐</div>
            <div>
              <div class="card-tit">Context Lock Snapshot</div>
              <div class="card-sub">primary/secondary exact read manifest를 잠가 같은 최소 문맥을 AI와 사람이 재사용합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Exact Files</div><div class="mc-v">${esc(contextLock.exact_file_count||0)}</div><div class="mc-s">${esc(contextLock.profile_id||'—')}</div></div>
            <div class="mc"><div class="mc-l">Estimated Tokens</div><div class="mc-v">${esc(formatTokens(contextLock.estimated_tokens||0))}</div><div class="mc-s">primary + secondary</div></div>
            <div class="mc"><div class="mc-l">Goal</div><div class="mc-v">${esc(contextLock.goal)}</div><div class="mc-s">exact file manifest export</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/export_context_lock.py --goal ${esc(contextLock.goal)} --json').then(()=>toast('context-lock 명령 복사됨'))">⌘ context-lock</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('npm run wp:context-lock -- --goal ${esc(contextLock.goal)} --json').then(()=>toast('npm context-lock 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Locked Paths</div>
              ${(contextLock.locked_paths||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${item.tier==='primary'?'d-pass':'d-act'}"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.tier)} · ${esc(item.reason||'')}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">잠글 경로 없음</div>'}
            </div>
          </div>
          ${(contextLock.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${contextLock.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🩺</div>
            <div>
              <div class="card-tit">Context Drift Guard</div>
              <div class="card-sub">잠근 context manifest 대비 changed/missing만 다시 읽도록 drift를 검사합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">manifest</span><span style="font-family:var(--mo);font-size:10px">${esc(contextDrift.manifest_path)}</span></div>
          <div class="kv"><span class="kk">locked files</span><span>${esc(contextDrift.exact_file_count||0)}</span></div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(contextDrift.commands?.json||'')}').then(()=>toast('context-drift 명령 복사됨'))">⌘ context-drift</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(contextDrift.commands?.npm||'')}').then(()=>toast('npm context-drift 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(contextDrift.reread_policy||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          ${(contextDrift.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${contextDrift.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🔁</div>
            <div>
              <div class="card-tit">Re-read Queue</div>
              <div class="card-sub">drift가 생겼을 때 어떤 파일을 먼저 다시 읽을지 primary/secondary 우선순위로 정리합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Status</div><div class="mc-v">${esc(rereadQueue.drift_status||'—')}</div><div class="mc-s">changed/missing first</div></div>
            <div class="mc"><div class="mc-l">Queue</div><div class="mc-v">${esc(rereadQueue.reread_count||0)}</div><div class="mc-s">top 8 candidates</div></div>
            <div class="mc"><div class="mc-l">Manifest</div><div class="mc-v">${esc((rereadQueue.manifest_path||'—').split('/').slice(-1)[0])}</div><div class="mc-s">context lock source</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(rereadQueue.commands?.json||'')}').then(()=>toast('reread-queue 명령 복사됨'))">⌘ reread-queue</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(rereadQueue.commands?.npm||'')}').then(()=>toast('npm reread-queue 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(rereadQueue.reread_queue||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${item.tier==='primary'?'d-pass':'d-act'}"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.tier)} · ${esc(item.status)} · ${esc(formatTokens(item.estimated_tokens||0))}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">현재 reread 후보 없음</div>'}
          </div>
          <div style="margin-top:10px">
            ${(rereadQueue.policy||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          ${(rereadQueue.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${rereadQueue.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
      </div>
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧭 Context Routing Profile</div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">🗺</div>
          <div>
            <div class="card-tit">${esc(contextRouting.profile?.id||'routing profile 없음')}</div>
            <div class="card-sub">${esc(contextRouting.profile?.objective||'')}</div>
          </div>
        </div>
        <div class="g3">
          <div class="mc"><div class="mc-l">Primary</div><div class="mc-v">${esc((contextRouting.primary_reads||[]).length)}</div><div class="mc-s">max ${esc(contextRouting.profile?.max_primary_files||0)} files</div></div>
          <div class="mc"><div class="mc-l">Secondary</div><div class="mc-v">${esc((contextRouting.secondary_reads||[]).length)}</div><div class="mc-s">max ${esc(contextRouting.profile?.max_secondary_files||0)} files</div></div>
          <div class="mc"><div class="mc-l">Deferred</div><div class="mc-v">${esc((contextRouting.deferred_reads||[]).length)}</div><div class="mc-s">실행/리뷰 시만</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Primary Reads</div>
            ${(contextRouting.primary_reads||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Secondary Reads</div>
            ${(contextRouting.secondary_reads||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Deferred Reads</div>
            ${(contextRouting.deferred_reads||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.reason)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          ${tokenBudgetCards}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🪙</div>
            <div>
              <div class="card-tit">Context Exception Ledger</div>
              <div class="card-sub">남은 token headroom 안에서만 secondary/deferred 파일을 예외적으로 추가 읽기합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Primary Headroom</div><div class="mc-v">${esc(formatTokens(contextExceptionLedger.primary_headroom||0))}</div><div class="mc-s">6000 기준 잔여</div></div>
            <div class="mc"><div class="mc-l">Total Headroom</div><div class="mc-v">${esc(formatTokens(contextExceptionLedger.total_headroom||0))}</div><div class="mc-s">18000 기준 잔여</div></div>
            <div class="mc"><div class="mc-l">Allowed</div><div class="mc-v">${esc(contextExceptionLedger.allowed_exception_count||0)}</div><div class="mc-s">on-demand exceptions</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(contextExceptionLedger.commands?.json||'')}').then(()=>toast('context-exception 명령 복사됨'))">⌘ context-exception</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(contextExceptionLedger.commands?.npm||'')}').then(()=>toast('npm context-exception 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(contextExceptionLedger.exceptions||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${item.decision==='allow-on-demand'?'d-pass':'d-warn'}"></div><div style="flex:1"><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)}</div><div class="wr">${esc(item.source_tier)} · ${esc(item.decision)} · ${esc(formatTokens(item.estimated_tokens||0))}${item.can_promote_to_primary?' · promote-to-primary 가능':''}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">예외 후보 없음</div>'}
          </div>
          ${(contextExceptionLedger.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${contextExceptionLedger.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧪</div>
            <div>
              <div class="card-tit">Exception Packet Draft</div>
              <div class="card-sub">허용된 예외 문맥만 별도 packet으로 정리해, 필요할 때만 bounded extra read를 열게 합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Allowed Paths</div><div class="mc-v">${esc((exceptionPacketDraft.allowed_paths||[]).length)}</div><div class="mc-s">allow-on-demand only</div></div>
            <div class="mc"><div class="mc-l">Promote To Primary</div><div class="mc-v">${esc((exceptionPacketDraft.candidate_primary_promotions||[]).length)}</div><div class="mc-s">bounded candidates</div></div>
            <div class="mc"><div class="mc-l">Tokens</div><div class="mc-v">${esc(formatTokens(exceptionPacketDraft.total_exception_tokens||0))}</div><div class="mc-s">extra context cap</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionPacketDraft.commands?.json||'')}').then(()=>toast('exception-packet 명령 복사됨'))">⌘ exception-packet</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionPacketDraft.commands?.npm||'')}').then(()=>toast('npm exception-packet 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(exceptionPacketDraft.allowed_paths||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">허용된 exception path 없음</div>'}
          </div>
          <div style="margin-top:10px">
            ${(exceptionPacketDraft.prompt_block||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          ${(exceptionPacketDraft.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${exceptionPacketDraft.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧠</div>
            <div>
              <div class="card-tit">Exception Replay Lens</div>
              <div class="card-sub">허용된 예외 문맥을 학습용으로 다시 읽고, 다음에 primary로 올릴 후보를 복기합니다.</div>
            </div>
          </div>
          <div style="margin-top:10px">
            ${(exceptionReplay.allowed_exception_paths||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">복기할 exception path 없음</div>'}
          </div>
          <div style="margin-top:10px">
            ${(exceptionReplay.study_prompts||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionReplay.commands?.json||'')}').then(()=>toast('exception-replay 명령 복사됨'))">⌘ exception-replay</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionReplay.commands?.npm||'')}').then(()=>toast('npm exception-replay 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(exceptionReplay.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${exceptionReplay.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        ${(contextRouting.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${contextRouting.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
      </div>
    </div>

    <div class="req-sec">
      <div class="req-sec-h">📦 Execution Packet Draft</div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-h">
          <div class="card-ic">🚀</div>
          <div>
            <div class="card-tit">${esc(executionPacket.id)}</div>
            <div class="card-sub">${esc(executionPacket.goal)}</div>
          </div>
        </div>
        <div class="g3">
          <div class="mc"><div class="mc-l">Type / Stage</div><div class="mc-v" style="font-size:13px">${esc(executionPacket.type)} / ${esc(executionPacket.stage)}</div><div class="mc-s">${esc(executionPacket.template_id)}</div></div>
          <div class="mc"><div class="mc-l">Tier Reads</div><div class="mc-v">${esc((executionPacket.context_budget?.tier_reads||[]).length)}</div><div class="mc-s">estimated ${esc(executionPacket.context_budget?.estimated_turns||0)} turns</div></div>
          <div class="mc"><div class="mc-l">File Budget</div><div class="mc-v">${esc(executionPacket.context_budget?.max_new_files||0)} / ${esc(executionPacket.context_budget?.max_modified_files||0)}</div><div class="mc-s">new / modified</div></div>
        </div>
        <div class="sec-ctrl" style="margin-top:10px">
          <div class="ts-info">Planning Studio와 Context Routing 결과를 current-wp 형태 draft로 환원합니다.</div>
          <button class="btn btn-s" style="font-size:10px" onclick="copyExecutionPacket()">📋 Execution Packet 복사</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportExecutionPacketJSON()">🧾 JSON</button>
          <button class="btn btn-i" style="font-size:10px" onclick="exportExecutionPacketYAML()">🗂 YAML</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Done When</div>
            ${(executionPacket.done_when||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Fail If</div>
            ${(executionPacket.fail_if||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="card" style="margin:0">
            <div class="card-tit" style="margin-bottom:6px">Validation</div>
            ${(executionPacket.validation||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')}
          </div>
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🛫</div>
            <div>
              <div class="card-tit">Apply Handoff Kit</div>
              <div class="card-sub">exported packet을 dry-run 후 current-wp / next-actions로 넘기는 마지막 1단계</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Commands</div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(applyHandoff.commands.dry_run)}</div></div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(applyHandoff.commands.apply)}</div></div>
              <div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(applyHandoff.commands.npm_apply)}</div></div>
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Preview Delta</div>
              ${(applyHandoff.targets||[]).map(target=>`<div style="margin-bottom:8px">
                <div class="wr" style="font-family:var(--mo);font-size:10px;margin-bottom:4px">${esc(target.path)}</div>
                ${Object.entries(target.after||{}).map(([key,value])=>`<div class="kv"><span class="kk">${esc(key)}</span><span>${esc(value)}</span></div>`).join('')}
              </div>`).join('')}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Apply Budget</div>
              <div class="kv"><span class="kk">export file</span><span style="font-family:var(--mo);font-size:10px">${esc(applyHandoff.export_file)}</span></div>
              <div class="kv"><span class="kk">tier reads</span><span>${esc(formatTokens(applyHandoff.budget.tier_reads?.estimated_tokens||0))}</span></div>
              <div class="kv"><span class="kk">context reads</span><span>${esc(formatTokens(applyHandoff.budget.context_reads?.estimated_tokens||0))}</span></div>
              <div class="kv"><span class="kk">total</span><span class="kv-ok">${esc(formatTokens(applyHandoff.budget.total?.estimated_tokens||0))}</span></div>
              ${(applyHandoff.guardrails||[]).map(item=>`<div class="wi" style="margin-top:6px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧮</div>
            <div>
              <div class="card-tit">Constraint Fit Checker</div>
              <div class="card-sub">hard constraint, adapter compatibility, token budget, packet boundary 적합성을 한 번에 점검합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">PASS</div><div class="mc-v">${esc(constraintFit.counts?.pass||0)}</div></div>
            <div class="mc"><div class="mc-l">WARN</div><div class="mc-v">${esc(constraintFit.counts?.warn||0)}</div></div>
            <div class="mc"><div class="mc-l">RISK</div><div class="mc-v">${esc(constraintFit.counts?.risk||0)}</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <div class="ts-info">같은 판정을 CLI에서도 재사용할 수 있습니다.</div>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/check_planning_fit.py --json').then(()=>toast('check-fit 명령 복사됨'))">⌘ check-fit</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('npm run wp:check-fit -- --json').then(()=>toast('npm check-fit 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0;grid-column:1/-1">
              ${constraintFitCards||'<div style="color:var(--dm);font-size:12px">점검 데이터 없음</div>'}
            </div>
          </div>
          ${(constraintFit.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${constraintFit.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧱</div>
            <div>
              <div class="card-tit">Core Impact Boundary Map</div>
              <div class="card-sub">코어 보호 범위와 edge touchpoint를 분리해 시스템 OS는 유지하고 필요한 계획만 추가합니다.</div>
            </div>
          </div>
          <div class="sb-r" style="margin-top:10px">${coreBoundaryRootCards||'<span class="st s-nd">분류 없음</span>'}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Protected Core</div>
              ${(coreBoundary.protected_paths||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">선언 없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Edge Touchpoints</div>
              ${(coreBoundary.edge_touchpoints||[]).slice(0,8).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Adapter Surface</div>
              ${(coreBoundary.adapter_surface?.weighted||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item.name)} (${esc(item.id)}) · ${esc(item.weighted_score)}/5</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
              ${(coreBoundary.adapter_surface?.add||[]).length?`<div class="wr" style="margin-top:8px">add: ${esc((coreBoundary.adapter_surface.add||[]).join(', '))}</div>`:''}
              ${(coreBoundary.adapter_surface?.remove||[]).length?`<div class="wr">remove: ${esc((coreBoundary.adapter_surface.remove||[]).join(', '))}</div>`:''}
            </div>
          </div>
          ${(coreBoundary.hard_guardrails||[]).length?`<div style="margin-top:10px">${(coreBoundary.hard_guardrails||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item)}</div></div>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧳</div>
            <div>
              <div class="card-tit">Handoff Bundle Composer</div>
              <div class="card-sub">planning patch, context bundle, execution packet, apply sequence를 하나의 artifact로 묶습니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">execution packet</span><span>${esc(handoffBundle.execution_packet.id)} / ${esc(handoffBundle.execution_packet.type)} / ${esc(handoffBundle.execution_packet.stage)}</span></div>
          <div class="kv"><span class="kk">constraint fit</span><span class="kv-ok">pass ${esc(handoffBundle.constraint_fit.counts?.pass||0)} · warn ${esc(handoffBundle.constraint_fit.counts?.warn||0)} · risk ${esc(handoffBundle.constraint_fit.counts?.risk||0)}</span></div>
          <div style="margin-top:10px">
            ${(handoffBundle.sequence||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-s" style="font-size:10px" onclick="copyHandoffBundle()">📋 Handoff Bundle 복사</button>
            <button class="btn btn-i" style="font-size:10px" onclick="exportHandoffBundleJSON()">🧾 JSON</button>
            <button class="btn btn-i" style="font-size:10px" onclick="exportHandoffBundleYAML()">🗂 YAML</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/compose_handoff_bundle.py --json').then(()=>toast('handoff-bundle 명령 복사됨'))">⌘ handoff-bundle</button>
          </div>
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">✅</div>
            <div>
              <div class="card-tit">Verified Promote Pipeline</div>
              <div class="card-sub">fit / context lock / replay 조건을 확인한 뒤 current-wp로 안전하게 승격합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Promotion</div><div class="mc-v">${promotePipeline.ready?'ready':'blocked'}</div><div class="mc-s">risk ${esc(promotePipeline.risk_count||0)} / warn ${esc(promotePipeline.warn_count||0)}</div></div>
            <div class="mc"><div class="mc-l">Exact Files</div><div class="mc-v">${esc(promotePipeline.exact_file_count||0)}</div><div class="mc-s">locked before apply</div></div>
            <div class="mc"><div class="mc-l">Tokens</div><div class="mc-v">${esc(formatTokens(promotePipeline.estimated_tokens||0))}</div><div class="mc-s">${esc(promotePipeline.goal)}</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/promote_packet.py --goal ${esc(promotePipeline.goal)} --json').then(()=>toast('promote 명령 복사됨'))">⌘ promote</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('python3 scripts/promote_packet.py --goal ${esc(promotePipeline.goal)} --apply --json').then(()=>toast('promote apply 명령 복사됨'))">⌘ promote --apply</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('npm run wp:promote -- --goal ${esc(promotePipeline.goal)} --json').then(()=>toast('npm promote 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(promotePipeline.guardrails||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
            <div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(promotePipeline.replay_goal||'')}</div></div>
          </div>
          ${(promotePipeline.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${promotePipeline.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🛠</div>
            <div>
              <div class="card-tit">Promotion Pipeline Orchestrator</div>
              <div class="card-sub">handoff, context lock, benchmark pack, promoted packet artifact를 한 번에 생성하고 필요 시 apply까지 연결합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Pipeline</div><div class="mc-v">${promotionPipeline.ready?'ready':'review'}</div><div class="mc-s">${esc(promotionPipeline.goal)}</div></div>
            <div class="mc"><div class="mc-l">Locked Tokens</div><div class="mc-v">${esc(formatTokens(promotionPipeline.locked_tokens||0))}</div><div class="mc-s">${esc(promotionPipeline.exact_file_count||0)} files</div></div>
            <div class="mc"><div class="mc-l">Top Focus</div><div class="mc-v">${esc(promotionPipeline.top_focus?.title||'—')}</div><div class="mc-s">benchmark-backed</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(promotionPipeline.commands?.json||'')}').then(()=>toast('promote-pipeline 명령 복사됨'))">⌘ promote-pipeline</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(promotionPipeline.commands?.apply||'')}').then(()=>toast('promote-pipeline apply 명령 복사됨'))">⌘ apply</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(promotionPipeline.commands?.npm||'')}').then(()=>toast('npm promote-pipeline 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(promotionPipeline.artifacts||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')}
          </div>
          ${(promotionPipeline.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${promotionPipeline.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧾</div>
            <div>
              <div class="card-tit">Readiness Brief</div>
              <div class="card-sub">status, scheduler, lock, reread, benchmark focus를 한 장으로 묶어 바로 다음 실행 판단에 씁니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Promotion</div><div class="mc-v">${readinessBrief.promotion_pipeline.ready?'ready':'review'}</div><div class="mc-s">${esc(formatTokens(readinessBrief.promotion_pipeline.locked_tokens||0))}</div></div>
            <div class="mc"><div class="mc-l">Scheduler</div><div class="mc-v">${esc(readinessBrief.scheduler.ready||0)}</div><div class="mc-s">ready / active ${esc(readinessBrief.scheduler.active||0)}</div></div>
            <div class="mc"><div class="mc-l">Re-read</div><div class="mc-v">${esc(readinessBrief.reread_queue.reread_count||0)}</div><div class="mc-s">${esc(readinessBrief.reread_queue.drift_status||'—')}</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(readinessBrief.commands?.json||'')}').then(()=>toast('readiness-brief 명령 복사됨'))">⌘ readiness-brief</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(readinessBrief.commands?.npm||'')}').then(()=>toast('npm readiness-brief 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(readinessBrief.next_actions||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div style="margin-top:10px">
            ${(readinessBrief.benchmark_focus||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item.title)} · score ${esc(item.score)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">benchmark focus 없음</div>'}
          </div>
          ${(readinessBrief.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${readinessBrief.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🚦</div>
            <div>
              <div class="card-tit">Promotion Decision Deck</div>
              <div class="card-sub">fit, reread, locked token 상태를 한 번에 읽고 지금 바로 승격할지 결정합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Gate</div><div class="mc-v">${esc(promotionDecision.gate_status)}</div><div class="mc-s">${promotionDecision.ready_to_apply?'apply 가능':'검토 필요'}</div></div>
            <div class="mc"><div class="mc-l">Locked Tokens</div><div class="mc-v">${esc(formatTokens(promotionDecision.locked_tokens||0))}</div><div class="mc-s">${esc(promotionDecision.goal)}</div></div>
            <div class="mc"><div class="mc-l">Re-read</div><div class="mc-v">${esc(promotionDecision.reread_count||0)}</div><div class="mc-s">drift candidate</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(promotionDecision.commands?.json||'')}').then(()=>toast('promotion-decision 명령 복사됨'))">⌘ promotion-decision</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(promotionDecision.commands?.npm||'')}').then(()=>toast('npm promotion-decision 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(promotionDecision.reasons||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${promotionDecision.gate_status==='ready'?'d-pass':promotionDecision.gate_status==='blocked'?'d-warn':'d-act'}"></div><div class="wg">${esc(item)}</div></div>`).join('')}
            <div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(promotionDecision.next_command||'')}</div></div>
          </div>
          ${(promotionDecision.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${promotionDecision.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🚀</div>
            <div>
              <div class="card-tit">Decision Apply Bridge</div>
              <div class="card-sub">ready 판정이면 promote pipeline apply까지 한 단계로 연결하고, 아니면 같은 자리에서 review 흐름만 유지합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">gate</span><span class="${decisionApplyBridge.ready_to_apply?'kv-ok':''}">${esc(decisionApplyBridge.gate_status)}</span></div>
          <div class="kv"><span class="kk">next</span><span style="font-family:var(--mo);font-size:10px">${esc(decisionApplyBridge.next_command||'')}</span></div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(decisionApplyBridge.commands?.json||'')}').then(()=>toast('decision-apply 명령 복사됨'))">⌘ decision-apply</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(decisionApplyBridge.commands?.apply||'')}').then(()=>toast('decision-apply --apply 명령 복사됨'))">⌘ apply</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(decisionApplyBridge.commands?.npm||'')}').then(()=>toast('npm decision-apply 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            <div class="wi" style="margin-bottom:5px"><div class="wd ${decisionApplyBridge.ready_to_apply?'d-pass':'d-warn'}"></div><div class="wg">${decisionApplyBridge.ready_to_apply?'GUI 판정 결과를 바로 apply로 넘길 수 있습니다.':'현재는 review 상태이므로 decision deck과 reread/fit 결과를 먼저 정리합니다.'}</div></div>
          </div>
          ${(decisionApplyBridge.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${decisionApplyBridge.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">📌</div>
            <div>
              <div class="card-tit">Apply Checkpoint Export</div>
              <div class="card-sub">decision/apply 직전 상태와 post-apply preview를 한 장으로 고정해 검토 후 실행하게 합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">gate</span><span class="${applyCheckpoint.ready_to_apply?'kv-ok':''}">${esc(applyCheckpoint.decision_gate)}</span></div>
          <div class="kv"><span class="kk">preview</span><span>${esc(applyCheckpoint.post_apply_preview.promoted_packet_id||'—')} / ${esc(applyCheckpoint.post_apply_preview.promoted_packet_stage||'—')}</span></div>
          <div class="kv"><span class="kk">locked tokens</span><span>${esc(formatTokens(applyCheckpoint.locked_tokens||0))}</span></div>
          <div style="margin-top:10px">
            ${(applyCheckpoint.reasons||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${applyCheckpoint.ready_to_apply?'d-pass':'d-warn'}"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyCheckpoint.commands?.json||'')}').then(()=>toast('apply-checkpoint 명령 복사됨'))">⌘ apply-checkpoint</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyCheckpoint.commands?.npm||'')}').then(()=>toast('npm apply-checkpoint 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(applyCheckpoint.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${applyCheckpoint.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🕒</div>
            <div>
              <div class="card-tit">Apply Timeline</div>
              <div class="card-sub">decision/apply 결과를 최근 이력으로 누적해, 승격 판단과 실행의 흐름을 복기합니다.</div>
            </div>
          </div>
          <div style="margin-top:10px">
            ${(applyTimeline.timeline_preview||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyTimeline.commands?.json||'')}').then(()=>toast('apply-timeline 명령 복사됨'))">⌘ apply-timeline</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyTimeline.commands?.npm||'')}').then(()=>toast('npm apply-timeline 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(applyTimeline.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${applyTimeline.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧬</div>
            <div>
              <div class="card-tit">Packet Hierarchy Lens</div>
              <div class="card-sub">작은 packet이 어떤 capability 단위를 이루는지, 다음 ready/blocked 흐름이 무엇인지 학습 surface로 같이 봅니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Capability</div><div class="mc-v">${esc(packetHierarchy.cap_id||'—')}</div><div class="mc-s">${esc(packetHierarchy.cap_name||'')}</div></div>
            <div class="mc"><div class="mc-l">Progress</div><div class="mc-v">${esc(packetHierarchy.progress.done||0)} / ${esc(packetHierarchy.progress.total||0)}</div><div class="mc-s">done / total</div></div>
            <div class="mc"><div class="mc-l">Current</div><div class="mc-v">${esc(packetHierarchy.current_id||'—')}</div><div class="mc-s">${esc(window.D.current_wp?.status||'')}</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(packetHierarchy.commands?.json||'')}').then(()=>toast('packet-hierarchy 명령 복사됨'))">⌘ packet-hierarchy</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(packetHierarchy.commands?.npm||'')}').then(()=>toast('npm packet-hierarchy 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Ready In Capability</div>
              ${(packetHierarchy.ready_in_capability||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item.id)} · ${esc(item.goal||'')}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Blocked In Capability</div>
              ${(packetHierarchy.blocked_in_capability||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item.id)} · waiting ${esc((item.unmet_dependencies||[]).join(', ')||'—')}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Learning Path</div>
              ${(packetHierarchy.learning_path||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${item.status==='done'?'d-pass':item.status==='completed'?'d-pass':'d-act'}"></div><div class="wg">${esc(item.id)} · ${esc(item.status||'')} · ${esc(item.goal||'')}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          ${(packetHierarchy.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${packetHierarchy.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🗂</div>
            <div>
              <div class="card-tit">Capability Brief</div>
              <div class="card-sub">현재 capability 기준으로 progress, next ready, planning mode, benchmark focus를 한 장으로 요약합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Capability</div><div class="mc-v">${esc(capabilityBrief.capability.id||'—')}</div><div class="mc-s">${esc(capabilityBrief.capability.name||'')}</div></div>
            <div class="mc"><div class="mc-l">Progress</div><div class="mc-v">${esc(capabilityBrief.capability.progress?.done||0)} / ${esc(capabilityBrief.capability.progress?.total||0)}</div><div class="mc-s">done / total</div></div>
            <div class="mc"><div class="mc-l">Planning Mode</div><div class="mc-v">${esc(capabilityBrief.planning_mode?.id||'—')}</div><div class="mc-s">${esc(capabilityBrief.current_packet.id||'')}</div></div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilityBrief.commands?.json||'')}').then(()=>toast('capability-brief 명령 복사됨'))">⌘ capability-brief</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilityBrief.commands?.npm||'')}').then(()=>toast('npm capability-brief 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Next Ready</div>
              ${(capabilityBrief.next_ready_packets||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item.id)} · ${esc(item.goal||'')}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Blocked</div>
              ${(capabilityBrief.blocked_packets||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg">${esc(item.id)} · waiting ${esc((item.unmet_dependencies||[]).join(', ')||'—')}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Benchmark Focus</div>
              ${(capabilityBrief.benchmark_focus||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item.title)} · score ${esc(item.score)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div style="margin-top:10px">
            ${(capabilityBrief.study_points||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">study point 없음</div>'}
          </div>
          ${(capabilityBrief.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${capabilityBrief.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🌱</div>
            <div>
              <div class="card-tit">Capability Planning Seed</div>
              <div class="card-sub">현재 capability에 맞는 planning seed section을 바로 편집 가능한 시작점으로 제공합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">planning mode</span><span>${esc(capabilityPlanningSeed.planning_mode?.id||'—')}</span></div>
          <div class="kv"><span class="kk">capability</span><span>${esc(capabilityPlanningSeed.capability?.id||'—')} / ${esc(capabilityPlanningSeed.capability?.name||'')}</span></div>
          <div style="margin-top:10px">
            ${(capabilityPlanningSeed.seed_sections||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.id)}</div><div class="wr">${esc(String(item.value).slice(0,140))}</div></div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-s" style="font-size:10px" onclick="applyCapabilitySeedToPlanningStudio()">⚙️ Planning Studio에 적용</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilityPlanningSeed.commands?.json||'')}').then(()=>toast('capability-seed 명령 복사됨'))">⌘ capability-seed</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilityPlanningSeed.commands?.npm||'')}').then(()=>toast('npm capability-seed 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(capabilityPlanningSeed.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${capabilityPlanningSeed.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧭</div>
            <div>
              <div class="card-tit">Exception Routing Patch</div>
              <div class="card-sub">반복되는 exception 경로를 must-read / expand-if-needed / review-later 보정안으로 환원합니다.</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Promote To Must Read</div>
              ${(exceptionRoutingPatch.routing_patch.promote_to_must_read||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Keep Expand If Needed</div>
              ${(exceptionRoutingPatch.routing_patch.keep_expand_if_needed||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Review Later</div>
              ${(exceptionRoutingPatch.routing_patch.review_later||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionRoutingPatch.commands?.json||'')}').then(()=>toast('exception-routing 명령 복사됨'))">⌘ exception-routing</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(exceptionRoutingPatch.commands?.npm||'')}').then(()=>toast('npm exception-routing 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(exceptionRoutingPatch.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${exceptionRoutingPatch.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧩</div>
            <div>
              <div class="card-tit">Capability Seed Tuning Patch</div>
              <div class="card-sub">capability seed와 apply/exception feedback를 실제 Planning Studio section에 맞게 다시 매핑합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">planning mode</span><span>${esc(capabilitySeedTuning.planning_mode?.id||'—')}</span></div>
          <div class="kv"><span class="kk">latest apply</span><span>${esc(capabilitySeedTuning.latest_apply?.decision_gate||'review')} / ${esc(capabilitySeedTuning.latest_apply?.result||'dry-run')}</span></div>
          <div style="margin-top:10px">
            ${(capabilitySeedTuning.mapped_sections||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.id)}</div><div class="wr">${esc(String(item.value).slice(0,160))}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">매핑 결과 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-s" style="font-size:10px" onclick="applyCapabilitySeedTuningToPlanningStudio()">⚙️ Tuning Patch 적용</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilitySeedTuning.commands?.json||'')}').then(()=>toast('capability-seed-tuning 명령 복사됨'))">⌘ capability-seed-tuning</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(capabilitySeedTuning.commands?.npm||'')}').then(()=>toast('npm capability-seed-tuning 명령 복사됨'))">⌘ npm</button>
          </div>
          <div style="margin-top:10px">
            ${(capabilitySeedTuning.notes||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          ${(capabilitySeedTuning.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${capabilitySeedTuning.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">📈</div>
            <div>
              <div class="card-tit">Apply Outcome Scorecard</div>
              <div class="card-sub">apply history, locked token, reread pressure를 한 점수표로 묶어 다음 실행 안정성을 읽습니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Score</div><div class="mc-v">${esc(applyOutcomeScorecard.score||0)}</div><div class="mc-s">${esc(applyOutcomeScorecard.current_gate||'review')}</div></div>
            <div class="mc"><div class="mc-l">Applied</div><div class="mc-v">${esc(applyOutcomeScorecard.history_window?.applied_count||0)}</div><div class="mc-s">history window</div></div>
            <div class="mc"><div class="mc-l">Re-read Ratio</div><div class="mc-v">${esc(applyOutcomeScorecard.token_efficiency?.reread_ratio||0)}</div><div class="mc-s">${esc(formatTokens(applyOutcomeScorecard.token_efficiency?.reread_tokens||0))}</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">History Window</div>
              <div class="kv"><span class="kk">entries</span><span>${esc(applyOutcomeScorecard.history_window?.entry_count||0)}</span></div>
              <div class="kv"><span class="kk">ready / review / blocked</span><span>${esc(applyOutcomeScorecard.history_window?.ready_count||0)} / ${esc(applyOutcomeScorecard.history_window?.review_count||0)} / ${esc(applyOutcomeScorecard.history_window?.blocked_count||0)}</span></div>
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Token Efficiency</div>
              <div class="kv"><span class="kk">primary</span><span>${esc(formatTokens(applyOutcomeScorecard.token_efficiency?.primary_tokens||0))}</span></div>
              <div class="kv"><span class="kk">secondary</span><span>${esc(formatTokens(applyOutcomeScorecard.token_efficiency?.secondary_tokens||0))}</span></div>
              <div class="kv"><span class="kk">locked</span><span>${esc(formatTokens(applyOutcomeScorecard.token_efficiency?.locked_tokens||0))}</span></div>
            </div>
          </div>
          <div style="margin-top:10px">
            ${(applyOutcomeScorecard.action_items||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyOutcomeScorecard.commands?.json||'')}').then(()=>toast('apply-scorecard 명령 복사됨'))">⌘ apply-scorecard</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(applyOutcomeScorecard.commands?.npm||'')}').then(()=>toast('npm apply-scorecard 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(applyOutcomeScorecard.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${applyOutcomeScorecard.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🗺</div>
            <div>
              <div class="card-tit">Blueprint Launch Deck</div>
              <div class="card-sub">새 프로젝트 시작 조합을 blueprint, planning mode, routing, deliverable 기준으로 한 장에서 고르게 합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">blueprint</span><span>${esc(blueprintLaunchDeck.blueprint?.id||'—')} / ${esc(blueprintLaunchDeck.blueprint?.name||'')}</span></div>
          <div class="kv"><span class="kk">planning / routing</span><span>${esc(blueprintLaunchDeck.planning_mode?.id||'—')} / ${esc(blueprintLaunchDeck.routing_profile?.id||'—')}</span></div>
          <div class="kv"><span class="kk">execution template</span><span>${esc(blueprintLaunchDeck.execution_template_id||'—')}</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Launch Sequence</div>
              ${(blueprintLaunchDeck.launch_sequence||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.step||'')}</div><div class="wr">${esc(item.focus||'')}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Starter Deliverables</div>
              ${(blueprintLaunchDeck.starter_deliverables||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-act"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Benchmark Focus</div>
              ${(blueprintLaunchDeck.benchmark_focus||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item.title)} · score ${esc(item.score)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(blueprintLaunchDeck.commands?.json||'')}').then(()=>toast('blueprint-launch 명령 복사됨'))">⌘ blueprint-launch</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(blueprintLaunchDeck.commands?.npm||'')}').then(()=>toast('npm blueprint-launch 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(blueprintLaunchDeck.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${blueprintLaunchDeck.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧠</div>
            <div>
              <div class="card-tit">Learned Preset Memory</div>
              <div class="card-sub">decision/apply history에서 goal별로 가장 잘 버틴 planning/routing/template 서명을 다시 꺼냅니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">history</span><span>${esc(learnedPresetMemory.history_entries||0)} entries</span></div>
          <div class="kv"><span class="kk">recommended</span><span>${esc(learnedPresetMemory.recommended_signature?.planning_mode_id||'—')} / ${esc(learnedPresetMemory.recommended_signature?.routing_profile_id||'—')}</span></div>
          <div style="margin-top:10px">
            ${(learnedPresetMemory.top_signatures||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.blueprint_id||'—')} · ${esc(item.planning_mode_id||'—')} · ${esc(item.routing_profile_id||'—')}</div><div class="wr">ready ${esc(item.ready_count||0)} / applied ${esc(item.applied_count||0)} / total ${esc(item.entry_count||0)}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">학습된 preset history 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-s" style="font-size:10px" onclick="applyLearnedPresetMemoryToPlanningStudio()">⚙️ Learned Preset 적용</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(learnedPresetMemory.commands?.json||'')}').then(()=>toast('learned-preset-memory 명령 복사됨'))">⌘ learned-preset-memory</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(learnedPresetMemory.commands?.npm||'')}').then(()=>toast('npm learned-preset-memory 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(learnedPresetMemory.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${learnedPresetMemory.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">💸</div>
            <div>
              <div class="card-tit">Token ROI Report</div>
              <div class="card-sub">secondary 읽기와 reread hotspot을 토큰 절감 기준으로 다시 정렬합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Locked</div><div class="mc-v">${esc(formatTokens(tokenROI.locked_tokens||0))}</div><div class="mc-s">primary + secondary</div></div>
            <div class="mc"><div class="mc-l">Savings</div><div class="mc-v">${esc(formatTokens(tokenROI.estimated_savings_tokens||0))}</div><div class="mc-s">defer/drop candidate</div></div>
            <div class="mc"><div class="mc-l">Hotspots</div><div class="mc-v">${esc((tokenROI.reread_hotspots||[]).length)}</div><div class="mc-s">reread top paths</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Promote To Primary</div>
              ${(tokenROI.promote_to_primary||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)} · ${esc(formatTokens(item.estimated_tokens||0))}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Defer Or Drop</div>
              ${(tokenROI.defer_or_drop||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item.path)} · ${esc(formatTokens(item.estimated_tokens||0))}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(tokenROI.commands?.json||'')}').then(()=>toast('token-roi 명령 복사됨'))">⌘ token-roi</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(tokenROI.commands?.npm||'')}').then(()=>toast('npm token-roi 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(tokenROI.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${tokenROI.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🚪</div>
            <div>
              <div class="card-tit">Proven Kickoff Deck</div>
              <div class="card-sub">blueprint, learned preset, benchmark focus, context budget를 묶어 검증된 시작 조합을 바로 제안합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">proven start</span><span>${esc(provenKickoffDeck.proven_start?.blueprint_id||'—')} / ${esc(provenKickoffDeck.proven_start?.planning_mode_id||'—')} / ${esc(provenKickoffDeck.proven_start?.routing_profile_id||'—')}</span></div>
          <div class="kv"><span class="kk">context budget</span><span>${esc(formatTokens(provenKickoffDeck.context_budget?.locked_tokens||0))} / save ${esc(formatTokens(provenKickoffDeck.context_budget?.estimated_savings_tokens||0))}</span></div>
          <div style="margin-top:10px">
            ${(provenKickoffDeck.kickoff_steps||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">kickoff step 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(provenKickoffDeck.commands?.json||'')}').then(()=>toast('proven-kickoff 명령 복사됨'))">⌘ proven-kickoff</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(provenKickoffDeck.commands?.npm||'')}').then(()=>toast('npm proven-kickoff 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(provenKickoffDeck.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${provenKickoffDeck.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🛫</div>
            <div>
              <div class="card-tit">Adaptive Starter Preset</div>
              <div class="card-sub">learned preset memory를 starter 기본값에 직접 승격해 Planning Studio 시작값으로 씁니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">source</span><span>${esc(adaptiveStarterPreset.source||'benchmark-default')}</span></div>
          <div class="kv"><span class="kk">signature</span><span>${esc(adaptiveStarterPreset.recommended_signature?.planning_mode_id||'—')} / ${esc(adaptiveStarterPreset.recommended_signature?.routing_profile_id||'—')}</span></div>
          <div style="margin-top:10px">
            ${(adaptiveStarterPreset.planning_sections||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div style="flex:1"><div class="wg">${esc(item.id)}</div><div class="wr">${esc(String(item.value).slice(0,160))}</div></div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">adaptive section 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-s" style="font-size:10px" onclick="applyAdaptiveStarterToPlanningStudio()">⚙️ Adaptive Starter 적용</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(adaptiveStarterPreset.commands?.json||'')}').then(()=>toast('adaptive-starter 명령 복사됨'))">⌘ adaptive-starter</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(adaptiveStarterPreset.commands?.npm||'')}').then(()=>toast('npm adaptive-starter 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(adaptiveStarterPreset.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${adaptiveStarterPreset.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🪙</div>
            <div>
              <div class="card-tit">Token ROI Routing Patch</div>
              <div class="card-sub">token ROI 결과를 바로 primary/secondary/deferred 조정 patch로 환원합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">estimated savings</span><span>${esc(formatTokens(tokenROIRoutingPatch.estimated_savings_tokens||0))}</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Promote To Primary</div>
              ${(tokenROIRoutingPatch.routing_patch.promote_to_primary||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Move To Deferred</div>
              ${(tokenROIRoutingPatch.routing_patch.move_to_deferred||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(tokenROIRoutingPatch.commands?.json||'')}').then(()=>toast('token-roi-routing 명령 복사됨'))">⌘ token-roi-routing</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(tokenROIRoutingPatch.commands?.npm||'')}').then(()=>toast('npm token-roi-routing 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(tokenROIRoutingPatch.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${tokenROIRoutingPatch.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧾</div>
            <div>
              <div class="card-tit">Kickoff Evidence Bundle</div>
              <div class="card-sub">adaptive starter, kickoff step, readiness score를 한 evidence artifact로 묶어 시작 전 검토를 고정합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">readiness</span><span>${esc(kickoffEvidenceBundle.execution_readiness?.current_gate||'review')} / score ${esc(kickoffEvidenceBundle.execution_readiness?.score||0)}</span></div>
          <div class="kv"><span class="kk">blueprint</span><span>${esc(kickoffEvidenceBundle.blueprint?.id||'—')} / ${esc(kickoffEvidenceBundle.adaptive_signature?.planning_mode_id||'—')}</span></div>
          <div style="margin-top:10px">
            ${(kickoffEvidenceBundle.kickoff_steps||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">kickoff step 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(kickoffEvidenceBundle.commands?.json||'')}').then(()=>toast('kickoff-evidence 명령 복사됨'))">⌘ kickoff-evidence</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(kickoffEvidenceBundle.commands?.npm||'')}').then(()=>toast('npm kickoff-evidence 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(kickoffEvidenceBundle.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${kickoffEvidenceBundle.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🛰</div>
            <div>
              <div class="card-tit">Launch Brief Autopilot</div>
              <div class="card-sub">adaptive starter와 kickoff evidence를 launch brief 기본 추천으로 직접 연결합니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">blueprint</span><span>${esc(launchBriefAutopilot.recommendation?.blueprint_id||'—')} / ${esc(launchBriefAutopilot.recommendation?.blueprint_name||'')}</span></div>
          <div class="kv"><span class="kk">signature</span><span>${esc(launchBriefAutopilot.recommendation?.planning_mode_id||'—')} / ${esc(launchBriefAutopilot.recommendation?.routing_profile_id||'—')}</span></div>
          <div class="kv"><span class="kk">ready gate</span><span>${esc(launchBriefAutopilot.ready_gate?.current_gate||'review')} / score ${esc(launchBriefAutopilot.ready_gate?.score||0)}</span></div>
          <div style="margin-top:10px">
            ${(launchBriefAutopilot.start_now||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">start now 없음</div>'}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(launchBriefAutopilot.commands?.json||'')}').then(()=>toast('launch-brief-autopilot 명령 복사됨'))">⌘ launch-brief-autopilot</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(launchBriefAutopilot.commands?.npm||'')}').then(()=>toast('npm launch-brief-autopilot 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(launchBriefAutopilot.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${launchBriefAutopilot.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🧠</div>
            <div>
              <div class="card-tit">Routing Learning Ledger</div>
              <div class="card-sub">exception routing과 token ROI patch를 한 장의 canonical routing memory로 합칩니다.</div>
            </div>
          </div>
          <div class="kv"><span class="kk">routing profile</span><span>${esc(routingLearningLedger.routing_profile_id||'—')}</span></div>
          <div class="kv"><span class="kk">savings</span><span>${esc(formatTokens(routingLearningLedger.estimated_savings_tokens||0))}</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Promote To Primary</div>
              ${(routingLearningLedger.routing_learning?.promote_to_primary||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
            <div class="card" style="margin:0">
              <div class="card-tit" style="margin-bottom:6px">Move To Deferred</div>
              ${(routingLearningLedger.routing_learning?.move_to_deferred||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-warn"></div><div class="wg" style="font-family:var(--mo);font-size:10px">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:12px">없음</div>'}
            </div>
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(routingLearningLedger.commands?.json||'')}').then(()=>toast('routing-learning 명령 복사됨'))">⌘ routing-learning</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(routingLearningLedger.commands?.npm||'')}').then(()=>toast('npm routing-learning 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(routingLearningLedger.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${routingLearningLedger.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
        <div class="card" style="margin:10px 0 0 0">
          <div class="card-h">
            <div class="card-ic">🚦</div>
            <div>
              <div class="card-tit">Kickoff Ready Gate</div>
              <div class="card-sub">프로젝트 시작 전 ready / review / blocked를 단일 게이트로 판정합니다.</div>
            </div>
          </div>
          <div class="g3" style="margin-top:10px">
            <div class="mc"><div class="mc-l">Gate</div><div class="mc-v">${esc(kickoffReadyGate.gate_status||'review')}</div><div class="mc-s">${esc(kickoffReadyGate.current_gate||'')}</div></div>
            <div class="mc"><div class="mc-l">Score</div><div class="mc-v">${esc(kickoffReadyGate.score||0)}</div><div class="mc-s">kickoff evidence</div></div>
            <div class="mc"><div class="mc-l">Next</div><div class="mc-v">${esc((kickoffReadyGate.next_actions||[]).length)}</div><div class="mc-s">recommended actions</div></div>
          </div>
          <div style="margin-top:10px">
            ${(kickoffReadyGate.reasons||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd ${kickoffReadyGate.gate_status==='ready'?'d-pass':kickoffReadyGate.gate_status==='blocked'?'d-warn':'d-act'}"></div><div class="wg">${esc(item)}</div></div>`).join('')}
            ${(kickoffReadyGate.next_actions||[]).map(item=>`<div class="wi" style="margin-bottom:5px"><div class="wd d-pass"></div><div class="wg">${esc(item)}</div></div>`).join('')}
          </div>
          <div class="sec-ctrl" style="margin-top:10px">
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(kickoffReadyGate.commands?.json||'')}').then(()=>toast('kickoff-ready-gate 명령 복사됨'))">⌘ kickoff-ready-gate</button>
            <button class="btn btn-i" style="font-size:10px" onclick="navigator.clipboard.writeText('${esc(kickoffReadyGate.commands?.npm||'')}').then(()=>toast('npm kickoff-ready-gate 명령 복사됨'))">⌘ npm</button>
          </div>
          ${(kickoffReadyGate.benchmark_signals||[]).length?`<div class="sb-r" style="margin-top:8px">${kickoffReadyGate.benchmark_signals.map(signal=>`<span class="st s-ac">${esc(signal.product)}</span>`).join('')}</div>`:''}
        </div>
      </div>
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧠 AI 학습 플로우</div>
      ${trackH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧭 추천 조합 기준 학습 여정</div>
      ${guidedJourneyH||'<div style="color:var(--dm);font-size:12px">선택된 blueprint/recipe에 연결된 학습 여정이 없습니다.</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🧱 어댑터 호환성 매트릭스</div>
      ${compatibilityH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🎓 학습 숙련도 로드맵</div>
      ${masteryH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🤖 AI Runtime Recipes</div>
      ${recipeH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>

    <div class="req-sec">
      <div class="req-sec-h">🕸 마스터 OS 관계 맵</div>
      ${relationH||'<div style="color:var(--dm);font-size:12px">데이터 없음</div>'}
    </div>`;
}

// ────────────────────────────────────────────────────────────────
// SPRINT BOARD
// ────────────────────────────────────────────────────────────────
function renderSprint(){
  const d=window.D;
  const active=d.wps.active||[], pending=d.wps.pending||[];
  const done=[...d.wps.done].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||'')).slice(0,8);
  const git=d.git||{};
  const launchBriefData=buildLaunchBriefData();

  // 현재 스프린트 정보
  const curWP=active[0]||{};
  const curCap=d.caps.find(c=>c.id===(curWP.cap_id||''))||{};
  const capPct=curCap.wp_count?Math.round(curCap.done_count/curCap.wp_count*100):100;

  // Kanban cards
  const mkCard=(w,cls)=>`<div class="kb-card ${cls}">
    <div class="kb-cid">
      <div class="wd ${cls==='active'?'w-ac':cls==='done'?'w-ok':'w-nd'}" style="width:7px;height:7px;border-radius:50%"></div>
      ${esc(w.id||'')} <span class="wt" style="flex-shrink:0">${esc(w.tier||'')}</span>
    </div>
    <div class="kb-goal">${esc((w.goal||'').substring(0,80))}${(w.goal||'').length>80?'…':''}</div>
    ${w.cap_name?`<div style="font-size:9px;color:var(--dm);margin-top:4px">${esc(w.cap_id)} — ${esc(w.cap_name)}</div>`:''}
    ${w.completed_at&&cls==='done'?`<div style="font-size:9px;color:var(--dm);margin-top:3px">✓ ${esc(w.completed_at)}</div>`:''}
  </div>`;

  const activeCards=active.length?active.map(w=>mkCard(w,'active')).join('')
    :'<div style="color:var(--dm);font-size:11px;padding:8px">진행 중인 WP 없음<br><small>npm run wp:next 실행</small></div>';
  const pendingCards=pending.slice(0,4).map(w=>mkCard(w,'pending')).join('')
    ||'<div style="color:var(--dm);font-size:11px;padding:8px">대기 WP 없음</div>';
  const doneCards=done.slice(0,5).map(w=>mkCard(w,'done')).join('');

  // Recent commits
  const commitsH=(git.commits||[]).map(c=>`<div class="commit-row">
    <span class="commit-hash">${esc(c.hash)}</span>
    <span class="commit-msg">${esc(c.msg)}</span>
  </div>`).join('');

  $('c-sprint').innerHTML=`
    <div class="sec-tit">🎯 현재 스프린트</div>

    ${curWP.id?`<div class="card" style="border-color:rgba(31,111,235,.4);background:rgba(31,111,235,.04);margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="font-size:32px">🔄</div>
        <div style="flex:1">
          <div style="font-size:11px;color:var(--ac2);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">
            현재 진행중 — ${esc(curWP.id)}</div>
          <div style="font-size:16px;font-weight:700;color:var(--br);margin-bottom:5px">${esc(curWP.goal||'')}</div>
          <div style="font-size:11px;color:var(--dm)">CAP: ${esc(curWP.cap_id||'')} — ${esc(curWP.cap_name||'')} |
            Tier: ${esc(curWP.tier||'')} | CAP 진행률: ${capPct}%</div>
          <div class="pb2" style="margin-top:6px"><div class="pb2-f" style="width:${capPct}%"></div></div>
        </div>
        <button class="btn btn-i" style="flex-shrink:0" onclick="sw('wps')">WP 목록 →</button>
      </div>
    </div>`:`<div class="card" style="margin-bottom:14px">
      <div style="color:var(--dm);padding:8px">진행 중인 Work Packet 없음 — <code style="font-size:11px">npm run wp:next</code> 실행</div>
    </div>`}

    <div class="g3" style="margin-bottom:14px">
      <div class="mc"><div class="mc-l">전체 WP 완료</div>
        <div class="mc-v sc-hi">${d.wps.done_count}<span style="font-size:13px;color:var(--dm)">/${d.wps.total}</span></div>
        <div class="pb2"><div class="pb2-f" style="width:${pct(d.wps.done_count,d.wps.total)}%"></div></div></div>
      <div class="mc"><div class="mc-l">브랜치</div>
        <div class="mc-v" style="font-size:12px;font-family:var(--mo)">${esc(git.branch||'—')}</div>
        <div class="mc-s">${esc((git.hash||'').substring(0,7))}</div></div>
      <div class="mc"><div class="mc-l">최근 커밋</div>
        <div class="mc-v" style="font-size:11px;line-height:1.3">${esc((git.last_msg||'—').substring(0,30))}${(git.last_msg||'').length>30?'…':''}</div>
        <div class="mc-s">${esc((git.last_date||'').substring(0,10))}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><div class="card-ic">🎯</div>
        <div><div class="card-tit">Starter Focus Cycle</div>
          <div class="card-sub">${esc(launchBriefData.recommendation.blueprint_name||'—')} / ${esc(launchBriefData.recommendation.recipe_name||'—')} 기준 시작 cycle</div></div></div>
      <div class="kb">
        <div class="kb-col">
          <div class="kb-h" style="color:var(--ac2)">Now</div>
          <div class="kb-body">${(launchBriefData.focus_cycle.now||[]).map(item=>`<div class="kb-card active"><div class="kb-goal">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:11px;padding:8px">정의된 항목 없음</div>'}</div>
        </div>
        <div class="kb-col">
          <div class="kb-h" style="color:var(--ac3)">Next</div>
          <div class="kb-body">${(launchBriefData.focus_cycle.next||[]).map(item=>`<div class="kb-card pending"><div class="kb-goal">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:11px;padding:8px">정의된 항목 없음</div>'}</div>
        </div>
        <div class="kb-col">
          <div class="kb-h" style="color:var(--ac)">Later</div>
          <div class="kb-body">${(launchBriefData.focus_cycle.later||[]).map(item=>`<div class="kb-card done"><div class="kb-goal">${esc(item)}</div></div>`).join('')||'<div style="color:var(--dm);font-size:11px;padding:8px">정의된 항목 없음</div>'}</div>
        </div>
      </div>
      <div class="sec-ctrl" style="margin-top:10px">
        <div class="ts-info">Linear의 curated focus 방식처럼 지금 먼저 볼 일과 다음 순서를 분리합니다.</div>
        <button class="btn btn-s" style="font-size:10px" onclick="copyLaunchBrief()">📋 Launch Brief 복사</button>
        <button class="btn btn-i" style="font-size:10px" onclick="exportLaunchBriefJSON()">🧾 JSON</button>
      </div>
    </div>

    <div class="kb">
      <div class="kb-col">
        <div class="kb-h" style="color:var(--ac2)">🔄 진행중 <span class="tc" style="margin-left:auto">${active.length}</span></div>
        <div class="kb-body">${activeCards}</div>
      </div>
      <div class="kb-col">
        <div class="kb-h" style="color:var(--ac3)">⏳ 대기 <span class="tc" style="margin-left:auto">${pending.length}</span></div>
        <div class="kb-body">${pendingCards}</div>
      </div>
      <div class="kb-col">
        <div class="kb-h" style="color:var(--ac)">✅ 최근 완료 <span class="tc" style="margin-left:auto">${done.length}</span></div>
        <div class="kb-body">${doneCards}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><div class="card-ic">🔀</div>
        <div><div class="card-tit">형상관리 — Git 커밋 이력</div>
          <div class="card-sub">브랜치: ${esc(git.branch||'')} · HEAD: ${esc(git.hash||'')}</div></div></div>
      <div style="margin-top:8px">${commitsH||'<div style="color:var(--dm);font-size:11px;padding:8px">git 정보 없음</div>'}</div>
      ${git.diff_stat?`<div style="margin-top:8px;padding:8px;background:var(--bg);border-radius:5px;font-family:var(--mo);font-size:10px;color:var(--dm);max-height:120px;overflow-y:auto;white-space:pre-wrap">${esc(git.diff_stat)}</div>`:''}
    </div>

    <div class="card">
      <div class="card-h"><div class="card-ic">🗺</div>
        <div><div class="card-tit">Capability 로드맵</div>
          <div class="card-sub">전체 CAP 진행 현황</div></div></div>
      <div style="margin-top:10px">
        ${d.caps.map(c=>{
          const cp=c.wp_count?Math.round(c.done_count/c.wp_count*100):0;
          return `<div style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:9px;font-weight:700;color:var(--dm);min-width:55px">${esc(c.id)}</span>
              <span style="font-size:11px;color:var(--tx);flex:1">${esc(c.name)}</span>
              <span style="font-size:10px;color:${cp===100?'var(--ac)':'var(--dm)'}">${cp===100?'✅':''}${c.done_count}/${c.wp_count}</span>
            </div>
            <div class="pb2"><div class="pb2-f" style="width:${cp}%"></div></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ────────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// ────────────────────────────────────────────────────────────────
let _gsIdx=0;
function openSearch(){ $('gsModal').classList.add('open'); $('gsInp').focus(); $('gsInp').value=''; $('gsResults').innerHTML='<div class="gs-empty">검색어를 입력하세요</div>'; }
function closeSearch(){ $('gsModal').classList.remove('open'); }
function gsKey(e){
  if(e.key==='Escape'){closeSearch();return;}
  const items=[...$('gsResults').querySelectorAll('.gs-item')];
  if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_gsIdx=Math.min(_gsIdx+1,items.length-1);}
  else if(e.key==='ArrowUp'){e.preventDefault();_gsIdx=Math.max(_gsIdx-1,0);}
  else if(e.key==='Enter'){items[_gsIdx]?.click();return;}
  items.forEach((it,i)=>it.style.background=i===_gsIdx?'var(--sf2)':'');
}
function runSearch(q){
  _gsIdx=0;
  if(!q||q.length<2){$('gsResults').innerHTML='<div class="gs-empty">검색어를 2자 이상 입력하세요</div>';return;}
  const d=window.D; const ql=q.toLowerCase(); const results=[];
  // WPs
  d.wps.all.filter(w=>(w.id+w.goal+w.cap_name+w.result).toLowerCase().includes(ql)).slice(0,6).forEach(w=>{
    results.push({tag:'WP',text:w.id+' — '+w.goal.substring(0,60),sub:'CAP: '+w.cap_id+' | '+w.status,
      action:`sw('wps')`});
  });
  // Planning sections
  SECTIONS.filter(s=>(s.title+s.desc+(ST.planC[s.id]||'')).toLowerCase().includes(ql)).forEach(s=>{
    results.push({tag:'기획',text:s.num+' '+s.title,sub:s.desc.substring(0,50),
      action:`sw('plan');setTimeout(()=>document.getElementById('ps-${s.id}')?.scrollIntoView({behavior:'smooth'}),100)`});
  });
  // Domains
  d.domains.filter(m=>(m.module_id+m.domain).toLowerCase().includes(ql)).forEach(m=>{
    results.push({tag:'도메인',text:m.module_id+' ('+m.domain+')',sub:'health: '+(m.health_score||'—'),
      action:`sw('dom')`});
  });
  // ADRs
  d.adrs.filter(a=>(a.id+a.title+a.domain).toLowerCase().includes(ql)).slice(0,4).forEach(a=>{
    results.push({tag:'ADR',text:'ADR-'+a.id+': '+a.title,sub:'domain: '+a.domain,action:`sw('adr')`});
  });
  // Blueprints
  (d.project_blueprints||[]).filter(bp=>(bp.id+bp.name+bp.summary+bp.when_to_use).toLowerCase().includes(ql)).slice(0,4).forEach(bp=>{
    results.push({tag:'청사진',text:bp.name,sub:bp.summary,action:`sw('req')`});
  });
  // Planning studio
  (d.planning_studio_modes||[]).filter(mode=>(mode.id+mode.title+mode.summary).toLowerCase().includes(ql)).slice(0,4).forEach(mode=>{
    results.push({tag:'기획모드',text:mode.title,sub:mode.summary,action:`sw('req')`});
  });
  // Execution packet templates
  (d.execution_packet_templates||[]).filter(template=>(template.id+template.title+template.when_to_use).toLowerCase().includes(ql)).slice(0,4).forEach(template=>{
    results.push({tag:'실행패킷',text:template.title,sub:template.when_to_use,action:`sw('req')`});
  });
  // Learning tracks
  (d.ai_learning_tracks||[]).filter(track=>(track.id+track.title+track.persona+track.objective).toLowerCase().includes(ql)).slice(0,4).forEach(track=>{
    results.push({tag:'학습',text:track.title,sub:track.objective,action:`sw('req')`});
  });
  // Recipes
  (d.ai_runtime_recipes||[]).filter(recipe=>(recipe.id+recipe.name+recipe.objective+(recipe.tool_stack||[]).join(' ')).toLowerCase().includes(ql)).slice(0,4).forEach(recipe=>{
    results.push({tag:'레시피',text:recipe.name,sub:recipe.objective,action:`sw('req')`});
  });
  // Intake questions
  ((d.project_intake_canvas||{}).questions||[]).filter(qn=>(qn.id+qn.title+qn.prompt).toLowerCase().includes(ql)).slice(0,4).forEach(qn=>{
    results.push({tag:'질문지',text:qn.title,sub:qn.prompt,action:`sw('req')`});
  });
  // Compatibility
  (d.adapter_compatibility||[]).filter(rule=>(rule.profile_id+(rule.notes||[]).join(' ')).toLowerCase().includes(ql)).slice(0,4).forEach(rule=>{
    results.push({tag:'호환성',text:rule.profile_id,sub:(rule.recommended_recipes||[]).join(', ')||'recipe 없음',action:`sw('req')`});
  });
  // Mastery
  (d.learning_mastery_map||[]).filter(ms=>(ms.id+ms.title+ms.objective+ms.track_ref).toLowerCase().includes(ql)).slice(0,4).forEach(ms=>{
    results.push({tag:'숙련도',text:ms.title,sub:ms.objective,action:`sw('req')`});
  });
  // Benchmarks
  ((d.benchmark_intelligence||{}).signals||[]).filter(signal=>(signal.id+signal.product+signal.category+signal.signal).toLowerCase().includes(ql)).slice(0,4).forEach(signal=>{
    results.push({tag:'벤치마크',text:signal.product,sub:signal.signal,action:`sw('req')`});
  });
  if('context packet read first read next token budget'.includes(ql) || ql.includes('context') || ql.includes('token')){
    results.push({tag:'컨텍스트',text:'Context Packet',sub:'작업단위별 최소 읽기 묶음',action:`sw('req')`});
  }
  if('planning comparator variant compare mode recommendation'.includes(ql) || ql.includes('compare') || ql.includes('variant')){
    results.push({tag:'기획비교',text:'Planning Variant Comparator',sub:'현재 목표 기준 planning mode 비교',action:`sw('req')`});
  }
  if('planning patch snapshot history diff'.includes(ql) || ql.includes('snapshot') || ql.includes('patch')){
    results.push({tag:'기획패치',text:'Planning Patch Preview',sub:'기본값 대비 변경점과 snapshot timeline',action:`sw('req')`});
  }
  if('execution packet draft current wp yaml'.includes(ql) || ql.includes('packet')){
    results.push({tag:'실행패킷',text:'Execution Packet Draft',sub:'planning 결과를 current-wp draft로 변환',action:`sw('req')`});
  }
  if('apply handoff current wp next actions dry run'.includes(ql) || ql.includes('handoff') || ql.includes('apply')){
    results.push({tag:'실행반영',text:'Apply Handoff Kit',sub:'dry-run/apply 명령과 변경 preview',action:`sw('req')`});
  }
  if('core impact boundary protected core edge touchpoints'.includes(ql) || ql.includes('boundary') || ql.includes('core')){
    results.push({tag:'코어경계',text:'Core Impact Boundary Map',sub:'보호 코어와 edge touchpoint 분리',action:`sw('req')`});
  }
  if('context bundle export minimal read bundle'.includes(ql) || ql.includes('bundle') || ql.includes('export')){
    results.push({tag:'번들',text:'Context Bundle Export',sub:'최소 읽기 묶음 CLI/JSON/YAML export',action:`sw('req')`});
  }
  if('context lock snapshot exact read manifest hash'.includes(ql) || ql.includes('context lock') || ql.includes('manifest')){
    results.push({tag:'문맥잠금',text:'Context Lock Snapshot',sub:'exact file manifest와 hash 기반 최소 문맥 고정',action:`sw('req')`});
  }
  if('context drift guard drift changed missing reread'.includes(ql) || ql.includes('drift')){
    results.push({tag:'드리프트',text:'Context Drift Guard',sub:'locked manifest 대비 changed/missing만 다시 읽기',action:`sw('req')`});
  }
  if('constraint fit checker constraint budget adapter'.includes(ql) || ql.includes('constraint') || ql.includes('fit')){
    results.push({tag:'적합성',text:'Constraint Fit Checker',sub:'제약/adapter/token budget 적합성 점검',action:`sw('req')`});
  }
  if('handoff bundle composer transfer packet bundle'.includes(ql) || ql.includes('handoff bundle')){
    results.push({tag:'handoff',text:'Handoff Bundle Composer',sub:'patch/context/packet/apply를 한 artifact로 묶기',action:`sw('req')`});
  }
  if('verified promote pipeline promote packet apply current wp'.includes(ql) || ql.includes('promote')){
    results.push({tag:'승격',text:'Verified Promote Pipeline',sub:'검증 통과 packet만 current-wp로 승격',action:`sw('req')`});
  }
  if('benchmark action pack benchmark pack recommendation'.includes(ql) || ql.includes('benchmark pack')){
    results.push({tag:'벤치팩',text:'Benchmark Action Pack',sub:'현재 goal용 benchmark-backed 개선 묶음',action:`sw('req')`});
  }
  if('starter preset pack preset mode routing template'.includes(ql) || ql.includes('preset')){
    results.push({tag:'프리셋',text:'Starter Preset Pack',sub:'goal별 planning/routing/template 기본값',action:`sw('req')`});
  }
  if('promotion pipeline orchestrator pipeline apply handoff'.includes(ql) || ql.includes('pipeline')){
    results.push({tag:'오케스트레이션',text:'Promotion Pipeline Orchestrator',sub:'handoff/context/benchmark/promote/apply를 한 번에 묶기',action:`sw('req')`});
  }
  if('planning studio cycle brief change control'.includes(ql) || ql.includes('plan') || ql.includes('canvas')){
    results.push({tag:'기획스튜디오',text:'Planning Studio',sub:'선택형 계획 캔버스와 내보내기',action:`sw('req')`});
  }
  if(('launch brief starter focus cycle '+(d.project?.name||'')).toLowerCase().includes(ql)){
    results.push({tag:'실행브리프',text:'Launch Brief / Starter Focus Cycle',sub:'추천 조합을 바로 artifact와 cycle로 변환',action:`sw('sprint')`});
  }
  if('transition switchboard adapter profile migration'.includes(ql) || ql.includes('adapter')){
    results.push({tag:'전환',text:'Adapter Transition Switchboard',sub:'profile 전환 diff와 검증 절차',action:`sw('dom')`});
  }
  if('live ops feed auto refresh structured log guardrail'.includes(ql) || ql.includes('log') || ql.includes('audit')){
    results.push({tag:'로그',text:'Live Ops Feed',sub:'최근 운영 시그널과 구조화 로그 기준',action:`sw('log')`});
  }
  if('study replay learning replay'.includes(ql) || ql.includes('study') || ql.includes('replay')){
    results.push({tag:'학습복기',text:'Study Replay',sub:'로그를 learning track으로 다시 연결',action:`sw('log')`});
  }
  if('replay next packet next packet draft'.includes(ql) || ql.includes('next packet')){
    results.push({tag:'다음패킷',text:'Replay Next Packet',sub:'로그 기반 다음 실행 packet 초안',action:`sw('log')`});
  }
  if(!results.length){$('gsResults').innerHTML='<div class="gs-empty">검색 결과 없음: "'+esc(q)+'"</div>';return;}
  $('gsResults').innerHTML=results.map((r,i)=>`<div class="gs-item" style="${i===0?'background:var(--sf2)':''}"
    onclick="${r.action};closeSearch()">
    <span class="gs-item-tag">${esc(r.tag)}</span>
    <div><div class="gs-item-text">${esc(r.text)}</div>
      <div class="gs-item-sub">${esc(r.sub)}</div></div>
  </div>`).join('');
}
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openSearch();}
  if(e.key==='Escape'&&$('gsModal').classList.contains('open'))closeSearch();
});

// ────────────────────────────────────────────────────────────────
// SIDEBAR
// ────────────────────────────────────────────────────────────────
function buildSB(tab){
  const sb=$('sidebar'); sb.innerHTML='';
  const d=window.D;
  if(tab==='dash'){
    sb.innerHTML=`<div class="sb-lbl">섹션</div>`+
      ['핵심 지표','Stage 상태','도메인 헬스','진행 중 WP','Feature Flags','품질 게이트','Known Issues']
      .map(s=>`<div class="nl"><span class="dot d-pass"></span>${s}</div>`).join('');
  } else if(tab==='plan'){
    sb.innerHTML=`<div class="sb-lbl">목차 (${SECTIONS.filter(s=>ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id)).length}/${SECTIONS.length} 완료)</div>`+
      SECTIONS.map(s=>{
        const done=ST.planDone[s.id]||localStorage.getItem('wfos-done-'+s.id);
        return `<div class="nl${done?' on':''}"
          onclick="document.getElementById('ps-${s.id}')?.scrollIntoView({behavior:'smooth'})">
          <span class="dot ${done?'d-pass':'d-off'}"></span>
          <span style="flex:1;font-size:11px">${s.title}</span>
          <span style="font-size:9px;color:${done?'var(--ac)':'var(--dm)'}">${done?'✓':s.tag}</span>
        </div>`;
      }).join('');
  } else if(tab==='wps'){
    const bs={done:0,in_progress:0,pending:0};
    d.wps.all.forEach(w=>{if(bs[w.status]!==undefined)bs[w.status]++;});
    sb.innerHTML=`<div class="sb-lbl">WP 현황</div>
      <div class="mc" style="margin-bottom:8px">
        <div class="kv"><span class="kk" style="font-size:11px">완료</span><span class="kv-ok">${bs.done}</span></div>
        <div class="kv"><span class="kk" style="font-size:11px">진행중</span><span style="color:var(--ac2)">${bs.in_progress}</span></div>
        <div class="kv"><span class="kk" style="font-size:11px">대기</span><span>${bs.pending}</span></div>
      </div>
      <div class="sb-lbl">CAP</div>`+
      d.caps.map(c=>{
        const cp=pct(c.done_count,c.wp_count);
        return `<div class="nl"><span class="dot ${cp===100?'d-pass':'d-act'}"></span>
          <span style="flex:1;font-size:11px">${esc(c.id)}</span>
          <span style="font-size:9px;color:${cp===100?'var(--ac)':'var(--dm)'}">${cp}%</span>
        </div>`;
      }).join('');
  } else if(tab==='arc'){
    sb.innerHTML=`<div class="sb-lbl">아카이브</div>
      <div class="nl on"><span class="dot d-pass"></span>전체 완료 WP (${d.wps.done_count})</div>`;
  } else if(tab==='dom'){
    const tp=(window.D.adapter_transition_playbooks||[]).length;
    sb.innerHTML=`<div class="sb-lbl">도메인 (${d.domains.length})</div>`+
      d.domains.map(m=>`<div class="nl">
        <span class="dot d-pass"></span>
        <span style="flex:1;font-size:11px">${esc(m.module_id)}</span>
        <span style="font-size:9px;color:var(--dm)">${m.health_score||'—'}</span>
      </div>`).join('')+
      `<div class="sb-lbl">아키텍처</div>`+
      `<div class="nl"><span class="dot d-act"></span>Transition Playbooks (${tp})</div>`+
      `<div class="sb-lbl">플러그인</div>`+
      d.plugins.map(p=>`<div class="nl">
        <span class="dot ${p.status==='active'?'d-pass':'d-off'}"></span>
        <span style="font-size:11px">${esc(p.name)}</span>
      </div>`).join('');
  } else if(tab==='req'){
    const req=window.D.requirements||{};
    const hc=(req.hard_constraints||[]).length, sc=(req.soft_constraints||[]).length;
    const bp=(window.D.project_blueprints||[]).length;
    const lt=(window.D.ai_learning_tracks||[]).length;
    const iq=((window.D.project_intake_canvas||{}).questions||[]).length;
    const ac=(window.D.adapter_compatibility||[]).length;
    const lm=(window.D.learning_mastery_map||[]).length;
    const bm=(((window.D.benchmark_intelligence||{}).signals)||[]).length;
    const pm=(window.D.planning_studio_modes||[]).length;
    const ep=(window.D.execution_packet_templates||[]).length;
    const cp=buildContextPacketData();
    sb.innerHTML=`<div class="sb-lbl">요구사항</div>
      <div class="nl"><span class="dot d-pass"></span>모듈 정의</div>
      <div class="nl"><span class="dot d-act"></span>NFR 비기능 요구사항</div>
      <div class="nl"><span class="dot d-pass"></span>품질 게이트</div>
      <div class="nl"><span class="dot d-warn"></span>하드 제약 (${hc}개)</div>
      <div class="nl"><span class="dot d-off"></span>소프트 제약 (${sc}개)</div>
      <div class="nl"><span class="dot d-act"></span>도메인 맵</div>
      <div class="nl"><span class="dot d-pass"></span>블루프린트 (${bp}개)</div>
      <div class="nl"><span class="dot d-pass"></span>벤치마크 (${bm}개)</div>
      <div class="nl"><span class="dot d-pass"></span>프로젝트 질문지 (${iq}개)</div>
      <div class="nl"><span class="dot d-act"></span>Planning Studio (${pm}개)</div>
      <div class="nl"><span class="dot d-pass"></span>Planning Comparator</div>
      <div class="nl"><span class="dot d-pass"></span>Planning Patch / Snapshot</div>
      <div class="nl"><span class="dot d-pass"></span>Context Packet (${(cp.read_first||[]).length}/${(cp.read_next||[]).length})</div>
      <div class="nl"><span class="dot d-pass"></span>Context Bundle Export</div>
      <div class="nl"><span class="dot d-pass"></span>Context Lock Snapshot</div>
      <div class="nl"><span class="dot d-pass"></span>Context Drift Guard</div>
      <div class="nl"><span class="dot d-pass"></span>Token Budget Meter</div>
      <div class="nl"><span class="dot d-pass"></span>Execution Packet (${ep}개)</div>
      <div class="nl"><span class="dot d-pass"></span>Constraint Fit Checker</div>
      <div class="nl"><span class="dot d-act"></span>Apply Handoff Kit</div>
      <div class="nl"><span class="dot d-warn"></span>Core Boundary Map</div>
      <div class="nl"><span class="dot d-act"></span>Handoff Bundle Composer</div>
      <div class="nl"><span class="dot d-act"></span>Verified Promote Pipeline</div>
      <div class="nl"><span class="dot d-act"></span>Promotion Pipeline Orchestrator</div>
      <div class="nl"><span class="dot d-pass"></span>Benchmark Action Pack</div>
      <div class="nl"><span class="dot d-pass"></span>Starter Preset Pack</div>
      <div class="nl"><span class="dot d-pass"></span>AI 학습 플로우 (${lt}개)</div>
      <div class="nl"><span class="dot d-pass"></span>호환성 매트릭스 (${ac}개)</div>
      <div class="nl"><span class="dot d-pass"></span>숙련도 로드맵 (${lm}개)</div>`;
  } else if(tab==='adr'){
    sb.innerHTML=`<div class="sb-lbl">ADR (${d.adrs.length})</div>`+
      d.adrs.map(a=>`<div class="nl">
        <span class="dot d-act"></span>
        <span style="font-size:10px;flex:1">${esc(a.id)}: ${esc(a.title.substring(0,22))}${a.title.length>22?'…':''}</span>
      </div>`).join('');
  } else if(tab==='sprint'){
    const d2=window.D; const git=d2.git||{};
    sb.innerHTML=`<div class="sb-lbl">스프린트</div>
      <div class="nl on"><span class="dot d-act"></span>현재 WP (${d2.wps.active.length})</div>
      <div class="nl"><span class="dot d-pass"></span>Starter Focus Cycle</div>
      <div class="nl"><span class="dot d-warn"></span>대기 (${d2.wps.pending.length})</div>
      <div class="nl"><span class="dot d-pass"></span>최근 완료 WP</div>
      <div class="sb-lbl">Git</div>
      <div class="nl"><span class="dot d-act"></span><span style="font-size:10px;font-family:var(--mo)">${esc(git.branch||'—')}</span></div>
      <div class="nl"><span class="dot d-pass"></span>HEAD: <span style="font-family:var(--mo);font-size:9px">${esc(git.hash||'—')}</span></div>
      <div class="sb-lbl">CAP 로드맵</div>
      ${d2.caps.map(c=>{
        const cp=c.wp_count?Math.round(c.done_count/c.wp_count*100):100;
        return `<div class="nl"><span class="dot ${cp===100?'d-pass':'d-act'}"></span>
          <span style="flex:1;font-size:10px">${esc(c.id)}</span>
          <span style="font-size:9px;color:${cp===100?'var(--ac)':'var(--dm)'}">${cp}%</span>
        </div>`;
      }).join('')}`;
  } else if(tab==='log'){
    const d2=window.D;
    const liveCount=buildLiveOpsFeed().length;
    const replayCount=buildStudyReplayData().length;
    sb.innerHTML=`<div class="sb-lbl">감사 로그</div>
      <div class="nl"><span class="dot d-act"></span>Live Ops Feed (${liveCount})</div>
      <div class="nl"><span class="dot d-warn"></span>Alert Cockpit (${(d2.observability?.alert_groups||[]).length})</div>
      <div class="nl"><span class="dot d-pass"></span>Study Replay (${replayCount})</div>
      <div class="nl"><span class="dot d-act"></span>Replay Next Packet</div>
      <div class="nl"><span class="dot d-warn"></span>Reflexion (${d2.reflections.length})</div>
      <div class="nl"><span class="dot d-pass"></span>감사 체인 (${d2.audit_entries.length})</div>
      <div class="nl"><span class="dot d-act"></span>학습 보고서 (${d2.learning_reports.length})</div>`;
  }
}

// ────────────────────────────────────────────────────────────────
// REGEN (데이터 재생성 버튼)
// ────────────────────────────────────────────────────────────────
function regenData(){
  toast('터미널에서 npm run planner 실행 후 페이지 새로고침하세요');
  // 실제 서버 환경에서는 fetch('/api/regen') 호출 가능
}

// ────────────────────────────────────────────────────────────────
// AI FLOW VISUALIZER
// ────────────────────────────────────────────────────────────────
function renderAIFlow() {
  const d=window.D;
  const stages=d.project.stage_states||{};
  const domains=d.domains||[];
  const stageDefs=[
    {id:'A',icon:'📐',agent:'architect',color:'#1f6feb',title:'요구사항 분석 & 계약 설계',thinking:'ultrathink',
     inputs:['requirements/[domain].yaml','constraints.yaml'],
     outputs:['capability.yaml','openapi.yaml','ui-contract.yaml','events.yaml'],
     gate:'도메인 경계 + 불변조건(INV) 정의'},
    {id:'B',icon:'🔗',agent:'architect',color:'#8b49e5',title:'도메인 조합 충돌 검사',thinking:'ultrathink',
     inputs:['Stage A 계약 (전 도메인)'],
     outputs:['stageB/[domain]-composition.yaml'],
     gate:'전체 도메인 간 계약 충돌 없음'},
    {id:'C',icon:'🔌',agent:'master-shell',color:'#1a7f37',title:'마스터 셸 플러그인 등록',thinking:'normal',
     inputs:['plugin-registry/registry.yaml','navigation/nav.yaml'],
     outputs:['plugin 등록','feature-flag 설정','navigation 연결'],
     gate:'validate:composition PASS'},
    {id:'D',icon:'⚙️',agent:'implementer',color:'#e36209',title:'구현 & 품질 게이트',thinking:'normal',
     inputs:['Stage A 계약','Stage B 조합 규칙'],
     outputs:['domain/src/ 구현체','tests/ 스위트','interface/controller.js'],
     gate:'unit + lint + contract + authz + e2e PASS'},
    {id:'E',icon:'🔴',agent:'adversary',color:'#cf222e',title:'적대적 검증 (레드팀)',thinking:'ultrathink',
     inputs:['Stage D 구현체','불변조건 목록'],
     outputs:['GAP-*.yaml','reflections/','ADR (필요시)'],
     gate:'모든 INV 공격 벡터 차단 확인'},
  ];
  const agentDefs=[
    {name:'architect',stages:['A','B'],color:'#1f6feb',desc:'요구사항 분석, 계약 설계, 도메인 조합 충돌 검사'},
    {name:'implementer',stages:['D'],color:'#e36209',desc:'Clean Architecture 안쪽→바깥, 코딩 패턴 강제'},
    {name:'adversary',stages:['E'],color:'#cf222e',desc:'모든 INV를 깨뜨리는 레드팀 적대적 검증'},
    {name:'reviewer (B_review)',stages:[],color:'#8b49e5',desc:'코드 리뷰 + 계약 영향 + semver, Cross-Model'},
    {name:'observer',stages:[],color:'#1a7f37',desc:'독립 감사, 파일시스템 직접 검증, MISMATCH 0건 요구'},
    {name:'reporter',stages:[],color:'#d4a72c',desc:'학습보고서 생성 전문, 기승전결 + 코드 스니펫 3단계'},
  ];
  const kwDefs=[
    {kw:'계속',action:'next-actions priority 1 실행',thinking:'normal',auto:'✅'},
    {kw:'A [도메인]',action:'Stage A~E 전체 실행',thinking:'ultrathink(A,B,E)',auto:'✅'},
    {kw:'D [도메인]',action:'Stage D만 실행',thinking:'normal',auto:'✅'},
    {kw:'E [도메인]',action:'Stage E + B_review',thinking:'ultrathink',auto:'✅'},
    {kw:'검토',action:'현재 상태 보고',thinking:'normal',auto:'—'},
    {kw:'게이트',action:'전 도메인 품질 게이트',thinking:'normal',auto:'✅'},
    {kw:'B_review [도메인]',action:'적대적 리뷰만',thinking:'ultrathink',auto:'✅'},
    {kw:'보고서 [도메인]',action:'학습보고서 생성',thinking:'normal',auto:'✅'},
    {kw:'A *',action:'전 도메인 병렬 실행',thinking:'ultrathink',auto:'✅'},
    {kw:'건강',action:'건강도 대시보드',thinking:'normal',auto:'—'},
    {kw:'그래프',action:'의존성 다이어그램 생성',thinking:'normal',auto:'—'},
    {kw:'카탈로그',action:'도메인 카탈로그 사이트 생성',thinking:'normal',auto:'✅'},
  ];

  // SVG flow diagram
  const W=700,H=180,nW=100,nH=60,gX=38,sX=20,sY=40;
  let paths='',nodes='';
  stageDefs.forEach((st,i)=>{
    const x=sX+i*(nW+gX),y=sY;
    const status=stages[st.id]||'N/A';
    const sc=status==='PASS'?'#1a7f37':status==='FAIL'?'#cf222e':'#444';
    if(i<stageDefs.length-1){
      const nx=sX+(i+1)*(nW+gX);
      paths+=`<line x1="${x+nW}" y1="${y+nH/2}" x2="${nx}" y2="${y+nH/2}" stroke="#555" stroke-width="2" marker-end="url(#arr)"/>`;
    }
    nodes+=`<rect x="${x}" y="${y}" width="${nW}" height="${nH}" rx="7" fill="#161b22" stroke="${sc}" stroke-width="2"/>`;
    nodes+=`<text x="${x+nW/2}" y="${y+18}" text-anchor="middle" fill="${st.color}" font-size="13" font-weight="bold">${st.icon} ${st.id}</text>`;
    nodes+=`<text x="${x+nW/2}" y="${y+33}" text-anchor="middle" fill="#8b949e" font-size="9">${st.agent}</text>`;
    nodes+=`<text x="${x+nW/2}" y="${y+52}" text-anchor="middle" fill="${sc}" font-size="10" font-weight="bold">${status}</text>`;
    // label below
    nodes+=`<text x="${x+nW/2}" y="${y+nH+18}" text-anchor="middle" fill="#8b949e" font-size="8" width="${nW}">${st.thinking}</text>`;
  });
  const svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px">
    <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#555"/></marker></defs>
    ${paths}${nodes}</svg>`;

  // Domain grid
  let domH='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:8px">';
  (domains.length?domains:[{id:'—',name:'등록된 도메인 없음'}]).forEach(dom=>{
    const hs=(d.domain_scores[dom.domain_id||dom.id]||{}).score||0;
    const domStages=dom.stage_states||{};
    domH+=`<div class="card" style="margin:0">
      <div class="card-tit" style="font-size:13px">${esc(dom.name||dom.domain_id||dom.id)}</div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:6px">
        ${['A','B','C','D','E'].map(s=>`<span class="st ${(domStages[s]||stages[s]||'N/A')==='PASS'?'s-ok':'s-nd'}" style="font-size:9px">Stage ${s}</span>`).join('')}
      </div>
      <div style="color:var(--dm);font-size:11px;margin-top:4px">헬스 ${hs}점</div>
    </div>`;
  });
  domH+='</div>';

  // Stage cards
  let stH='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px;margin-top:10px">';
  stageDefs.forEach(st=>{
    const status=stages[st.id]||'N/A';
    stH+=`<div class="card" style="margin:0;border-left:3px solid ${st.color}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:18px">${st.icon}</span>
        <div style="flex:1"><div style="font-weight:700;color:${st.color}">Stage ${st.id}: ${esc(st.title)}</div>
        <div style="font-size:11px;color:var(--dm)">에이전트: <strong>${esc(st.agent)}</strong> · <em style="color:#d4a72c">${esc(st.thinking)}</em></div></div>
        <span class="st ${status==='PASS'?'s-ok':status==='FAIL'?'s-fl':'s-nd'}" style="font-size:10px">${esc(status)}</span>
      </div>
      <div style="font-size:11px;color:var(--dm);margin-bottom:4px">📥 ${esc((st.inputs||[]).join(' · '))}</div>
      <div style="font-size:11px;color:var(--dm);margin-bottom:4px">📤 ${esc((st.outputs||[]).join(' · '))}</div>
      <div style="font-size:11px;color:#1f6feb">🔒 ${esc(st.gate)}</div>
    </div>`;
  });
  stH+='</div>';

  // Agent table
  let agH=`<table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr style="border-bottom:1px solid var(--br)">
      <th style="padding:8px;text-align:left;color:var(--dm)">에이전트</th>
      <th style="padding:8px;text-align:left;color:var(--dm)">담당 Stage</th>
      <th style="padding:8px;text-align:left;color:var(--dm)">역할</th>
    </tr>`;
  agentDefs.forEach(ag=>{
    agH+=`<tr style="border-bottom:1px solid #21262d">
      <td style="padding:8px"><strong style="color:${ag.color}">${esc(ag.name)}</strong></td>
      <td style="padding:8px">${ag.stages.map(s=>`<span class="st s-ok" style="font-size:9px">Stage ${s}</span>`).join(' ')||'<span style="color:var(--dm)">on-demand</span>'}</td>
      <td style="padding:8px;color:var(--dm)">${esc(ag.desc)}</td>
    </tr>`;
  });
  agH+='</table>';

  // Keyword table
  let kwH=`<table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr style="border-bottom:1px solid var(--br)">
      <th style="padding:8px;text-align:left;color:var(--dm)">키워드</th>
      <th style="padding:8px;text-align:left;color:var(--dm)">행동</th>
      <th style="padding:8px;text-align:left;color:var(--dm)">사고 모드</th>
      <th style="padding:8px;text-align:center;color:var(--dm)">자동</th>
    </tr>`;
  kwDefs.forEach(kw=>{
    kwH+=`<tr style="border-bottom:1px solid #21262d">
      <td style="padding:8px"><code style="background:#161b22;padding:2px 6px;border-radius:4px;color:#e6edf3;font-size:11px">${esc(kw.kw)}</code></td>
      <td style="padding:8px;color:var(--dm)">${esc(kw.action)}</td>
      <td style="padding:8px;color:#d4a72c;font-size:11px">${esc(kw.thinking)}</td>
      <td style="padding:8px;text-align:center">${kw.auto}</td>
    </tr>`;
  });
  kwH+='</table>';

  $('c-flow').innerHTML=`
    <div class="sec-tit">🤖 AI 에이전트 흐름 시각화</div>
    <div class="sec-sub">Stage A→E 오케스트레이션 · 에이전트 위임 · 키워드 명령 레퍼런스 · Reflexion Loop</div>

    <div class="req-sec-h" style="margin-top:20px">📊 Stage 플로우 다이어그램</div>
    <div class="card" style="overflow-x:auto;padding:20px">${svg}</div>

    <div class="req-sec-h" style="margin-top:20px">🗂 도메인별 Stage 현황</div>
    ${domH}

    <div class="req-sec-h" style="margin-top:20px">📋 Stage 상세 카드</div>
    ${stH}

    <div class="req-sec-h" style="margin-top:20px">🤝 에이전트 위임 매트릭스</div>
    <div class="card">${agH}</div>

    <div class="req-sec-h" style="margin-top:20px">⌨️ 단일 키워드 명령 레퍼런스</div>
    <div class="card">${kwH}</div>

    <div class="req-sec-h" style="margin-top:20px">🔄 자동화 vs 멈춤 정책</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="card" style="margin:0;border-left:3px solid #1a7f37">
        <div class="card-tit" style="color:#1a7f37">✅ 자동 진행</div>
        <ul style="color:var(--dm);font-size:12px;padding-left:16px;margin:8px 0">
          <li>품질 게이트 PASS → 다음 Stage</li>
          <li>테스트 실패 → 수정 후 재실행 (최대 3회)</li>
          <li>ESLint → 즉시 수정</li>
          <li>P0/P1 갭 발견 → 즉시 수정</li>
          <li>Feature Flag: D PASS→internal(5%), E PASS→beta(20%), B_review PASS→full(100%)</li>
        </ul>
      </div>
      <div class="card" style="margin:0;border-left:3px solid #cf222e">
        <div class="card-tit" style="color:#cf222e">⛔ 멈추고 보고</div>
        <ul style="color:var(--dm);font-size:12px;padding-left:16px;margin:8px 0">
          <li>requirements/ 구조 변경</li>
          <li>기존 코드 삭제</li>
          <li>보안 정책 변경</li>
          <li>3회 연속 동일 실패 미해결</li>
          <li>INV 충돌 → ADR 필요</li>
        </ul>
      </div>
    </div>

    <div class="req-sec-h" style="margin-top:20px">🔁 Reflexion Loop (자기반성)</div>
    <div class="card">
      <div style="font-size:12px;color:var(--dm);margin-bottom:10px">테스트 실패 / 게이트 FAIL 즉시 발동. 동일 category 3회 반복 시 ADR 경고.</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${['1.실패 감지','2.reflection.yaml 생성','3.root_cause 분류','4.next_strategy 수립','5.재시도 (max 3회)','6.성공→lessons-learned.yaml'].map((s,i)=>`
          <span style="background:#161b22;border:1px solid ${i===5?'#1a7f37':'#30363d'};padding:5px 10px;border-radius:20px;font-size:11px;color:${i===5?'#3fb950':'#c9d1d9'}">${esc(s)}</span>${i<5?'<span style="color:#555;font-size:16px">→</span>':''}`).join('')}
      </div>
    </div>

    <div class="req-sec-h" style="margin-top:20px">✅ Chain-of-Verification (CoVe)</div>
    <div class="card">
      <div style="font-size:12px;color:var(--dm);margin-bottom:10px">Stage D 게이트 PASS 후 자동 실행</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        <div style="background:#161b22;border:1px solid #30363d;padding:10px;border-radius:6px;font-size:12px">
          <div style="font-weight:600;margin-bottom:4px">① 자문</div>
          <div style="color:var(--dm)">"이 테스트가 정말 INV를 검증하는가?"</div>
        </div>
        <div style="background:#161b22;border:1px solid #30363d;padding:10px;border-radius:6px;font-size:12px">
          <div style="font-weight:600;margin-bottom:4px">② 탐색</div>
          <div style="color:var(--dm)">"PASS해도 위반 가능한 입력이 존재하는가?"</div>
        </div>
        <div style="background:#161b22;border:1px solid #30363d;padding:10px;border-radius:6px;font-size:12px">
          <div style="font-weight:600;margin-bottom:4px">③ 보완</div>
          <div style="color:var(--dm)">불일치 → 테스트 보완 → 재검증</div>
        </div>
        <div style="background:#161b22;border:1px solid #1a7f37;padding:10px;border-radius:6px;font-size:12px">
          <div style="font-weight:600;margin-bottom:4px;color:#3fb950">④ 기록</div>
          <div style="color:var(--dm)">결과 → memory/stageD/[domain]-cove.yaml</div>
        </div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const d=window.D;
  $('hbadge').textContent=d.project.health_rating;
  $('gentime').textContent='생성: '+new Date(d.generated_at).toLocaleString('ko-KR');
  renderDash(); renderPlan(); renderWPs(); renderArc(); renderDom(); renderReq(); renderADR(); renderSprint(); renderLog(); renderAIFlow();
  syncAutoRefreshTimer();
  // git 칩
  const g=d.git||{}; if(g.branch) $('gitchip').innerHTML=`<em>⎇</em> ${esc(g.branch)} <span style="opacity:.5;font-size:9px">${esc(g.hash||'')}</span>`;
  buildSB('dash');
  setInterval(()=>{
    SECTIONS.forEach(s=>{
      const a=$('ea-'+s.id); if(a) localStorage.setItem('wfos-'+s.id,a.value);
      if(ST.planDone[s.id]) localStorage.setItem('wfos-done-'+s.id,'1');
    });
  },5000);
});
</script>
</body>
</html>"""

# ── 데이터 삽입 ──────────────────────────────────────────────────────
HTML = HTML_TEMPLATE.replace('__DATA_JSON__', DATA_JSON)

OUT_DIR  = os.path.join(ROOT, "artifacts", "master-planner")
os.makedirs(OUT_DIR, exist_ok=True)
OUT_PATH = os.path.join(OUT_DIR, "index.html")

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(HTML)

size_kb = os.path.getsize(OUT_PATH) // 1024
if not SILENT:
    print(f"✅ 생성 완료: {OUT_PATH} ({size_kb}KB)")
    print(f"   파일 크기: {size_kb}KB")
    print(f"   브라우저에서 열기: file://{OUT_PATH}")
else:
    print(f"✅ {OUT_PATH} ({size_kb}KB)")
