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
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CURRENT_STATE = ROOT / "memory/project/current-state.yaml"
NEXT_ACTIONS = ROOT / "memory/project/next-actions.yaml"
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


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_scalar(text: str, key: str, fallback: str = "UNKNOWN") -> str:
    match = re.search(rf"^{re.escape(key)}:\s*\"?([^\n\"]+)\"?\s*$", text, re.MULTILINE)
    return match.group(1).strip() if match else fallback


def extract_next_action(text: str) -> dict[str, str]:
    pattern = re.compile(
        r"- priority:\s*(?P<priority>\d+)\n"
        r"\s+id:\s*\"(?P<id>[^\"]+)\"\n"
        r"\s+track:\s*\"(?P<track>[^\"]+)\"\n"
        r"\s+action:\s*\"(?P<action>[^\"]+)\"\n"
        r"\s+done:\s*(?P<done>true|false)",
        re.MULTILINE,
    )
    for match in pattern.finditer(text):
        if match.group("done") == "false":
          return {
              "priority": match.group("priority"),
              "id": match.group("id"),
              "track": match.group("track"),
              "action": match.group("action"),
          }
    return {"priority": "NONE", "id": "NONE", "track": "NONE", "action": "NONE"}


def main() -> None:
    current_state_text = read_text(CURRENT_STATE)
    next_actions_text = read_text(NEXT_ACTIONS)

    evidence = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "repository": "my-module",
        "branch": run_git("branch", "--show-current"),
        "head_commit": run_git("rev-parse", "HEAD"),
        "last_completed_stage": extract_scalar(current_state_text, "last_completed_stage"),
        "quality_gate_result": extract_scalar(current_state_text, "quality_gate_result"),
        "next_action": extract_next_action(next_actions_text),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"release evidence written: {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
