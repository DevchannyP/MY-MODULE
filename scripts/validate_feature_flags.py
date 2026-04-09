#!/usr/bin/env python3
"""Validate feature flag configuration consistency.

Checks:
  1. flags.yaml ↔ metadata.json bidirectional key sync (no orphans)
  2. Every metadata entry has required fields: owner, description, expires_on, stage
  3. Stale flags: expires_on is in the past
  4. .env.example documents every WOS_FLAG_* key derived from flags.yaml
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
FLAGS_PATH = REPO_ROOT / "master-shell" / "feature-flags" / "flags.yaml"
METADATA_PATH = REPO_ROOT / "master-shell" / "feature-flags" / "metadata.json"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"

METADATA_REQUIRED_FIELDS = ("owner", "description", "expires_on", "stage")


def load_flag_keys(flags_path: Path) -> list[str]:
    """Return all flag keys from flags.yaml (global_flags + plugin_flags sections)."""
    text = flags_path.read_text(encoding="utf-8")
    keys: list[str] = []
    in_flag_section = False
    section_headers = {"global_flags", "plugin_flags"}
    top_level_skips = {"version", "last_updated"}

    for raw_line in text.split("\n"):
        line = raw_line.replace("#.*$", "").split("#")[0]
        stripped = line.strip()
        if not stripped:
            continue
        # Top-level section header
        if re.match(r"^[a-z_]+:$", stripped):
            section_name = stripped[:-1]
            in_flag_section = section_name in section_headers
            continue
        if in_flag_section:
            m = re.match(r"^\s{2}([a-z_.]+):", line)
            if m:
                keys.append(m.group(1))
        else:
            # Top-level scalar — skip known non-flag scalars silently
            m = re.match(r"^([a-z_]+):\s", line)
            if m and m.group(1) not in top_level_skips:
                pass  # not a flag section key

    return keys


def to_env_key(flag_key: str) -> str:
    return "WOS_FLAG_" + re.sub(r"[.\-]", "_", flag_key).upper()


def load_metadata(metadata_path: Path) -> dict[str, dict]:
    raw = json.loads(metadata_path.read_text(encoding="utf-8"))
    return raw.get("flags", {}) if isinstance(raw, dict) else {}


def env_example_wos_keys(env_example_path: Path) -> set[str]:
    if not env_example_path.exists():
        return set()
    text = env_example_path.read_text(encoding="utf-8")
    return set(re.findall(r"WOS_FLAG_[A-Z_0-9]+", text))


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    today = date.today().isoformat()

    # ── 1. Load sources ──────────────────────────────────────────────────────
    flag_keys = load_flag_keys(FLAGS_PATH)
    flag_key_set = set(flag_keys)
    metadata = load_metadata(METADATA_PATH)
    metadata_key_set = set(metadata.keys())
    example_env_keys = env_example_wos_keys(ENV_EXAMPLE_PATH)

    # ── 2. Bidirectional sync: flags.yaml ↔ metadata.json ───────────────────
    yaml_only = sorted(flag_key_set - metadata_key_set)
    meta_only = sorted(metadata_key_set - flag_key_set)
    for key in yaml_only:
        errors.append(f"flag '{key}' is in flags.yaml but missing from metadata.json")
    for key in meta_only:
        errors.append(f"flag '{key}' is in metadata.json but not declared in flags.yaml (orphan)")

    # ── 3. Required metadata fields per entry ────────────────────────────────
    for flag_key in sorted(flag_key_set & metadata_key_set):
        entry = metadata[flag_key]
        for field in METADATA_REQUIRED_FIELDS:
            if not entry.get(field):
                errors.append(f"metadata['{flag_key}'] missing required field: {field}")

    # ── 4. Stale flag detection ──────────────────────────────────────────────
    stale: list[str] = []
    for flag_key, entry in metadata.items():
        expires_on = entry.get("expires_on", "")
        if isinstance(expires_on, str) and expires_on and expires_on < today:
            stale.append(f"flag '{flag_key}' expired on {expires_on} (today: {today})")
    for msg in stale:
        warnings.append(msg)

    # ── 5. .env.example coverage ─────────────────────────────────────────────
    expected_env_keys = {to_env_key(k) for k in flag_keys}
    missing_from_example = sorted(expected_env_keys - example_env_keys)
    extra_in_example = sorted(
        k for k in example_env_keys - expected_env_keys if k.startswith("WOS_FLAG_")
    )
    for key in missing_from_example:
        errors.append(f".env.example missing WOS_FLAG_* entry: {key}")
    for key in extra_in_example:
        warnings.append(f".env.example has undeclared WOS_FLAG_* key: {key} (not in flags.yaml)")

    # ── Output ────────────────────────────────────────────────────────────────
    for msg in warnings:
        print(f"WARN: {msg}")
    if errors:
        for msg in errors:
            print(f"ERROR: {msg}")
        return 1

    print("feature flag validation PASS")
    print(f"  flags.yaml keys     : {len(flag_keys)}")
    print(f"  metadata.json keys  : {len(metadata_key_set)}")
    print(f"  .env.example keys   : {len(example_env_keys)}")
    print(f"  sync coverage       : {len(flag_key_set & metadata_key_set)}/{len(flag_keys)} flags have metadata")
    print(f"  env example coverage: {len(expected_env_keys) - len(missing_from_example)}/{len(flag_keys)} flags in .env.example")
    if stale:
        print(f"  stale flags         : {len(stale)} (see WARN lines above)")
    else:
        print(f"  stale flags         : 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
