#!/usr/bin/env python3
"""Generate a deterministic SPDX JSON baseline SBOM for Workflow OS."""

from __future__ import annotations

from pathlib import Path
import json
import re


REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "artifacts/sbom/workflow-os.spdx.json"


def sanitize_spdx_id(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9.-]", "-", name)


def build_packages(lock_data: dict) -> list[dict]:
    packages = []
    entries = lock_data.get("packages", {})
    root = entries.get("", {})
    root_name = root.get("name", lock_data.get("name", "workflow-os"))
    root_version = root.get("version", lock_data.get("version", "0.0.0"))

    packages.append({
        "name": root_name,
        "SPDXID": f"SPDXRef-Package-{sanitize_spdx_id(root_name)}",
        "versionInfo": root_version,
        "downloadLocation": "NOASSERTION",
        "licenseConcluded": root.get("license", "NOASSERTION"),
        "licenseDeclared": root.get("license", "NOASSERTION"),
        "primaryPackagePurpose": "APPLICATION",
    })

    for path, metadata in sorted(entries.items()):
        if not path or not path.startswith("node_modules/"):
            continue
        package_name = path.removeprefix("node_modules/")
        packages.append({
            "name": package_name,
            "SPDXID": f"SPDXRef-Package-{sanitize_spdx_id(package_name)}",
            "versionInfo": metadata.get("version", "NOASSERTION"),
            "downloadLocation": metadata.get("resolved", "NOASSERTION"),
            "licenseConcluded": metadata.get("license", "NOASSERTION"),
            "licenseDeclared": metadata.get("license", "NOASSERTION"),
            "primaryPackagePurpose": "LIBRARY",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": f"pkg:npm/{package_name}@{metadata.get('version', '0.0.0')}",
                }
            ],
        })

    return packages


def main() -> int:
    lock_data = json.loads((REPO_ROOT / "package-lock.json").read_text(encoding="utf-8"))
    document = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": "workflow-os-core-sbom",
        "documentNamespace": "https://example.local/workflow-os/sbom/workflow-os-core",
        "creationInfo": {
            "created": "2026-03-18T00:00:00Z",
            "creators": ["Tool: Workflow OS SBOM Generator"],
        },
        "documentDescribes": ["SPDXRef-Package-my-module"],
        "packages": build_packages(lock_data),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(document, ensure_ascii=True, indent=2, sort_keys=False) + "\n"
    OUTPUT_PATH.write_text(content, encoding="utf-8")
    print(f"generated SBOM -> {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
