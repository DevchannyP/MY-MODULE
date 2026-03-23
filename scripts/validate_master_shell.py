#!/usr/bin/env python3
"""Validate cross-file consistency for the master-shell composition layer."""

from __future__ import annotations

from pathlib import Path
import json
import sys
from datetime import date

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent


def load_yaml(relative_path: str) -> dict:
    path = REPO_ROOT / relative_path
    with path.open("r", encoding="utf-8") as handle:
      return yaml.safe_load(handle) or {}


def load_json(relative_path: str) -> dict:
    path = REPO_ROOT / relative_path
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle) or {}


def file_exists(relative_path: str) -> bool:
    return (REPO_ROOT / relative_path).exists()


def parse_anchor(reference: str) -> tuple[str, str | None]:
    if "#" not in reference:
        return reference, None

    path, anchor = reference.split("#", 1)
    return path, anchor


def stage_b_entry_points(stage_b_memory_ref: str) -> set[str]:
    data = load_yaml(stage_b_memory_ref)
    entries = set()

    navigation_flow = data.get("navigation_flow", {})
    if isinstance(navigation_flow, dict):
        entry = navigation_flow.get("entry")
        if isinstance(entry, str):
            entries.add(entry)

    routes = data.get("routes", {})
    if isinstance(routes, dict):
        base = routes.get("base")
        if isinstance(base, str):
            entries.add(base)

    return entries


def ui_contract_feature_flags(ui_contract_ref: str) -> set[str]:
    data = load_yaml(ui_contract_ref)
    flags: set[str] = set()

    for screen in data.get("screens", []):
        feature_flag = screen.get("feature_flag")
        if isinstance(feature_flag, str) and feature_flag:
            flags.add(feature_flag)

    return flags


def main() -> int:
    registry = load_yaml("master-shell/plugin-registry/registry.yaml")
    navigation = load_yaml("master-shell/navigation/nav.yaml")
    catalog = load_yaml("master-shell/catalog/domains.yaml")
    flags = load_yaml("master-shell/feature-flags/flags.yaml")
    flag_metadata = load_json("master-shell/feature-flags/metadata.json")
    slo_policy = load_json("master-shell/observability/slo-policy.json")
    observability = load_yaml("master-shell/observability/config.yaml")

    errors: list[str] = []

    plugins = registry.get("plugins", [])
    plugin_map = {}
    for plugin in plugins:
        plugin_id = plugin.get("id")
        if plugin_id in plugin_map:
            errors.append(f"duplicate plugin id: {plugin_id}")
        plugin_map[plugin_id] = plugin

    feature_flags = set(flags.get("global_flags", {}).keys()) | set(flags.get("plugin_flags", {}).keys())
    metadata_flags = flag_metadata.get("flags", {}) if isinstance(flag_metadata.get("flags", {}), dict) else {}
    nav_groups = {
        group.get("id"): group
        for group in navigation.get("navigation_groups", [])
    }
    dashboards = {
        dashboard.get("id"): dashboard
        for dashboard in observability.get("dashboards", [])
    }
    alert_groups = {
        alert_group.get("id"): alert_group
        for alert_group in observability.get("alert_groups", [])
    }
    slo_budgets = slo_policy.get("budgets", {}) if isinstance(slo_policy.get("budgets", {}), dict) else {}
    deployment_protection = (
        slo_policy.get("deployment_protection", {})
        if isinstance(slo_policy.get("deployment_protection", {}), dict)
        else {}
    )

    for plugin_id, plugin in plugin_map.items():
        for field in ("ui_contract", "capability_contract", "stage_b_memory_ref"):
            ref = plugin.get(field)
            if not isinstance(ref, str) or not file_exists(ref):
                errors.append(f"{plugin_id}: missing or invalid {field} -> {ref}")

        feature_flag = plugin.get("feature_flag")
        if feature_flag not in feature_flags:
            errors.append(f"{plugin_id}: feature flag not registered -> {feature_flag}")

        ui_contract_ref = plugin.get("ui_contract")
        if isinstance(ui_contract_ref, str) and file_exists(ui_contract_ref):
            for ui_flag in sorted(ui_contract_feature_flags(ui_contract_ref)):
                if ui_flag not in feature_flags:
                    errors.append(
                        f"{plugin_id}: ui-contract feature flag not registered -> {ui_flag}"
                    )

        navigation_group = plugin.get("navigation", {}).get("group")
        nav_group = nav_groups.get(navigation_group)
        if nav_group is None:
            errors.append(f"{plugin_id}: navigation group not found -> {navigation_group}")
        else:
            primary_item = None
            for item in nav_group.get("items", []):
                if item.get("plugin_id") == plugin_id and item.get("route") == plugin.get("entry_point"):
                    primary_item = item
                    break

            if primary_item is None:
                errors.append(
                    f"{plugin_id}: no navigation item matches entry point {plugin.get('entry_point')} in group {navigation_group}"
                )
            elif primary_item.get("feature_flag") != feature_flag:
                errors.append(
                    f"{plugin_id}: navigation item feature flag mismatch "
                    f"({primary_item.get('feature_flag')} != {feature_flag})"
                )

        dashboard_ref = plugin.get("observability", {}).get("dashboard")
        dashboard_path, dashboard_anchor = parse_anchor(dashboard_ref or "")
        if not file_exists(dashboard_path):
            errors.append(f"{plugin_id}: observability dashboard file missing -> {dashboard_ref}")
        elif dashboard_anchor not in dashboards:
            errors.append(f"{plugin_id}: observability dashboard id not found -> {dashboard_ref}")
        elif dashboards[dashboard_anchor].get("plugin_id") != plugin_id:
            errors.append(
                f"{plugin_id}: observability dashboard plugin mismatch -> {dashboard_ref}"
            )

        alert_group_id = plugin.get("observability", {}).get("alert_group")
        if alert_group_id not in alert_groups:
            errors.append(f"{plugin_id}: alert group not found -> {alert_group_id}")
        elif alert_groups[alert_group_id].get("plugin_id") != plugin_id:
            errors.append(f"{plugin_id}: alert group plugin mismatch -> {alert_group_id}")

        stage_b_ref = plugin.get("stage_b_memory_ref")
        if isinstance(stage_b_ref, str) and file_exists(stage_b_ref):
            entry_points = stage_b_entry_points(stage_b_ref)
            if plugin.get("entry_point") not in entry_points:
                errors.append(
                    f"{plugin_id}: entry_point {plugin.get('entry_point')} not found in Stage B memory {stage_b_ref}"
                )

    for group_id, group in nav_groups.items():
        for item in group.get("items", []):
            plugin_id = item.get("plugin_id")
            if plugin_id not in plugin_map:
                errors.append(f"navigation group {group_id}: unknown plugin id -> {plugin_id}")
                continue

            plugin = plugin_map[plugin_id]
            item_flag = item.get("feature_flag")
            if item_flag not in feature_flags:
                errors.append(f"navigation group {group_id}: unknown feature flag -> {item_flag}")
            if not str(item.get("route", "")).startswith(str(plugin.get("entry_point", ""))):
                errors.append(
                    f"navigation group {group_id}: route {item.get('route')} is outside plugin entry point {plugin.get('entry_point')}"
                )

    catalog_plugin_refs = set()
    for domain in catalog.get("domains", []):
        for plugin_id in domain.get("plugins", []):
            catalog_plugin_refs.add(plugin_id)
            if plugin_id not in plugin_map:
                errors.append(f"catalog domain {domain.get('id')}: unknown plugin -> {plugin_id}")

        for bounded_context in domain.get("bounded_contexts", []):
            memory_ref = bounded_context.get("stage_a_memory")
            if isinstance(memory_ref, str) and not file_exists(memory_ref):
                errors.append(
                    f"catalog domain {domain.get('id')}: missing stage_a_memory -> {memory_ref}"
                )

        stage_b_ref = domain.get("stage_b_memory")
        if isinstance(stage_b_ref, str) and not file_exists(stage_b_ref):
            errors.append(f"catalog domain {domain.get('id')}: missing stage_b_memory -> {stage_b_ref}")

        domain_map_ref = domain.get("domain_map_ref")
        if isinstance(domain_map_ref, str) and not file_exists(domain_map_ref):
            errors.append(f"catalog domain {domain.get('id')}: missing domain_map_ref -> {domain_map_ref}")

    for plugin_id in plugin_map:
        if plugin_id not in catalog_plugin_refs:
            errors.append(f"{plugin_id}: not referenced by master-shell catalog")

    if set(metadata_flags.keys()) != feature_flags:
        missing_metadata = sorted(feature_flags - set(metadata_flags.keys()))
        unknown_metadata = sorted(set(metadata_flags.keys()) - feature_flags)
        for flag_name in missing_metadata:
            errors.append(f"feature-flag metadata missing -> {flag_name}")
        for flag_name in unknown_metadata:
            errors.append(f"feature-flag metadata orphaned -> {flag_name}")

    today = date.today().isoformat()
    allowed_stages = {"internal", "canary", "beta", "released", "archived"}
    for flag_name, metadata in metadata_flags.items():
        if not isinstance(metadata, dict):
            errors.append(f"{flag_name}: metadata must be an object")
            continue
        owner = metadata.get("owner")
        expires_on = metadata.get("expires_on")
        stage = metadata.get("stage")
        if not isinstance(owner, str) or not owner.strip():
            errors.append(f"{flag_name}: metadata.owner must be a non-empty string")
        if not isinstance(expires_on, str) or len(expires_on) != 10:
            errors.append(f"{flag_name}: metadata.expires_on must be YYYY-MM-DD")
        elif expires_on < today and stage != "archived":
            errors.append(f"{flag_name}: metadata.expires_on is stale -> {expires_on}")
        if stage not in allowed_stages:
            errors.append(f"{flag_name}: metadata.stage invalid -> {stage}")

    required_reviewers_min = deployment_protection.get("required_reviewers_min")
    smoke_must_pass = deployment_protection.get("smoke_must_pass")
    error_budget_policy = deployment_protection.get("error_budget_policy")
    if not isinstance(required_reviewers_min, int) or required_reviewers_min < 1:
        errors.append("slo-policy: deployment_protection.required_reviewers_min must be an integer >= 1")
    if smoke_must_pass is not True:
        errors.append("slo-policy: deployment_protection.smoke_must_pass must be true")
    if error_budget_policy not in {"block-on-failure", "warn-only"}:
        errors.append(
            "slo-policy: deployment_protection.error_budget_policy must be one of block-on-failure, warn-only"
        )

    if "health" not in slo_budgets:
        errors.append("slo-policy: budgets.health missing")

    for budget_id, budget in slo_budgets.items():
        if not isinstance(budget, dict):
            errors.append(f"slo-policy: budget {budget_id} must be an object")
            continue
        latency_budget_ms = budget.get("latency_budget_ms")
        if not isinstance(latency_budget_ms, (int, float)) or latency_budget_ms <= 0:
            errors.append(f"slo-policy: budget {budget_id}.latency_budget_ms must be > 0")
        availability = budget.get("availability_percent")
        if availability is not None and (
            not isinstance(availability, (int, float)) or availability <= 0 or availability > 100
        ):
            errors.append(f"slo-policy: budget {budget_id}.availability_percent must be within (0, 100]")
        error_budget = budget.get("error_budget_percent")
        if error_budget is not None and (
            not isinstance(error_budget, (int, float)) or error_budget < 0 or error_budget > 100
        ):
            errors.append(f"slo-policy: budget {budget_id}.error_budget_percent must be within [0, 100]")

    for plugin_id in plugin_map:
        if plugin_id not in slo_budgets:
            errors.append(f"slo-policy: missing budget for plugin -> {plugin_id}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("master-shell composition validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
