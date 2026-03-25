#!/usr/bin/env python3
"""Validate contract drift between domain contracts, central event contracts, and interface code."""

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


def load_data(relative_path: str) -> dict:
    return load_json(relative_path) if relative_path.endswith(".json") else load_yaml(relative_path)


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


def video_event_ids(events_schema: dict) -> set[str]:
    return {
        name
        for name in events_schema.get("definitions", {}).keys()
        if name != "EventEnvelope"
    }


def billing_event_ids(events_schema: dict) -> set[str]:
    definitions = {
        name
        for name in events_schema.get("definitions", {}).keys()
        if name not in {"Money", "EventEnvelope"}
    }
    if definitions:
        return definitions

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


def resolve_pointer(document: dict, pointer: str):
    if not pointer:
        return document
    if not pointer.startswith("#/"):
        raise ValueError(f"unsupported pointer format: {pointer}")

    current = document
    for token in pointer[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            try:
                index = int(token)
            except ValueError as exc:
                raise KeyError(token) from exc
            current = current[index]
            continue
        current = current[token]
    return current


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


def validate_video(errors: list[str]) -> None:
    capability = load_yaml("domains/video/contract/capability.yaml")
    ui = load_yaml("domains/video/contract/ui-contract.yaml")
    openapi_spec = load_yaml("domains/video/contract/openapi.yaml")
    events_schema = load_json("domains/video/contract/events.schema.json")
    controller_source = load_text("domains/video/src/interface/VideoController.js")

    operations = operation_map(openapi_spec)
    ui_module_keys = {screen["module_key"] for screen in ui.get("screens", [])}

    for item in capability.get("capabilities", []):
        for operation_id in item.get("http_operations", []):
            if operation_id not in operations:
                errors.append(f"video: capability {item['id']} references unknown operationId {operation_id}")
        for screen_key in item.get("screens", []):
            if screen_key not in ui_module_keys:
                errors.append(f"video: capability {item['id']} references unknown screen {screen_key}")

    defined_event_ids = video_event_ids(events_schema)
    for event_id in capability.get("events_emitted", []):
        if event_id not in defined_event_ids:
            errors.append(f"video: events.schema.json missing event definition {event_id}")

    for operation_id, detail in operations.items():
        normalized_path = re.sub(r"\{([^}]+)\}", r":\1", detail["path"])
        assert_contains(
            errors,
            controller_source,
            f"path === '{normalized_path}'",
            f"video controller routing for {operation_id}",
        )


def validate_event_registry(errors: list[str]) -> None:
    registry = load_yaml("contracts/events/registry.yaml")
    envelope_path = registry.get("envelope")

    if not isinstance(envelope_path, str) or not (REPO_ROOT / envelope_path).exists():
        errors.append("events-registry: envelope path is missing or does not exist")
        return

    envelope_schema = load_json(envelope_path)
    required_envelope_fields = {"specversion", "id", "source", "type", "time"}
    if not required_envelope_fields.issubset(set(envelope_schema.get("required", []))):
        errors.append("events-registry: envelope.schema.json is missing CloudEvents required fields")

    task_events_schema = load_json("domains/productivity/task-tracking/contract/events.schema.json")
    billing_events_schema = load_json("domains/billing/contracts/events.schema.json")
    video_events_schema = load_json("domains/video/contract/events.schema.json")
    registry_task_defs: set[str] = set()
    registry_billing_defs: set[str] = set()
    registry_video_defs: set[str] = set()
    seen_types: set[str] = set()

    for event in registry.get("events", []):
        event_type = event.get("type")
        source = event.get("source")
        schema_ref = event.get("schema")

        if not isinstance(event_type, str) or not event_type.startswith("com.workflow-os."):
            errors.append(f"events-registry: invalid event type {event_type!r}")
        elif event_type in seen_types:
            errors.append(f"events-registry: duplicate event type {event_type}")
        else:
            seen_types.add(event_type)

        if not isinstance(source, str) or not source.startswith("//workflow-os/"):
            errors.append(f"events-registry: invalid event source for {event_type!r}")

        if not isinstance(schema_ref, str) or "#/" not in schema_ref:
            errors.append(f"events-registry: invalid schema ref for {event_type!r}")
            continue

        schema_path, pointer = schema_ref.split("#", 1)
        schema_file = REPO_ROOT / schema_path
        if not schema_file.exists():
            errors.append(f"events-registry: schema file missing for {event_type}: {schema_path}")
            continue

        document = load_data(schema_path)
        try:
            resolve_pointer(document, f"#{pointer}")
        except (KeyError, IndexError, ValueError):
            errors.append(f"events-registry: schema pointer missing for {event_type}: {schema_ref}")
            continue

        definition_name = pointer.rsplit("/", 1)[-1]
        normalized_schema_path = schema_path.replace("\\", "/")
        if normalized_schema_path == "domains/productivity/task-tracking/contract/events.schema.json":
            registry_task_defs.add(definition_name)
        if normalized_schema_path == "domains/billing/contracts/events.schema.json":
            registry_billing_defs.add(definition_name)
        if normalized_schema_path == "domains/video/contract/events.schema.json":
            registry_video_defs.add(definition_name)

        for producer in event.get("produced_by", []):
            if not (REPO_ROOT / producer).exists():
                errors.append(f"events-registry: produced_by path missing for {event_type}: {producer}")

    missing_task = sorted(task_event_ids(task_events_schema) - registry_task_defs)
    if missing_task:
        errors.append(f"events-registry: task-tracking registry coverage missing {missing_task}")

    missing_billing = sorted(billing_event_ids(billing_events_schema) - registry_billing_defs)
    if missing_billing:
        errors.append(f"events-registry: billing registry coverage missing {missing_billing}")

    missing_video = sorted(video_event_ids(video_events_schema) - registry_video_defs)
    if missing_video:
        errors.append(f"events-registry: video registry coverage missing {missing_video}")


def main() -> int:
    errors: list[str] = []
    validate_task_management(errors)
    validate_billing(errors)
    validate_video(errors)
    validate_event_registry(errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("contract drift validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
