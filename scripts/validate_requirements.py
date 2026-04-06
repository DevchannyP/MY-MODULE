#!/usr/bin/env python3
"""Validate the Stage A requirements input without extra repo dependencies."""

from __future__ import annotations

from pathlib import Path
import json
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REQUIREMENTS = ROOT / "requirements/requirements.yaml"
SCHEMA_PATH = ROOT / "requirements/requirements.schema.json"

MODULE_ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
CONTRACT_PATH_RE = re.compile(r"^(domains|platform)/.+/(contract|contracts)/[^/]+$")
SEMVER_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
STAGES = {"A", "B", "C", "D", "E"}
EXPECTED_GATES = {
    "correctness": {"unit-tests", "contract-tests", "integration-tests", "e2e-smoke"},
    "code_health": {"lint", "type-check", "static-analysis"},
    "security": {
        "secret-scan",
        "dependency-scan",
        "authn-authz-regression",
        "input-validation",
    },
    "supply_chain": {
        "sbom",
        "provenance-evidence",
        "rollback-verification",
        "observability-check",
    },
}
EXPECTED_CONTRACT_SUFFIX = {
    "http": "openapi.yaml",
    "events": "events.schema.json",
    "ui": "ui-contract.yaml",
    "capability": "capability.yaml",
}


def load_yaml(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def relative_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def add_error(errors: list[str], message: str) -> None:
    errors.append(message)


def require_mapping(errors: list[str], label: str, value: object) -> dict:
    if not isinstance(value, dict):
        add_error(errors, f"{label}: expected mapping")
        return {}
    return value


def require_list(errors: list[str], label: str, value: object) -> list:
    if not isinstance(value, list):
        add_error(errors, f"{label}: expected list")
        return []
    return value


def require_string(
    errors: list[str],
    label: str,
    value: object,
    *,
    min_length: int = 1,
    pattern: re.Pattern[str] | None = None,
) -> str:
    if not isinstance(value, str):
        add_error(errors, f"{label}: expected string")
        return ""
    if len(value.strip()) < min_length:
        add_error(errors, f"{label}: expected string length >= {min_length}")
    if pattern and not pattern.fullmatch(value):
        add_error(errors, f"{label}: invalid format -> {value}")
    return value


def resolve_input_path(raw_path: str | None) -> Path:
    if not raw_path:
        return DEFAULT_REQUIREMENTS

    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return ROOT / candidate


def validate_contract_path(errors: list[str], label: str, value: object) -> str:
    path_value = require_string(errors, label, value, pattern=CONTRACT_PATH_RE)
    if not path_value:
        return ""

    if "/src/" in path_value or path_value.endswith(".js"):
        add_error(errors, f"{label}: contract path must not point to implementation -> {path_value}")

    path = ROOT / path_value
    if not path.exists():
        add_error(errors, f"{label}: file does not exist -> {path_value}")

    return path_value


def validate_gate_list(errors: list[str], label: str, value: object, expected: set[str]) -> None:
    entries = require_list(errors, label, value)
    if not entries:
        add_error(errors, f"{label}: at least one gate is required")
        return

    non_strings = [entry for entry in entries if not isinstance(entry, str) or not entry.strip()]
    if non_strings:
        add_error(errors, f"{label}: gate names must be non-empty strings")
        return

    missing = sorted(expected - set(entries))
    if missing:
        add_error(errors, f"{label}: missing baseline gates -> {missing}")


def validate_requirements(target_path: Path) -> list[str]:
    errors: list[str] = []

    if not target_path.exists():
        return [f"requirements file not found -> {relative_path(target_path)}"]

    try:
        data = load_yaml(target_path)
    except yaml.YAMLError as exc:
        return [f"{relative_path(target_path)}: YAML parse error -> {exc}"]

    try:
        with SCHEMA_PATH.open("r", encoding="utf-8") as handle:
            json.load(handle)
    except json.JSONDecodeError as exc:
        errors.append(f"{relative_path(SCHEMA_PATH)}: JSON parse error -> {exc}")

    document = require_mapping(errors, relative_path(target_path), data)
    allowed_top_level = {
        "version",
        "module",
        "stage",
        "contracts",
        "nfr",
        "quality_gates",
        "composition",
        "feature_flags",
        "routing",
    }
    unknown_top_level = sorted(set(document) - allowed_top_level)
    if unknown_top_level:
        add_error(errors, f"unexpected top-level keys -> {unknown_top_level}")

    required_top_level = sorted(allowed_top_level - set(document))
    if required_top_level:
        add_error(errors, f"missing top-level keys -> {required_top_level}")

    require_string(errors, "version", document.get("version"), pattern=SEMVER_RE)

    module = require_mapping(errors, "module", document.get("module"))
    expected_module_keys = {"id", "name", "domain", "bounded_context", "owner", "description"}
    missing_module_keys = sorted(expected_module_keys - set(module))
    if missing_module_keys:
        add_error(errors, f"module: missing keys -> {missing_module_keys}")
    unknown_module_keys = sorted(set(module) - expected_module_keys)
    if unknown_module_keys:
        add_error(errors, f"module: unexpected keys -> {unknown_module_keys}")

    require_string(errors, "module.id", module.get("id"), pattern=MODULE_ID_RE)
    require_string(errors, "module.name", module.get("name"), min_length=2)
    require_string(errors, "module.domain", module.get("domain"), pattern=MODULE_ID_RE)
    require_string(
        errors,
        "module.bounded_context",
        module.get("bounded_context"),
        pattern=MODULE_ID_RE,
    )
    require_string(errors, "module.owner", module.get("owner"), min_length=2)
    require_string(errors, "module.description", module.get("description"), min_length=20)

    stage = require_string(errors, "stage", document.get("stage"))
    if stage and stage not in STAGES:
        add_error(errors, f"stage: expected one of {sorted(STAGES)}")

    contracts = require_mapping(errors, "contracts", document.get("contracts"))
    expected_contract_keys = {"http", "events", "ui", "capability"}
    missing_contract_keys = sorted(expected_contract_keys - set(contracts))
    if missing_contract_keys:
        add_error(errors, f"contracts: missing keys -> {missing_contract_keys}")
    unknown_contract_keys = sorted(set(contracts) - expected_contract_keys)
    if unknown_contract_keys:
        add_error(errors, f"contracts: unexpected keys -> {unknown_contract_keys}")

    resolved_contracts: dict[str, str] = {}
    for contract_key, suffix in EXPECTED_CONTRACT_SUFFIX.items():
        path_value = validate_contract_path(errors, f"contracts.{contract_key}", contracts.get(contract_key))
        if path_value and not path_value.endswith(suffix):
            add_error(errors, f"contracts.{contract_key}: expected suffix {suffix} -> {path_value}")
        if path_value:
            resolved_contracts[contract_key] = path_value

    if len(set(resolved_contracts.values())) != len(resolved_contracts):
        add_error(errors, "contracts: duplicate paths are not allowed")

    nfr = require_mapping(errors, "nfr", document.get("nfr"))
    expected_nfr_keys = {"latency_p99_ms", "availability_percent", "rpo_minutes", "rto_minutes"}
    missing_nfr_keys = sorted(expected_nfr_keys - set(nfr))
    if missing_nfr_keys:
        add_error(errors, f"nfr: missing keys -> {missing_nfr_keys}")
    unknown_nfr_keys = sorted(set(nfr) - expected_nfr_keys)
    if unknown_nfr_keys:
        add_error(errors, f"nfr: unexpected keys -> {unknown_nfr_keys}")

    latency = nfr.get("latency_p99_ms")
    if not isinstance(latency, int) or latency <= 0:
        add_error(errors, "nfr.latency_p99_ms: expected positive integer")

    availability = nfr.get("availability_percent")
    if not isinstance(availability, (int, float)) or not (90 <= availability <= 100):
        add_error(errors, "nfr.availability_percent: expected number between 90 and 100")

    for key in ("rpo_minutes", "rto_minutes"):
        value = nfr.get(key)
        if not isinstance(value, int) or value < 0:
            add_error(errors, f"nfr.{key}: expected integer >= 0")

    quality_gates = require_mapping(errors, "quality_gates", document.get("quality_gates"))
    missing_quality_gate_groups = sorted(set(EXPECTED_GATES) - set(quality_gates))
    if missing_quality_gate_groups:
        add_error(errors, f"quality_gates: missing groups -> {missing_quality_gate_groups}")
    unknown_quality_gate_groups = sorted(set(quality_gates) - set(EXPECTED_GATES))
    if unknown_quality_gate_groups:
        add_error(errors, f"quality_gates: unexpected groups -> {unknown_quality_gate_groups}")

    for group_name, expected in EXPECTED_GATES.items():
        validate_gate_list(errors, f"quality_gates.{group_name}", quality_gates.get(group_name), expected)

    composition = require_mapping(errors, "composition", document.get("composition"))
    expected_composition_keys = {"depends_on", "provides"}
    missing_composition_keys = sorted(expected_composition_keys - set(composition))
    if missing_composition_keys:
        add_error(errors, f"composition: missing keys -> {missing_composition_keys}")
    unknown_composition_keys = sorted(set(composition) - expected_composition_keys)
    if unknown_composition_keys:
        add_error(errors, f"composition: unexpected keys -> {unknown_composition_keys}")

    depends_on = require_list(errors, "composition.depends_on", composition.get("depends_on"))
    for index, dependency_path in enumerate(depends_on):
        validate_contract_path(errors, f"composition.depends_on[{index}]", dependency_path)
    if len(depends_on) != len(set(depends_on)):
        add_error(errors, "composition.depends_on: schema violation -> items must be unique")

    provides = require_list(errors, "composition.provides", composition.get("provides"))
    if not provides:
        add_error(errors, "composition.provides: at least one provided contract is required")
    for index, provided_path in enumerate(provides):
        validate_contract_path(errors, f"composition.provides[{index}]", provided_path)
    capability_path = resolved_contracts.get("capability")
    if capability_path and capability_path not in provides:
        add_error(errors, "composition.provides: must include contracts.capability")

    feature_flags = require_mapping(errors, "feature_flags", document.get("feature_flags"))
    if not feature_flags:
        add_error(errors, "feature_flags: at least one feature flag is required")
    for flag_name, flag_value in feature_flags.items():
        require_string(errors, f"feature_flags.{flag_name}", flag_name, min_length=1)
        if not isinstance(flag_value, bool):
            add_error(errors, f"feature_flags.{flag_name}: expected boolean")

    routing = require_mapping(errors, "routing", document.get("routing"))
    expected_routing_keys = {"entry_point", "navigation_group", "plugin_slot"}
    missing_routing_keys = sorted(expected_routing_keys - set(routing))
    if missing_routing_keys:
        add_error(errors, f"routing: missing keys -> {missing_routing_keys}")
    unknown_routing_keys = sorted(set(routing) - expected_routing_keys)
    if unknown_routing_keys:
        add_error(errors, f"routing: unexpected keys -> {unknown_routing_keys}")

    entry_point = require_string(errors, "routing.entry_point", routing.get("entry_point"), min_length=2)
    if entry_point and not entry_point.startswith("/"):
        add_error(errors, f"routing.entry_point: expected absolute path -> {entry_point}")

    require_string(
        errors,
        "routing.navigation_group",
        routing.get("navigation_group"),
        pattern=MODULE_ID_RE,
    )
    require_string(errors, "routing.plugin_slot", routing.get("plugin_slot"), min_length=1)

    return errors


def discover_domain_requirements() -> list[Path]:
    """Return paths of all requirements/*.yaml files that declare a module.id."""
    results: list[Path] = []
    for path in sorted((ROOT / "requirements").glob("*.yaml")):
        try:
            data = load_yaml(path)
            if isinstance(data, dict) and isinstance(data.get("module", {}).get("id"), str):
                results.append(path)
        except Exception:
            pass
    return results


def main(argv: list[str]) -> int:
    # --all scans every requirements/*.yaml with a module.id
    if "--all" in argv:
        domain_files = discover_domain_requirements()
        if not domain_files:
            print("No domain requirements files found.", file=sys.stderr)
            return 1
        exit_code = 0
        for path in domain_files:
            errors = validate_requirements(path)
            if errors:
                for error in errors:
                    print(f"ERROR: {error}")
                exit_code = 1
            else:
                print(f"requirements validation PASS: {relative_path(path)}")
        return exit_code

    if len(argv) > 2:
        print("usage: validate_requirements.py [requirements-path | --all]")
        return 2

    target_path = resolve_input_path(argv[1] if len(argv) == 2 else None)
    errors = validate_requirements(target_path)

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"requirements validation PASS: {relative_path(target_path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
