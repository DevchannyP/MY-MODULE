#!/usr/bin/env python3
"""Validate deployment environment provisioning policy against the registry."""

from __future__ import annotations

from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "master-shell" / "operations" / "deployment-environments.yaml"
POLICY_PATH = ROOT / "master-shell" / "operations" / "deployment-environment-provisioning.yaml"
TEMPLATE_PATH = ROOT / "artifacts" / "deployment-smoke" / "environment-provisioning-audit-template.json"


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def index_by_id(items: list[dict]) -> dict[str, dict]:
    indexed: dict[str, dict] = {}
    for item in items:
        item_id = item.get("id")
        if item_id:
            indexed[str(item_id)] = item
    return indexed


def validate_policy(registry: dict, policy: dict) -> list[str]:
    errors: list[str] = []

    if policy.get("version") != "0.1.0":
        errors.append('policy: version must be "0.1.0"')
    if policy.get("registry") != "master-shell/operations/deployment-environments.yaml":
        errors.append("policy: registry path mismatch")
    if policy.get("evidence_template") != "artifacts/deployment-smoke/environment-provisioning-audit-template.json":
        errors.append("policy: evidence_template path mismatch")

    audit_contract = policy.get("audit_contract", {})
    if audit_contract.get("mode") != "operator-audit":
        errors.append('policy: audit_contract.mode must be "operator-audit"')
    if audit_contract.get("freshness_days") != 7:
        errors.append("policy: audit_contract.freshness_days must be 7")
    required_metadata = audit_contract.get("required_metadata", [])
    for key in ["captured_at", "captured_by", "source", "owner", "repo"]:
        if key not in required_metadata:
            errors.append(f"policy: audit_contract.required_metadata missing {key}")

    registry_envs = index_by_id(registry.get("environments", []))
    policy_envs = index_by_id(policy.get("environments", []))
    if set(policy_envs) != set(registry_envs):
        errors.append(
            "policy: environments must match registry ids "
            f"{sorted(registry_envs)} != {sorted(policy_envs)}"
        )
        return errors

    required_vars = registry.get("required_github_environment_vars", [])
    default_branch_patterns = policy.get("defaults", {}).get("branch_patterns", [])
    if "main" not in default_branch_patterns:
        errors.append("policy: defaults.branch_patterns must include main")

    for env_id, registry_env in registry_envs.items():
        policy_env = policy_envs[env_id]

        if policy_env.get("github_environment") != registry_env.get("github_environment"):
            errors.append(f"policy: {env_id} github_environment mismatch")

        env_required_vars = policy_env.get("required_environment_vars", [])
        for name in required_vars:
            if name not in env_required_vars:
                errors.append(f"policy: {env_id} missing required_environment_var {name}")

        protection = policy_env.get("protection_rules", {})
        branch_policy = protection.get("deployment_branch_policy", {})
        mode = branch_policy.get("mode")
        patterns = branch_policy.get("patterns", [])
        if mode not in {"no-restriction", "protected-only", "selected"}:
            errors.append(f"policy: {env_id} invalid deployment_branch_policy.mode {mode}")

        if mode == "selected" and not patterns:
            errors.append(f"policy: {env_id} selected branch policy requires patterns")
        if mode != "selected" and patterns:
            errors.append(f"policy: {env_id} non-selected branch policy must not declare patterns")

        reviewers_min = protection.get("required_reviewers_min")
        if not isinstance(reviewers_min, int) or reviewers_min < 0:
            errors.append(f"policy: {env_id} required_reviewers_min must be a non-negative integer")

        if env_id in {"canary", "production"}:
            if reviewers_min < 1:
                errors.append(f"policy: {env_id} must require at least one reviewer")
            if protection.get("prevent_self_review") is not True:
                errors.append(f"policy: {env_id} must enable prevent_self_review")
            if protection.get("allow_admin_bypass") is not False:
                errors.append(f"policy: {env_id} must disable admin bypass")
            if mode != "selected":
                errors.append(f"policy: {env_id} must use selected branch policy")
        if env_id == "internal" and reviewers_min != 0:
            errors.append("policy: internal must keep reviewer minimum at 0")

        if not policy_env.get("rationale"):
            errors.append(f"policy: {env_id} rationale is required")

    return errors


def validate_template_presence() -> list[str]:
    if TEMPLATE_PATH.exists():
        return []
    return [f"template: missing generated artifact {TEMPLATE_PATH.relative_to(ROOT)}"]


def main() -> int:
    registry = load_yaml(REGISTRY_PATH)
    policy = load_yaml(POLICY_PATH)

    errors = validate_policy(registry, policy)
    errors.extend(validate_template_presence())

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("deployment environment provisioning validation PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
