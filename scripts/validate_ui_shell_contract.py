#!/usr/bin/env python3
"""Validate UI shell control API contract against frontend usage and runtime sources."""

from __future__ import annotations

from pathlib import Path
import re
import sys

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
OPENAPI_PATH = REPO_ROOT / "contracts" / "ui-shell" / "openapi.yaml"
HOME_UI_PATH = REPO_ROOT / "scripts" / "generate-ui-home.js"
NODE_RUNTIME_PATH = REPO_ROOT / "src" / "server" / "createServer.js"
STATIC_RUNTIME_PATH = REPO_ROOT / "scripts" / "serve.py"

REQUIRED_OPERATIONS = {
    ("GET", "/planning-studio/snapshot"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-packet"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-sections"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-automation"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/scaffold-preview"): [NODE_RUNTIME_PATH],
    ("POST", "/planning-studio/scaffold-create"): [NODE_RUNTIME_PATH],
    ("GET", "/pty/sessions"): [STATIC_RUNTIME_PATH],
    ("POST", "/pty/send"): [STATIC_RUNTIME_PATH],
    ("GET", "/pty/scheduler/status"): [STATIC_RUNTIME_PATH],
    ("POST", "/pty/scheduler/start"): [STATIC_RUNTIME_PATH],
    ("POST", "/pty/scheduler/stop"): [STATIC_RUNTIME_PATH],
    ("POST", "/pty/send-now"): [STATIC_RUNTIME_PATH],
    ("POST", "/pty/enter-now"): [STATIC_RUNTIME_PATH],
}


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def collect_spec_operations(spec: dict) -> set[tuple[str, str]]:
    operations: set[tuple[str, str]] = set()
    for route_path, methods in (spec.get("paths") or {}).items():
        if not isinstance(methods, dict):
            continue
        for method in methods:
            normalized = str(method).upper()
            if normalized in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}:
                operations.add((normalized, str(route_path)))
    return operations


def collect_home_ui_operations(source: str) -> set[tuple[str, str]]:
    operations: set[tuple[str, str]] = set()

    for endpoint in re.findall(r"callPlanningApi\('([^']+)'", source):
        normalized = str(endpoint).strip()
        if not normalized.startswith("/"):
            normalized = "/" + normalized
        operations.add(("GET" if normalized == "/snapshot" else "POST", f"/planning-studio{normalized}"))

    for path, method in re.findall(r"callJson\('(/api/pty[^']+)'\s*,\s*\{\s*method:\s*'([A-Z]+)'", source):
        operations.add((method.upper(), path.split("?", 1)[0].removeprefix("/api")))

    for path in re.findall(r"fetch\('(/api/pty[^']+)'", source):
        operations.add(("GET", path.split("?", 1)[0].removeprefix("/api")))

    return operations


def main() -> int:
    errors: list[str] = []
    spec = load_yaml(OPENAPI_PATH)
    spec_operations = collect_spec_operations(spec)

    if not spec_operations:
        errors.append("ui-shell openapi has no operations")

    home_ui_operations = collect_home_ui_operations(load_text(HOME_UI_PATH))
    missing_from_spec = sorted(home_ui_operations - spec_operations)
    for method, path in missing_from_spec:
        errors.append(f"frontend uses undocumented endpoint: {method} {path}")

    node_runtime_text = load_text(NODE_RUNTIME_PATH)
    static_runtime_text = load_text(STATIC_RUNTIME_PATH)
    source_map = {
        NODE_RUNTIME_PATH: node_runtime_text,
        STATIC_RUNTIME_PATH: static_runtime_text,
    }

    for operation, sources in REQUIRED_OPERATIONS.items():
        method, path = operation
        if operation not in spec_operations:
            errors.append(f"required contract endpoint missing: {method} {path}")
            continue

        runtime_path = f"/api{path}"
        if not any(runtime_path in source_map[source] for source in sources):
            source_labels = ", ".join(source.name for source in sources)
            errors.append(f"runtime source missing for {method} {path} (expected in {source_labels})")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("ui shell contract validation PASS")
    print(f"  documented operations: {len(spec_operations)}")
    print(f"  frontend-mapped operations: {len(home_ui_operations)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
