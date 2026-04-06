#!/usr/bin/env python3
"""
Workflow OS HTTP 서버 — 포트 8080
artifacts/ 정적 서빙 + /api/* 라우팅
"""

import collections
import configparser
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import termios
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
VSCODE_CLI_DIR = ARTIFACTS_DIR / "vscode-cli-automation"
HOME_DATA_PATH = ARTIFACTS_DIR / "home-data.json"
PLANNING_API_SCRIPT = REPO_ROOT / "scripts" / "planning_studio_api.py"
SYSTEM_RUNTIME_LOG_PATH = REPO_ROOT / "worklog" / "system-os-runtime.jsonl"
PROMOTION_PIPELINE_REPORT_PATH = ARTIFACTS_DIR / "promotion-pipeline" / "latest" / "pipeline-report.json"
DECISION_APPLY_REPORT_PATH = ARTIFACTS_DIR / "decision-apply" / "latest" / "decision-apply-report.json"
CURRENT_WP_MEMORY_PATH = REPO_ROOT / "memory" / "current-wp.yaml"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".ahk": "text/plain; charset=utf-8",
    ".ini": "text/plain; charset=utf-8",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
}

# ── Automation Runtime State ──────────────────────────────────── #
_state_lock = threading.Lock()
_automation_runtime = {
    "running": False,
    "startedAt": None,
    "workers": [],
    "config": {
        "cycleSteps": 180,
        "intervalMs": 10000,
        "pasteMethod": "ctrlshiftv",
        "cycleMinutes": 30,
        "enterSeconds": 10,
    },
    "log": [],
}

# ── File Activity Watcher ─────────────────────────────────────── #
_activity_lock = threading.Lock()
_activity_store = {
    "events": collections.deque(maxlen=60),   # {ts, path, rel, kind}
    "mtimes": {},                              # rel_path → mtime
    "git_status": [],                          # [{status, path}]
    "git_updated_at": 0.0,
}

_WATCH_DIRS = ["domains", "scripts", "memory", "src", "requirements", "worklog"]
_WATCH_EXTS = {".js", ".ts", ".py", ".yaml", ".yml", ".json", ".md", ".txt", ".html"}
_IGNORE_PARTS = {
    "node_modules", ".git", "__pycache__", ".pytest_cache",
    "dist", "build", ".turbo",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _should_watch(path: Path) -> bool:
    parts = set(path.parts)
    if parts & _IGNORE_PARTS:
        return False
    return path.suffix.lower() in _WATCH_EXTS


def _file_watcher_loop():
    """Background thread: scans key dirs every 3s, records mtime changes."""
    while True:
        try:
            now_ts = time.time()
            now_iso = datetime.fromtimestamp(now_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            for watch_dir in _WATCH_DIRS:
                base = REPO_ROOT / watch_dir
                if not base.exists():
                    continue
                for p in base.rglob("*"):
                    if not p.is_file() or not _should_watch(p):
                        continue
                    try:
                        mtime = p.stat().st_mtime
                    except OSError:
                        continue
                    rel = str(p.relative_to(REPO_ROOT))
                    with _activity_lock:
                        prev = _activity_store["mtimes"].get(rel)
                        if prev is None:
                            _activity_store["mtimes"][rel] = mtime
                        elif mtime > prev + 0.5:
                            _activity_store["mtimes"][rel] = mtime
                            _activity_store["events"].appendleft({
                                "ts": now_iso,
                                "ts_epoch": now_ts,
                                "path": rel,
                                "name": p.name,
                                "kind": "edit",
                            })

            # Refresh git status every 10s
            with _activity_lock:
                git_age = now_ts - _activity_store["git_updated_at"]
            if git_age >= 10:
                try:
                    result = subprocess.run(
                        ["git", "status", "--porcelain", "-u"],
                        capture_output=True, text=True, timeout=6,
                        cwd=str(REPO_ROOT),
                    )
                    lines = []
                    for line in result.stdout.splitlines()[:30]:
                        if len(line) >= 3:
                            status = line[:2].strip()
                            path = line[3:].strip()
                            lines.append({"status": status or "M", "path": path})
                    with _activity_lock:
                        _activity_store["git_status"] = lines
                        _activity_store["git_updated_at"] = now_ts
                except Exception:
                    pass

        except Exception:
            pass

        time.sleep(3)


def _start_file_watcher():
    t = threading.Thread(target=_file_watcher_loop, daemon=True, name="file-watcher")
    t.start()


# ── Prompt Generator ─────────────────────────────────────────── #
def _generate_optimized_prompt(snapshot_bytes: bytes) -> str:
    try:
        snap = json.loads(snapshot_bytes)
    except Exception:
        return "계속"
    current_wp = snap.get("currentPlan") or {}
    next_wp    = snap.get("nextPlan")    or {}
    cwp_id     = current_wp.get("id", "")
    cwp_goal   = current_wp.get("goal", "")
    cwp_status = current_wp.get("status", "")
    nwp_id     = next_wp.get("id", "")
    nwp_goal   = next_wp.get("goal", "")
    validation = current_wp.get("validation") or []
    val_cmds   = "\n".join(f"  {v}" for v in validation[:3]) if validation else "  (없음)"
    if not cwp_id and not nwp_id:
        return "계속"
    lines = [
        "---",
        "# Workflow OS 자동 전송 프롬프트",
        f"# 생성: {utc_now().strftime('%Y-%m-%dT%H:%M:%S')}Z",
        "",
        "[현재 packet 종료 검토]",
    ]
    if cwp_id:
        lines += [f"현재 WP: {cwp_id} — {cwp_goal}", f"상태: {cwp_status}", "검증 명령:", val_cmds]
    else:
        lines.append("(없음)")
    lines += ["", "[다음 실행]"]
    if nwp_id:
        lines.append(f"다음 WP: {nwp_id} — {nwp_goal}")
        for s in (next_wp.get("subtasks") or [])[:4]:
            lines.append(f"  - {s}")
        lines += [
            "", "[실행 지시]",
            "1. 현재 packet 미완료 항목을 5줄 이하로 정리하세요.",
            "2. 다음 packet 시작 전 blocker와 dependency를 체크리스트로 나누세요.",
            "3. 바로 실행할 수정 순서를 짧게 제시한 뒤 실제 작업을 시작하세요.",
            "4. 설명만 하지 말고 구현/수정/검증까지 진행하세요.",
            "5. 마지막 응답에 실행한 검증 명령과 결과를 남기세요.",
        ]
    else:
        lines += ["(다음 WP 없음)", "", "계속"]
    return "\n".join(lines)


# ── VSCode Detection ──────────────────────────────────────────── #
def _clean_vscode_label(title: str) -> str:
    """'file.ahk - workspace [WSL: Ubuntu] - Visual Studio Code' → 'workspace'"""
    if not title:
        return ""
    label = title
    # Strip editor suffix first
    for suf in (" - Visual Studio Code", " - VSCodium", " - Cursor", " - Windsurf", " - Code"):
        idx = label.rfind(suf)
        if idx >= 0:
            label = label[:idx]
            break
    # Strip WSL tag
    label = re.sub(r"\s*\[WSL[^\]]*\]", "", label)
    label = label.strip()
    # VSCode titles are "open-file - workspace-name"; take only the last segment
    if " - " in label:
        label = label.rsplit(" - ", 1)[-1].strip()
    return label


def _detect_via_powershell():
    """Strategy 1: PowerShell Get-Process.  No multi-byte literals in script."""
    # NOTE: avoid Korean/CJK in the PS script itself — encoding issues in some WSL setups.
    ps = (
        "$names = 'Code','Code - Insiders','Cursor','Windsurf','codium';"
        "$r = foreach($n in $names){Get-Process -Name $n -EA 0};"
        "if($r){"
        "$r | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress"
        "}else{'[]'}"
    )
    try:
        out = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, timeout=10,
            encoding="utf-8", errors="replace",
        )
        raw = out.stdout.strip()
        if not raw or raw == "[]":
            return [], out.stderr.strip()
        data = json.loads(raw)
        if isinstance(data, dict):
            data = [data]
        results = []
        seen = set()
        for e in data:
            pid = e.get("Id") or e.get("id") or 0
            if not pid or pid in seen:
                continue
            seen.add(pid)
            title = e.get("MainWindowTitle") or e.get("mainWindowTitle") or ""
            proc  = e.get("ProcessName") or e.get("processName") or "Code"
            label = _clean_vscode_label(title) or proc
            results.append({
                "pid": pid,
                "title": title,
                "label": label,
                "proc": proc,
                "minimized": not bool(title),
                "source": "powershell",
            })
        return results, ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return [], "powershell.exe not available or timed out"
    except json.JSONDecodeError as exc:
        return [], f"JSON parse error: {exc}"
    except Exception as exc:
        return [], str(exc)


def _detect_via_tasklist():
    """Strategy 2: tasklist.exe — reliable even when PS title is blank."""
    EDITOR_EXE = {"code.exe", "code - insiders.exe", "cursor.exe", "windsurf.exe", "codium.exe"}
    try:
        out = subprocess.run(
            ["tasklist.exe", "/FI", "STATUS eq running", "/FO", "CSV", "/NH"],
            capture_output=True, timeout=8,
            encoding="utf-8", errors="replace",
        )
        results = []
        seen = set()
        for line in out.stdout.splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) < 2:
                continue
            name = parts[0].lower()
            if name not in EDITOR_EXE:
                continue
            try:
                pid = int(parts[1])
            except ValueError:
                continue
            if pid in seen:
                continue
            seen.add(pid)
            display_name = parts[0].replace(".exe", "").replace(".EXE", "")
            results.append({
                "pid": pid,
                "title": "",
                "label": display_name,
                "proc": display_name,
                "minimized": True,
                "source": "tasklist",
            })
        return results, ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return [], "tasklist.exe not available"
    except Exception as exc:
        return [], str(exc)


def _enrich_with_vscode_workspaces(terminals: list) -> None:
    """Strategy 3: read VSCode storage.json for recent workspace names."""
    try:
        users_root = Path("/mnt/c/Users")
        if not users_root.exists():
            return
        skip = {"Public", "Default", "All Users", "Default User"}
        user_dir = next(
            (d for d in users_root.iterdir() if d.is_dir() and d.name not in skip),
            None,
        )
        if not user_dir:
            return
        storage = user_dir / "AppData/Roaming/Code/User/globalStorage/storage.json"
        if not storage.exists():
            return
        data = json.loads(storage.read_text(encoding="utf-8", errors="replace"))
        opl = data.get("openedPathsList") or {}
        workspaces = []
        for entry in (opl.get("workspaces3") or opl.get("workspaces") or [])[:8]:
            if isinstance(entry, str):
                workspaces.append(Path(entry).name)
            elif isinstance(entry, dict):
                folder = (
                    entry.get("folderUri")
                    or (entry.get("workspace") or {}).get("configPath")
                    or ""
                )
                name = folder.rstrip("/").split("/")[-1].replace(".code-workspace", "")
                if name:
                    workspaces.append(name)

        # Annotate minimized terminals with workspace hints
        minimized = [t for t in terminals if t.get("minimized")]
        for i, t in enumerate(minimized):
            if i < len(workspaces):
                t["workspace_hint"] = workspaces[i]
    except Exception:
        pass


def detect_vscode_terminals():
    """
    WSL2 에서 실행 중인 VS Code 계열 창 탐지.
    - PowerShell: 창 제목(MainWindowTitle) 포함, 실제 VSCode 창 식별
    - tasklist.exe: PS 실패 시 폴백 (최소화·백그라운드 프로세스 포함)
    - storage.json: 워크스페이스 이름 보강
    """
    # 1단계: PowerShell (창 제목 포함)
    ps_all, ps_error = _detect_via_powershell()

    # windows = 창 제목이 있는 것 (실제로 사용 가능한 VSCode 창)
    windows   = [t for t in ps_all if not t.get("minimized")]
    bg_procs  = [t for t in ps_all if t.get("minimized")]

    # 2단계: PS 완전 실패 시 tasklist fallback
    tl_all, tl_error = [], ""
    if not ps_all:
        tl_all, tl_error = _detect_via_tasklist()
        windows  = tl_all   # tasklist는 창 제목을 모르므로 전부 표시
        bg_procs = []

    # 3단계: 워크스페이스 이름 보강
    _enrich_with_vscode_workspaces(windows + bg_procs)

    # UI에서 쓸 terminals = 창 제목 있는 것 우선, 없으면 전체
    terminals = windows if windows else (bg_procs or tl_all)

    return {
        "terminals": terminals,           # 실제로 선택 가능한 창 목록
        "windows": windows,               # 창 제목 있는 창
        "background_count": len(bg_procs),# 백그라운드 프로세스 수
        "count": len(terminals),
        "detected_at": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "strategy": "powershell" if ps_all else ("tasklist" if tl_all else "none"),
        "error": (ps_error or tl_error) if not terminals else None,
    }


def get_vscode_auto_health() -> dict:
    """
    VSCode 자동화 전체 진단: automation.ini + automation-state.ini + 창 탐지를
    하나의 API로 통합해 GO/NOGO 상태를 반환한다.
    """
    ini_path   = VSCODE_CLI_DIR / "automation.ini"
    state_path = VSCODE_CLI_DIR / "automation-state.ini"

    # ── 1. automation.ini 읽기 ──────────────────────────────────── #
    cfg = configparser.ConfigParser()
    cfg_ok = False
    if ini_path.exists():
        try:
            cfg.read(ini_path, encoding="utf-8")
            cfg_ok = True
        except Exception:
            pass

    enabled      = cfg.get("general", "enabled",      fallback="0") == "1" if cfg_ok else False
    cycle_min    = cfg.get("general", "cycle_minutes", fallback="30")       if cfg_ok else "30"
    enter_sec    = cfg.get("general", "enter_seconds", fallback="10")        if cfg_ok else "10"
    worker_count = int(cfg.get("general", "worker_count", fallback="0"))    if cfg_ok else 0

    # ── 2. automation-state.ini 읽기 (캡처된 좌표) ─────────────── #
    state = configparser.ConfigParser()
    state_ini_exists = state_path.exists()
    if state_ini_exists:
        try:
            state.read(state_path, encoding="utf-8")
        except Exception:
            pass

    # ── 3. worker 상태 ─────────────────────────────────────────── #
    workers_info = []
    prompts_dir  = VSCODE_CLI_DIR / "prompts"
    for i in range(1, worker_count + 1):
        sec = f"worker_{i}"
        name        = cfg.get(sec, "name",        fallback=f"Worker {i}") if cfg_ok else f"Worker {i}"
        plan_id     = cfg.get(sec, "plan_id",     fallback="")            if cfg_ok else ""
        role_label  = cfg.get(sec, "role_label",  fallback="")            if cfg_ok else ""
        prompt_file = cfg.get(sec, "prompt_file", fallback="")            if cfg_ok else ""

        prompt_ok  = bool(prompt_file) and (prompts_dir / prompt_file).exists()
        prompt_len = 0
        if prompt_ok:
            try:
                prompt_len = len((prompts_dir / prompt_file).read_text(encoding="utf-8").strip())
            except Exception:
                pass

        x = int(state.get(sec, "x", fallback="-1")) if state.has_section(sec) else -1
        y = int(state.get(sec, "y", fallback="-1")) if state.has_section(sec) else -1
        coord_ok = x >= 0 and y >= 0

        issues = []
        if not prompt_ok:
            issues.append("프롬프트 파일 없음" + (f" ({prompt_file})" if prompt_file else ""))
        elif prompt_len == 0:
            issues.append("프롬프트 파일 비어 있음")
        if not coord_ok:
            issues.append("F7 좌표 미캡처")

        workers_info.append({
            "index":       i,
            "name":        name,
            "plan_id":     plan_id,
            "role_label":  role_label,
            "prompt_file": prompt_file,
            "prompt_ok":   prompt_ok,
            "prompt_len":  prompt_len,
            "x": x, "y": y,
            "coord_ok":    coord_ok,
            "issues":      issues,
            "ready":       prompt_ok and coord_ok,
        })

    # ── 4. VSCode 창 탐지 ──────────────────────────────────────── #
    detection = detect_vscode_terminals()
    windows    = detection.get("windows", [])
    bg_count   = detection.get("background_count", 0)

    # AHK가 실제로 사용할 창 = 창 제목 있는 것 중 첫 번째
    ahk_target = windows[0] if windows else None

    # ── 5. 전체 이슈 집계 ──────────────────────────────────────── #
    issues = []
    if not cfg_ok:
        issues.append("automation.ini 없음 — 브리지 설정을 먼저 저장하세요")
    elif not enabled:
        issues.append("자동화 비활성 (enabled=0)")
    if not state_ini_exists and worker_count > 0:
        issues.append("automation-state.ini 없음 — F7 을 눌러 터미널 좌표를 캡처하세요 (자동 추정 모드로 동작 중)")
    if worker_count == 0:
        issues.append("worker 없음 — worker 수를 1 이상으로 설정하세요")
    if not windows:
        if bg_count > 0:
            issues.append(f"VS Code 창 없음 (백그라운드 {bg_count}개) — 창을 화면에 꺼내세요")
        else:
            issues.append("VS Code 창 없음 — VS Code를 여세요")
    for w in workers_info:
        for iss in w["issues"]:
            issues.append(f"Worker {w['index']} ({w['name']}): {iss}")

    all_workers_ready = all(w["ready"] for w in workers_info) if workers_info else False
    ready = cfg_ok and enabled and bool(windows) and all_workers_ready and worker_count > 0

    status = "GO" if ready else ("PARTIAL" if (cfg_ok and (windows or workers_info)) else "NOGO")

    # ── 6. 마지막 전송 시각 (AHK가 state.ini에 기록) ──────────── #
    last_send_ts_raw = state.get("status", "last_send_ts", fallback="") if state.has_section("status") else ""
    last_action      = state.get("status", "last_action",  fallback="") if state.has_section("status") else ""
    last_send_iso = ""
    if last_send_ts_raw and len(last_send_ts_raw) >= 14:
        try:
            dt = datetime.strptime(last_send_ts_raw[:14], "%Y%m%d%H%M%S")
            last_send_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass

    return {
        "status":          status,    # "GO" | "PARTIAL" | "NOGO"
        "ready":           ready,
        "issues":          issues,
        "config": {
            "ini_exists":       cfg_ok,
            "state_ini_exists": state_ini_exists,
            "enabled":          enabled,
            "cycle_minutes":    cycle_min,
            "enter_seconds":    enter_sec,
            "worker_count":     worker_count,
        },
        "workers":         workers_info,
        "vscode": {
            "windows":          windows,
            "background_count": bg_count,
            "ahk_target":       ahk_target,
            "strategy":         detection.get("strategy"),
        },
        "last_send": {
            "ts_raw": last_send_ts_raw,
            "ts_iso": last_send_iso,
            "action": last_action,
        },
        "checked_at": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ── Activity Feed ─────────────────────────────────────────────── #
def _read_audit_chain(limit: int = 15) -> list:
    audit_path = REPO_ROOT / "worklog" / "audit-chain.jsonl"
    entries = []
    try:
        if audit_path.exists():
            lines = audit_path.read_text(encoding="utf-8").splitlines()
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                    if len(entries) >= limit:
                        break
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    return entries


def append_system_runtime_event(action: str, payload: dict):
    payload = payload if isinstance(payload, dict) else {}
    ts = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    packet_id = str(payload.get("packet_id") or "").strip()
    source_packet_id = str(payload.get("source_packet_id") or "").strip()
    goal = str(payload.get("goal") or "").strip()
    worker = str(payload.get("worker") or payload.get("name") or "manual").strip() or "manual"
    subject_parts = [packet_id, goal, worker]
    subject = str(payload.get("subject") or "/".join(part for part in subject_parts if part) or action)
    trace_seed = source_packet_id or packet_id or goal or action or subject
    trace_id = str(payload.get("trace_id") or hashlib.sha256(trace_seed.encode("utf-8")).hexdigest()[:32])
    span_seed = f"{trace_seed}:{action}:{ts}:{worker}:{str(payload.get('pts') or '')}"
    span_id = str(payload.get("span_id") or hashlib.sha256(span_seed.encode("utf-8")).hexdigest()[:16])
    entry = {
        "ts": ts,
        "action": action,
        "specversion": "1.0",
        "id": span_id,
        "source": "workflow-os/system-runtime",
        "type": f"io.workflowos.runtime.{action}",
        "subject": subject,
        "time": ts,
        "trace_id": trace_id,
        "span_id": span_id,
        "payload": payload,
    }
    try:
        SYSTEM_RUNTIME_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with SYSTEM_RUNTIME_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def read_system_runtime_events(limit: int = 20) -> list:
    rows = []
    try:
        if SYSTEM_RUNTIME_LOG_PATH.exists():
            lines = SYSTEM_RUNTIME_LOG_PATH.read_text(encoding="utf-8").splitlines()
            for raw in reversed(lines):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                    if isinstance(event, dict):
                        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
                        action = str(event.get("action") or "event")
                        packet_id = str(payload.get("packet_id") or "").strip()
                        goal = str(payload.get("goal") or "").strip()
                        worker = str(payload.get("worker") or payload.get("name") or "manual").strip() or "manual"
                        ts = str(event.get("ts") or event.get("time") or utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"))
                        subject = str(event.get("subject") or "/".join(part for part in (packet_id, goal, worker) if part) or action)
                        trace_seed = packet_id or goal or action or subject
                        if "specversion" not in event:
                            event["specversion"] = "1.0"
                        if "source" not in event:
                            event["source"] = "workflow-os/system-runtime"
                        if "type" not in event:
                            event["type"] = f"io.workflowos.runtime.{action}"
                        if "subject" not in event:
                            event["subject"] = subject
                        if "time" not in event:
                            event["time"] = ts
                        if "trace_id" not in event:
                            event["trace_id"] = hashlib.sha256(trace_seed.encode("utf-8")).hexdigest()[:32]
                        if "span_id" not in event:
                            span_seed = f"{trace_seed}:{action}:{ts}:{worker}:{str(payload.get('pts') or '')}"
                            event["span_id"] = hashlib.sha256(span_seed.encode("utf-8")).hexdigest()[:16]
                    rows.append(event)
                    if len(rows) >= limit:
                        break
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    return rows


def extract_packet_id(prompt_text: str) -> str:
    match = re.search(r"\b(WP-[A-Z0-9-]+)\b", str(prompt_text or ""))
    return str(match.group(1)) if match else ""


def build_runtime_trace_id(packet_id: str = "", goal: str = "", source_packet_id: str = "", subject: str = "") -> str:
    seed = str(source_packet_id or packet_id or goal or subject or "workflow-os-runtime").strip()
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]


def summarize_runtime_event(event: dict) -> str:
    if not isinstance(event, dict):
        return "최근 실행 로그 없음"
    payload = event.get("payload") or {}
    ts = str(event.get("ts") or "time")
    action = str(event.get("action") or "event")
    worker = str(payload.get("worker") or "manual")
    packet_id = str(payload.get("packet_id") or "")
    pts = str(payload.get("pts") or "")
    trace_id = str(event.get("trace_id") or "")
    error = str(payload.get("error") or "").strip()
    ok = payload.get("ok")
    segments = [ts, action, worker]
    if packet_id:
        segments.append(packet_id)
    if trace_id:
        segments.append(f"trace:{trace_id[:8]}")
    if pts:
        segments.append(pts)
    if error:
        segments.append(f"error:{error}")
    elif ok is False:
        segments.append("error")
    elif ok is True:
        segments.append("ok")
    return " / ".join(filter(None, segments))


def build_runtime_correlation(current_packet_id: str, promotion_state: dict, runtime_events: list) -> dict:
    promoted_packet = promotion_state.get("promoted_packet") if isinstance(promotion_state.get("promoted_packet"), dict) else {}
    promoted_packet_id = str(promoted_packet.get("id") or "").strip()
    goal = str(promotion_state.get("goal") or "").strip()
    current_events = collect_packet_runtime_events(runtime_events, current_packet_id)
    promoted_events = collect_packet_runtime_events(runtime_events, promoted_packet_id)
    latest = runtime_events[0] if runtime_events else {}
    lineage_trace_id = build_runtime_trace_id(
        packet_id=promoted_packet_id,
        goal=goal,
        source_packet_id=current_packet_id,
        subject="promotion-lineage",
    )
    return {
        "current_packet_id": current_packet_id,
        "current_trace_id": str((current_events[0] or {}).get("trace_id") if current_events else ""),
        "current_event_count": len(current_events),
        "promoted_packet_id": promoted_packet_id,
        "promoted_trace_id": str((promoted_events[0] or {}).get("trace_id") if promoted_events else ""),
        "promoted_event_count": len(promoted_events),
        "lineage_trace_id": lineage_trace_id,
        "latest_subject": str((latest or {}).get("subject") or ""),
        "latest_trace_id": str((latest or {}).get("trace_id") or ""),
        "latest_type": str((latest or {}).get("type") or ""),
    }


def event_has_error(event: dict) -> bool:
    if not isinstance(event, dict):
        return False
    payload = event.get("payload") or {}
    return bool(str(payload.get("error") or "").strip() or payload.get("ok") is False)


def collect_packet_runtime_events(runtime_events: list, packet_id: str) -> list:
    normalized_packet_id = str(packet_id or "").strip()
    if not normalized_packet_id:
        return []
    return [
        item for item in (runtime_events or [])
        if str(((item.get("payload") or {}).get("packet_id") or "")).strip() == normalized_packet_id
    ]


def latest_validation_result(packet_events: list) -> dict | None:
    for item in packet_events or []:
        if str(item.get("action") or "") == "validation-result":
            return item
    return None


def derive_packet_lifecycle(packet_id: str, packet_status: str, runtime_events: list, pipeline: dict, lane: str,
                           promotion_state: dict | None = None) -> dict:
    normalized_status = str(packet_status or "").strip().lower()
    packet_events = collect_packet_runtime_events(runtime_events, packet_id)
    latest_event = packet_events[0] if packet_events else None
    latest_action = str((latest_event or {}).get("action") or "")
    latest_validation = latest_validation_result(packet_events)
    validation_outcome = str((((latest_validation or {}).get("payload") or {}).get("outcome") or "")).strip().lower()
    has_error = any(event_has_error(item) for item in packet_events)
    pipeline_clean = str((pipeline or {}).get("drift_status") or "") == "clean"
    promotion_state = promotion_state or {}
    decision_result = str(promotion_state.get("decision_result") or "").strip().lower()
    decision_gate = str(promotion_state.get("decision_gate") or "").strip().lower()
    promoted = decision_gate in {"applied", "promoted", "complete"} or (decision_result not in {"", "dry-run", "blocked"} and decision_result != "unknown")

    if has_error:
        phase = "blocked"
        detail = summarize_runtime_event(next((item for item in packet_events if event_has_error(item)), latest_event))
    elif validation_outcome == "fail":
        phase = "blocked"
        detail = summarize_runtime_event(latest_validation)
    elif promoted and normalized_status in {"completed", "done", "complete"}:
        phase = "promoted"
        detail = str(promotion_state.get("decision_result") or promotion_state.get("decision_gate") or "decision apply complete")
    elif validation_outcome == "pass" and normalized_status in {"completed", "done", "complete"} and bool(promotion_state.get("pipeline_ready")) and pipeline_clean:
        phase = "promotion-ready"
        detail = str(promotion_state.get("recommended_next_command") or "decision apply 단계로 넘길 준비 완료")
    elif validation_outcome == "pass":
        phase = "verified"
        detail = summarize_runtime_event(latest_validation)
    elif normalized_status in {"completed", "done", "complete"}:
        phase = "verified" if pipeline_clean else "completed"
        detail = "validation result pending / promotion drift clean" if pipeline_clean else "promotion drift 확인 필요"
    elif "prompt" in latest_action or "enter" in latest_action or normalized_status in {"in_progress", "active", "review"}:
        phase = "running"
        detail = summarize_runtime_event(latest_event)
    elif lane == "next":
        phase = "queued"
        detail = "다음 packet 대기열에서 실행 준비"
    else:
        phase = "planned"
        detail = "아직 runtime event 없음"

    return {
      "phase": phase,
      "detail": detail,
      "event_count": len(packet_events),
    }


def _load_yaml_file(path: Path):
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _load_json_file(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def to_web_artifact_path(raw_path: str) -> str:
    text = str(raw_path or "").strip()
    if not text:
        return ""
    try:
        path_obj = Path(text)
        if not path_obj.is_absolute():
            path_obj = (REPO_ROOT / path_obj).resolve()
        else:
            path_obj = path_obj.resolve()
        rel = path_obj.relative_to(ARTIFACTS_DIR.resolve())
        return "/" + str(rel).replace("\\", "/")
    except Exception:
        return ""


def summarize_handoff_bundle(handoff_bundle: dict) -> dict:
    payload = handoff_bundle if isinstance(handoff_bundle, dict) else {}
    current_packet = payload.get("current_packet") if isinstance(payload.get("current_packet"), dict) else {}
    context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else {}
    fit_report = payload.get("fit_report") if isinstance(payload.get("fit_report"), dict) else {}
    return {
        "current_packet_id": str(current_packet.get("id") or ""),
        "current_packet_goal": str(current_packet.get("goal") or ""),
        "current_packet_status": str(current_packet.get("status") or ""),
        "sequence_count": len(payload.get("sequence") or []),
        "read_first_count": len(context_bundle.get("read_first") or []),
        "read_next_count": len(context_bundle.get("read_next") or []),
        "protected_core_count": len(context_bundle.get("protected_core") or []),
        "fit_pass": int(((fit_report.get("counts") or {}).get("pass")) or 0),
        "fit_warn": int(((fit_report.get("counts") or {}).get("warn")) or 0),
        "fit_risk": int(((fit_report.get("counts") or {}).get("risk")) or 0),
    }


def build_handoff_starter_queue(promotion_state: dict) -> dict:
    state = promotion_state if isinstance(promotion_state, dict) else {}
    promoted_packet = state.get("promoted_packet") if isinstance(state.get("promoted_packet"), dict) else {}
    handoff_summary = state.get("handoff_summary") if isinstance(state.get("handoff_summary"), dict) else {}
    handoff_commands = state.get("handoff_commands") if isinstance(state.get("handoff_commands"), dict) else {}
    promoted_packet_id = str(promoted_packet.get("id") or "")
    source_packet_id = str(handoff_summary.get("current_packet_id") or "")
    trace_id = build_runtime_trace_id(
        packet_id=promoted_packet_id,
        goal=str(state.get("goal") or ""),
        source_packet_id=source_packet_id,
        subject="handoff-starter",
    )
    command_list = []
    for command in list(handoff_commands.values()) + list(promoted_packet.get("validation") or [])[:3]:
        text = str(command or "").strip()
        if text and text not in command_list:
            command_list.append(text)

    prompt_lines = [
        "[Promoted Packet Handoff]",
        "goal: " + str(state.get("goal") or "unknown"),
        "source packet: " + str(handoff_summary.get("current_packet_id") or "NONE"),
        "promoted packet: " + (promoted_packet_id or "NONE"),
        "status: " + str(promoted_packet.get("status") or "unknown"),
        "next unlock: " + str(promoted_packet.get("next_unlock") or "없음"),
    ]
    if command_list:
        prompt_lines.append("")
        prompt_lines.append("[Starter Commands]")
        prompt_lines.extend(f"{index + 1}. {command}" for index, command in enumerate(command_list))

    auto_reservations = []
    if command_list:
        auto_reservations.append({
            "id": "first-prompt",
            "label": "첫 실행 프롬프트",
            "kind": "prompt",
            "trace_id": trace_id,
            "packet_id": promoted_packet_id,
            "source_packet_id": source_packet_id,
            "commands": command_list[:3],
            "prompt": "\n".join(prompt_lines),
        })
    validation_commands = [command for command in (promoted_packet.get("validation") or []) if str(command or "").strip()]
    if validation_commands:
        auto_reservations.append({
            "id": "first-validation",
            "label": "첫 검증 세트",
            "kind": "validation",
            "trace_id": trace_id,
            "packet_id": promoted_packet_id,
            "source_packet_id": source_packet_id,
            "commands": validation_commands[:3],
            "prompt": "\n".join([
                "[Promoted Packet Validation]",
                "packet: " + (promoted_packet_id or "NONE"),
                "trace: " + trace_id,
                *[f"{index + 1}. {command}" for index, command in enumerate(validation_commands[:3])],
            ]),
        })

    return {
        "label": "Promoted Handoff · " + (promoted_packet_id or "NONE"),
        "packet_id": promoted_packet_id,
        "trace_id": trace_id,
        "commands": command_list,
        "prompt": "\n".join(prompt_lines),
        "next_unlock": str(promoted_packet.get("next_unlock") or ""),
        "source_packet_id": str(handoff_summary.get("current_packet_id") or ""),
        "source_packet_status": str(handoff_summary.get("current_packet_status") or ""),
        "auto_reservations": auto_reservations,
    }


def regenerate_home_artifacts() -> dict:
    try:
        result = subprocess.run(
            ["node", "scripts/generate-ui-home.js"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    if result.returncode != 0:
        return {
            "ok": False,
            "error": (result.stderr or result.stdout or "generate-ui-home failed").strip(),
        }
    return {"ok": True}


def load_promotion_state() -> dict:
    pipeline_report = _load_json_file(PROMOTION_PIPELINE_REPORT_PATH)
    decision_apply_report = _load_json_file(DECISION_APPLY_REPORT_PATH)
    handoff_bundle = _load_json_file(ARTIFACTS_DIR / "decision-apply" / "latest" / "handoff-bundle.json")
    promoted_packet = _load_yaml_file(ARTIFACTS_DIR / "decision-apply" / "latest" / "promoted-packet.yaml")
    artifacts = decision_apply_report.get("artifacts") if isinstance(decision_apply_report.get("artifacts"), dict) else {}
    artifact_links = {
        key: to_web_artifact_path(value)
        for key, value in artifacts.items()
        if to_web_artifact_path(value)
    }
    return {
        "goal": str(decision_apply_report.get("goal") or pipeline_report.get("goal") or ""),
        "pipeline_ready": bool(pipeline_report.get("promotion_ready")),
        "pipeline_result": str(pipeline_report.get("result") or ""),
        "decision_ready": bool(decision_apply_report.get("ready_to_apply")),
        "decision_gate": str(decision_apply_report.get("decision_gate") or ""),
        "decision_result": str(decision_apply_report.get("result") or ""),
        "recommended_next_command": str(decision_apply_report.get("recommended_next_command") or ""),
        "artifacts": artifacts,
        "artifact_links": artifact_links,
        "commands": decision_apply_report.get("commands") if isinstance(decision_apply_report.get("commands"), dict) else {},
        "handoff_sequence": handoff_bundle.get("sequence") if isinstance(handoff_bundle.get("sequence"), list) else [],
        "handoff_commands": handoff_bundle.get("commands") if isinstance(handoff_bundle.get("commands"), dict) else {},
        "handoff_summary": summarize_handoff_bundle(handoff_bundle),
        "promoted_packet": promoted_packet if isinstance(promoted_packet, dict) else {},
    }


def run_decision_apply_bridge(apply: bool = False) -> dict:
    current_wp = _load_yaml_file(CURRENT_WP_MEMORY_PATH)
    source_packet_id = str(current_wp.get("id") or "")
    source_goal = str(current_wp.get("goal") or "")
    trace_id = build_runtime_trace_id(
        packet_id=source_packet_id,
        goal=source_goal,
        source_packet_id=source_packet_id,
        subject="decision-apply",
    )
    cmd = [sys.executable, str(REPO_ROOT / "scripts" / "run_decision_apply.py"), "--json"]
    if apply:
        cmd.insert(-1, "--apply")
    result = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "decision apply failed").strip())
    payload = json.loads(result.stdout or "{}")
    append_system_runtime_event("decision-apply-run", {
        "packet_id": str(payload.get("promoted_packet_id") or ""),
        "source_packet_id": source_packet_id,
        "goal": str(payload.get("goal") or ""),
        "apply": bool(apply),
        "result": str(payload.get("result") or ""),
        "decision_gate": str(payload.get("decision_gate") or ""),
        "trace_id": trace_id,
        "ok": str(payload.get("result") or "") in {"dry-run", "applied"},
        "error": "" if str(payload.get("result") or "") in {"dry-run", "applied"} else str(payload.get("reason") or ""),
    })
    payload["home_refresh"] = regenerate_home_artifacts()
    updated_promotion_state = load_promotion_state()
    payload["handoff_starter_queue"] = build_handoff_starter_queue(updated_promotion_state)
    if apply and str(payload.get("result") or "").strip().lower() == "applied":
        starter_queue = payload.get("handoff_starter_queue") if isinstance(payload.get("handoff_starter_queue"), dict) else {}
        append_system_runtime_event("handoff-queue-prepared", {
            "packet_id": str(starter_queue.get("packet_id") or payload.get("promoted_packet_id") or ""),
            "source_packet_id": str(starter_queue.get("source_packet_id") or source_packet_id),
            "trace_id": str(starter_queue.get("trace_id") or trace_id),
            "goal": str(payload.get("goal") or ""),
            "commands": starter_queue.get("commands") if isinstance(starter_queue.get("commands"), list) else [],
            "next_unlock": str(starter_queue.get("next_unlock") or ""),
            "ok": True,
            "error": "",
        })
        for reservation in starter_queue.get("auto_reservations") or []:
            if not isinstance(reservation, dict):
                continue
            append_system_runtime_event("handoff-reservation-created", {
                "packet_id": str(reservation.get("packet_id") or ""),
                "source_packet_id": str(reservation.get("source_packet_id") or source_packet_id),
                "trace_id": str(reservation.get("trace_id") or trace_id),
                "reservation_id": str(reservation.get("id") or ""),
                "kind": str(reservation.get("kind") or ""),
                "commands": reservation.get("commands") if isinstance(reservation.get("commands"), list) else [],
                "ok": True,
                "error": "",
            })
    return payload


def build_menu_contract_index(home_payload: dict) -> list:
    menu_items = (((home_payload or {}).get("menuExplorerData") or {}).get("items") or [])
    index = []
    for item in menu_items:
        if not isinstance(item, dict):
            continue
        ui_contract_path = str(item.get("uiContractPath") or "")
        capability_contract_path = str(item.get("capabilityContractPath") or "")
        stage_memory_ref = str(item.get("stageMemoryRef") or "")
        roots = set()
        for raw_path in (ui_contract_path, capability_contract_path):
            if raw_path.startswith("domains/"):
                path_obj = Path(raw_path)
                parts = path_obj.parts
                if "contract" in parts:
                    contract_index = parts.index("contract")
                    roots.add(str(Path(*parts[:contract_index])).replace("\\", "/") + "/")
                elif "contracts" in parts:
                    contract_index = parts.index("contracts")
                    roots.add(str(Path(*parts[:contract_index])).replace("\\", "/") + "/")
        route_tokens = [token for token in re.split(r"[^a-z0-9]+", str(item.get("route") or "").lower()) if token]
        module_tokens = [token for token in re.split(r"[^a-z0-9]+", str(item.get("moduleId") or "").lower()) if token]
        label_tokens = [token for token in re.split(r"[^a-z0-9가-힣]+", str(item.get("label") or "").lower()) if len(token) >= 2]
        index.append({
            "id": str(item.get("id") or ""),
            "label": str(item.get("label") or ""),
            "plugin_id": str(item.get("pluginId") or ""),
            "group_label": str(item.get("groupLabel") or ""),
            "route": str(item.get("route") or ""),
            "ui_contract_path": ui_contract_path,
            "capability_contract_path": capability_contract_path,
            "stage_memory_ref": stage_memory_ref,
            "roots": sorted(roots),
            "module_tokens": module_tokens + route_tokens + label_tokens,
            "validation_commands": [
                str(entry.get("command") or "").strip()
                for entry in (item.get("verificationCommands") or [])
                if isinstance(entry, dict) and str(entry.get("command") or "").strip()
            ],
            "capability_ids": [
                str(entry.get("id") or "").strip()
                for entry in (item.get("capabilityContracts") or [])
                if isinstance(entry, dict) and str(entry.get("id") or "").strip()
            ],
        })
    return index


def match_menu_items_for_path(changed_path: str, menu_index: list) -> list:
    changed = str(changed_path or "")
    changed_lower = changed.lower()
    scored = []
    for item in menu_index:
        score = 0
        if changed and changed == item.get("ui_contract_path"):
            score += 120
        if changed and changed == item.get("capability_contract_path"):
            score += 120
        if changed and changed == item.get("stage_memory_ref"):
            score += 80
        for root in item.get("roots") or []:
            if root and changed.startswith(root):
                score += 60
        if "/contract" in changed or "/contracts" in changed:
            if item.get("ui_contract_path") and changed.startswith(str(Path(item["ui_contract_path"]).parent).replace("\\", "/")):
                score += 70
            if item.get("capability_contract_path") and changed.startswith(str(Path(item["capability_contract_path"]).parent).replace("\\", "/")):
                score += 70
        for token in item.get("module_tokens") or []:
            if token and token in changed_lower:
                score += 10
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda entry: (-entry[0], entry[1].get("label", "")))
    return [item for _, item in scored[:3]]


def build_contract_drift_causes(live: dict, home_payload: dict) -> list:
    menu_index = build_menu_contract_index(home_payload)
    changed_rows = []
    for entry in (live.get("git_status") or []):
        changed_path = str(entry.get("path", ""))
        if not changed_path:
            continue
        if not any(token in changed_path for token in ("/contract", "/contracts", "requirements/", "openapi", "capability.yaml")):
            continue
        matches = match_menu_items_for_path(changed_path, menu_index)
        changed_rows.append({
            "path": changed_path,
            "menus": [
                {
                    "label": item.get("label", ""),
                    "route": item.get("route", ""),
                    "contracts": [value for value in [item.get("ui_contract_path"), item.get("capability_contract_path")] if value],
                    "validation_commands": item.get("validation_commands", [])[:3],
                    "capability_ids": item.get("capability_ids", [])[:3],
                }
                for item in matches
            ],
            "validation_chain": matches[0].get("validation_commands", [])[:3] if matches else [],
        })
    return changed_rows[:6]


def build_drift_control(report: dict, live: dict, scheduler_state: dict, vscode_health: dict) -> list:
    home_payload = _load_home_payload()
    pipeline = report.get("promotion_pipeline") or {}
    git_changes = len(live.get("git_status") or [])
    scheduler_running = bool(scheduler_state.get("running"))
    vscode_ready = bool(vscode_health.get("ready"))
    contract_related = [
        entry for entry in (live.get("git_status") or [])
        if "/contract" in str(entry.get("path", "")) or "requirements/" in str(entry.get("path", "")) or "openapi" in str(entry.get("path", ""))
    ]
    runtime_events = read_system_runtime_events(limit=40)
    latest_runtime_error = next((
        item for item in runtime_events
        if isinstance(item, dict) and (
            str((item.get("payload") or {}).get("error") or "").strip()
            or (item.get("payload") or {}).get("ok") is False
        )
    ), None)
    contract_drift_causes = build_contract_drift_causes(live, home_payload)
    for cause in contract_drift_causes:
        if isinstance(cause, dict):
            packet_id = str(cause.get("packet_id") or "")
            cause["trace_id"] = build_runtime_trace_id(packet_id=packet_id, source_packet_id=packet_id, subject="contract-drift")
    runtime_error_count = sum(1 for item in runtime_events if isinstance(item, dict) and (
        str((item.get("payload") or {}).get("error") or "").strip()
        or (item.get("payload") or {}).get("ok") is False
    ))
    return [
        {
            "id": "contract-drift",
            "label": "Contract Drift",
            "status": "ready" if len(contract_related) == 0 else "partial",
            "value": f"{len(contract_related)} candidates",
            "detail": (
                "clean"
                if len(contract_related) == 0
                else "changed: " + ", ".join(str(item.get("path", "")) for item in contract_related[:3])
            ),
            "causes": contract_drift_causes,
        },
        {
            "id": "promotion-drift",
            "label": "Promotion Drift",
            "status": "ready" if str(pipeline.get("drift_status", "")) == "clean" else "attention",
            "value": str(pipeline.get("drift_status", "unknown")),
            "detail": f"locked tokens {int(pipeline.get('locked_tokens', 0))} / changed {int(pipeline.get('changed_files', 0))} / missing {int(pipeline.get('missing_files', 0))}",
        },
        {
            "id": "working-tree",
            "label": "Working Tree",
            "status": "partial" if git_changes > 0 else "ready",
            "value": f"{git_changes} changes",
            "detail": live.get("summary", ""),
            "causes": [
                {"path": str(entry.get("path", "")), "trace_id": ""}
                for entry in (live.get("git_status") or [])[:5]
                if str(entry.get("path", ""))
            ],
        },
        {
            "id": "runtime-bridge",
            "label": "Runtime Bridge",
            "status": "ready" if scheduler_running or vscode_ready else "partial",
            "value": "scheduler on" if scheduler_running else ("vscode ready" if vscode_ready else "manual bridge"),
            "detail": f"vscode {vscode_health.get('status', 'NOGO')} / scheduler {'running' if scheduler_running else 'stopped'}",
        },
        {
            "id": "runtime-drift",
            "label": "Runtime Drift",
            "status": "ready" if runtime_error_count == 0 else "attention",
            "value": f"{runtime_error_count} errors",
            "detail": (
                "최근 runtime event 로그에서 error 또는 ok=false 없음"
                if runtime_error_count == 0
                else summarize_runtime_event(latest_runtime_error)
            ),
            "causes": ([] if runtime_error_count == 0 else [{
                "packet_id": str(((latest_runtime_error or {}).get("payload") or {}).get("packet_id") or ""),
                "path": str(((latest_runtime_error or {}).get("payload") or {}).get("pts") or ""),
                "trace_id": str((latest_runtime_error or {}).get("trace_id") or ""),
            }]),
        },
    ]


def build_packet_execution_view(report: dict, snapshot: dict, scheduler_state: dict) -> list:
    current_wp = snapshot.get("current_wp") or {}
    next_actions = snapshot.get("next_actions") or {}
    active_packets = snapshot.get("active_packets") or []
    next_id = str(next_actions.get("next_wp", "")).strip()
    next_packet = next((item for item in active_packets if str(item.get("id", "")) == next_id), None)
    last_activity = scheduler_state.get("last_activity") or {}
    pipeline = report.get("promotion_pipeline") or {}
    promotion_state = load_promotion_state()
    runtime_events = read_system_runtime_events(limit=20)
    latest_runtime_event = runtime_events[0] if runtime_events else None
    latest_prompt_event = next((
        item for item in runtime_events
        if "prompt" in str(item.get("action", "")) or str((item.get("payload") or {}).get("action", "")) == "prompt"
    ), latest_runtime_event)
    current_packet_id = str(current_wp.get("id", "") or report.get("current_wp", "NONE"))
    latest_current_packet_event = next((
        item for item in runtime_events
        if str(((item.get("payload") or {}).get("packet_id") or "")).strip() == current_packet_id
    ), latest_prompt_event)
    latest_runtime_packet_id = str((last_activity or {}).get("packet_id") or "")
    current_lifecycle = derive_packet_lifecycle(current_packet_id, str(current_wp.get("status", "") or ""), runtime_events, pipeline, "current", promotion_state)
    next_lifecycle = derive_packet_lifecycle(next_id, str((next_packet or {}).get("status", "") or ""), runtime_events, pipeline, "next", promotion_state)
    runtime_lifecycle = derive_packet_lifecycle(
        latest_runtime_packet_id,
        str(last_activity.get("action", "") or ""),
        runtime_events,
        pipeline,
        "runtime",
        promotion_state,
    ) if latest_runtime_packet_id else {
        "phase": "idle",
        "detail": "현재 연결된 packet runtime 없음",
        "event_count": 0,
    }
    return [
        {
            "lane": "current",
            "label": "현재 packet",
            "id": str(current_wp.get("id", "") or report.get("current_wp", "NONE")),
            "summary": str(current_wp.get("goal", "") or report.get("current_wp_goal", "현재 목표 미정")),
            "status": str(current_wp.get("status", "") or "unknown"),
            "validation": current_wp.get("validation") or [],
            "result": str(current_wp.get("result", "") or "최근 실행 결과 없음"),
            "next_unlock": str(current_wp.get("next_unlock", "") or "다음 unlock 정보 없음"),
            "runtime_event": summarize_runtime_event(latest_current_packet_event),
            "trace_id": str((latest_current_packet_event or {}).get("trace_id") or ""),
            "event_subject": str((latest_current_packet_event or {}).get("subject") or ""),
            "phase": current_lifecycle["phase"],
            "phase_detail": current_lifecycle["detail"],
            "event_count": current_lifecycle["event_count"],
            "promotion_state": promotion_state,
        },
        {
            "lane": "next",
            "label": "다음 packet",
            "id": next_id or report.get("next_wp", "NONE"),
            "summary": str((next_packet or {}).get("goal", "") or "다음 목표 미정"),
            "status": str((next_packet or {}).get("status", "") or "unknown"),
            "validation": (next_packet or {}).get("validation") or [],
            "result": str((next_packet or {}).get("result", "") or "아직 실행 결과 없음"),
            "next_unlock": str((next_packet or {}).get("next_unlock", "") or "후속 unlock 정보 없음"),
            "runtime_event": (
                "scheduler queued"
                if bool(scheduler_state.get("running"))
                else "다음 packet은 아직 runtime queue에 없음"
            ),
            "trace_id": str((collect_packet_runtime_events(runtime_events, next_id)[0] or {}).get("trace_id") if next_id and collect_packet_runtime_events(runtime_events, next_id) else ""),
            "event_subject": str((collect_packet_runtime_events(runtime_events, next_id)[0] or {}).get("subject") if next_id and collect_packet_runtime_events(runtime_events, next_id) else ""),
            "phase": next_lifecycle["phase"],
            "phase_detail": next_lifecycle["detail"],
            "event_count": next_lifecycle["event_count"],
        },
        {
            "lane": "runtime",
            "label": "현재 실행 초점",
            "id": str(last_activity.get("worker", "") or "manual"),
            "summary": str(last_activity.get("active_issue", "") or "최근 실행 초점 없음"),
            "status": str(last_activity.get("action", "") or "idle"),
            "validation": [],
            "result": str(last_activity.get("prompt_preview", "") or "최근 프롬프트 없음"),
            "next_unlock": "다음 unlock은 현재 packet/next packet 카드에서 확인",
            "runtime_event": summarize_runtime_event(latest_runtime_event),
            "packet_id": latest_runtime_packet_id or str(((latest_runtime_event or {}).get("payload") or {}).get("packet_id") or ""),
            "trace_id": str((latest_runtime_event or {}).get("trace_id") or ""),
            "event_subject": str((latest_runtime_event or {}).get("subject") or ""),
            "phase": runtime_lifecycle["phase"],
            "phase_detail": runtime_lifecycle["detail"],
            "event_count": runtime_lifecycle["event_count"],
        },
    ]


# 온디맨드 스캔 캐시 (5초)
_scan_cache: dict = {"result": None, "ts": 0.0}
_scan_lock = threading.Lock()


def _scan_recent_files(window_secs: int = 300) -> list:
    """
    요청 시점 기준으로 최근 window_secs 초 안에 수정된 파일을 직접 스캔한다.
    서버 시작 전에 수정된 파일도 잡는다 — 파일 워처의 "시작 이후만" 한계를 보완.
    """
    now = time.time()
    results = []
    for watch_dir in _WATCH_DIRS:
        base = REPO_ROOT / watch_dir
        if not base.exists():
            continue
        try:
            for p in base.rglob("*"):
                if not p.is_file() or not _should_watch(p):
                    continue
                try:
                    mtime = p.stat().st_mtime
                except OSError:
                    continue
                if now - mtime > window_secs:
                    continue
                rel = str(p.relative_to(REPO_ROOT))
                results.append({
                    "ts": datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "ts_epoch": mtime,
                    "path": rel,
                    "name": p.name,
                    "kind": "edit",
                })
        except Exception:
            continue
    results.sort(key=lambda x: -x["ts_epoch"])
    return results


def _get_git_status_fresh() -> list:
    """git status를 직접 실행해서 반환. 결과는 _activity_store에도 캐시."""
    with _activity_lock:
        git_age = time.time() - _activity_store["git_updated_at"]
        if git_age < 8:
            return list(_activity_store["git_status"])
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "-u"],
            capture_output=True, text=True, timeout=6, cwd=str(REPO_ROOT),
        )
        lines = []
        for line in result.stdout.splitlines()[:40]:
            if len(line) >= 3:
                st = line[:2].strip() or "M"
                path = line[3:].strip()
                # skip untracked artifacts/binary
                if path.startswith("artifacts/") and not path.endswith((".html", ".json", ".yaml")):
                    continue
                lines.append({"status": st, "path": path})
        with _activity_lock:
            _activity_store["git_status"] = lines
            _activity_store["git_updated_at"] = time.time()
        return lines
    except Exception:
        return []


def get_live_activity():
    """
    실시간 활동 피드 — 3-레이어 조합:
    1. 온디맨드 파일 스캔 (최근 5분): 서버 재시작 없이도 즉시 동작
    2. Git 상태: 워킹트리 전체 변경 파일
    3. Audit chain: 완료된 작업 기록
    파일 워처 이벤트도 병합해 더 짧은 시간 단위로 보완.
    """
    now = time.time()
    now_iso = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── 1. 파일 스캔 (캐시 5초) ──────────────────────────────────
    with _scan_lock:
        if now - _scan_cache["ts"] >= 5:
            _scan_cache["result"] = _scan_recent_files(window_secs=300)
            _scan_cache["ts"] = now
        scanned = list(_scan_cache["result"] or [])

    # 파일 워처 이벤트도 병합 (중복 제거: 더 최신 mtime 우선)
    with _activity_lock:
        watcher_events = list(_activity_store["events"])
    combined: dict = {e["path"]: e for e in scanned}
    for e in watcher_events:
        if e["path"] not in combined or e["ts_epoch"] > combined[e["path"]]["ts_epoch"]:
            combined[e["path"]] = e

    all_files = sorted(combined.values(), key=lambda x: -x["ts_epoch"])

    active = [e for e in all_files if now - e["ts_epoch"] < 90][:10]
    recent = [e for e in all_files if 90 <= now - e["ts_epoch"] < 300][:10]

    # ── 2. Git 상태 ───────────────────────────────────────────────
    git_status = _get_git_status_fresh()

    # ── 3. Audit chain ────────────────────────────────────────────
    audit_entries = _read_audit_chain(limit=10)

    # ── 요약 줄 ──────────────────────────────────────────────────
    if active:
        top = active[0]["name"]
        summary = f"편집 중: {top}" + (f" 외 {len(active)-1}개" if len(active) > 1 else "")
    elif git_status:
        summary = f"변경 파일 {len(git_status)}개 (git status 기준)"
    elif audit_entries:
        summary = audit_entries[0].get("action", "작업 기록 있음")
    else:
        summary = "대기 중 — 파일 변경 없음"

    return {
        "fetched_at": now_iso,
        "summary": summary,
        "active_edits": active,
        "recent_changes": recent,
        "git_status": git_status,
        "audit_entries": audit_entries,
    }


def _load_home_payload() -> dict:
    try:
        return json.loads(HOME_DATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _system_layer_dynamic_state(layer: dict, report: dict, snapshot: dict, live: dict,
                                pty_payload: dict, vscode_health: dict, scheduler_state: dict) -> dict:
    layer_id = str(layer.get("id", ""))
    current_wp = str((snapshot.get("current_wp") or {}).get("id", "") or report.get("current_wp", ""))
    next_wp = str((snapshot.get("next_actions") or {}).get("next_wp", "") or report.get("next_wp", ""))

    if layer_id == "planning-truth":
        sections = ((snapshot.get("planner_sections_draft") or {}).get("sections") or [])
        ready = bool(current_wp) and bool(next_wp or report.get("next_wp"))
        return {
            "status": "ready" if ready else "partial",
            "note": f"current {current_wp or 'NONE'} / next {next_wp or 'NONE'} / roadmap notes {len(sections)}개",
            "signals": [
                {"label": "current_wp", "value": current_wp or "NONE"},
                {"label": "next_wp", "value": next_wp or "NONE"},
                {"label": "roadmap_notes", "value": len(sections)},
            ],
        }

    if layer_id == "contract-mesh":
        portfolio = report.get("requirements_portfolio") or {}
        capabilities = report.get("capabilities") or []
        menus = (( _load_home_payload().get("menuExplorerData") or {}).get("items") or [])
        ready = int(portfolio.get("total_modules", 0)) > 0 and len(capabilities) > 0
        return {
            "status": "ready" if ready else "partial",
            "note": f"modules {portfolio.get('total_modules', 0)} / capabilities {len(capabilities)} / menus {len(menus)}",
            "signals": [
                {"label": "modules", "value": int(portfolio.get("total_modules", 0))},
                {"label": "capabilities", "value": len(capabilities)},
                {"label": "menus", "value": len(menus)},
            ],
        }

    if layer_id == "runtime-bridge":
        pty_count = int(pty_payload.get("count", 0))
        scheduler_running = bool(scheduler_state.get("running"))
        vscode_ready = bool(vscode_health.get("ready"))
        direct_ready = pty_count > 0
        ready = direct_ready
        return {
            "status": "ready" if ready else ("partial" if pty_count > 0 else "attention"),
            "note": f"direct {'ready' if direct_ready else 'wait'} / scheduler {'on' if scheduler_running else 'off'} / vscode {'ready' if vscode_ready else 'check'}",
            "signals": [
                {"label": "pty_sessions", "value": pty_count},
                {"label": "direct_bridge", "value": "ready" if direct_ready else "wait"},
                {"label": "scheduler", "value": "running" if scheduler_running else "stopped"},
                {"label": "vscode_auto", "value": vscode_health.get("status", "NOGO")},
            ],
        }

    if layer_id == "observability-loop":
        active_edits = len(live.get("active_edits") or [])
        git_changes = len(live.get("git_status") or [])
        audit_entries = len(live.get("audit_entries") or [])
        runtime_events = len(read_system_runtime_events(limit=20))
        ready = audit_entries > 0 and git_changes >= 0
        return {
            "status": "ready" if ready else "partial",
            "note": f"active edits {active_edits} / git changes {git_changes} / audit entries {audit_entries} / runtime events {runtime_events}",
            "signals": [
                {"label": "active_edits", "value": active_edits},
                {"label": "git_changes", "value": git_changes},
                {"label": "audit_entries", "value": audit_entries},
                {"label": "runtime_events", "value": runtime_events},
            ],
        }

    if layer_id == "promotion-safety":
        pipeline = report.get("promotion_pipeline") or {}
        ready = bool(pipeline.get("available")) and str(pipeline.get("drift_status", "")) == "clean"
        return {
            "status": "ready" if ready else ("partial" if pipeline.get("available") else "attention"),
            "note": f"pipeline {'ready' if pipeline.get('promotion_ready') else 'hold'} / drift {pipeline.get('drift_status', 'unknown')}",
            "signals": [
                {"label": "pipeline", "value": "available" if pipeline.get("available") else "missing"},
                {"label": "drift", "value": pipeline.get("drift_status", "unknown")},
                {"label": "locked_tokens", "value": int(pipeline.get("locked_tokens", 0))},
            ],
        }

    return {
        "status": str(layer.get("status", "attention")),
        "note": str(layer.get("note", "")),
        "signals": [],
    }


def build_system_os_status() -> dict:
    home_payload = _load_home_payload()
    report = home_payload.get("report", {}) if isinstance(home_payload, dict) else {}
    live = get_live_activity()
    pty_payload = list_pty_sessions()
    vscode_health = get_vscode_auto_health()
    promotion_state = load_promotion_state()
    code, out, _ = call_planning_studio_api("snapshot")
    try:
        snapshot = json.loads(out) if code == 0 else {}
    except Exception:
        snapshot = {}

    with _pty_sched_lock:
        scheduler_state = {
            "running": _pty_sched["running"],
            "started_at": _pty_sched["started_at"],
            "worker_count": len(_pty_sched["workers"]),
            "last_activity": _pty_sched["last_activity"],
        }
    runtime_events = read_system_runtime_events(limit=12)
    current_packet_id = str((snapshot.get("current_wp") or {}).get("id", "") or report.get("current_wp", ""))

    layers = []
    for layer in (report.get("system_os_layers") or []):
        dynamic = _system_layer_dynamic_state(layer, report, snapshot, live, pty_payload, vscode_health, scheduler_state)
        layers.append({
            **layer,
            "dynamic_status": dynamic["status"],
            "dynamic_note": dynamic["note"],
            "dynamic_signals": dynamic["signals"],
        })

    statuses = [layer.get("dynamic_status", "attention") for layer in layers]
    if layers and all(status == "ready" for status in statuses):
        overall = "ready"
    elif "attention" in statuses:
        overall = "attention"
    else:
        overall = "partial"

    next_moves = []
    if int(pty_payload.get("count", 0)) == 0:
        next_moves.append("Codex 또는 Claude CLI를 먼저 열어 PTY 세션을 연결하세요.")
    if not scheduler_state["running"]:
        next_moves.append("반복 작업이 필요하면 홈에서 scheduler를 시작하세요.")
    if str((report.get("promotion_pipeline") or {}).get("drift_status", "")) != "clean":
        next_moves.append("promotion drift를 먼저 해소하고 packet 승격을 진행하세요.")
    elif str(promotion_state.get("decision_result") or "").strip().lower() == "applied":
        promoted_packet = promotion_state.get("promoted_packet") if isinstance(promotion_state.get("promoted_packet"), dict) else {}
        next_moves.append(f"승격 packet {str(promoted_packet.get('id') or 'NONE')} 기준으로 handoff starter queue를 전송하세요.")
    elif bool(promotion_state.get("pipeline_ready")) and not bool(promotion_state.get("decision_ready")):
        next_moves.append("promotion pipeline은 준비됐지만 decision gate가 막혀 있습니다. handoff evidence와 fit risk를 먼저 정리하세요.")
    if len(next_moves) == 0:
        next_moves.append("계층별 상태가 준비됐습니다. 현재 packet 기준으로 실행과 검증을 이어가면 됩니다.")

    handoff_starter_queue = build_handoff_starter_queue(promotion_state)
    return {
        "checked_at": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "overall_status": overall,
        "current_wp": report.get("current_wp", "UNKNOWN"),
        "next_wp": report.get("next_wp", "UNKNOWN"),
        "scheduler": scheduler_state,
        "pty_sessions": {
            "count": int(pty_payload.get("count", 0)),
        },
        "vscode_auto": {
            "status": vscode_health.get("status", "NOGO"),
            "ready": bool(vscode_health.get("ready")),
        },
        "live_activity": {
            "summary": live.get("summary", ""),
            "active_edits": len(live.get("active_edits") or []),
            "git_changes": len(live.get("git_status") or []),
            "audit_entries": len(live.get("audit_entries") or []),
        },
        "runtime_events": runtime_events,
        "runtime_correlation": build_runtime_correlation(current_packet_id, promotion_state, runtime_events),
        "packet_execution": build_packet_execution_view(report, snapshot, scheduler_state),
        "drift_control": build_drift_control(report, live, scheduler_state, vscode_health),
        "decision_apply_console": {
            "goal": promotion_state.get("goal", ""),
            "decision_gate": promotion_state.get("decision_gate", ""),
            "ready_to_apply": bool(promotion_state.get("decision_ready")),
            "result": promotion_state.get("decision_result", ""),
            "pipeline_ready": bool(promotion_state.get("pipeline_ready")),
            "pipeline_result": promotion_state.get("pipeline_result", ""),
            "recommended_next_command": promotion_state.get("recommended_next_command", ""),
            "artifacts": promotion_state.get("artifacts", {}),
            "artifact_links": promotion_state.get("artifact_links", {}),
            "commands": promotion_state.get("commands", {}),
            "handoff_sequence": promotion_state.get("handoff_sequence", [])[:4],
            "handoff_commands": promotion_state.get("handoff_commands", {}),
            "handoff_summary": promotion_state.get("handoff_summary", {}),
            "promoted_packet": promotion_state.get("promoted_packet", {}),
            "handoff_starter_queue": handoff_starter_queue,
        },
        "layers": layers,
        "suggested_next_moves": next_moves[:3],
    }


# ── Planning Studio ───────────────────────────────────────────── #
def call_planning_studio_api(action, body_bytes=None):
    cmd = [sys.executable, str(PLANNING_API_SCRIPT), action]
    inp = body_bytes if body_bytes else b""
    result = subprocess.run(
        cmd, input=inp, capture_output=True, timeout=30, cwd=str(REPO_ROOT),
    )
    return result.returncode, result.stdout, result.stderr


# ── PTY Session Management ────────────────────────────────────── #
def list_pty_sessions():
    """Scan /proc to list active PTY sessions with process info."""
    by_pts: dict = {}
    proc_path = Path("/proc")
    for proc_dir in proc_path.iterdir():
        if not proc_dir.name.isdigit():
            continue
        try:
            stat_data = (proc_dir / "stat").read_text()
            fields = stat_data.split()
            tty_nr = int(fields[6])
            if tty_nr == 0:
                continue
            major = os.major(tty_nr)
            if major != 136:  # 136 = /dev/pts/*
                continue
            minor = os.minor(tty_nr)
            pts_path = f"/dev/pts/{minor}"
            pid = int(proc_dir.name)
            comm = (proc_dir / "comm").read_text().strip()
            try:
                raw = (proc_dir / "cmdline").read_bytes()
                cmdline = raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()[:100]
            except OSError:
                cmdline = comm
            if pts_path not in by_pts:
                by_pts[pts_path] = []
            by_pts[pts_path].append({"pid": pid, "comm": comm, "cmdline": cmdline})
        except (OSError, ValueError, IndexError):
            continue

    sessions = []
    for pts_path in sorted(by_pts.keys(), key=lambda p: int(p.split("/")[-1])):
        procs = sorted(by_pts[pts_path], key=lambda p: -p["pid"])
        labels = list(dict.fromkeys(p["comm"] for p in procs))[:3]
        sessions.append({
            "pts": pts_path,
            "processes": procs,
            "label": f"{pts_path}  [{', '.join(labels)}]",
            "exists": Path(pts_path).exists(),
        })
    return {"sessions": sessions, "count": len(sessions)}


def send_to_pty(pts_path: str, text: str):
    """Inject text into a PTY via TIOCSTI ioctl (no AHK needed)."""
    try:
        with open(pts_path, "w") as f:
            for ch in text:
                fcntl.ioctl(f, termios.TIOCSTI, ch.encode("utf-8"))
        return True, None
    except Exception as exc:
        return False, str(exc)


def append_submit_enter(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    return normalized + "\r"


def load_home_operator_prompt() -> str:
    try:
        payload = json.loads(HOME_DATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return ""
    plan_data = payload.get("planStudioData", {}) if isinstance(payload, dict) else {}
    prompt = plan_data.get("operatorPrompt", "") if isinstance(plan_data, dict) else ""
    return str(prompt).strip()


def resolve_worker_prompt(worker: dict) -> str:
    if worker.get("use_home_operator_prompt"):
        latest = load_home_operator_prompt()
        if latest:
            return latest
    return str(worker.get("prompt", "계속"))


def worker_prompt_preview(worker: dict, limit: int = 120) -> str:
    return resolve_worker_prompt(worker).strip()[:limit]


def extract_active_issue(prompt_text: str, limit: int = 180) -> str:
    lines = [
        line.strip()
        for line in str(prompt_text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ]
    for index, line in enumerate(lines):
        if line == "[다음 packet 시작 대상]":
            for candidate in lines[index + 1:]:
                if candidate:
                    return candidate[:limit]
    for line in lines:
        if line and not line.startswith("[") and not re.match(r"^\d+\.", line):
            return line[:limit]
    return ""


def build_sched_activity(action: str, worker_name: str, pts: str, prompt_text: str = "", ok: bool = True,
                         err: str | None = None, use_home_operator_prompt: bool = False,
                         packet_id: str = "") -> dict:
    preview = str(prompt_text or "").strip()[:120]
    resolved_packet_id = str(packet_id or extract_packet_id(prompt_text) or "").strip()
    return {
        "ts": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "worker": worker_name,
        "action": action,
        "pts": pts,
        "ok": bool(ok),
        "error": err,
        "prompt_preview": preview,
        "active_issue": extract_active_issue(prompt_text),
        "packet_id": resolved_packet_id,
        "use_home_operator_prompt": bool(use_home_operator_prompt),
    }


# ── Server-Side PTY Scheduler ──────────────────────────────────── #
_pty_sched_lock = threading.Lock()
_pty_sched: dict = {
    "running": False,
    "workers": [],
    "log": collections.deque(maxlen=200),
    "started_at": None,
    "last_activity": None,
}


def _pty_scheduler_loop():
    while True:
        time.sleep(0.25)
        with _pty_sched_lock:
            if not _pty_sched["running"]:
                continue
            now = time.time()
            ts = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%H:%M:%S")
            for w in _pty_sched["workers"]:
                pts = w.get("pts", "")
                if not pts:
                    continue
                # Prompt cycle
                if w["next_prompt"] > 0 and now >= w["next_prompt"]:
                    prompt_text = resolve_worker_prompt(w)
                    ok, err = send_to_pty(pts, append_submit_enter(prompt_text))
                    w["next_prompt"] = now + w["cycle_sec"]
                    w["next_enter"] = now + w["enter_sec"]
                    _pty_sched["log"].appendleft({
                        "ts": ts, "worker": w["name"], "action": "prompt",
                        "pts": pts, "ok": ok, "error": err,
                    })
                    _pty_sched["last_activity"] = build_sched_activity(
                        "prompt", w["name"], pts, prompt_text, ok, err,
                        bool(w.get("use_home_operator_prompt")),
                        str(w.get("plan_id") or ""),
                    )
                    append_system_runtime_event("scheduler-prompt", {
                        "worker": w["name"],
                        "pts": pts,
                        "packet_id": str(w.get("plan_id") or extract_packet_id(prompt_text) or ""),
                        "ok": ok,
                        "error": err,
                    })
                    continue
                # Enter heartbeat
                if w["next_enter"] > 0 and now >= w["next_enter"]:
                    ok, err = send_to_pty(pts, "\r")
                    w["next_enter"] = now + w["enter_sec"]
                    _pty_sched["log"].appendleft({
                        "ts": ts, "worker": w["name"], "action": "enter",
                        "pts": pts, "ok": ok, "error": err,
                    })
                    _pty_sched["last_activity"] = build_sched_activity(
                        "enter", w["name"], pts, resolve_worker_prompt(w), ok, err,
                        bool(w.get("use_home_operator_prompt")),
                        str(w.get("plan_id") or ""),
                    )
                    append_system_runtime_event("scheduler-enter", {
                        "worker": w["name"],
                        "pts": pts,
                        "packet_id": str(w.get("plan_id") or extract_packet_id(resolve_worker_prompt(w)) or ""),
                        "ok": ok,
                        "error": err,
                    })


def _start_pty_scheduler():
    t = threading.Thread(target=_pty_scheduler_loop, daemon=True, name="pty-scheduler")
    t.start()


# ── HTTP Handler ──────────────────────────────────────────────── #
class WfosHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        ts = datetime.now().strftime("%H:%M:%S")
        sys.stderr.write("[%s] %s\n" % (ts, fmt % args))

    def send_cors_headers(self):
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_json(404, {"error": "Not found", "path": str(path)})
            return
        suffix = path.suffix.lower()
        mime = MIME_TYPES.get(suffix, "application/octet-stream")
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    # ------------------------------------------------------------------ #
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        self._route("GET", path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        self._route("POST", path)

    # ------------------------------------------------------------------ #
    def _route(self, method, path):

        # ── Live activity feed ─────────────────────────────────── #
        if path == "/api/live-activity":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(200, get_live_activity())
            return

        # Backward-compat alias
        if path == "/api/activity-feed":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            data = get_live_activity()
            # flatten for old clients
            self.send_json(200, {
                "entries": data["audit_entries"],
                "count": len(data["audit_entries"]),
                "fetched_at": data["fetched_at"],
            })
            return

        # ── VSCode terminal detection ──────────────────────────── #
        if path == "/api/planning-studio/detect-terminals":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(200, detect_vscode_terminals())
            return

        # ── VSCode automation full health ──────────────────────── #
        if path == "/api/vscode-auto/status":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(200, get_vscode_auto_health())
            return

        # ── Planning Studio ────────────────────────────────────── #
        if path == "/api/planning-studio/snapshot":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            code, out, err = call_planning_studio_api("snapshot")
            if code != 0:
                self.send_json(500, {"error": err.decode("utf-8", errors="replace")})
                return
            try:
                self.send_json(200, json.loads(out))
            except json.JSONDecodeError:
                body = out
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
            return

        if path == "/api/system-os/status":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(200, build_system_os_status())
            return

        if path == "/api/system-os/decision-apply":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            body = json.loads(self.read_body() or b"{}")
            try:
                payload = run_decision_apply_bridge(bool(body.get("apply")))
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
                return
            self.send_json(200, payload)
            return

        if path == "/api/system-os/validation-result":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            body = json.loads(self.read_body() or b"{}")
            packet_id = str(body.get("packet_id") or "").strip()
            outcome = str(body.get("outcome") or "").strip().lower()
            if outcome not in {"pass", "fail"}:
                self.send_json(400, {"error": "outcome must be pass|fail"})
                return
            append_system_runtime_event("validation-result", {
                "packet_id": packet_id,
                "source_packet_id": str(body.get("source_packet_id") or packet_id),
                "outcome": outcome,
                "source": str(body.get("source") or "home-bridge"),
                "notes": str(body.get("notes") or ""),
                "commands": body.get("commands") if isinstance(body.get("commands"), list) else [],
                "trace_id": str(body.get("trace_id") or build_runtime_trace_id(packet_id=packet_id, source_packet_id=str(body.get("source_packet_id") or packet_id))),
                "ok": outcome == "pass",
                "error": "" if outcome == "pass" else str(body.get("notes") or "validation failed"),
            })
            self.send_json(200, {"ok": True, "packet_id": packet_id, "outcome": outcome})
            return

        if path in (
            "/api/planning-studio/save-automation",
            "/api/planning-studio/save-packet",
            "/api/planning-studio/save-sections",
        ):
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            action = path.split("/")[-1]
            body_bytes = self.read_body()
            code, out, err = call_planning_studio_api(action, body_bytes)
            if code != 0:
                self.send_json(500, {"error": err.decode("utf-8", errors="replace")})
                return
            try:
                self.send_json(200, json.loads(out))
            except json.JSONDecodeError:
                self.send_json(200, {"ok": True, "message": out.decode("utf-8", errors="replace").strip()})
            return

        # ── Static files ───────────────────────────────────────── #
        if path == "/vscode-cli-automation" or path.startswith("/vscode-cli-automation/"):
            rel = path[len("/vscode-cli-automation"):].lstrip("/")
            target = VSCODE_CLI_DIR / rel if rel else VSCODE_CLI_DIR / "index.html"
            self.send_static(target)
            return

        if path == "/" or path == "":
            self.send_static(ARTIFACTS_DIR / "index.html")
            return

        rel = path.lstrip("/")
        candidate = ARTIFACTS_DIR / rel
        if candidate.exists() and candidate.is_file():
            self.send_static(candidate)
            return

        # ── Automation Runtime API ─────────────────────────────── #
        if path == "/api/automation/state":
            if method == "GET":
                with _state_lock:
                    import copy
                    self.send_json(200, copy.deepcopy(_automation_runtime))
                return
            if method == "POST":
                body_bytes = self.read_body()
                try:
                    update = json.loads(body_bytes)
                    with _state_lock:
                        if "running" in update:
                            _automation_runtime["running"] = bool(update["running"])
                        if "workers" in update and isinstance(update["workers"], list):
                            _automation_runtime["workers"] = update["workers"]
                        if "config" in update and isinstance(update["config"], dict):
                            _automation_runtime["config"].update(update["config"])
                        if isinstance(update.get("log"), list):
                            _automation_runtime["log"] = (update["log"] + _automation_runtime["log"])[:100]
                        if "startedAt" in update:
                            _automation_runtime["startedAt"] = update["startedAt"]
                    self.send_json(200, {"ok": True})
                except Exception as exc:
                    self.send_json(400, {"error": str(exc)})
                return

        if path == "/api/automation/optimize-prompt":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            code, out, _ = call_planning_studio_api("snapshot")
            prompt_text = _generate_optimized_prompt(out if code == 0 else b"{}")
            self.send_json(200, {"prompt": prompt_text})
            return

        # ── PTY session list ──────────────────────────────── #
        if path == "/api/pty/sessions":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(200, list_pty_sessions())
            return

        # ── PTY one-shot send ─────────────────────────────── #
        if path == "/api/pty/send":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            body = json.loads(self.read_body() or b"{}")
            pts  = body.get("pts", "")
            text = body.get("text", "")
            if not pts:
                self.send_json(400, {"error": "pts required"})
                return
            ok, err = send_to_pty(pts, text)
            action = str(body.get("action") or ("enter" if text == "\r" else "prompt"))
            prompt_text = str(body.get("prompt") or (text[:-1] if isinstance(text, str) and text.endswith("\r") else text))
            with _pty_sched_lock:
                _pty_sched["last_activity"] = build_sched_activity(
                    action=action,
                    worker_name=str(body.get("name") or "manual"),
                    pts=pts,
                    prompt_text=prompt_text,
                    ok=ok,
                    err=err,
                    use_home_operator_prompt=bool(body.get("use_home_operator_prompt")),
                    packet_id=str(body.get("packet_id") or ""),
                )
                _pty_sched["log"].appendleft({
                    "ts": utc_now().strftime("%H:%M:%S"),
                    "worker": str(body.get("name") or "manual"),
                    "action": action,
                    "pts": pts,
                    "packet_id": str(body.get("packet_id") or extract_packet_id(prompt_text) or ""),
                    "ok": ok,
                    "error": err,
                })
            append_system_runtime_event("pty-send", {
                "worker": str(body.get("name") or "manual"),
                "pts": pts,
                "action": action,
                "packet_id": str(body.get("packet_id") or extract_packet_id(prompt_text) or ""),
                "source_packet_id": str(body.get("source_packet_id") or body.get("packet_id") or extract_packet_id(prompt_text) or ""),
                "trace_id": str(body.get("trace_id") or build_runtime_trace_id(
                    packet_id=str(body.get("packet_id") or extract_packet_id(prompt_text) or ""),
                    source_packet_id=str(body.get("source_packet_id") or body.get("packet_id") or extract_packet_id(prompt_text) or ""),
                    subject="pty-send",
                )),
                "ok": ok,
                "error": err,
            })
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})
            return

        # ── PTY scheduler status ──────────────────────────── #
        if path == "/api/pty/scheduler/status":
            if method != "GET":
                self.send_json(405, {"error": "Method not allowed"})
                return
            now = time.time()
            with _pty_sched_lock:
                current_activity = None
                if _pty_sched["running"]:
                    for w in _pty_sched["workers"]:
                        if w.get("pts"):
                            prompt_text = resolve_worker_prompt(w)
                            current_activity = build_sched_activity(
                                "running",
                                w["name"],
                                w["pts"],
                                prompt_text,
                                True,
                                None,
                                bool(w.get("use_home_operator_prompt")),
                                str(w.get("plan_id") or ""),
                            )
                            current_activity["next_enter_in"] = max(0, round(w["next_enter"] - now)) if w["next_enter"] > 0 else -1
                            current_activity["next_prompt_in"] = max(0, round(w["next_prompt"] - now)) if w["next_prompt"] > 0 else -1
                            break
                state = {
                    "running":    _pty_sched["running"],
                    "started_at": _pty_sched["started_at"],
                    "workers": [
                        {
                            "name":           w["name"],
                            "plan_id":        str(w.get("plan_id") or ""),
                            "pts":            w["pts"],
                            "prompt_preview": worker_prompt_preview(w, 80),
                            "active_issue":   extract_active_issue(resolve_worker_prompt(w)),
                            "use_home_operator_prompt": bool(w.get("use_home_operator_prompt")),
                            "cycle_min":      round(w["cycle_sec"] / 60, 1),
                            "enter_sec":      w["enter_sec"],
                            "next_enter_in":  max(0, round(w["next_enter"] - now))
                                              if w["next_enter"] > 0 else -1,
                            "next_prompt_in": max(0, round(w["next_prompt"] - now))
                                              if w["next_prompt"] > 0 else -1,
                        }
                        for w in _pty_sched["workers"]
                    ],
                    "current_activity": current_activity,
                    "last_activity": _pty_sched["last_activity"],
                    "log": list(_pty_sched["log"])[:30],
                }
            self.send_json(200, state)
            return

        # ── PTY scheduler start ───────────────────────────── #
        if path == "/api/pty/scheduler/start":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            body         = json.loads(self.read_body() or b"{}")
            cycle_min    = float(body.get("cycle_minutes", 30))
            enter_sec    = float(body.get("enter_seconds", 10))
            workers_cfg  = body.get("workers", [])
            now          = time.time()
            with _pty_sched_lock:
                _pty_sched["workers"] = []
                for i, w in enumerate(workers_cfg):
                    cm  = float(w.get("cycle_minutes", cycle_min))
                    es  = float(w.get("enter_seconds", enter_sec))
                    _pty_sched["workers"].append({
                        "name":        w.get("name", f"Worker {i + 1}"),
                        "plan_id":     str(w.get("plan_id", "") or ""),
                        "pts":         w.get("pts", ""),
                        "prompt":      w.get("prompt", "계속"),
                        "use_home_operator_prompt": bool(w.get("use_home_operator_prompt")),
                        "cycle_sec":   cm * 60,
                        "enter_sec":   es,
                        "next_enter":  now + es,
                        "next_prompt": now + cm * 60,
                    })
                _pty_sched["running"]    = True
                _pty_sched["started_at"] = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
                _pty_sched["log"].appendleft({
                    "ts": "system", "worker": "scheduler", "action": "start", "ok": True,
                })
            append_system_runtime_event("scheduler-start", {
                "workers": len(workers_cfg),
                "cycle_minutes": cycle_min,
                "enter_seconds": enter_sec,
            })
            self.send_json(200, {"ok": True, "workers": len(workers_cfg)})
            return

        # ── PTY scheduler stop ────────────────────────────── #
        if path == "/api/pty/scheduler/stop":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            with _pty_sched_lock:
                _pty_sched["running"]    = False
                _pty_sched["started_at"] = None
                _pty_sched["log"].appendleft({
                    "ts": "system", "worker": "scheduler", "action": "stop", "ok": True,
                })
            append_system_runtime_event("scheduler-stop", {"ok": True})
            self.send_json(200, {"ok": True})
            return

        # ── PTY send prompt now (all or one) ──────────────── #
        if path == "/api/pty/send-now":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            body = json.loads(self.read_body() or b"{}")
            idx  = body.get("worker_index")   # None = all
            results = []
            now = time.time()
            with _pty_sched_lock:
                targets = (
                    [_pty_sched["workers"][idx]]
                    if idx is not None and idx < len(_pty_sched["workers"])
                    else _pty_sched["workers"]
                )
                ts_str = utc_now().strftime("%H:%M:%S")
                for w in targets:
                    if w["pts"]:
                        prompt_text = resolve_worker_prompt(w)
                        ok, err = send_to_pty(w["pts"], append_submit_enter(prompt_text))
                        if ok:
                            w["next_prompt"] = now + w["cycle_sec"]
                            w["next_enter"]  = now + w["enter_sec"]
                        results.append({"worker": w["name"], "ok": ok, "error": err})
                        _pty_sched["log"].appendleft({
                            "ts": ts_str, "worker": w["name"],
                            "action": "prompt", "pts": w["pts"],
                            "ok": ok, "error": err,
                        })
                        _pty_sched["last_activity"] = build_sched_activity(
                            "prompt", w["name"], w["pts"], prompt_text, ok, err,
                            bool(w.get("use_home_operator_prompt")),
                            str(w.get("plan_id") or ""),
                        )
                        append_system_runtime_event("scheduler-send-now", {
                            "worker": w["name"],
                            "pts": w["pts"],
                            "packet_id": str(w.get("plan_id") or extract_packet_id(prompt_text) or ""),
                            "ok": ok,
                            "error": err,
                        })
            self.send_json(200, {"results": results})
            return

        # ── PTY send enter now (all workers) ─────────────── #
        if path == "/api/pty/enter-now":
            if method != "POST":
                self.send_json(405, {"error": "Method not allowed"})
                return
            results = []
            now = time.time()
            with _pty_sched_lock:
                ts_str = utc_now().strftime("%H:%M:%S")
                for w in _pty_sched["workers"]:
                    if w["pts"]:
                        ok, err = send_to_pty(w["pts"], "\r")
                        if ok:
                            w["next_enter"] = now + w["enter_sec"]
                        results.append({"worker": w["name"], "ok": ok, "error": err})
                        _pty_sched["log"].appendleft({
                            "ts": ts_str, "worker": w["name"],
                            "action": "enter", "pts": w["pts"],
                            "ok": ok, "error": err,
                        })
                        _pty_sched["last_activity"] = build_sched_activity(
                            "enter", w["name"], w["pts"], resolve_worker_prompt(w), ok, err,
                            bool(w.get("use_home_operator_prompt")),
                            str(w.get("plan_id") or ""),
                        )
                        append_system_runtime_event("scheduler-enter-now", {
                            "worker": w["name"],
                            "pts": w["pts"],
                            "packet_id": str(w.get("plan_id") or extract_packet_id(resolve_worker_prompt(w)) or ""),
                            "ok": ok,
                            "error": err,
                        })
            self.send_json(200, {"results": results})
            return

        self.send_json(404, {"error": "Not found", "path": path})


# ── Entry Point ───────────────────────────────────────────────── #
def main():
    _start_file_watcher()
    _start_pty_scheduler()
    port = 8080
    server = HTTPServer(("127.0.0.1", port), WfosHandler)
    sys.stderr.write(
        "[serve.py] Workflow OS HTTP server on http://127.0.0.1:%d\n" % port
    )
    sys.stderr.write("[serve.py] File watcher started (domains/scripts/memory/src)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[serve.py] Stopped.\n")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
