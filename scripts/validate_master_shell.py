#!/usr/bin/env python3
"""Validate cross-file consistency for the master-shell composition layer."""

from __future__ import annotations

from pathlib import Path
import sys

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent


def load_yaml(relative_path: str) -> dict:
    path = REPO_ROOT / relative_path
    with path.open("r", encoding="utf-8") as handle:
      return yaml.safe_load(handle) or {}


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


def main() -> int:
    registry = load_yaml("master-shell/plugin-registry/registry.yaml")
    navigation = load_yaml("master-shell/navigation/nav.yaml")
    catalog = load_yaml("master-shell/catalog/domains.yaml")
    flags = load_yaml("master-shell/feature-flags/flags.yaml")
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

    for plugin_id, plugin in plugin_map.items():
        for field in ("ui_contract", "capability_contract", "stage_b_memory_ref"):
            ref = plugin.get(field)
            if not isinstance(ref, str) or not file_exists(ref):
                errors.append(f"{plugin_id}: missing or invalid {field} -> {ref}")

        feature_flag = plugin.get("feature_flag")
        if feature_flag not in feature_flags:
            errors.append(f"{plugin_id}: feature flag not registered -> {feature_flag}")

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

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("master-shell composition validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
