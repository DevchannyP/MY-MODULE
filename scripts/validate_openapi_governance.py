#!/usr/bin/env python3
"""Validate OpenAPI governance rules across domain contracts."""

from __future__ import annotations

from pathlib import Path
import re
import sys

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
PROBLEM_RESPONSES = ("BadRequest", "Unauthorized", "Forbidden", "NotFound", "Conflict")


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def validate_spec(path: Path) -> list[str]:
    spec = load_yaml(path)
    errors: list[str] = []
    rel = path.relative_to(REPO_ROOT)

    info = spec.get("info", {})
    version = info.get("version")
    if not isinstance(version, str) or not SEMVER.match(version):
        errors.append(f"{rel}: info.version must be semver (x.y.z)")

    for field in ("x-api-id", "x-api-audience", "x-api-version-policy"):
        if field not in info:
            errors.append(f"{rel}: info.{field} missing")

    components = spec.get("components", {})
    schemas = components.get("schemas", {})
    responses = components.get("responses", {})
    problem = schemas.get("ProblemDetails")

    if not isinstance(problem, dict):
        errors.append(f"{rel}: components.schemas.ProblemDetails missing")
    else:
        required = set(problem.get("required", []))
        expected = {"type", "title", "status", "code", "message"}
        missing = sorted(expected - required)
        if missing:
            errors.append(f"{rel}: ProblemDetails required fields missing -> {', '.join(missing)}")

    for response_name in PROBLEM_RESPONSES:
        response = responses.get(response_name)
        if not isinstance(response, dict):
          errors.append(f"{rel}: components.responses.{response_name} missing")
          continue
        content = response.get("content", {})
        problem_json = content.get("application/problem+json")
        if not isinstance(problem_json, dict):
            errors.append(f"{rel}: {response_name} must use application/problem+json")
            continue
        schema = problem_json.get("schema", {})
        if schema.get("$ref") != "#/components/schemas/ProblemDetails":
            errors.append(f"{rel}: {response_name} must reference ProblemDetails schema")

    return errors


def main() -> int:
    errors: list[str] = []
    specs = sorted((REPO_ROOT / "domains").rglob("openapi.yaml"))

    if not specs:
        print("⚠️ no domain openapi specs found")
        return 0

    for spec_path in specs:
        errors.extend(validate_spec(spec_path))

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"openapi governance validation PASS ({len(specs)} specs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
