#!/usr/bin/env python3
"""Validate deployment smoke registry and workflow binding baseline."""

from __future__ import annotations

from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "master-shell" / "operations" / "deployment-environments.yaml"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "deployment-smoke.yml"


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def main() -> int:
    registry = load_yaml(REGISTRY_PATH)
    workflow = load_yaml(WORKFLOW_PATH)

    errors: list[str] = []

    if registry.get("version") != "0.1.0":
        errors.append('registry: version must be "0.1.0"')
    if registry.get("workflow") != ".github/workflows/deployment-smoke.yml":
        errors.append("registry: workflow path mismatch")

    required_vars = registry.get("required_github_environment_vars", [])
    for name in [
        "DEPLOYMENT_BASE_URL",
        "TASK_WRITE_PERMISSIONS",
        "TASK_READ_PERMISSIONS",
        "FLAG_OFF_PATH",
        "FLAG_OFF_PERMISSIONS",
    ]:
        if name not in required_vars:
            errors.append(f"registry: missing required GitHub environment var {name}")

    environments = registry.get("environments", [])
    if not environments:
        errors.append("registry: at least one environment must be declared")

    env_names: list[str] = []
    for item in environments:
        github_environment = item.get("github_environment")
        if not github_environment:
            errors.append("registry: each environment needs github_environment")
            continue
        env_names.append(str(github_environment))
        if not item.get("rollout_phase"):
            errors.append(f"registry: {github_environment} missing rollout_phase")
        if not item.get("vars", {}).get("base_url"):
            errors.append(f"registry: {github_environment} missing vars.base_url")

    on_block = workflow.get("on")
    if on_block is None and True in workflow:
        on_block = workflow.get(True)
    workflow_inputs = (on_block or {}).get("workflow_dispatch", {}).get("inputs", {})
    environment_input = workflow_inputs.get("environment_name", {})
    if environment_input.get("type") != "choice":
        errors.append("workflow: environment_name input must be choice")
    options = environment_input.get("options", [])
    if options != env_names:
        errors.append(f"workflow: environment_name options must match registry order {env_names}")

    base_url_override = workflow_inputs.get("base_url_override", {})
    if base_url_override.get("type") != "string":
        errors.append("workflow: base_url_override input must be string")

    job = workflow.get("jobs", {}).get("deployment-smoke", {})
    environment = job.get("environment", {})
    if environment.get("name") != "${{ inputs.environment_name }}":
        errors.append("workflow: deployment-smoke job must bind environment.name to inputs.environment_name")

    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")
    if "scripts/resolve_deployment_target.py" not in workflow_text:
        errors.append("workflow: resolve_deployment_target.py step is missing")
    if "npm run smoke:deployment --" not in workflow_text:
        errors.append("workflow: smoke:deployment invocation missing")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("deployment smoke binding validation PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
