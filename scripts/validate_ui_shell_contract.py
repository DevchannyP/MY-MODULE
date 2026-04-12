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
MINDMAP_UI_PATH = REPO_ROOT / "scripts" / "generate-mindmap.js"
NODE_RUNTIME_PATH = REPO_ROOT / "src" / "server" / "createServer.js"
STATIC_RUNTIME_PATH = REPO_ROOT / "scripts" / "serve.py"

REQUIRED_OPERATIONS = {
    ("GET", "/planning-studio/snapshot"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-packet"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-sections"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/save-automation"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/planning-studio/scaffold-preview"): [NODE_RUNTIME_PATH],
    ("POST", "/planning-studio/scaffold-create"): [NODE_RUNTIME_PATH],
    ("POST", "/planning-studio/stage-run"): [NODE_RUNTIME_PATH],
    ("GET", "/automation/optimize-prompt"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("GET", "/pty/sessions"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/pty/send"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("GET", "/pty/scheduler/status"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/pty/scheduler/start"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/pty/scheduler/stop"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/pty/send-now"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    ("POST", "/pty/enter-now"): [NODE_RUNTIME_PATH, STATIC_RUNTIME_PATH],
    # /flags uses path-level server override (url: /) — actual path is /flags, not /api/flags
    ("GET", "/flags"): [NODE_RUNTIME_PATH],
    # /ui/home-runtime — 홈 런타임 상태 (WP 큐, 칸반 데이터)
    ("GET", "/ui/home-runtime"): [NODE_RUNTIME_PATH],
    # /mindmap/rebuild — Worker Thread 기반 마인드맵 재생성 (runtime: /api/mindmap/rebuild)
    ("POST", "/mindmap/rebuild"): [NODE_RUNTIME_PATH],
}

# Operations whose spec path is relative to root (/) not the default /api server.
# Used to compute the correct runtime_path when checking source files.
ROOT_SERVER_OPERATIONS: set[tuple[str, str]] = {
    ("GET", "/flags"),
    ("GET", "/ui/home-runtime"),
}

IDEMPOTENT_OPERATIONS = {
    ("POST", "/planning-studio/save-packet"),
    ("POST", "/planning-studio/save-sections"),
    ("POST", "/planning-studio/save-automation"),
    ("POST", "/planning-studio/scaffold-preview"),
    ("POST", "/planning-studio/scaffold-create"),
    ("POST", "/planning-studio/stage-run"),
    ("POST", "/pty/send"),
    ("POST", "/pty/scheduler/start"),
    ("POST", "/pty/scheduler/stop"),
    ("POST", "/pty/send-now"),
    ("POST", "/pty/enter-now"),
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


def get_operation_spec(spec: dict, method: str, path: str) -> dict:
    return (((spec.get("paths") or {}).get(path) or {}).get(method.lower()) or {})


def has_idempotency_parameter(operation: dict) -> bool:
    parameters = operation.get("parameters") or []
    for parameter in parameters:
        if isinstance(parameter, dict) and parameter.get("$ref") == "#/components/parameters/IdempotencyKeyHeader":
            return True
    return False


def has_idempotency_replay_header(operation: dict) -> bool:
    responses = operation.get("responses") or {}
    success_response = responses.get("200") or {}
    headers = success_response.get("headers") or {}
    return "Idempotency-Replayed" in headers


def collect_ui_operations(source: str) -> set[tuple[str, str]]:
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

    # fetchJson('/api/pty/...') with no second argument → GET
    for path in re.findall(r"fetchJson\('(/api/pty[^']+)'\)", source):
        operations.add(("GET", path.split("?", 1)[0].removeprefix("/api")))

    # fetchJson('/api/pty/...', {...}) with options argument → POST
    for path in re.findall(r"fetchJson\('(/api/pty[^']+)'\s*,\s*\{", source):
        operations.add(("POST", path.split("?", 1)[0].removeprefix("/api")))

    for path in re.findall(r"fetchJson\('(/api/automation[^']+)'", source):
        operations.add(("GET", path.split("?", 1)[0].removeprefix("/api")))

    # callJson for root-server paths (e.g., /flags — not under /api)
    for path, method in re.findall(r"callJson\('(/(?!api)[^']+)'\s*,\s*\{[^}]*method:\s*'([A-Z]+)'", source):
        operations.add((method.upper(), path.split("?", 1)[0]))

    return operations


def main() -> int:
    errors: list[str] = []
    spec = load_yaml(OPENAPI_PATH)
    spec_operations = collect_spec_operations(spec)

    if not spec_operations:
        errors.append("ui-shell openapi has no operations")

    frontend_operations = set()
    frontend_operations.update(collect_ui_operations(load_text(HOME_UI_PATH)))
    frontend_operations.update(collect_ui_operations(load_text(MINDMAP_UI_PATH)))
    missing_from_spec = sorted(frontend_operations - spec_operations)
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

        if operation in ROOT_SERVER_OPERATIONS:
            runtime_path = path  # path-level server url:/ — no /api prefix
        else:
            runtime_path = f"/api{path}"
        if not any(runtime_path in source_map[source] for source in sources):
            source_labels = ", ".join(source.name for source in sources)
            errors.append(f"runtime source missing for {method} {path} (expected in {source_labels})")

    for method, path in sorted(IDEMPOTENT_OPERATIONS):
        operation = get_operation_spec(spec, method, path)
        if not operation:
            continue
        if not has_idempotency_parameter(operation):
            errors.append(f"idempotent endpoint missing Idempotency-Key parameter: {method} {path}")
        if not has_idempotency_replay_header(operation):
            errors.append(f"idempotent endpoint missing Idempotency-Replayed header: {method} {path}")

    # Reverse check: every spec operation must be tracked in REQUIRED_OPERATIONS
    required_keys = set(REQUIRED_OPERATIONS.keys())
    uncovered_spec_ops = sorted(spec_operations - required_keys)
    for method, path in uncovered_spec_ops:
        errors.append(f"spec operation not tracked in REQUIRED_OPERATIONS: {method} {path}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    # Coverage summary
    node_covered = sorted(
        (m, p) for (m, p), sources in REQUIRED_OPERATIONS.items() if NODE_RUNTIME_PATH in sources
    )
    static_covered = sorted(
        (m, p) for (m, p), sources in REQUIRED_OPERATIONS.items() if STATIC_RUNTIME_PATH in sources
    )

    print("ui shell contract validation PASS")
    print(f"  spec operations          : {len(spec_operations)}")
    print(f"  required_operations      : {len(REQUIRED_OPERATIONS)} ({len(spec_operations) - len(uncovered_spec_ops)}/{len(spec_operations)} covered)")
    print(f"  frontend-mapped ops      : {len(frontend_operations)}")
    print(f"  node runtime coverage    : {len(node_covered)}/{len(REQUIRED_OPERATIONS)}")
    print(f"  static runtime coverage  : {len(static_covered)}/{len(REQUIRED_OPERATIONS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
