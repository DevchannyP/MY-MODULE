#!/usr/bin/env python3
"""
Export an exact file-level lock manifest for the current minimal context bundle.

Usage:
  python3 scripts/export_context_lock.py --goal plan-and-learn --json
  python3 scripts/export_context_lock.py --goal module-extension --output context-lock.yaml
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import (
    CONSTRAINTS_PATH,
    CURRENT_WP_PATH,
    ROUTING_PATH,
    build_bundle,
    infer_goal_from_current_wp,
    load_yaml,
)


ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Workflow OS context lock manifest")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def estimate_tokens(byte_count: int) -> int:
    # 3 bytes/token: conservative estimate for Korean/English mixed content.
    # Korean UTF-8 averages ~2 bytes/token; English ~4 bytes/token.
    if byte_count <= 0:
        return 0
    return max(1, round(byte_count / 3))


def iter_relative_files(relative_path: str) -> list[str]:
    target = ROOT / relative_path.rstrip("/")
    if not relative_path or not target.exists():
        return []
    if target.is_file():
        return [str(target.relative_to(ROOT))]

    files: list[str] = []
    for child in sorted(target.rglob("*")):
        if child.is_file():
            files.append(str(child.relative_to(ROOT)))
    return files


def sha256_for_file(relative_path: str) -> str:
    digest = hashlib.sha256()
    with (ROOT / relative_path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_lock_entries(paths: list[str], tier: str) -> tuple[list[dict], dict]:
    entries: list[dict] = []
    for requested_path in dedupe_strings(paths):
        exact_files = iter_relative_files(requested_path)
        if not exact_files:
            entries.append({
                "requested_path": requested_path,
                "path": requested_path,
                "tier": tier,
                "exists": False,
                "bytes": 0,
                "estimated_tokens": 0,
                "sha256": "",
            })
            continue

        for file_path in exact_files:
            file_target = ROOT / file_path
            byte_count = file_target.stat().st_size
            entries.append({
                "requested_path": requested_path,
                "path": file_path,
                "tier": tier,
                "exists": True,
                "bytes": byte_count,
                "estimated_tokens": estimate_tokens(byte_count),
                "sha256": sha256_for_file(file_path),
            })

    summary = {
        "file_count": len([entry for entry in entries if entry["exists"]]),
        "total_bytes": sum(entry["bytes"] for entry in entries),
        "estimated_tokens": sum(entry["estimated_tokens"] for entry in entries),
    }
    return entries, summary


def build_context_lock(goal: str, current_wp: dict, routing_catalog: dict, constraints: dict) -> dict:
    bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    primary_entries, primary_summary = build_lock_entries(bundle.get("read_first", []), "primary")
    secondary_entries, secondary_summary = build_lock_entries(bundle.get("read_next", []), "secondary")

    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "profile_id": bundle.get("profile_id", ""),
        "current_wp": bundle.get("current_wp", {}),
        "protected_core": bundle.get("protected_core", []),
        "core_guardrails": bundle.get("core_guardrails", []),
        "requested_paths": {
            "primary": bundle.get("read_first", []),
            "secondary": bundle.get("read_next", []),
            "deferred": bundle.get("read_later", []),
        },
        "locked_files": {
            "primary": primary_entries,
            "secondary": secondary_entries,
        },
        "summary": {
            "primary": primary_summary,
            "secondary": secondary_summary,
            "total": {
                "file_count": primary_summary["file_count"] + secondary_summary["file_count"],
                "total_bytes": primary_summary["total_bytes"] + secondary_summary["total_bytes"],
                "estimated_tokens": primary_summary["estimated_tokens"] + secondary_summary["estimated_tokens"],
            },
        },
        "commands": {
            "context_bundle_json": f"python3 scripts/export_context_bundle.py --goal {goal} --json",
            "context_lock_json": f"python3 scripts/export_context_lock.py --goal {goal} --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    report = build_context_lock(goal, current_wp, routing_catalog, constraints)

    if args.json:
        rendered = json.dumps(report, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(report, allow_unicode=True, default_flow_style=False, sort_keys=False)

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.write_text(rendered, encoding="utf-8")
        print(str(output_path))
        return

    print(rendered)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
