#!/usr/bin/env python3
"""Planning studio snapshot/save helper.

Commands:
  python3 scripts/planning_studio_api.py snapshot
  python3 scripts/planning_studio_api.py save-packet < payload.json
  python3 scripts/planning_studio_api.py save-sections < payload.json
  python3 scripts/planning_studio_api.py save-automation < payload.json
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CURRENT_WP_PATH = ROOT / "memory" / "current-wp.yaml"
NEXT_ACTIONS_PATH = ROOT / "memory" / "next-actions.yaml"
WP_QUEUE_PATH = ROOT / "memory" / "wp-queue.yaml"
PLANNER_DRAFT_PATH = ROOT / "memory" / "project" / "master-planner-draft.yaml"
AUTOMATION_CONFIG_PATH = ROOT / "memory" / "project" / "vscode-cli-automation.yaml"
STAGE_RUN_REPORT_PATH = ROOT / "memory" / "project" / "stage-run-latest.yaml"
STAGE_RUN_HISTORY_PATH = ROOT / "memory" / "project" / "stage-run-history.yaml"
STAGE_RUN_HISTORY_LIMIT = 5

COMPLETED_STATUSES = {"done", "completed", "complete"}


def git_output(*args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    return (result.stdout or "").strip()


def load_yaml(path: Path, default):
    if not path.exists():
        return copy.deepcopy(default)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        return copy.deepcopy(default)
    return data


def save_yaml(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )


def now_iso() -> str:
    return dt.datetime.now().replace(microsecond=0).isoformat()


def is_completed(status: str) -> bool:
    return str(status or "").strip().lower() in COMPLETED_STATUSES


def unique_strings(values):
    seen = []
    for value in values:
        if isinstance(value, list):
            for inner in value:
                text = str(inner or "").strip()
                if text and text not in seen:
                    seen.append(text)
            continue
        text = str(value or "").strip()
        if text and text not in seen:
            seen.append(text)
    return seen


def parse_git_status_line(line: str) -> dict | None:
    text = str(line or "").rstrip("\n")
    if not text.strip():
        return None
    status = text[:2].strip() or "??"
    payload = text[2:].lstrip()
    if not payload:
        return None
    return {
        "status": status,
        "path": payload,
    }


def normalize_packet(packet, *, source="", capability=None, current=False, next_flag=False, recommended=False):
    packet = packet or {}
    capability = capability or {}
    packet_id = str(packet.get("id", "")).strip()
    if not packet_id:
        return None
    return {
        "id": packet_id,
        "goal": str(packet.get("goal", "")).strip(),
        "status": str(packet.get("status", "")).strip(),
        "tier": str(packet.get("tier", "")).strip(),
        "stage": str(packet.get("stage", "")).strip(),
        "type": str(packet.get("type", "")).strip(),
        "depends_on": unique_strings([packet.get("depends_on", []), packet.get("dependsOn", [])]),
        "subtasks": unique_strings([packet.get("subtasks", [])]),
        "validation": unique_strings([packet.get("validation", [])]),
        "constraints": unique_strings([packet.get("constraints", [])]),
        "evidence": unique_strings([packet.get("evidence", [])]),
        "scope_in": unique_strings([packet.get("scope_in", [])]),
        "scope_out": unique_strings([packet.get("scope_out", [])]),
        "next_unlock": str(packet.get("next_unlock", "")).strip(),
        "completed_at": str(packet.get("completed_at", "")).strip(),
        "result": str(packet.get("result", "")).strip(),
        "capability_id": str(capability.get("id", "")).strip(),
        "capability_name": str(capability.get("name", "")).strip(),
        "priority": capability.get("priority"),
        "source": source,
        "is_current": bool(current),
        "is_next": bool(next_flag),
        "is_recommended": bool(recommended),
    }


def merge_packet(base, incoming):
    if not base:
        return incoming
    if not incoming:
        return base

    merged = dict(base)
    for key in ("goal", "status", "tier", "stage", "type", "next_unlock", "completed_at", "result", "capability_id", "capability_name"):
        if incoming.get(key):
            merged[key] = incoming[key]
    for key in ("depends_on", "subtasks", "validation", "constraints", "evidence", "scope_in", "scope_out"):
        merged[key] = unique_strings([base.get(key, []), incoming.get(key, [])])
    merged["priority"] = incoming.get("priority", base.get("priority"))
    merged["source"] = incoming.get("source") or base.get("source")
    merged["is_current"] = bool(base.get("is_current") or incoming.get("is_current"))
    merged["is_next"] = bool(base.get("is_next") or incoming.get("is_next"))
    merged["is_recommended"] = bool(base.get("is_recommended") or incoming.get("is_recommended"))
    return merged


def packet_sort_key(packet):
    status_order = {
        "in_progress": 0,
        "active": 0,
        "ready": 1,
        "pending": 2,
        "review": 3,
        "blocked": 4,
    }
    return (
        0 if packet.get("is_recommended") else 1,
        0 if packet.get("is_current") else 1,
        status_order.get(packet.get("status", ""), 8),
        packet.get("priority") if isinstance(packet.get("priority"), int) else 999,
        packet.get("id", ""),
    )


def completed_sort_key(packet):
    return (packet.get("completed_at", ""), packet.get("id", ""))


def default_planner_sections(current_wp, next_actions, active_packets, completed_packets):
    current_id = str((current_wp or {}).get("id", "")).strip()
    current_goal = str((current_wp or {}).get("goal", "")).strip() or "현재 packet 목표 미정"
    next_id = str((next_actions or {}).get("next_wp", "")).strip() or "NONE"
    next_packet = next((packet for packet in active_packets if str(packet.get("id", "")) == next_id), None)
    next_goal = str((next_packet or {}).get("goal", "")).strip() or "다음 packet 목표 미정"
    recent_done = completed_packets[:3]

    sections = [
        {
            "id": "roadmap-current-focus",
            "tag": "현재 초점",
            "title": "지금 왜 이 packet을 보고 있는가",
            "content": f"현재 packet {current_id or 'NONE'}의 목표는 {current_goal} 입니다.",
            "done": False,
        },
        {
            "id": "roadmap-next-connection",
            "tag": "다음 연결",
            "title": "바로 이어질 다음 실행",
            "content": f"다음 packet {next_id}의 목표는 {next_goal} 입니다.",
            "done": False,
        },
    ]

    if recent_done:
        sections.append({
            "id": "roadmap-recent-completions",
            "tag": "최근 완료",
            "title": "최근 끝난 흐름에서 이어받을 것",
            "content": "\n".join(
                f"- {item.get('id', 'NONE')}: {item.get('goal', '목표 미정')}"
                for item in recent_done
            ),
            "done": False,
        })

    return sections


def collect_snapshot():
    current_wp = load_yaml(CURRENT_WP_PATH, {})
    next_actions = load_yaml(NEXT_ACTIONS_PATH, {})
    wp_queue = load_yaml(WP_QUEUE_PATH, {})
    planner_draft = load_yaml(PLANNER_DRAFT_PATH, {"updated_at": "", "sections": []})
    automation_config = load_yaml(AUTOMATION_CONFIG_PATH, {"enabled": False, "cycle_minutes": 30, "enter_seconds": 10, "workers": []})
    stage_run_last_report = load_yaml(STAGE_RUN_REPORT_PATH, {})
    stage_run_recent_reports = load_yaml(STAGE_RUN_HISTORY_PATH, [])
    if not isinstance(stage_run_recent_reports, list):
        stage_run_recent_reports = []

    packets_by_id = {}

    def upsert(packet, **kwargs):
        normalized = normalize_packet(packet, **kwargs)
        if not normalized:
            return
        packets_by_id[normalized["id"]] = merge_packet(packets_by_id.get(normalized["id"]), normalized)

    for capability in wp_queue.get("capabilities", []) or []:
        for packet in capability.get("work_packets", []) or []:
            upsert(packet, source="wp-queue", capability=capability)

    next_wp_id = str(next_actions.get("next_wp", "")).strip()
    for packet in next_actions.get("queue", []) or []:
        packet_id = str(packet.get("id", "")).strip()
        upsert(
            packet,
            source="next-actions",
            next_flag=packet_id == next_wp_id,
            recommended=packet_id == next_wp_id,
        )

    if next_wp_id and next_wp_id not in packets_by_id:
        upsert({"id": next_wp_id}, source="next-actions", next_flag=True, recommended=True)

    if current_wp:
        upsert(
            current_wp,
            source="current-wp",
            current=True,
            recommended=bool(current_wp.get("id")) and not is_completed(current_wp.get("status")),
        )

    packets = list(packets_by_id.values())
    active_packets = sorted(
        [
            {
                **packet,
                "goal": packet.get("goal") or "목표 미정",
                "status": packet.get("status") or "pending",
            }
            for packet in packets
            if not is_completed(packet.get("status"))
        ],
        key=packet_sort_key,
    )
    completed_packets = sorted(
        [
            {
                **packet,
                "goal": packet.get("goal") or "목표 미정",
                "status": packet.get("status") or "completed",
            }
            for packet in packets
            if is_completed(packet.get("status"))
        ],
        key=completed_sort_key,
        reverse=True,
    )

    default_packet = active_packets[0] if active_packets else {}
    sections = planner_draft.get("sections", []) if isinstance(planner_draft.get("sections"), list) else []
    seeded = False
    if not sections:
        sections = default_planner_sections(current_wp, next_actions, active_packets, completed_packets)
        seeded = True
    raw_status = git_output("status", "--short", "--untracked-files=all")
    changed_files = []
    for line in raw_status.splitlines():
        parsed = parse_git_status_line(line)
        if parsed:
            changed_files.append(parsed)
    return {
        "generated_at": now_iso(),
        "current_wp": current_wp,
        "next_actions": next_actions,
        "active_packets": active_packets,
        "completed_packets": completed_packets,
        "default_packet_id": default_packet.get("id", ""),
        "planner_sections_draft": {
            "updated_at": planner_draft.get("updated_at", ""),
            "sections": sections,
            "sections_by_id": {str(item.get("id", "")): item for item in sections if item.get("id")},
            "seeded": seeded,
        },
        "automation_config": automation_config,
        "stage_run_last_report": stage_run_last_report,
        "stage_run_recent_reports": stage_run_recent_reports[:STAGE_RUN_HISTORY_LIMIT],
        "code_status": {
            "branch": git_output("rev-parse", "--abbrev-ref", "HEAD") or "unknown",
            "head": git_output("rev-parse", "--short", "HEAD") or "",
            "dirty": bool(changed_files),
            "changed_count": len(changed_files),
            "changed_files": changed_files[:20],
        },
        "files": {
            "current_wp": str(CURRENT_WP_PATH.relative_to(ROOT)),
            "next_actions": str(NEXT_ACTIONS_PATH.relative_to(ROOT)),
            "wp_queue": str(WP_QUEUE_PATH.relative_to(ROOT)),
            "planner_draft": str(PLANNER_DRAFT_PATH.relative_to(ROOT)),
            "automation_config": str(AUTOMATION_CONFIG_PATH.relative_to(ROOT)),
            "stage_run_last_report": str(STAGE_RUN_REPORT_PATH.relative_to(ROOT)),
            "stage_run_recent_reports": str(STAGE_RUN_HISTORY_PATH.relative_to(ROOT)),
        },
    }


def merge_fields(target, payload):
    for key in ("id", "goal", "status", "tier", "stage", "type", "next_unlock", "result"):
        if key in payload:
            target[key] = payload.get(key)
    for key in ("depends_on", "subtasks", "validation", "constraints", "evidence", "scope_in", "scope_out"):
        if key in payload:
            target[key] = list(payload.get(key) or [])
    return target


def update_packet_files(payload):
    packet_id = str(payload.get("id", "")).strip()
    if not packet_id:
        raise SystemExit("save-packet requires id")

    current_wp = load_yaml(CURRENT_WP_PATH, {})
    next_actions = load_yaml(NEXT_ACTIONS_PATH, {})
    wp_queue = load_yaml(WP_QUEUE_PATH, {})

    packet_payload = {
        "id": packet_id,
        "goal": str(payload.get("goal", "")).strip(),
        "status": str(payload.get("status", "")).strip() or "pending",
        "tier": str(payload.get("tier", "")).strip(),
        "stage": str(payload.get("stage", "")).strip(),
        "type": str(payload.get("type", "")).strip(),
        "depends_on": list(payload.get("depends_on") or []),
        "subtasks": list(payload.get("subtasks") or []),
        "validation": list(payload.get("validation") or []),
        "constraints": list(payload.get("constraints") or []),
        "next_unlock": str(payload.get("next_unlock", "")).strip(),
    }

    current_id = str(current_wp.get("id", "")).strip()
    if packet_id == current_id:
        merge_fields(current_wp, packet_payload)
        save_yaml(CURRENT_WP_PATH, current_wp)

    queue_items = next_actions.get("queue", [])
    if not isinstance(queue_items, list):
        queue_items = []
        next_actions["queue"] = queue_items

    queue_item = None
    for item in queue_items:
        if str(item.get("id", "")).strip() == packet_id:
            queue_item = item
            break
    if queue_item is None:
        queue_item = {"id": packet_id}
        queue_items.append(queue_item)
    merge_fields(queue_item, packet_payload)

    if payload.get("set_as_next") or str(next_actions.get("next_wp", "")).strip() == packet_id:
        next_actions["next_wp"] = packet_id
    if not next_actions.get("as_of"):
        next_actions["as_of"] = dt.date.today().isoformat()
    save_yaml(NEXT_ACTIONS_PATH, next_actions)

    for capability in wp_queue.get("capabilities", []) or []:
      for item in capability.get("work_packets", []) or []:
        if str(item.get("id", "")).strip() == packet_id:
          merge_fields(item, packet_payload)
    save_yaml(WP_QUEUE_PATH, wp_queue)


def update_sections_file(payload):
    sections_payload = payload.get("sections") or []
    if not isinstance(sections_payload, list) or not sections_payload:
        raise SystemExit("save-sections requires sections[]")

    current = load_yaml(PLANNER_DRAFT_PATH, {"updated_at": "", "sections": []})
    existing = {str(item.get("id", "")): item for item in current.get("sections", []) if item.get("id")}
    for item in sections_payload:
        section_id = str(item.get("id", "")).strip()
        if not section_id:
            continue
        entry = existing.get(section_id, {"id": section_id})
        if "title" in item:
            entry["title"] = item.get("title", "")
        if "tag" in item:
            entry["tag"] = item.get("tag", "")
        if "content" in item:
            entry["content"] = item.get("content", "")
        if "done" in item:
            entry["done"] = bool(item.get("done"))
        entry["updated_at"] = now_iso()
        existing[section_id] = entry

    ordered = sorted(existing.values(), key=lambda item: item.get("id", ""))
    save_yaml(PLANNER_DRAFT_PATH, {"updated_at": now_iso(), "sections": ordered})


def update_automation_file(payload):
    workers = payload.get("workers") or []
    if not isinstance(workers, list):
        raise SystemExit("save-automation requires workers[]")

    normalized_workers = []
    for index, worker in enumerate(workers, start=1):
        if not isinstance(worker, dict):
            continue
        prompt = str(worker.get("prompt", "")).strip()
        normalized_workers.append({
            "name": str(worker.get("name", f"Worker {index}")).strip() or f"Worker {index}",
            "plan_id": str(worker.get("plan_id", "")).strip(),
            "role_id": str(worker.get("role_id", "")).strip(),
            "role_label": str(worker.get("role_label", "")).strip(),
            "prompt": prompt,
        })

    data = {
        "updated_at": now_iso(),
        "enabled": bool(payload.get("enabled")),
        "cycle_minutes": int(payload.get("cycle_minutes") or 30),
        "enter_seconds": int(payload.get("enter_seconds") or 10),
        "workers": normalized_workers,
    }
    save_yaml(AUTOMATION_CONFIG_PATH, data)


def update_stage_run_file(payload):
    if not isinstance(payload, dict):
        raise SystemExit("save-stage-run requires object payload")

    requested_stage = str(payload.get("requested_stage", "")).strip().upper()
    if not requested_stage:
        raise SystemExit("save-stage-run requires requested_stage")

    data = dict(payload)
    data["requested_stage"] = requested_stage
    data["requested_module"] = str(payload.get("requested_module", "")).strip()
    data["recorded_at"] = now_iso()

    existing_history = load_yaml(STAGE_RUN_HISTORY_PATH, [])
    if not isinstance(existing_history, list):
        existing_history = []

    deduped_history = []
    for item in existing_history:
        if not isinstance(item, dict):
            continue
        if (
            str(item.get("requested_stage", "")).strip().upper() == data["requested_stage"]
            and str(item.get("requested_module", "")).strip() == data["requested_module"]
            and str(item.get("execution_mode", "")).strip() == str(data.get("execution_mode", "")).strip()
            and str(item.get("recorded_at", "")).strip() == str(data["recorded_at"]).strip()
        ):
            continue
        deduped_history.append(item)

    save_yaml(STAGE_RUN_REPORT_PATH, data)
    save_yaml(STAGE_RUN_HISTORY_PATH, [data, *deduped_history][:STAGE_RUN_HISTORY_LIMIT])


def regenerate_artifacts(*targets):
    commands = []
    if "home" in targets:
        commands.append(["node", "scripts/generate-ui-home.js"])
    for command in commands:
        subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def read_stdin_json():
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: planning_studio_api.py <snapshot|save-packet|save-sections|save-automation|save-stage-run>")

    command = sys.argv[1]
    if command == "snapshot":
        print(json.dumps(collect_snapshot(), ensure_ascii=False))
        return

    if command == "save-packet":
        payload = read_stdin_json()
        update_packet_files(payload)
        regenerate_artifacts("home")
        print(json.dumps(collect_snapshot(), ensure_ascii=False))
        return

    if command == "save-sections":
        payload = read_stdin_json()
        update_sections_file(payload)
        regenerate_artifacts("home")
        print(json.dumps(collect_snapshot(), ensure_ascii=False))
        return

    if command == "save-automation":
        payload = read_stdin_json()
        update_automation_file(payload)
        regenerate_artifacts("home")
        print(json.dumps(collect_snapshot(), ensure_ascii=False))
        return

    if command == "save-stage-run":
        payload = read_stdin_json()
        update_stage_run_file(payload)
        print(json.dumps(collect_snapshot(), ensure_ascii=False))
        return

    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    main()
