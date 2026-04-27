#!/usr/bin/env python3
"""
Session End — 자동 자기개선 루프
Benchmark: Kubernetes 조정 루프, GitOps reconciliation, Toyota Kaizen(개선)

세션 종료 시 실행:
  1. requirements gap 검출 (requirements_gap.py)
  2. state reconciliation (reconcile_state.py)
  3. 신규 gap WP 생성 → wp-queue.yaml 자동 삽입
  4. checkpoint.yaml 갱신
  5. session health 보고

Usage:
  python3 scripts/session_end.py          # dry-run (no queue write)
  python3 scripts/session_end.py --apply  # apply gap WPs to queue
  python3 scripts/session_end.py --json   # machine-readable output
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent

# ── Memory triad: three files that must stay in sync ────────
MEMORY_TRIAD = (
    ROOT / "memory" / "current-state.yaml",
    ROOT / "memory" / "current-wp.yaml",
    ROOT / "memory" / "next-actions.yaml",
)


def _triad_wp_ref(path: Path, data: dict) -> str | None:
    """Extract the WP pointer from a triad file."""
    name = path.name
    if name == "current-state.yaml":
        lwp = data.get("last_completed_wp") or {}
        return lwp.get("id") if isinstance(lwp, dict) else None
    if name == "current-wp.yaml":
        return data.get("id")
    if name == "next-actions.yaml":
        return data.get("next_wp")
    return None


def verify_memory_consistency() -> dict:
    """
    Verify memory triad consistency (INV: atomic update guarantee).

    Invariants checked:
      1. All three files have an as_of field.
      2. All as_of values are identical.
      3. current-wp.id ≠ current-state.last_completed_wp.id
         (active packet must differ from the already-completed one).

    Returns: {consistent: bool, errors: list[str], refs: dict, timestamps: dict}
    """
    errors: list[str] = []
    refs: dict[str, str | None] = {}
    timestamps: dict[str, str | None] = {}

    for path in MEMORY_TRIAD:
        name = path.name
        try:
            data = load_yaml(path)
        except FileNotFoundError:
            errors.append(f"{name}: file not found")
            continue
        as_of = data.get("as_of")
        timestamps[name] = as_of
        refs[name] = _triad_wp_ref(path, data)
        if as_of is None:
            errors.append(f"{name}: missing as_of field")

    ts_set = {v for v in timestamps.values() if v is not None}
    if len(ts_set) > 1:
        errors.append(f"as_of drift: {timestamps}")

    active = refs.get("current-wp.yaml")
    last_done = refs.get("current-state.yaml")
    if active and last_done and active == last_done:
        errors.append(
            f"current-wp.id ({active}) equals last_completed_wp.id — "
            "active packet must differ from the completed one"
        )

    return {
        "consistent": len(errors) == 0,
        "errors": errors,
        "refs": refs,
        "timestamps": timestamps,
    }


def atomic_write_memory_triad(
    *,
    active_wp_id: str,
    last_completed_wp_id: str,
    last_completed_result: str = "PASS",
    as_of: str | None = None,
    next_wp: str | None = None,
) -> None:
    """
    Write all three memory triad files with the same as_of timestamp.
    Uses write-then-rename so an interrupted write leaves prior files intact.

    Args:
        active_wp_id: The WP currently being worked on (current-wp.id).
        last_completed_wp_id: The WP just finished (current-state.last_completed_wp.id).
        last_completed_result: Gate result for the completed WP.
        as_of: Override date; defaults to today.
        next_wp: Optional next_wp pointer for next-actions.yaml.
    """
    today = as_of or date.today().isoformat()

    cs = load_yaml(MEMORY_TRIAD[0])
    cw = load_yaml(MEMORY_TRIAD[1])
    na = load_yaml(MEMORY_TRIAD[2])

    cs["as_of"] = today
    cs["last_completed_wp"] = {
        "id": last_completed_wp_id,
        "completed_at": today,
        "result": last_completed_result,
    }
    cw["as_of"] = today
    cw["id"] = active_wp_id
    na["as_of"] = today
    if next_wp is not None:
        na["next_wp"] = next_wp

    for path, data in zip(MEMORY_TRIAD, [cs, cw, na]):
        tmp = path.with_suffix(".yaml.tmp")
        save_yaml(tmp, data)
        tmp.rename(path)


def run_script(script: str, *args: str) -> dict:
    """Run a sibling script with --json and return parsed output."""
    cmd = [sys.executable, str(ROOT / "scripts" / script), "--json", *args]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, timeout=30)
        return json.loads(result.stdout) if result.stdout.strip() else {}
    except Exception as e:
        return {"error": str(e)}


def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_yaml(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def update_checkpoint(completed: list[str], not_started: list[str]) -> None:
    cp_path = ROOT / "memory" / "checkpoint.yaml"
    cp = load_yaml(cp_path)
    today = date.today().isoformat()
    cp["session_date"] = today

    existing_done = set(cp.get("wps_completed", []))
    for wp_id in completed:
        existing_done.add(wp_id)
    cp["wps_completed"] = sorted(existing_done)

    # Remove completed from not_started
    existing_not_started = [
        w for w in cp.get("wps_not_started", [])
        if w not in existing_done
    ]
    # Add any new not_started
    for wp_id in not_started:
        if wp_id not in existing_done and wp_id not in existing_not_started:
            existing_not_started.append(wp_id)
    cp["wps_not_started"] = existing_not_started

    save_yaml(cp_path, cp)


def main() -> None:
    as_json = "--json" in sys.argv
    do_apply = "--apply" in sys.argv

    W = 62
    if not as_json:
        print(f"\n{'='*W}")
        print(f"  Session End — Self-Improvement Loop")
        print(f"{'='*W}")

    # Step 0: Memory triad consistency
    consistency = verify_memory_consistency()
    triad_ok = consistency["consistent"]
    if not as_json and not triad_ok:
        print(f"  ⚠ Memory Triad Drift ({len(consistency['errors'])} issue(s)):")
        for e in consistency["errors"]:
            print(f"    · {e}")

    # Step 1: Requirements gap
    gap_report = run_script("requirements_gap.py")
    gaps = gap_report.get("gap_count", 0)
    high_gaps = sum(1 for g in gap_report.get("gaps", []) if g.get("severity") == "high")

    # Step 2: State reconciliation
    recon_args = ["--apply"] if do_apply else []
    recon_report = run_script("reconcile_state.py", *recon_args)
    uncovered = recon_report.get("uncovered", 0)
    apply_note = recon_report.get("apply_note")

    # Step 3: Gap WP generation
    gen_count = 0
    if do_apply and high_gaps > 0:
        gen_report = run_script("requirements_gap.py", "--gen")
        gen_count = len(gen_report.get("generated_wps", []))

    # Step 4: Health metrics
    health = run_script("session_metrics.py")
    rating = health.get("health_rating", "UNKNOWN")
    gate_pass = health.get("gate_pass_rate_pct", 0)

    # Step 5: WP scheduler summary
    sched = run_script("wp_scheduler.py")
    ready_count = len(sched.get("ready", []))

    summary = {
        "date": date.today().isoformat(),
        "triad_consistent": triad_ok,
        "triad_errors": consistency.get("errors", []),
        "requirements_gaps": gaps,
        "high_severity_gaps": high_gaps,
        "state_uncovered": uncovered,
        "wps_auto_inserted": gen_count,
        "apply_note": apply_note,
        "health_rating": rating,
        "gate_pass_rate_pct": gate_pass,
        "ready_wps_next_session": ready_count,
    }

    if as_json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return

    # Human-readable output
    print(f"\n  Step 1 — Requirements Gaps   : {gaps} total, {high_gaps} HIGH")
    print(f"  Step 2 — State Reconciliation: {uncovered} uncovered")
    if apply_note:
        print(f"           → {apply_note}")
    if gen_count:
        print(f"  Step 3 — Auto-inserted WPs   : {gen_count}")
    print(f"  Step 4 — Health Rating       : {rating} ({gate_pass}% gate pass)")
    print(f"  Step 5 — Ready WPs (next)    : {ready_count}")

    print()
    if high_gaps == 0 and uncovered == 0:
        print(f"  ✓ Loop CLEAN — no gaps, fully reconciled")
    else:
        tips = []
        if high_gaps > 0:  tips.append(f"fix {high_gaps} HIGH gap(s)")
        if uncovered > 0:  tips.append(f"cover {uncovered} uncovered capability/ies")
        print(f"  Next actions: {', '.join(tips)}")
        print(f"  Re-run with --apply to auto-insert gap WPs.")
    print(f"{'='*W}\n")


if __name__ == "__main__":
    main()
