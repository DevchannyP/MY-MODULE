#!/usr/bin/env python3
"""Validate contract drift between capability/ui/openapi/events and interface code."""

from __future__ import annotations

from pathlib import Path
import json
import re
import sys

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent


def load_yaml(relative_path: str) -> dict:
    with (REPO_ROOT / relative_path).open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_json(relative_path: str) -> dict:
    with (REPO_ROOT / relative_path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def operation_map(openapi_spec: dict) -> dict[str, dict]:
    operations = {}
    for path, methods in openapi_spec.get("paths", {}).items():
        for method, spec in methods.items():
            if method.lower() not in {"get", "post", "patch", "put", "delete"}:
                continue
            operations[spec["operationId"]] = {
                "path": path,
                "method": method.upper(),
                "spec": spec,
            }
    return operations


def kebab_to_camel(value: str) -> str:
    head, *tail = value.split("-")
    return head + "".join(part.capitalize() for part in tail)


def resolve_schema(schema: dict, components: dict) -> dict:
    if "$ref" in schema:
        ref = schema["$ref"]
        prefix = "#/components/schemas/"
        if not ref.startswith(prefix):
            raise ValueError(f"unsupported schema ref: {ref}")
        return components[ref[len(prefix):]]
    return schema


def schema_properties(schema: dict, components: dict) -> set[str]:
    resolved = resolve_schema(schema, components)
    return set(resolved.get("properties", {}).keys())


def task_event_ids(events_schema: dict) -> set[str]:
    return set(events_schema.get("definitions", {}).keys())


def billing_event_ids(events_schema: dict) -> set[str]:
    names: set[str] = set()
    for variant in events_schema.get("oneOf", []):
        for item in variant.get("allOf", []):
            event_type = item.get("properties", {}).get("event_type", {}).get("const")
            if event_type:
                names.add(event_type)
    return names


def assert_contains(errors: list[str], source: str, needle: str, context: str) -> None:
    if needle not in source:
        errors.append(f"{context}: missing source snippet -> {needle}")


def validate_task_management(errors: list[str]) -> None:
    capability = load_yaml("domains/productivity/task-tracking/contract/capability.yaml")
    ui = load_yaml("domains/productivity/task-tracking/contract/ui-contract.yaml")
    openapi_spec = load_yaml("domains/productivity/task-tracking/contract/openapi.yaml")
    events_schema = load_json("domains/productivity/task-tracking/contract/events.schema.json")
    controller_source = load_text("domains/productivity/task-tracking/src/interface/TaskController.js")

    capabilities = capability.get("capabilities", [])
    capability_ids = {item["id"] for item in capabilities}

    for screen in ui.get("screens", []):
        for capability_id in screen.get("capabilities_required", []):
            if capability_id not in capability_ids:
                errors.append(f"task-management: UI screen {screen['id']} references unknown capability {capability_id}")
        for requirement in screen.get("data_requirements", []):
            source = requirement.get("source")
            if source and source not in capability_ids:
                errors.append(f"task-management: UI screen {screen['id']} references unknown data source {source}")

    operations = operation_map(openapi_spec)
    expected_operation_ids = {kebab_to_camel(item["id"]) for item in capabilities}
    if set(operations) != expected_operation_ids:
        errors.append(
            "task-management: openapi operationIds do not match capability ids "
            f"({sorted(set(operations))} != {sorted(expected_operation_ids)})"
        )

    components = openapi_spec.get("components", {}).get("schemas", {})
    response_expectations = {
        "create-task": ("201", "createTask"),
        "get-task": ("200", "getTask"),
        "list-tasks": ("200", "listTasks"),
        "transition-task-status": ("200", "transitionTaskStatus"),
    }
    for capability_id, (status_code, operation_id) in response_expectations.items():
        capability_item = next(item for item in capabilities if item["id"] == capability_id)
        output_schema = capability_item.get("output_schema")
        if not output_schema:
            continue
        expected_props = set(output_schema.get("properties", {}).keys())
        response_schema = operations[operation_id]["spec"]["responses"][status_code]["content"]["application/json"]["schema"]
        actual_props = schema_properties(response_schema, components)
        if actual_props != expected_props:
            errors.append(
                f"task-management: capability {capability_id} output != openapi {operation_id} response "
                f"({sorted(actual_props)} != {sorted(expected_props)})"
            )

    event_ids = task_event_ids(events_schema)
    for event in capability.get("events_emitted", []):
        event_id = event.get("id")
        if event_id and event_id not in event_ids:
            errors.append(f"task-management: events.schema.json missing event definition {event_id}")

    route_snippets = {
        "/tasks": "path === '/tasks'",
        "/tasks/{task_id}": "path.match(/^\\/tasks\\/([^/]+)$/)",
        "/tasks/{task_id}/status": "path.match(/^\\/tasks\\/([^/]+)\\/status$/)",
        "/tasks/{task_id}/assignee": "path.match(/^\\/tasks\\/([^/]+)\\/assignee$/)",
    }
    for path, snippet in route_snippets.items():
        if path not in openapi_spec.get("paths", {}):
            errors.append(f"task-management: openapi missing path {path}")
        assert_contains(errors, controller_source, snippet, "task-management controller routing")


def validate_billing(errors: list[str]) -> None:
    capability = load_yaml("domains/billing/contracts/capability.yaml")
    ui = load_yaml("domains/billing/contracts/ui-contract.yaml")
    openapi_spec = load_yaml("domains/billing/contracts/openapi.yaml")
    events_schema = load_json("domains/billing/contracts/events.schema.json")
    controller_source = load_text("domains/billing/src/interface/BillingController.js")

    operations = operation_map(openapi_spec)
    ui_module_keys = {screen["module_key"] for screen in ui.get("screens", [])}

    for item in capability.get("capabilities", []):
        for operation_id in item.get("http_operations", []):
            if operation_id not in operations:
                errors.append(f"billing: capability {item['id']} references unknown operationId {operation_id}")
        for screen_key in item.get("screens", []):
            if screen_key not in ui_module_keys:
                errors.append(f"billing: capability {item['id']} references unknown screen {screen_key}")

    defined_event_ids = billing_event_ids(events_schema)
    for event_id in capability.get("events_emitted", []):
        if event_id not in defined_event_ids:
            errors.append(f"billing: events.schema.json missing event definition {event_id}")

    for operation_id, detail in operations.items():
        normalized_path = re.sub(r"\{([^}]+)\}", r":\1", detail["path"])
        assert_contains(
            errors,
            controller_source,
            f"path === '{normalized_path}'",
            f"billing controller routing for {operation_id}",
        )


def main() -> int:
    errors: list[str] = []
    validate_task_management(errors)
    validate_billing(errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("contract drift validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
