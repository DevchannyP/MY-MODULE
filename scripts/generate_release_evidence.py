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
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ROOT_CURRENT_STATE = ROOT / "memory/current-state.yaml"
LEGACY_CURRENT_STATE = ROOT / "memory/project/current-state.yaml"
ROOT_NEXT_ACTIONS = ROOT / "memory/next-actions.yaml"
LEGACY_NEXT_ACTIONS = ROOT / "memory/project/next-actions.yaml"
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


def main() -> None:
    current_state_path = pick_memory_path(ROOT_CURRENT_STATE, LEGACY_CURRENT_STATE)
    next_actions_path = pick_memory_path(ROOT_NEXT_ACTIONS, LEGACY_NEXT_ACTIONS)
    current_state = load_yaml(current_state_path)
    next_actions = load_yaml(next_actions_path)

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
        "schema_version": "2",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "repository": "my-module",
        "branch": os.environ.get("GITHUB_REF", run_git("branch", "--show-current")),
        "head_commit": ci_env["github_sha"],
        "build_environment": ci_env,
        "memory_sources": {
            "current_state": str(current_state_path.relative_to(ROOT)),
            "next_actions": str(next_actions_path.relative_to(ROOT)),
        },
        "last_completed_stage": extract_last_completed_stage(current_state),
        "quality_gate_result": extract_quality_gate_result(current_state),
        "next_action": extract_next_action(next_actions),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"release evidence written: {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
