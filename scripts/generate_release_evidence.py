#!/usr/bin/env python3
"""
Release evidence generator.

이 스크립트는 외부 서비스 없이도 현재 저장소 상태를 하나의 JSON 근거 파일로 묶는다.
핵심 아이디어는 단순하다.

1. git에서 "지금 어디 브랜치인지"와 "어느 커밋인지"를 읽는다.
2. memory 파일에서 "지금 품질 상태가 어떤지"를 읽는다.
3. 다음 작업 큐에서 "다음 우선순위가 무엇인지"를 읽는다.
4. 위 정보를 artifacts/release-evidence/release-evidence.json에 기록한다.
"""

from __future__ import annotations

import json
import subprocess
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ROOT_CURRENT_STATE = ROOT / "memory/current-state.yaml"
LEGACY_CURRENT_STATE = ROOT / "memory/project/current-state.yaml"
ROOT_NEXT_ACTIONS = ROOT / "memory/next-actions.yaml"
LEGACY_NEXT_ACTIONS = ROOT / "memory/project/next-actions.yaml"
STAGE_RUN_REPORT = ROOT / "memory/project/stage-run-latest.yaml"
STAGE_RUN_HISTORY = ROOT / "memory/project/stage-run-history.yaml"
OUTPUT = ROOT / "artifacts/release-evidence/release-evidence.json"


def run_git(*args: str) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            capture_output=True,
            check=True,
            text=True,
        )
        return completed.stdout.strip()
    except subprocess.CalledProcessError:
        return "UNAVAILABLE"


def pick_memory_path(primary: Path, fallback: Path) -> Path:
    if primary.exists():
        return primary
    return fallback


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def load_planning_snapshot() -> dict:
    try:
        completed = subprocess.run(
            ["python3", "scripts/planning_studio_api.py", "snapshot"],
            cwd=ROOT,
            capture_output=True,
            check=True,
            text=True,
        )
        payload = json.loads(completed.stdout or "{}")
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def extract_last_completed_stage(current_state: dict) -> str:
    if isinstance(current_state.get("last_completed_stage"), str):
        return current_state["last_completed_stage"]
    if isinstance(current_state.get("last_completed_wp"), dict):
        return "WORK_PACKET_MODE"
    return "UNKNOWN"


def extract_quality_gate_result(current_state: dict) -> str:
    release_summary = current_state.get("release_summary")
    if isinstance(release_summary, dict):
        result = release_summary.get("quality_gate_result")
        if isinstance(result, str):
            return result
    if isinstance(current_state.get("quality_gate_result"), str):
        return current_state["quality_gate_result"]
    return "UNKNOWN"


def extract_quality_gate_inputs(current_state: dict) -> list[str]:
    release_summary = current_state.get("release_summary")
    if isinstance(release_summary, dict):
        inputs = release_summary.get("quality_gate_inputs")
        if isinstance(inputs, list):
            return [str(item) for item in inputs if isinstance(item, str) and item]
    return []


def extract_last_completed_unit(current_state: dict) -> dict[str, str]:
    last_wp = current_state.get("last_completed_wp")
    if isinstance(last_wp, dict):
        return {
            "mode": "work_packet",
            "id": str(last_wp.get("id", "UNKNOWN")),
            "completed_at": str(last_wp.get("completed_at", "UNKNOWN")),
            "result": str(last_wp.get("result", "UNKNOWN")),
        }

    last_stage = current_state.get("last_completed_stage")
    if isinstance(last_stage, str):
        return {
            "mode": "stage",
            "id": last_stage,
            "completed_at": "UNKNOWN",
            "result": extract_quality_gate_result(current_state),
        }

    return {
        "mode": "unknown",
        "id": "UNKNOWN",
        "completed_at": "UNKNOWN",
        "result": "UNKNOWN",
    }


def extract_release_artifacts(current_state: dict) -> dict[str, str]:
    release_summary = current_state.get("release_summary")
    if isinstance(release_summary, dict):
        artifacts = release_summary.get("artifacts")
        if isinstance(artifacts, dict):
            return {
                str(key): str(value)
                for key, value in artifacts.items()
                if isinstance(key, str) and isinstance(value, str) and value
            }
    return {}


def collect_artifact_evidence(current_state: dict) -> dict[str, dict[str, str | bool]]:
    artifact_map = extract_release_artifacts(current_state)
    evidence = {}
    output_relative = str(OUTPUT.relative_to(ROOT))

    for key, relative_path in artifact_map.items():
        path = ROOT / relative_path
        item = {
            "path": relative_path,
            "exists": path.exists(),
        }
        if path.exists() and relative_path != output_relative:
            item["sha256"] = sha256_file(path)
        if relative_path == output_relative:
            item["digest_strategy"] = "external-verification-required"
        evidence[key] = item

    return evidence


def collect_git_status() -> dict[str, object]:
    porcelain = run_git("status", "--short")
    if porcelain == "UNAVAILABLE":
        return {
            "available": False,
            "is_clean": False,
            "modified_paths": [],
            "untracked_paths": [],
        }

    modified_paths: list[str] = []
    untracked_paths: list[str] = []
    for line in porcelain.splitlines():
        if not line.strip():
            continue
        if len(line) > 3 and line[2] == " ":
            path = line[3:].strip()
        else:
            parts = line.split(maxsplit=1)
            path = parts[1].strip() if len(parts) == 2 else ""
        if line.startswith("??"):
            untracked_paths.append(path)
        else:
            modified_paths.append(path)

    return {
        "available": True,
        "is_clean": not modified_paths and not untracked_paths,
        "modified_paths": modified_paths,
        "untracked_paths": untracked_paths,
    }


def extract_next_action(next_actions: dict) -> dict[str, str]:
    queue = next_actions.get("queue", [])
    if isinstance(queue, list) and queue:
        first = queue[0]
        if isinstance(first, dict):
            return {
                "priority": str(first.get("priority", "NONE")),
                "id": str(first.get("id", "NONE")),
                "track": str(first.get("track", "WORK_PACKET")),
                "action": str(first.get("action", first.get("goal", "NONE"))),
            }
    return {"priority": "NONE", "id": "NONE", "track": "NONE", "action": "NONE"}


def extract_stage_run_evidence(snapshot: dict | None = None) -> dict[str, object]:
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    latest = snapshot.get("stage_run_last_report")
    history = snapshot.get("stage_run_recent_reports")
    contract = snapshot.get("stage_run_contract")

    if not isinstance(latest, dict):
        latest = load_yaml(STAGE_RUN_REPORT) if STAGE_RUN_REPORT.exists() else {}
    if not isinstance(history, list):
        history = load_yaml(STAGE_RUN_HISTORY) if STAGE_RUN_HISTORY.exists() else []
    if not isinstance(latest, dict):
        latest = {}
    if not isinstance(history, list):
        history = []
    if not isinstance(contract, dict):
        contract = {}

    runtime_observability = latest.get("runtime_observability")
    if not isinstance(runtime_observability, dict):
        runtime_observability = {}

    artifact_paths = runtime_observability.get("artifact_paths")
    if not isinstance(artifact_paths, dict):
        artifact_paths = {
            "last_report": str(STAGE_RUN_REPORT.relative_to(ROOT)),
            "recent_reports": str(STAGE_RUN_HISTORY.relative_to(ROOT)),
        }

    requested_stage = str(latest.get("requested_stage", ""))
    quality_gate_result = str(latest.get("quality_gate_result", "") or "UNKNOWN")
    report_saved = runtime_observability.get("report_saved")
    if not isinstance(report_saved, bool):
        report_saved = bool(requested_stage)
    contract_drift_status = str(contract.get("drift_status", "") or "unknown")
    contract_issues = contract.get("issues") if isinstance(contract.get("issues"), list) else []
    contract_clean = contract_drift_status == "clean"

    release_ready = quality_gate_result == "PASS" and report_saved and contract_clean
    if release_ready:
        blocker = "NONE"
    elif not requested_stage:
        blocker = "stage-run latest report missing"
    elif not contract_clean:
        blocker = f"stage-run contract {contract_drift_status}"
    elif quality_gate_result != "PASS":
        blocker = f"quality gate {quality_gate_result}"
    else:
        blocker = "stage-run report not persisted"

    return {
        "available": bool(requested_stage),
        "report_path": str(STAGE_RUN_REPORT.relative_to(ROOT)),
        "history_path": str(STAGE_RUN_HISTORY.relative_to(ROOT)),
        "history_count": len(history),
        "requested_stage": requested_stage or "UNKNOWN",
        "requested_module": str(latest.get("requested_module", "")) or "all",
        "execution_mode": str(latest.get("execution_mode", "UNKNOWN")),
        "status": str(latest.get("status", "UNKNOWN")),
        "quality_gate_result": quality_gate_result,
        "recorded_at": str(latest.get("recorded_at", "")),
        "docs_ref": str(latest.get("docs_ref", "")),
        "report_saved": report_saved,
        "request_id": str(runtime_observability.get("request_id", "")),
        "correlation_id": str(runtime_observability.get("correlation_id", "")),
        "artifact_paths": artifact_paths,
        "save_command": str(runtime_observability.get("save_command", "python3 scripts/planning_studio_api.py save-stage-run")),
        "stage_run_contract": {
            "drift_status": contract_drift_status,
            "latest_history_head_match": bool(contract.get("latest_history_head_match")),
            "history_head_available": bool(contract.get("history_head_available")),
            "release_evidence_surface_complete": bool(contract.get("release_evidence_surface_complete")),
            "release_evidence_generated": bool(contract.get("release_evidence_generated")),
            "release_evidence_trigger_reason": str(contract.get("release_evidence_trigger_reason", "")),
            "issues": [str(item) for item in contract_issues if str(item)],
        },
        "release_evidence_ready": release_ready,
        "release_evidence_blocker": blocker,
    }


def main() -> None:
    current_state_path = pick_memory_path(ROOT_CURRENT_STATE, LEGACY_CURRENT_STATE)
    next_actions_path = pick_memory_path(ROOT_NEXT_ACTIONS, LEGACY_NEXT_ACTIONS)
    current_state = load_yaml(current_state_path)
    next_actions = load_yaml(next_actions_path)
    planning_snapshot = load_planning_snapshot()

    import os
    # SLSA-compatible provenance fields (GitHub Actions environment)
    ci_env = {
        "ci": os.environ.get("CI", "false"),
        "github_sha": os.environ.get("GITHUB_SHA") or run_git("rev-parse", "HEAD"),
        "github_ref": os.environ.get("GITHUB_REF", "local"),
        "github_run_id": os.environ.get("GITHUB_RUN_ID", "local"),
        "github_workflow": os.environ.get("GITHUB_WORKFLOW", "local"),
    }

    evidence = {
        "schema_version": "3",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "repository": "my-module",
        "branch": os.environ.get("GITHUB_REF", run_git("branch", "--show-current")),
        "head_commit": ci_env["github_sha"],
        "build_environment": ci_env,
        "git_status": collect_git_status(),
        "memory_sources": {
            "current_state": str(current_state_path.relative_to(ROOT)),
            "next_actions": str(next_actions_path.relative_to(ROOT)),
        },
        "last_completed_stage": extract_last_completed_stage(current_state),
        "last_completed_unit": extract_last_completed_unit(current_state),
        "quality_gate_result": extract_quality_gate_result(current_state),
        "quality_gate_inputs": extract_quality_gate_inputs(current_state),
        "stage_run_evidence": extract_stage_run_evidence(planning_snapshot),
        "release_artifacts": collect_artifact_evidence(current_state),
        "next_action": extract_next_action(next_actions),
        "harness_release": {
            "prompt_version": "0.2.0",
            "output_schema_ref": "contracts/harness/output.schema.json",
            "provider_contract_ref": "contracts/harness/provider-adapter.yaml",
            "rollout_stage": "internal",
            "rollback_target": "null-harness-provider",
            "rollback_strategy": "set HARNESS_PROVIDER= in .env and restart server",
        },
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"release evidence written: {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
