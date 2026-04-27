#!/usr/bin/env python3
"""Generate an operator-facing audit template for remote deployment environments."""

from __future__ import annotations

from datetime import date
import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "master-shell" / "operations" / "deployment-environments.yaml"
POLICY_PATH = ROOT / "master-shell" / "operations" / "deployment-environment-provisioning.yaml"
OUTPUT_PATH = ROOT / "artifacts" / "deployment-smoke" / "environment-provisioning-audit-template.json"


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def endpoint(owner: str, repo: str, env_name: str) -> str:
    return f"/repos/{owner}/{repo}/environments/{env_name}"


def variable_endpoint(owner: str, repo: str, env_name: str) -> str:
    return f"/repos/{owner}/{repo}/environments/{env_name}/variables"


def branch_policy_endpoint(owner: str, repo: str, env_name: str) -> str:
    return f"/repos/{owner}/{repo}/environments/{env_name}/deployment-branch-policies"


def main() -> int:
    registry = load_yaml(REGISTRY_PATH)
    policy = load_yaml(POLICY_PATH)
    owner_placeholder = "<repo-owner>"
    repo_placeholder = "<repo-name>"

    policy_by_id = {item["id"]: item for item in policy.get("environments", [])}
    environments = []

    for item in registry.get("environments", []):
        env_id = item["id"]
        github_environment = item["github_environment"]
        policy_item = policy_by_id[env_id]

        environments.append({
            "id": env_id,
            "github_environment": github_environment,
            "rollout_phase": item.get("rollout_phase"),
            "expected": {
                "required_environment_vars": policy_item.get("required_environment_vars", []),
                "protection_rules": policy_item.get("protection_rules", {}),
            },
            "observed": {
                "captured_at": "",
                "captured_by": "",
                "source": "gh api",
                "owner": owner_placeholder,
                "repo": repo_placeholder,
                "environment_exists": None,
                "variables_present": [],
                "protection_rules": {
                    "required_reviewers_count": None,
                    "prevent_self_review": None,
                    "allow_admin_bypass": None,
                    "wait_timer_minutes": None,
                    "deployment_branch_policy": {
                        "mode": "",
                        "patterns": [],
                    },
                },
            },
            "collection_hints": {
                "environment_endpoint": endpoint(owner_placeholder, repo_placeholder, github_environment),
                "variables_endpoint": variable_endpoint(owner_placeholder, repo_placeholder, github_environment),
                "branch_policy_endpoint": branch_policy_endpoint(owner_placeholder, repo_placeholder, github_environment),
            },
        })

    payload = {
        "schema_version": "0.1.0",
        "generated_at": date.today().isoformat(),
        "registry_path": str(REGISTRY_PATH.relative_to(ROOT)),
        "policy_path": str(POLICY_PATH.relative_to(ROOT)),
        "note": "Template only. Replace placeholder owner/repo and null observed fields with live GitHub environment audit results.",
        "environments": environments,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print(str(OUTPUT_PATH.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
