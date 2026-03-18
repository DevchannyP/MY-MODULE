#!/usr/bin/env python3
"""Validate observability and rollback operating baselines for Workflow OS."""

from __future__ import annotations

from pathlib import Path
import sys

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent


def load_yaml(relative_path: str) -> dict:
    with (REPO_ROOT / relative_path).open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def file_exists(relative_path: str) -> bool:
    return (REPO_ROOT / relative_path).exists()


def parse_anchor(reference: str) -> tuple[str, str | None]:
    if "#" not in reference:
        return reference, None
    path, anchor = reference.split("#", 1)
    return path, anchor


def validate_observability() -> int:
    registry = load_yaml("master-shell/plugin-registry/registry.yaml")
    observability = load_yaml("master-shell/observability/config.yaml")

    plugins = {plugin["id"]: plugin for plugin in registry.get("plugins", [])}
    dashboards = {item["id"]: item for item in observability.get("dashboards", [])}
    alert_groups = {item["id"]: item for item in observability.get("alert_groups", [])}
    required_log_fields = {
        "timestamp",
        "level",
        "service",
        "trace_id",
        "span_id",
        "message",
    }

    errors: list[str] = []

    global_settings = observability.get("global_settings", {})
    if not global_settings.get("tracing_enabled"):
        errors.append("observability: tracing_enabled must be true")
    if not global_settings.get("metrics_enabled"):
        errors.append("observability: metrics_enabled must be true")
    if not global_settings.get("logging_enabled"):
        errors.append("observability: logging_enabled must be true")

    sampling_rate = global_settings.get("sampling_rate")
    if not isinstance(sampling_rate, (int, float)) or not (0 < sampling_rate <= 1):
        errors.append("observability: sampling_rate must be a number between 0 and 1")

    configured_log_fields = set(global_settings.get("required_log_fields", []))
    missing_log_fields = required_log_fields - configured_log_fields
    if missing_log_fields:
        errors.append(f"observability: missing required log fields -> {sorted(missing_log_fields)}")

    for dashboard_id, dashboard in dashboards.items():
        if dashboard.get("plugin_id") not in plugins:
            errors.append(f"observability: dashboard {dashboard_id} references unknown plugin")
        if not str(dashboard.get("url", "")).startswith("dashboard://"):
            errors.append(f"observability: dashboard {dashboard_id} url must use dashboard:// scheme")
        if len(dashboard.get("metrics", [])) < 3:
            errors.append(f"observability: dashboard {dashboard_id} must define at least 3 metrics")

    for alert_group_id, alert_group in alert_groups.items():
        if alert_group.get("plugin_id") not in plugins:
            errors.append(f"observability: alert group {alert_group_id} references unknown plugin")
        if not str(alert_group.get("channel", "")).startswith("alert://"):
            errors.append(f"observability: alert group {alert_group_id} channel must use alert:// scheme")
        if len(alert_group.get("rules", [])) < 2:
            errors.append(f"observability: alert group {alert_group_id} must define at least 2 rules")

    for plugin_id, plugin in plugins.items():
        dashboard_ref = plugin.get("observability", {}).get("dashboard")
        dashboard_path, dashboard_anchor = parse_anchor(dashboard_ref or "")
        if dashboard_path != "master-shell/observability/config.yaml" or dashboard_anchor not in dashboards:
            errors.append(f"observability: plugin {plugin_id} dashboard ref invalid -> {dashboard_ref}")
        if dashboard_anchor in dashboards and dashboards[dashboard_anchor].get("plugin_id") != plugin_id:
            errors.append(f"observability: plugin {plugin_id} dashboard plugin mismatch")

        alert_group_id = plugin.get("observability", {}).get("alert_group")
        if alert_group_id not in alert_groups:
            errors.append(f"observability: plugin {plugin_id} alert group ref invalid -> {alert_group_id}")
        elif alert_groups[alert_group_id].get("plugin_id") != plugin_id:
            errors.append(f"observability: plugin {plugin_id} alert group plugin mismatch")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("observability baseline validation PASS")
    return 0


def validate_rollback() -> int:
    registry = load_yaml("master-shell/plugin-registry/registry.yaml")
    flags = load_yaml("master-shell/feature-flags/flags.yaml")
    playbook = load_yaml("master-shell/operations/rollback-playbook.yaml")
    requirements = load_yaml("requirements/requirements.yaml")

    plugin_flags = flags.get("plugin_flags", {})
    plugins = registry.get("plugins", [])
    playbook_plugins = {item["plugin_id"]: item for item in playbook.get("plugins", [])}
    rto_minutes = requirements.get("nfr", {}).get("rto_minutes")
    rollback_target = playbook.get("global", {}).get("rollback_execution_target_minutes")

    errors: list[str] = []

    if not file_exists("worklog/incidents.md"):
        errors.append("rollback: incidents log file missing")

    incident_log = playbook.get("defaults", {}).get("incident_log")
    if incident_log != "worklog/incidents.md":
        errors.append("rollback: incident_log must point to worklog/incidents.md")

    if not isinstance(rto_minutes, int):
        errors.append("rollback: requirements nfr.rto_minutes must be defined")
    if not isinstance(rollback_target, int) or rollback_target > 5:
        errors.append("rollback: rollback_execution_target_minutes must be <= 5")
    if isinstance(rto_minutes, int) and isinstance(rollback_target, int) and rollback_target > rto_minutes:
        errors.append("rollback: rollback execution target must not exceed RTO")

    for plugin in plugins:
        plugin_id = plugin["id"]
        feature_flag = plugin.get("feature_flag")
        if feature_flag not in plugin_flags:
            errors.append(f"rollback: plugin {plugin_id} feature flag is not registered")
        elif plugin_flags[feature_flag] is not False:
            errors.append(f"rollback: plugin {plugin_id} primary feature flag must default to false")

        rollout = plugin.get("rollout", {})
        if "strategy" not in rollout:
            errors.append(f"rollback: plugin {plugin_id} rollout strategy missing")

        rollback = plugin.get("rollback")
        if not isinstance(rollback, dict):
            errors.append(f"rollback: plugin {plugin_id} rollback block missing")
            continue

        rollback_flag = rollback.get("flag")
        if rollback_flag not in plugin_flags:
            errors.append(f"rollback: plugin {plugin_id} rollback flag is not registered -> {rollback_flag}")
        if rollback_flag != feature_flag:
            errors.append(f"rollback: plugin {plugin_id} rollback flag must match primary feature flag")
        if not rollback.get("trigger_conditions"):
            errors.append(f"rollback: plugin {plugin_id} trigger_conditions missing")

        playbook_entry = playbook_plugins.get(plugin_id)
        if playbook_entry is None:
            errors.append(f"rollback: playbook entry missing for plugin {plugin_id}")
            continue

        disable_flags = playbook_entry.get("rollback", {}).get("disable_flags", [])
        if rollback_flag not in disable_flags:
            errors.append(f"rollback: playbook disable_flags must include {rollback_flag} for {plugin_id}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("rollback baseline validation PASS")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"observability", "rollback"}:
        print("usage: validate_operations.py [observability|rollback]")
        return 2

    if argv[1] == "observability":
        return validate_observability()
    return validate_rollback()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
