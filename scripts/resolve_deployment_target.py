#!/usr/bin/env python3
"""Resolve deployment smoke inputs from the in-repo environment registry."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "master-shell" / "operations" / "deployment-environments.yaml"


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_registry() -> dict:
    return load_yaml(REGISTRY_PATH)


def find_environment(registry: dict, name: str) -> dict:
    for item in registry.get("environments", []):
        if item.get("github_environment") == name or item.get("id") == name:
            return item
    raise SystemExit(f"deployment target resolution FAIL: unknown environment -> {name}")


def resolve_value(env_name: str, env_entry: dict, key: str, fallback: str) -> str:
    env_var_name = str(env_entry.get("vars", {}).get(key, "")).strip()
    if env_var_name:
        value = os.environ.get(env_var_name, "").strip()
        if value:
            return value
    return fallback


def resolve_target(registry: dict, env_name: str, base_url_override: str) -> dict:
    env_entry = find_environment(registry, env_name)
    defaults = registry.get("defaults", {})

    base_url = base_url_override.strip() or resolve_value(env_name, env_entry, "base_url", "")
    if not base_url:
        raise SystemExit(
            "deployment target resolution FAIL: missing base URL. "
            "Provide --base-url-override or configure DEPLOYMENT_BASE_URL in the selected GitHub environment."
        )

    resolved = {
        "registry_path": str(REGISTRY_PATH.relative_to(ROOT)),
        "environment_name": str(env_entry.get("github_environment", env_name)),
        "registry_id": str(env_entry.get("id", env_name)),
        "rollout_phase": str(env_entry.get("rollout_phase", "unknown")),
        "owner": str(env_entry.get("owner", "unknown")),
        "smoke_status": str(env_entry.get("smoke_status", "operator-triggered")),
        "base_url": base_url,
        "task_write_permissions": resolve_value(
            env_name,
            env_entry,
            "task_write_permissions",
            str(defaults.get("task_write_permissions", "task:read,task:write")),
        ),
        "task_read_permissions": resolve_value(
            env_name,
            env_entry,
            "task_read_permissions",
            str(defaults.get("task_read_permissions", "task:read")),
        ),
        "flag_off_path": resolve_value(env_name, env_entry, "flag_off_path", ""),
        "flag_off_permissions": resolve_value(
            env_name,
            env_entry,
            "flag_off_permissions",
            str(defaults.get("flag_off_permissions", "task:read")),
        ),
    }
    return resolved


def write_github_output(path_str: str, resolved: dict) -> None:
    if not path_str:
        return
    path = Path(path_str)
    with path.open("a", encoding="utf-8") as handle:
        for key, value in resolved.items():
            handle.write(f"{key}={value}\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resolve deployment smoke target inputs.")
    parser.add_argument("--environment", required=True, help="GitHub environment name from the registry")
    parser.add_argument("--base-url-override", default="", help="Break-glass base URL override")
    parser.add_argument("--github-output", default="", help="Optional GITHUB_OUTPUT file path")
    parser.add_argument("--json", action="store_true", help="Print JSON to stdout")
    parser.add_argument("--json-output", default="", help="Optional path to write the resolved JSON payload")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    registry = load_registry()
    resolved = resolve_target(registry, args.environment, args.base_url_override)

    if args.json_output:
        output_path = Path(args.json_output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(resolved, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    write_github_output(args.github_output, resolved)

    if args.json:
        print(json.dumps(resolved, indent=2, ensure_ascii=False))
    else:
        print(
            "deployment target resolution PASS: "
            f"{resolved['environment_name']} -> {resolved['base_url']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
