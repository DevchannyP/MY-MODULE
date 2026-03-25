#!/usr/bin/env python3
"""
Generate the next packet recommendation from logs + replay lenses.

Usage:
  python3 scripts/generate_replay_packet.py --json
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
from pathlib import Path
import subprocess
import sys

import yaml

ROOT = Path(__file__).resolve().parent.parent
CURRENT_WP_PATH = ROOT / "memory" / "current-wp.yaml"
LEARNING_REPLAY_PATH = ROOT / "master-shell" / "catalog" / "learning-replay-lenses.yaml"
AI_LEARNING_MAP_PATH = ROOT / "master-shell" / "catalog" / "ai-learning-map.yaml"
TIMELINE_PATH = ROOT / "master-shell" / "observability" / "timeline.jsonl"
AUDIT_CHAIN_PATH = ROOT / "worklog" / "audit-chain.json"
REFLECTION_LOG_PATH = ROOT / "memory" / "L0-hot" / "reflection-log.yaml"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate replay-driven next packet")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_json(path: Path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def git(args: list[str]) -> str:
    try:
        completed = subprocess.run(["git"] + args, cwd=ROOT, capture_output=True, text=True, timeout=5, check=False)
        return completed.stdout.strip()
    except Exception:
        return ""


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def build_live_feed() -> list[dict]:
    timeline = [
        {
            "timestamp": item.get("timestamp") or item.get("time") or "",
            "title": item.get("event") or item.get("title") or f"timeline-{index+1}",
            "detail": item.get("detail") or item.get("message") or item.get("status") or "",
            "tag": item.get("source") or "timeline",
        }
        for index, item in enumerate(load_jsonl(TIMELINE_PATH))
    ]
    audit_chain = load_json(AUDIT_CHAIN_PATH).get("entries", [])
    audits = [
        {
            "timestamp": item.get("timestamp", ""),
            "title": item.get("action", "audit"),
            "detail": f"{item.get('actor', 'actor?')} {item.get('hash', '')[:12]}".strip(),
            "tag": "audit",
        }
        for item in audit_chain[:6]
        if isinstance(item, dict)
    ]
    reflections_raw = load_yaml(REFLECTION_LOG_PATH).get("entries", [])
    reflections = [
        {
            "timestamp": item.get("date", ""),
            "title": f"reflection {item.get('stage', '')}".strip(),
            "detail": (item.get("improvement_for_next") or item.get("root_cause") or ["개선 메모"])[0],
            "tag": "reflection",
        }
        for item in reflections_raw[:4]
        if isinstance(item, dict)
    ]
    reports = []
    for index, file_path in enumerate(glob.glob(str(ROOT / "worklog" / "reports" / "**" / "*.md"), recursive=True)):
        if index >= 3:
            break
        path = Path(file_path)
        reports.append({
            "timestamp": "",
            "title": f"report {path.parent.name}".strip(),
            "detail": str(path.relative_to(ROOT)),
            "tag": "report",
        })
    git_event = []
    last_msg = git(["log", "-1", "--format=%s"])
    if last_msg:
        git_event.append({
            "timestamp": git(["log", "-1", "--format=%ai"]),
            "title": "git commit",
            "detail": last_msg,
            "tag": "git",
        })

    feed = timeline + audits + reflections + reports + git_event
    unique: dict[str, dict] = {}
    for item in feed:
        key = f"{item['tag']}:{item['timestamp']}:{item['title']}"
        unique.setdefault(key, item)
    return sorted(unique.values(), key=lambda item: str(item.get("timestamp", "")), reverse=True)[:10]


def build_replay_packet(current_wp: dict) -> dict:
    live_feed = build_live_feed()
    lenses = load_yaml(LEARNING_REPLAY_PATH).get("lenses", [])
    track_map = {
        item.get("id"): item
        for item in load_yaml(AI_LEARNING_MAP_PATH).get("tracks", [])
        if isinstance(item, dict)
    }
    matched_lenses = []
    for lens in lenses:
        if not isinstance(lens, dict):
            continue
        matched = [item for item in live_feed if item.get("tag") == lens.get("event_tag")][:3]
        if not matched:
            continue
        matched_lenses.append({
            "id": lens.get("id", ""),
            "title": lens.get("title", ""),
            "teaches": lens.get("teaches", ""),
            "track": track_map.get(lens.get("track_ref"), {}),
            "matched": matched,
            "next_reads": lens.get("next_reads", []),
        })

    reads = dedupe_strings([path for lens in matched_lenses for path in lens.get("next_reads", [])])[:6]
    rationale = [f"{lens.get('title')}: {lens.get('teaches')}" for lens in matched_lenses[:3]]
    focus_tracks = [lens.get("track", {}).get("title") or lens.get("track", {}).get("id") or lens.get("title") for lens in matched_lenses[:3]]
    first_matched = matched_lenses[0]["matched"][0] if matched_lenses else {}
    goal = (
        f"최근 {first_matched.get('tag', 'log')} 시그널을 기준으로 {first_matched.get('detail', '다음 packet을 정리한다')}"
        if matched_lenses else
        "최근 로그와 replay lens를 기준으로 다음 packet 초안을 만든다"
    )
    validation = current_wp.get("validation", []) if isinstance(current_wp.get("validation", []), list) else []
    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "type": current_wp.get("type", "planning"),
        "stage": current_wp.get("stage", "A"),
        "focus_tracks": focus_tracks,
        "rationale": rationale,
        "read_first": reads,
        "validation": validation[:3],
        "matched_lenses": [
            {
                "id": lens.get("id", ""),
                "title": lens.get("title", ""),
                "track_title": lens.get("track", {}).get("title") or lens.get("track", {}).get("id", ""),
                "matched": lens.get("matched", []),
            }
            for lens in matched_lenses
        ],
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    report = build_replay_packet(current_wp)

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
