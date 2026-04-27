#!/usr/bin/env python3
"""
Generate a concise readiness brief from status, scheduler, pipeline, and benchmark state.

Usage:
  python3 scripts/generate_readiness_brief.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from generate_reread_queue import DEFAULT_INPUT, build_reread_queue
from check_context_drift import ROOT, build_drift_report, load_structured_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS readiness brief")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def run_json_command(command: list[str]) -> dict:
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=20, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or f"command failed: {' '.join(command)}")
    return json.loads(completed.stdout)


def build_readiness_brief(current_wp: dict) -> dict:
    goal = infer_goal_from_current_wp(current_wp, None)
    benchmark_pack = build_benchmark_pack(goal, current_wp, load_yaml(BENCHMARK_PATH))
    status_report = run_json_command(["node", "scripts/project_status.js"])
    scheduler_report = run_json_command(["python3", "scripts/wp_scheduler.py", "--json"])

    manifest = load_structured_file(Path(DEFAULT_INPUT).resolve()) if Path(DEFAULT_INPUT).exists() else {}
    reread_queue = build_reread_queue(build_drift_report(manifest, ROOT)) if manifest else {
        "drift_status": "clean",
        "reread_count": 0,
        "reread_queue": [],
    }

    next_actions = []
    if not status_report.get("promotion_pipeline", {}).get("promotion_ready", False):
        next_actions.append("promotion pipeline을 먼저 재생성하고 locked token 예산을 확인한다")
    if reread_queue.get("reread_count", 0) > 0:
        next_actions.append("changed/missing 파일만 reread queue 기준으로 다시 읽는다")
    if not next_actions:
        next_actions.append("현재 locked context와 promotion readiness가 clean 상태이므로 다음 packet 실행을 진행한다")

    return {
        "schema_version": "1",
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "promotion_pipeline": status_report.get("promotion_pipeline", {}),
        "scheduler": {
            "ready": len(scheduler_report.get("ready", [])),
            "blocked": scheduler_report.get("blocked", 0),
        },
        "reread_queue": {
            "drift_status": reread_queue.get("drift_status", "clean"),
            "reread_count": reread_queue.get("reread_count", 0),
            "top_paths": [item.get("path", "") for item in reread_queue.get("reread_queue", [])[:5]],
        },
        "benchmark_focus": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
            }
            for item in benchmark_pack.get("recommended_focuses", [])[:3]
        ],
        "next_actions": next_actions,
        "commands": {
            "readiness_brief_json": "python3 scripts/generate_readiness_brief.py --json",
            "reread_queue_json": "python3 scripts/generate_reread_queue.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    brief = build_readiness_brief(current_wp)

    if args.json:
        print(json.dumps(brief, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(brief, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
