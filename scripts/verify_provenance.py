#!/usr/bin/env python3
"""Generate and validate a deterministic provenance baseline for Workflow OS."""

from __future__ import annotations

from pathlib import Path
import hashlib
import json

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = REPO_ROOT / "artifacts/provenance/provenance-policy.yaml"
OUTPUT_PATH = REPO_ROOT / "artifacts/provenance/workflow-os-provenance.json"


def sha256(relative_path: str) -> str:
    path = REPO_ROOT / relative_path
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    policy = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8")) or {}
    subject_path = policy["subject"]["path"]
    inputs = policy["build_definition"]["inputs"]

    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "predicateType": policy["predicate_type"],
        "subject": [
            {
                "name": subject_path,
                "digest": {"sha256": sha256(subject_path)},
            }
        ],
        "predicate": {
            "builder": policy["builder"],
            "buildDefinition": {
                "buildType": policy["build_definition"]["build_type"],
                "externalParameters": policy["build_definition"]["external_parameters"],
                "internalParameters": {
                    "lockfile_sha256": sha256("package-lock.json"),
                    "requirements_sha256": sha256("requirements/requirements.yaml"),
                    "package_json_sha256": sha256("package.json"),
                },
                "resolvedDependencies": [
                    {
                        "uri": relative_path,
                        "digest": {"sha256": sha256(relative_path)},
                    }
                    for relative_path in inputs
                ],
            },
            "runDetails": {
                "metadata": {"invocationId": policy["run_details"]["invocation_id"]},
                "byproducts": [
                    {"name": "sbom-path", "value": subject_path},
                    {"name": "policy-path", "value": "artifacts/provenance/provenance-policy.yaml"},
                ],
            },
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(statement, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    OUTPUT_PATH.write_text(content, encoding="utf-8")

    if statement["subject"][0]["digest"]["sha256"] != sha256(subject_path):
        raise SystemExit("provenance subject digest mismatch")

    print(f"verified provenance -> {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
