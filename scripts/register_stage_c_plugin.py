#!/usr/bin/env python3
"""Register a newly scaffolded domain into Stage C baselines."""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import date
from pathlib import Path
import sys

import yaml


DEFAULT_ROOT = Path(__file__).resolve().parent.parent
TODAY = date.today().isoformat()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register Stage C plugin baselines.")
    parser.add_argument("--requirements", required=True, help="Path to requirements yaml, relative to root or absolute.")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Runtime root. Defaults to repository root.")
    return parser.parse_args(argv)


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_yaml(data: dict) -> str:
    return yaml.safe_dump(
        data,
        allow_unicode=True,
        sort_keys=False,
        width=120,
    )


def dump_json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def pascal_case(value: str) -> str:
    return "".join(part.capitalize() for part in value.replace("_", "-").split("-") if part)


def choose_primary_flag(flag_map: dict[str, bool]) -> str:
    keys = list(flag_map.keys())
    enabled = [key for key in keys if key.endswith(".enabled")]
    if enabled:
        return enabled[0]
    prefixed = [key for key in keys if key.startswith("enable_")]
    if prefixed:
        return prefixed[0]
    return keys[0]


def choose_icon(group_id: str) -> str:
    icon_map = {
        "productivity": "briefcase",
        "billing": "receipt",
        "content": "video_library",
        "ops": "build",
        "operations": "build",
        "security": "shield",
    }
    return icon_map.get(group_id, "extension")


def build_openapi_stub(module_id: str, display_name: str) -> dict:
    return {
        "openapi": "3.1.0",
        "info": {
            "title": f"{display_name} API",
            "version": "0.1.0",
            "description": f"{display_name} 도메인 HTTP 계약 placeholder",
        },
        "paths": {},
        "components": {},
    }


def build_events_stub(module_id: str, display_name: str) -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://workflow-os/domains/{module_id}/events.schema.json",
        "title": f"{display_name} Domain Events",
        "type": "object",
        "definitions": {},
    }


def build_ui_stub(module_id: str, display_name: str, entry_point: str, nav_group: str, primary_flag: str) -> dict:
    return {
        "version": "0.1.0",
        "module_id": module_id,
        "name": display_name,
        "description": f"{display_name} 화면 마운트 계약 placeholder",
        "entry_points": [
            {
                "route": entry_point,
                "label": display_name,
                "description": f"{display_name} 진입 화면",
            }
        ],
        "screens": [
            {
                "module_key": f"{module_id}.home",
                "route": entry_point,
                "mount": f"{pascal_case(module_id)}HomePage",
                "title": display_name,
                "description": f"{display_name} 기본 화면 placeholder",
                "nav_group": nav_group,
                "permissions": [f"{module_id}:read"],
                "data_requirements": [{"source": "TODO", "fields": ["TODO"]}],
                "actions": [{"id": "open-home", "label": f"{display_name} 열기", "triggers": "TODO"}],
                "shared_dependencies": ["react", "design-system"],
                "error_boundary": "default",
                "feature_flag": primary_flag,
                "observability_tags": [f"domain:{module_id}", "screen:home"],
            }
        ],
        "design_tokens": {
            "color_scheme": module_id,
            "accent": "#0f766e",
        },
    }


def build_capability_stub(module_id: str, display_name: str) -> dict:
    permission = f"{module_id}:read"
    return {
        "module_key": module_id,
        "version": "0.1.0",
        "capabilities": [
            {
                "id": f"can.mount.{module_id}",
                "description": f"{display_name} 플러그인 마운트",
                "required_permissions": [permission],
                "screens": [f"{module_id}.home"],
            }
        ],
        "required_permissions": [permission],
        "invariants": [
            {
                "id": f"INV-{module_id.upper().replace('-', '_')}-001",
                "description": f"{display_name} 기본 계약은 Stage A 완료 전까지 placeholder 상태를 유지한다.",
            }
        ],
        "events_emitted": [],
        "events_consumed": [],
    }


def build_stage_b_stub(module_id: str, bounded_context: str, display_name: str, entry_point: str) -> dict:
    return {
        "domain_id": module_id,
        "bounded_context": bounded_context,
        "stage": "B",
        "dependency_analysis": {
            "depends_on": [],
            "depended_by": [],
            "notes": f"{display_name} 조합 충돌 검사는 아직 수행 전이다.",
        },
        "naming_conflicts": {
            "route_conflicts": [],
            "event_conflicts": [],
            "permission_conflicts": [],
            "schema_conflicts": [],
        },
        "routes": {
            "base": entry_point,
            "pages": [{"path": entry_point, "module_key": f"{module_id}.home"}],
        },
        "result": "PENDING",
        "summary": "Stage B auto-generated placeholder. Composition validation required before activation.",
    }


def build_stage_c_stub(module_id: str, plugin_id: str, primary_flag: str, all_flags: list[str]) -> dict:
    return {
        "domain_id": module_id,
        "plugin_id": plugin_id,
        "stage": "C",
        "registered_at": TODAY,
        "status": "registered-not-activated",
        "feature_flags": {
            "primary": primary_flag,
            "all": all_flags,
        },
        "notes": [
            "Auto-registered by scaffold-create.",
            "Feature flags remain false until Stage D and approval gates pass.",
        ],
    }


def ensure_no_route_conflict(groups: list[dict], plugin_id: str, entry_point: str) -> None:
    for group in groups:
        for item in group.get("items", []):
            if item.get("route") == entry_point and item.get("plugin_id") != plugin_id:
                raise ValueError(f"navigation route conflict: {entry_point} already mapped to {item.get('plugin_id')}")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    requirements_path = Path(args.requirements)
    if not requirements_path.is_absolute():
        requirements_path = root / requirements_path

    requirements = load_yaml(requirements_path)
    if not requirements:
        print("requirements file is missing or empty", file=sys.stderr)
        return 1

    module = requirements.get("module") or {}
    routing = requirements.get("routing") or {}
    contracts = requirements.get("contracts") or {}
    feature_flags = deepcopy(requirements.get("feature_flags") or {})
    nfr = requirements.get("nfr") or {}

    module_id = str(module.get("id") or "").strip()
    display_name = str(module.get("name") or module_id).strip()
    bounded_context = str(module.get("bounded_context") or f"{module_id}-context").strip()
    owner = str(module.get("owner") or "TODO").strip()
    entry_point = str(routing.get("entry_point") or f"/{module_id}").strip()
    navigation_group = str(routing.get("navigation_group") or module_id).strip()

    if not module_id or not feature_flags:
        print("requirements must include module.id and feature_flags", file=sys.stderr)
        return 1

    primary_flag = choose_primary_flag(feature_flags)
    plugin_id = f"{module_id}-plugin"
    dashboard_id = f"{module_id}-dashboard"
    alert_group_id = f"{module_id}-alerts"
    stage_b_memory_ref = f"memory/stageB/{module_id}.yaml"
    stage_c_memory_ref = f"memory/stageC/{module_id}-plugin.yaml"

    registry_path = root / "master-shell" / "plugin-registry" / "registry.yaml"
    flags_path = root / "master-shell" / "feature-flags" / "flags.yaml"
    metadata_path = root / "master-shell" / "feature-flags" / "metadata.json"
    nav_path = root / "master-shell" / "navigation" / "nav.yaml"
    observability_path = root / "master-shell" / "observability" / "config.yaml"
    slo_policy_path = root / "master-shell" / "observability" / "slo-policy.json"
    catalog_path = root / "master-shell" / "catalog" / "domains.yaml"
    rollback_path = root / "master-shell" / "operations" / "rollback-playbook.yaml"

    registry = load_yaml(registry_path)
    flags = load_yaml(flags_path)
    metadata = load_json(metadata_path) or {"schema_version": "1", "flags": {}}
    navigation = load_yaml(nav_path)
    observability = load_yaml(observability_path)
    slo_policy = load_json(slo_policy_path) or {"schema_version": "1", "budgets": {}}
    catalog = load_yaml(catalog_path)
    rollback = load_yaml(rollback_path)

    plugins = registry.setdefault("plugins", [])
    if any(plugin.get("id") == plugin_id for plugin in plugins):
        print(f"plugin already registered: {plugin_id}", file=sys.stderr)
        return 1

    ensure_no_route_conflict(navigation.setdefault("navigation_groups", []), plugin_id, entry_point)

    plugin_entry = {
        "id": plugin_id,
        "name": display_name,
        "module_id": module_id,
        "entry_point": entry_point,
        "navigation": {
            "group": navigation_group,
            "label": display_name,
            "icon": choose_icon(navigation_group),
            "order": len(plugins) + 1,
        },
        "ui_contract": contracts.get("ui"),
        "capability_contract": contracts.get("capability"),
        "feature_flag": primary_flag,
        "rollout": {
            "strategy": "canary",
            "current_phase": "registered",
            "percentage": 0,
            "full_rollout_condition": "Stage D 품질 게이트 전체 PASS 후",
        },
        "rollback": {
            "strategy": "disable_flag",
            "flag": primary_flag,
            "trigger_conditions": [
                "error_rate > 1%",
                "authz 오류 발생",
                "smoke 테스트 실패",
            ],
        },
        "observability": {
            "dashboard": f"master-shell/observability/config.yaml#{dashboard_id}",
            "alert_group": alert_group_id,
        },
        "status": "inactive",
        "registered_at": TODAY,
        "owner": owner,
        "architecture_profile": "workflow-domain-module",
        "adapter_refs": [
            "master-ui-plugin-shell",
            "http-problem-details",
            "feature-flag-provider",
            "observability-otel",
        ],
        "stage_b_memory_ref": stage_b_memory_ref,
        "notes": (
            f"- {primary_flag}: false -> 기본 비노출 상태.\n"
            "- Stage D 품질 게이트 PASS 전 자동 활성화 금지.\n"
            "- Auto-registered during scaffold-create."
        ),
    }
    plugins.append(plugin_entry)
    registry["last_updated"] = TODAY

    plugin_flags = flags.setdefault("plugin_flags", {})
    for flag_name in feature_flags:
        plugin_flags.setdefault(flag_name, False)
    flags["last_updated"] = TODAY

    metadata_flags = metadata.setdefault("flags", {})
    for flag_name in feature_flags:
        if flag_name in metadata_flags:
            continue
        entry = {
            "owner": owner,
            "stage": "canary" if flag_name == primary_flag else "internal",
            "expires_on": "2026-12-31",
            "description": f"{display_name} 기능 플래그 ({flag_name})",
        }
        if flag_name == primary_flag:
            entry["rollout"] = {"percentage": 0, "bucket_by": "userId"}
        metadata_flags[flag_name] = entry

    groups = navigation.setdefault("navigation_groups", [])
    group_entry = next((group for group in groups if group.get("id") == navigation_group), None)
    if group_entry is None:
        group_entry = {
            "id": navigation_group,
            "label": display_name,
            "icon": choose_icon(navigation_group),
            "order": len(groups) + 1,
            "items": [],
        }
        groups.append(group_entry)
    items = group_entry.setdefault("items", [])
    if not any(item.get("plugin_id") == plugin_id and item.get("route") == entry_point for item in items):
        items.append({
            "plugin_id": plugin_id,
            "label": display_name,
            "route": entry_point,
            "feature_flag": primary_flag,
        })
    navigation["last_updated"] = TODAY

    dashboards = observability.setdefault("dashboards", [])
    alert_groups = observability.setdefault("alert_groups", [])
    dashboards.append({
        "id": dashboard_id,
        "name": f"{display_name} 대시보드",
        "description": f"{display_name} Stage C 등록 기본 대시보드",
        "url": f"dashboard://workflow-os/{module_id}-overview",
        "plugin_id": plugin_id,
        "metrics": [
            {"name": "등록 후 요청 수", "type": "rate", "source": f"{module_id} request count"},
            {"name": "오류율", "type": "error", "source": f"{module_id} HTTP 5xx rate"},
            {"name": "응답시간 p99", "type": "duration", "source": f"{module_id} latency"},
        ],
    })
    alert_groups.append({
        "id": alert_group_id,
        "name": f"{display_name} 알림",
        "plugin_id": plugin_id,
        "channel": f"alert://workflow-os/{module_id}",
        "rules": [
            {"name": "API 오류율 초과", "condition": "error_rate > 1% (5분 평균)", "severity": "warning"},
            {"name": "p99 응답시간 초과", "condition": "latency_p99 > 500ms", "severity": "warning"},
        ],
    })
    observability["last_updated"] = TODAY

    availability = float(nfr.get("availability_percent") or 99.5)
    error_budget = max(0.1, round(100 - availability, 1))
    slo_policy.setdefault("budgets", {})[plugin_id] = {
        "latency_budget_ms": int(nfr.get("latency_p99_ms") or 500),
        "availability_percent": availability,
        "error_budget_percent": error_budget,
    }

    domains = catalog.setdefault("domains", [])
    domains.append({
        "id": module_id,
        "name": display_name,
        "description": str(module.get("description") or f"{display_name} 도메인"),
        "bounded_contexts": [
            {
                "id": bounded_context,
                "name": display_name,
                "description": f"{display_name} bounded context placeholder",
                "stage_a_memory": f"memory/stageA/{module_id}.yaml",
            }
        ],
        "stage_b_memory": stage_b_memory_ref,
        "plugins": [plugin_id],
        "domain_map_ref": "requirements/domain-map.yaml",
        "status": "registered",
        "registered_at": TODAY,
        "note": f"Stage C auto-registration complete. {primary_flag}: false.",
    })
    catalog["last_updated"] = TODAY

    rollback_plugins = rollback.setdefault("plugins", [])
    rollback_plugins.append({
        "plugin_id": plugin_id,
        "owner": owner,
        "rollback": {
            "strategy": "disable_flag",
            "disable_flags": list(feature_flags.keys()),
            "trigger_conditions": [
                "error_rate > 1%",
                "authz 오류 발생",
                "smoke 테스트 실패",
            ],
        },
        "verification": {
            "dashboard": dashboard_id,
            "alert_group": alert_group_id,
            "expected_status": "inactive",
        },
    })
    rollback["last_updated"] = TODAY

    placeholder_files = {
        root / str(contracts.get("http")): dump_yaml(build_openapi_stub(module_id, display_name)),
        root / str(contracts.get("events")): dump_json(build_events_stub(module_id, display_name)),
        root / str(contracts.get("ui")): dump_yaml(build_ui_stub(module_id, display_name, entry_point, navigation_group, primary_flag)),
        root / str(contracts.get("capability")): dump_yaml(build_capability_stub(module_id, display_name)),
        root / stage_b_memory_ref: dump_yaml(build_stage_b_stub(module_id, bounded_context, display_name, entry_point)),
        root / stage_c_memory_ref: dump_yaml(build_stage_c_stub(module_id, plugin_id, primary_flag, list(feature_flags.keys()))),
        registry_path: dump_yaml(registry),
        flags_path: dump_yaml(flags),
        metadata_path: dump_json(metadata),
        nav_path: dump_yaml(navigation),
        observability_path: dump_yaml(observability),
        slo_policy_path: dump_json(slo_policy),
        catalog_path: dump_yaml(catalog),
        rollback_path: dump_yaml(rollback),
    }

    for target_path, content in placeholder_files.items():
        if "TODO" in str(target_path):
            print(f"invalid placeholder path in requirements: {target_path}", file=sys.stderr)
            return 1

    for target_path, content in placeholder_files.items():
        write_text(target_path, content)

    output = {
        "ok": True,
        "plugin_id": plugin_id,
        "feature_flag": primary_flag,
        "registered_files": [str(path.relative_to(root)) for path in placeholder_files],
    }
    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
