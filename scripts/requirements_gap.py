#!/usr/bin/env python3
"""
Requirements Gap Detector — compares requirements.yaml against implemented
capabilities and auto-generates skeleton WPs for uncovered requirements.

Inspired by: BDD spec-first (Gherkin → test skeleton), Shape Up appetite-scoping,
             Pact consumer-driven contracts (contract as source of truth).

Usage:
  python3 scripts/requirements_gap.py          # text gap report
  python3 scripts/requirements_gap.py --json   # machine-readable
  python3 scripts/requirements_gap.py --gen    # generate skeleton WP YAML
  python3 scripts/requirements_gap.py --strict # exit 1 if any gap found
"""

from __future__ import annotations

import json
import sys
import glob
from pathlib import Path
from datetime import date

import yaml

ROOT = Path(__file__).resolve().parent.parent

# Maps quality gate IDs to the capability IDs they are covered by
GATE_CAPABILITY_MAP: dict[str, str] = {
    "unit-tests": "requirements-validation",
    "contract-tests": "contract-drift-validation",
    "integration-tests": "server-wiring-smoke",
    "e2e-smoke": "server-wiring-smoke",
    "lint": "quality-gate-baseline",
    "type-check": "quality-gate-baseline",
    "static-analysis": "quality-gate-baseline",
    "secret-scan": "quality-gate-baseline",
    "dependency-scan": "quality-gate-baseline",
    "authn-authz-regression": "quality-gate-baseline",
    "input-validation": "quality-gate-baseline",
    "sbom": "quality-gate-ci",
    "provenance-evidence": "quality-gate-ci",
    "rollback-verification": "quality-gate-baseline",
    "observability-check": "quality-gate-baseline",
}


def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_requirements() -> dict:
    return load_yaml(ROOT / "requirements" / "requirements.yaml")


def load_current_state() -> dict:
    p = ROOT / "memory" / "current-state.yaml"
    return load_yaml(p) if p.exists() else {}


def load_worklogs() -> list[dict]:
    wls: list[dict] = []
    for path in sorted(glob.glob(str(ROOT / "worklog" / "*.yaml"))):
        try:
            data = load_yaml(Path(path))
            if data:
                wls.append(data)
        except Exception:
            pass
    return wls


def working_capability_ids(state: dict) -> set[str]:
    return {c["id"] for c in state.get("working_capabilities", []) if "id" in c}


def check_gaps(req: dict, state: dict) -> list[dict]:
    gaps: list[dict] = []
    working = working_capability_ids(state)

    # 1. Contract files exist on disk
    contracts = req.get("contracts", {})
    for ctype, cpath in contracts.items():
        if not (ROOT / cpath).exists():
            gaps.append({
                "type": "missing_contract_file",
                "severity": "high",
                "description": f"Contract file not found on disk: {cpath}",
                "suggested_wp_goal": f"{ctype} 계약 파일 {Path(cpath).name} 생성 및 검증",
                "tier": "domain",
            })

    # 2. Quality gate capabilities covered
    quality_gates = req.get("quality_gates", {})
    seen_caps: set[str] = set()
    for category, gates in quality_gates.items():
        for gate in gates:
            cap = GATE_CAPABILITY_MAP.get(gate)
            if cap and cap not in working and cap not in seen_caps:
                seen_caps.add(cap)
                gaps.append({
                    "type": "unimplemented_gate",
                    "severity": "medium",
                    "description": f"Gate '{gate}' ({category}) maps to capability '{cap}' not in working_capabilities",
                    "suggested_wp_goal": f"{cap} 품질 게이트 구현 및 CI 연결",
                    "tier": "governance",
                })

    # 3. desired_state reconciliation (Kubernetes-style)
    desired = state.get("desired_state", {})
    for cap_id, description in desired.items():
        if cap_id not in working:
            gaps.append({
                "type": "desired_state_gap",
                "severity": "medium",
                "description": f"Desired capability '{cap_id}' not yet working: {description}",
                "suggested_wp_goal": f"{cap_id} 구현 — {description}",
                "tier": "domain",
            })

    # 4. NFR has baseline coverage
    nfr = req.get("nfr", {})
    nfr_caps = {"observability-check", "rollback-verification"}
    if not nfr_caps.issubset(working):
        missing_nfr = nfr_caps - working
        gaps.append({
            "type": "nfr_coverage_gap",
            "severity": "low",
            "description": f"NFR latency={nfr.get('latency_p99_ms')}ms / avail={nfr.get('availability_percent')}% "
                           f"lacks enforcement via: {missing_nfr}",
            "suggested_wp_goal": "NFR 기준선 observability 및 rollback 검증 강화",
            "tier": "governance",
        })

    return gaps


def generate_wp_skeleton(gap: dict, idx: int) -> dict:
    today = date.today().isoformat()
    return {
        "id": f"WP-{today}-AUTO-{idx:02d}",
        "goal": gap["suggested_wp_goal"],
        "status": "pending",
        "tier": gap.get("tier", "domain"),
        "depends_on": [],
        "context_budget": {
            "tier_reads": ["memory/checkpoint.yaml", "memory/current-wp.yaml"],
            "context_reads": ["requirements/requirements.yaml"],
            "estimated_turns": 2,
        },
        "source": "requirements_gap_auto",
        "gap_type": gap["type"],
    }


def main() -> None:
    as_json = "--json" in sys.argv
    gen_wps = "--gen" in sys.argv
    strict = "--strict" in sys.argv

    req = load_requirements()
    state = load_current_state()
    gaps = check_gaps(req, state)

    if as_json:
        result: dict = {
            "module": req.get("module", {}).get("id"),
            "stage": req.get("stage"),
            "gap_count": len(gaps),
            "gaps": gaps,
        }
        if gen_wps:
            result["generated_wps"] = [generate_wp_skeleton(g, i + 1) for i, g in enumerate(gaps)]
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if strict and gaps:
            sys.exit(1)
        return

    W = 62
    print(f"\n{'='*W}")
    print(f"  Requirements Gap Detector")
    print(f"  Module : {req.get('module', {}).get('id', 'unknown')}")
    print(f"  Stage  : {req.get('stage', '?')}")
    print(f"{'='*W}")

    if not gaps:
        print("  ✓ No gaps. All requirements have working capability coverage.")
    else:
        print(f"  {len(gaps)} gap(s) found:\n")
        for i, gap in enumerate(gaps, 1):
            sev = gap["severity"].upper()
            print(f"  [{i}] [{sev}] {gap['type']}")
            print(f"       {gap['description']}")
            print(f"       → Suggested WP: {gap['suggested_wp_goal']}")
            print()

    if gen_wps and gaps:
        print("\n  --- Generated WP Skeletons (add to wp-queue.yaml) ---\n")
        for i, gap in enumerate(gaps, 1):
            wp = generate_wp_skeleton(gap, i)
            print(yaml.dump(wp, allow_unicode=True, default_flow_style=False))

    print(f"{'='*W}\n")

    if strict and gaps:
        sys.exit(1)


if __name__ == "__main__":
    main()
