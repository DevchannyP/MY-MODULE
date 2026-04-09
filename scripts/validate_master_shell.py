#!/usr/bin/env python3
"""Validate cross-file consistency for the master-shell composition layer."""

from __future__ import annotations

from pathlib import Path
import json
import sys
from datetime import date
from urllib.parse import urlparse

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


def ensure_list_of_strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def is_safe_default_flag_override(plugin: dict, flag_value) -> bool:
    if flag_value is not False:
        return False

    rollout = plugin.get("rollout", {})
    if not isinstance(rollout, dict):
        return False

    percentage = rollout.get("percentage")
    current_phase = rollout.get("current_phase")
    return (
        isinstance(percentage, int)
        and percentage > 0
        and isinstance(current_phase, str)
        and bool(current_phase)
    )


def main() -> int:
    registry = load_yaml("master-shell/plugin-registry/registry.yaml")
    navigation = load_yaml("master-shell/navigation/nav.yaml")
    catalog = load_yaml("master-shell/catalog/domains.yaml")
    adapter_registry = load_yaml("master-shell/catalog/adapter-registry.yaml")
    adapter_scorecards = load_yaml("master-shell/catalog/adapter-scorecards.yaml")
    execution_packet_templates = load_yaml("master-shell/catalog/execution-packet-templates.yaml")
    context_routing_profiles = load_yaml("master-shell/catalog/context-routing-profiles.yaml")
    learning_replay_lenses = load_yaml("master-shell/catalog/learning-replay-lenses.yaml")
    adapter_compatibility = load_yaml("master-shell/catalog/adapter-compatibility-matrix.yaml")
    planning_studio = load_yaml("master-shell/catalog/planning-studio-modes.yaml")
    adapter_transitions = load_yaml("master-shell/catalog/adapter-transition-playbooks.yaml")
    project_blueprints = load_yaml("master-shell/catalog/project-blueprints.yaml")
    project_intake = load_yaml("master-shell/catalog/project-intake-canvas.yaml")
    ai_learning_map = load_yaml("master-shell/catalog/ai-learning-map.yaml")
    learning_mastery = load_yaml("master-shell/catalog/learning-mastery-map.yaml")
    ai_runtime_recipes = load_yaml("master-shell/catalog/ai-runtime-recipes.yaml")
    relations_graph = load_yaml("master-shell/catalog/master-os-relations.yaml")
    benchmark_catalog = load_yaml("master-shell/catalog/benchmark-signals.yaml")
    flags = load_yaml("master-shell/feature-flags/flags.yaml")
    flag_metadata = load_json("master-shell/feature-flags/metadata.json")
    slo_policy = load_json("master-shell/observability/slo-policy.json")
    observability = load_yaml("master-shell/observability/config.yaml")

    errors: list[str] = []

    plugins = registry.get("plugins", [])
    adapters = adapter_registry.get("adapters", [])
    adapter_profiles = adapter_registry.get("adapter_profiles", [])
    execution_templates = execution_packet_templates.get("templates", [])
    routing_profiles = context_routing_profiles.get("profiles", [])
    replay_lenses = learning_replay_lenses.get("lenses", [])
    blueprints = project_blueprints.get("blueprints", [])
    intake_questions = project_intake.get("questions", [])
    learning_tracks = ai_learning_map.get("tracks", [])
    mastery_milestones = learning_mastery.get("milestones", [])
    runtime_recipes = ai_runtime_recipes.get("recipes", [])
    relation_items = relations_graph.get("relations", [])
    benchmark_focuses = benchmark_catalog.get("improvement_focuses", [])
    essential_improvements = benchmark_catalog.get("essential_improvements", [])
    benchmark_signals = benchmark_catalog.get("signals", [])
    compatibility_profiles = adapter_compatibility.get("profiles", [])
    planning_modes = planning_studio.get("modes", [])
    transition_playbooks = adapter_transitions.get("transitions", [])
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
    adapter_ids: set[str] = set()
    adapter_map = {}
    for adapter in adapters:
        adapter_id = adapter.get("id")
        if adapter_id in adapter_ids:
            errors.append(f"adapter-registry: duplicate adapter id -> {adapter_id}")
        if not isinstance(adapter_id, str) or not adapter_id:
            errors.append("adapter-registry: adapter.id must be non-empty")
            continue
        adapter_ids.add(adapter_id)
        adapter_map[adapter_id] = adapter

    profile_map = {}
    for profile in adapter_profiles:
        profile_id = profile.get("id")
        if profile_id in profile_map:
            errors.append(f"adapter-registry: duplicate adapter profile -> {profile_id}")
        if not isinstance(profile_id, str) or not profile_id:
            errors.append("adapter-registry: adapter_profiles[].id must be non-empty")
            continue
        profile_map[profile_id] = profile
        profile_refs = ensure_list_of_strings(profile.get("adapter_refs"))
        if not profile_refs:
            errors.append(f"adapter-registry: profile {profile_id} must reference at least one adapter")
        for adapter_ref in profile_refs:
            if adapter_ref not in adapter_map:
                errors.append(f"adapter-registry: profile {profile_id} unknown adapter -> {adapter_ref}")

    module_ids = {
        plugin.get("module_id")
        for plugin in plugins
        if isinstance(plugin.get("module_id"), str) and plugin.get("module_id")
    }

    for plugin_id, plugin in plugin_map.items():
        for field in ("ui_contract", "capability_contract", "stage_b_memory_ref"):
            ref = plugin.get(field)
            if not isinstance(ref, str) or not file_exists(ref):
                errors.append(f"{plugin_id}: missing or invalid {field} -> {ref}")

        feature_flag = plugin.get("feature_flag")
        if feature_flag not in feature_flags:
            errors.append(f"{plugin_id}: feature flag not registered -> {feature_flag}")
        else:
            # Repository flag files keep safe defaults false; active rollout can still
            # be valid when runtime/env overrides enable the plugin in deployment.
            flag_value = flags.get("plugin_flags", {}).get(feature_flag)
            plugin_status = plugin.get("status")
            if flag_value is True and plugin_status != "active":
                errors.append(
                    f"{plugin_id}: feature flag {feature_flag}=true but plugin status is {plugin_status!r} (expected 'active')"
                )
            elif (
                flag_value is False
                and plugin_status == "active"
                and not is_safe_default_flag_override(plugin, flag_value)
            ):
                errors.append(
                    f"{plugin_id}: feature flag {feature_flag}=false with active status requires rollout metadata for runtime override"
                )
            elif flag_value is False and plugin_status not in ("inactive", "active", None):
                errors.append(
                    f"{plugin_id}: feature flag {feature_flag}=false but plugin status is {plugin_status!r} (expected 'inactive' or runtime-overridden 'active')"
                )

        architecture_profile = plugin.get("architecture_profile")
        if architecture_profile not in profile_map:
            errors.append(f"{plugin_id}: architecture_profile not found -> {architecture_profile}")

        adapter_refs = ensure_list_of_strings(plugin.get("adapter_refs"))
        if not adapter_refs:
            errors.append(f"{plugin_id}: adapter_refs must declare at least one adapter")
        for adapter_ref in adapter_refs:
            if adapter_ref not in adapter_map:
                errors.append(f"{plugin_id}: unknown adapter ref -> {adapter_ref}")

        if architecture_profile in profile_map:
            profile_refs = set(ensure_list_of_strings(profile_map[architecture_profile].get("adapter_refs")))
            for adapter_ref in adapter_refs:
                if adapter_ref not in profile_refs:
                    errors.append(
                        f"{plugin_id}: adapter {adapter_ref} not permitted by architecture_profile {architecture_profile}"
                    )

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

    learning_track_ids: set[str] = set()
    allowed_learning_tabs = {
        "대시보드",
        "기획서",
        "Work Packets",
        "완료 아카이브",
        "도메인",
        "요구사항",
        "ADR",
        "스프린트",
        "감사·학습",
    }
    for track in learning_tracks:
        track_id = track.get("id")
        if track_id in learning_track_ids:
            errors.append(f"ai-learning-map: duplicate track id -> {track_id}")
        if not isinstance(track_id, str) or not track_id:
            errors.append("ai-learning-map: tracks[].id must be non-empty")
            continue
        learning_track_ids.add(track_id)
        steps = track.get("steps", [])
        if not isinstance(steps, list) or len(steps) < 2:
            errors.append(f"ai-learning-map: track {track_id} must define at least 2 steps")
            continue
        for step in steps:
            if not isinstance(step.get("title"), str) or not step.get("title"):
                errors.append(f"ai-learning-map: track {track_id} step title missing")
            if step.get("tab") not in allowed_learning_tabs:
                errors.append(f"ai-learning-map: track {track_id} invalid tab -> {step.get('tab')}")
            if not isinstance(step.get("learn"), str) or not step.get("learn"):
                errors.append(f"ai-learning-map: track {track_id} step learn missing")

    blueprint_ids: set[str] = set()
    for blueprint in blueprints:
        blueprint_id = blueprint.get("id")
        if blueprint_id in blueprint_ids:
            errors.append(f"project-blueprints: duplicate blueprint id -> {blueprint_id}")
        if not isinstance(blueprint_id, str) or not blueprint_id:
            errors.append("project-blueprints: blueprints[].id must be non-empty")
            continue
        blueprint_ids.add(blueprint_id)
        architecture_profile = blueprint.get("architecture_profile")
        if architecture_profile not in profile_map:
            errors.append(f"project-blueprints: {blueprint_id} unknown architecture_profile -> {architecture_profile}")
        recommended_modules = ensure_list_of_strings(blueprint.get("recommended_modules"))
        if not recommended_modules:
            errors.append(f"project-blueprints: {blueprint_id} must declare recommended_modules")
        for module_id in recommended_modules:
            if module_id not in module_ids:
                errors.append(f"project-blueprints: {blueprint_id} unknown module -> {module_id}")
        learning_refs = ensure_list_of_strings(blueprint.get("learning_tracks"))
        if not learning_refs:
            errors.append(f"project-blueprints: {blueprint_id} must declare learning_tracks")
        for learning_ref in learning_refs:
            if learning_ref not in learning_track_ids:
                errors.append(f"project-blueprints: {blueprint_id} unknown learning track -> {learning_ref}")
        starter_sequence = blueprint.get("starter_sequence", [])
        if not isinstance(starter_sequence, list) or len(starter_sequence) < 2:
            errors.append(f"project-blueprints: {blueprint_id} must define at least 2 starter_sequence steps")

    recipe_ids: set[str] = set()
    for recipe in runtime_recipes:
        recipe_id = recipe.get("id")
        if recipe_id in recipe_ids:
            errors.append(f"ai-runtime-recipes: duplicate recipe id -> {recipe_id}")
        if not isinstance(recipe_id, str) or not recipe_id:
            errors.append("ai-runtime-recipes: recipes[].id must be non-empty")
            continue
        recipe_ids.add(recipe_id)
        architecture_profile = recipe.get("architecture_profile")
        if architecture_profile not in profile_map:
            errors.append(f"ai-runtime-recipes: {recipe_id} unknown architecture_profile -> {architecture_profile}")
        adapter_refs = ensure_list_of_strings(recipe.get("adapters"))
        if not adapter_refs:
            errors.append(f"ai-runtime-recipes: {recipe_id} adapters required")
        for adapter_ref in adapter_refs:
            if adapter_ref not in adapter_map:
                errors.append(f"ai-runtime-recipes: {recipe_id} unknown adapter -> {adapter_ref}")
        if architecture_profile in profile_map:
            profile_refs = set(ensure_list_of_strings(profile_map[architecture_profile].get("adapter_refs")))
            for adapter_ref in adapter_refs:
                if adapter_ref not in profile_refs:
                    errors.append(
                        f"ai-runtime-recipes: {recipe_id} adapter {adapter_ref} not permitted by profile {architecture_profile}"
                    )
        if not ensure_list_of_strings(recipe.get("tool_stack")):
            errors.append(f"ai-runtime-recipes: {recipe_id} tool_stack required")
        if len(recipe.get("operating_sequence", [])) < 2:
            errors.append(f"ai-runtime-recipes: {recipe_id} operating_sequence must have at least 2 steps")
        for blueprint_ref in ensure_list_of_strings(recipe.get("blueprint_refs")):
            if blueprint_ref not in blueprint_ids:
                errors.append(f"ai-runtime-recipes: {recipe_id} unknown blueprint -> {blueprint_ref}")
        for learning_ref in ensure_list_of_strings(recipe.get("learning_track_refs")):
            if learning_ref not in learning_track_ids:
                errors.append(f"ai-runtime-recipes: {recipe_id} unknown learning track -> {learning_ref}")

    intake_default_ids = project_intake.get("defaults", {}) if isinstance(project_intake.get("defaults", {}), dict) else {}
    seen_question_ids: set[str] = set()
    for question in intake_questions:
        question_id = question.get("id")
        if question_id in seen_question_ids:
            errors.append(f"project-intake-canvas: duplicate question id -> {question_id}")
        if not isinstance(question_id, str) or not question_id:
            errors.append("project-intake-canvas: questions[].id must be non-empty")
            continue
        seen_question_ids.add(question_id)
        options = question.get("options", [])
        if not isinstance(options, list) or len(options) < 2:
            errors.append(f"project-intake-canvas: {question_id} must define at least 2 options")
            continue
        option_ids: set[str] = set()
        for option in options:
            option_id = option.get("id")
            if option_id in option_ids:
                errors.append(f"project-intake-canvas: {question_id} duplicate option -> {option_id}")
            if not isinstance(option_id, str) or not option_id:
                errors.append(f"project-intake-canvas: {question_id} option id missing")
                continue
            option_ids.add(option_id)
            boosts = option.get("boosts", {}) if isinstance(option.get("boosts", {}), dict) else {}
            for blueprint_ref in (boosts.get("blueprints", {}) or {}).keys():
                if blueprint_ref not in blueprint_ids:
                    errors.append(f"project-intake-canvas: {question_id}/{option_id} unknown blueprint boost -> {blueprint_ref}")
            for profile_ref in (boosts.get("profiles", {}) or {}).keys():
                if profile_ref not in profile_map:
                    errors.append(f"project-intake-canvas: {question_id}/{option_id} unknown profile boost -> {profile_ref}")
            for recipe_ref in (boosts.get("recipes", {}) or {}).keys():
                if recipe_ref not in recipe_ids and recipe_ids:
                    errors.append(f"project-intake-canvas: {question_id}/{option_id} unknown recipe boost -> {recipe_ref}")
        default_option = intake_default_ids.get(question_id)
        if default_option not in option_ids:
            errors.append(f"project-intake-canvas: default for {question_id} must reference an option in the same question")

    scorecards = adapter_scorecards.get("scorecards", [])
    scorecard_map = {}
    score_min = ((adapter_scorecards.get("score_scale") or {}).get("min"))
    score_max = ((adapter_scorecards.get("score_scale") or {}).get("max"))
    if not isinstance(score_min, int) or not isinstance(score_max, int):
        errors.append("adapter-scorecards: score_scale.min/max must be integers")
    for scorecard in scorecards:
        adapter_id = scorecard.get("adapter_id")
        if adapter_id in scorecard_map:
            errors.append(f"adapter-scorecards: duplicate adapter_id -> {adapter_id}")
        if adapter_id not in adapter_map:
            errors.append(f"adapter-scorecards: unknown adapter_id -> {adapter_id}")
            continue
        scorecard_map[adapter_id] = scorecard
        metrics = scorecard.get("metrics", {})
        required_metrics = {"extensibility", "performance", "learning_clarity", "ai_compatibility", "swap_safety"}
        if set(metrics.keys()) != required_metrics:
            errors.append(f"adapter-scorecards: {adapter_id} metrics must match {sorted(required_metrics)}")
        for metric_name, metric_value in metrics.items():
            if not isinstance(metric_value, int) or metric_value < score_min or metric_value > score_max:
                errors.append(
                    f"adapter-scorecards: {adapter_id}.{metric_name} must be integer within [{score_min}, {score_max}]"
                )
        if not ensure_list_of_strings(scorecard.get("strengths")):
            errors.append(f"adapter-scorecards: {adapter_id} strengths required")
        if not ensure_list_of_strings(scorecard.get("best_for")):
            errors.append(f"adapter-scorecards: {adapter_id} best_for required")

    for adapter_id in adapter_map:
        if adapter_id not in scorecard_map:
            errors.append(f"adapter-scorecards: missing scorecard for adapter -> {adapter_id}")

    compatibility_map = {}
    for compatibility in compatibility_profiles:
        profile_id = compatibility.get("profile_id")
        if profile_id in compatibility_map:
            errors.append(f"adapter-compatibility-matrix: duplicate profile_id -> {profile_id}")
        if profile_id not in profile_map:
            errors.append(f"adapter-compatibility-matrix: unknown profile -> {profile_id}")
            continue
        compatibility_map[profile_id] = compatibility
        required_adapters = set(ensure_list_of_strings(compatibility.get("required_adapters")))
        recommended_adapters = set(ensure_list_of_strings(compatibility.get("recommended_adapters")))
        forbidden_adapters = set(ensure_list_of_strings(compatibility.get("forbidden_adapters")))
        for adapter_ref in required_adapters | recommended_adapters | forbidden_adapters:
            if adapter_ref not in adapter_map:
                errors.append(f"adapter-compatibility-matrix: {profile_id} unknown adapter -> {adapter_ref}")
        if required_adapters & forbidden_adapters:
            errors.append(f"adapter-compatibility-matrix: {profile_id} adapter cannot be both required and forbidden")
        for recipe_ref in ensure_list_of_strings(compatibility.get("recommended_recipes")):
            if recipe_ref not in recipe_ids:
                errors.append(f"adapter-compatibility-matrix: {profile_id} unknown recipe -> {recipe_ref}")

    for profile_id, profile in profile_map.items():
        if profile_id not in compatibility_map:
            errors.append(f"adapter-compatibility-matrix: missing compatibility profile -> {profile_id}")
            continue
        declared = set(ensure_list_of_strings(profile.get("adapter_refs")))
        rules = compatibility_map[profile_id]
        required = set(ensure_list_of_strings(rules.get("required_adapters")))
        forbidden = set(ensure_list_of_strings(rules.get("forbidden_adapters")))
        if not required.issubset(declared):
            errors.append(
                f"adapter-compatibility-matrix: {profile_id} missing required adapters -> {sorted(required - declared)}"
            )
        invalid = declared & forbidden
        if invalid:
            errors.append(f"adapter-compatibility-matrix: {profile_id} contains forbidden adapters -> {sorted(invalid)}")

    milestone_ids: set[str] = set()
    for milestone in mastery_milestones:
        milestone_id = milestone.get("id")
        if milestone_id in milestone_ids:
            errors.append(f"learning-mastery-map: duplicate milestone id -> {milestone_id}")
        if not isinstance(milestone_id, str) or not milestone_id:
            errors.append("learning-mastery-map: milestones[].id must be non-empty")
            continue
        milestone_ids.add(milestone_id)
        track_ref = milestone.get("track_ref")
        if track_ref not in learning_track_ids:
            errors.append(f"learning-mastery-map: {milestone_id} unknown track_ref -> {track_ref}")
        if milestone.get("level") not in {"foundation", "apprentice", "practitioner", "mastery"}:
            errors.append(f"learning-mastery-map: {milestone_id} invalid level -> {milestone.get('level')}")
        if not isinstance(milestone.get("objective"), str) or not milestone.get("objective"):
            errors.append(f"learning-mastery-map: {milestone_id} objective required")
        if len(ensure_list_of_strings(milestone.get("proof"))) < 1:
            errors.append(f"learning-mastery-map: {milestone_id} proof required")

    for milestone in mastery_milestones:
        milestone_id = milestone.get("id")
        for prerequisite in ensure_list_of_strings(milestone.get("prerequisites")):
            if prerequisite not in milestone_ids:
                errors.append(f"learning-mastery-map: {milestone_id} unknown prerequisite -> {prerequisite}")

    allowed_benchmark_domains = {
        "figma.com",
        "help.figma.com",
        "miro.com",
        "linear.app",
        "docs.github.com",
        "github.com",
        "atlassian.com",
        "www.atlassian.com",
        "openai.com",
        "openai.github.io",
        "platform.openai.com",
        "clova.ai",
    }
    benchmark_signal_ids: set[str] = set()
    for signal in benchmark_signals:
        signal_id = signal.get("id")
        if signal_id in benchmark_signal_ids:
            errors.append(f"benchmark-signals: duplicate signal id -> {signal_id}")
        if not isinstance(signal_id, str) or not signal_id:
            errors.append("benchmark-signals: signals[].id must be non-empty")
            continue
        benchmark_signal_ids.add(signal_id)
        if signal.get("region") not in {"global", "korea"}:
            errors.append(f"benchmark-signals: {signal_id} invalid region -> {signal.get('region')}")
        if not isinstance(signal.get("product"), str) or not signal.get("product"):
            errors.append(f"benchmark-signals: {signal_id} product required")
        source_url = signal.get("source_url")
        if not isinstance(source_url, str) or not source_url.startswith("https://"):
            errors.append(f"benchmark-signals: {signal_id} source_url must be https -> {source_url}")
        else:
            hostname = urlparse(source_url).hostname or ""
            if not any(hostname == domain or hostname.endswith(f".{domain}") for domain in allowed_benchmark_domains):
                errors.append(f"benchmark-signals: {signal_id} unsupported source domain -> {hostname}")
        if not isinstance(signal.get("signal"), str) or not signal.get("signal"):
            errors.append(f"benchmark-signals: {signal_id} signal description required")
        if len(ensure_list_of_strings(signal.get("lessons"))) < 1:
            errors.append(f"benchmark-signals: {signal_id} lessons required")
        if len(ensure_list_of_strings(signal.get("adopted_into"))) < 1:
            errors.append(f"benchmark-signals: {signal_id} adopted_into required")

    seen_focus_ids: set[str] = set()
    for focus in benchmark_focuses:
        focus_id = focus.get("id")
        if focus_id in seen_focus_ids:
            errors.append(f"benchmark-signals: duplicate improvement_focus id -> {focus_id}")
        if not isinstance(focus_id, str) or not focus_id:
            errors.append("benchmark-signals: improvement_focuses[].id must be non-empty")
            continue
        seen_focus_ids.add(focus_id)
        if not isinstance(focus.get("title"), str) or not focus.get("title"):
            errors.append(f"benchmark-signals: {focus_id} title required")
        if not isinstance(focus.get("outcome"), str) or not focus.get("outcome"):
            errors.append(f"benchmark-signals: {focus_id} outcome required")
        if not isinstance(focus.get("preserve_essence"), str) or not focus.get("preserve_essence"):
            errors.append(f"benchmark-signals: {focus_id} preserve_essence required")
        if len(ensure_list_of_strings(focus.get("delivered_by"))) < 1:
            errors.append(f"benchmark-signals: {focus_id} delivered_by required")
        refs = ensure_list_of_strings(focus.get("benchmark_refs"))
        if len(refs) < 1:
            errors.append(f"benchmark-signals: {focus_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"benchmark-signals: {focus_id} unknown benchmark ref -> {ref}")

    seen_essential_ids: set[str] = set()
    for improvement in essential_improvements:
        improvement_id = improvement.get("id")
        if improvement_id in seen_essential_ids:
            errors.append(f"benchmark-signals: duplicate essential_improvement id -> {improvement_id}")
        if not isinstance(improvement_id, str) or not improvement_id:
            errors.append("benchmark-signals: essential_improvements[].id must be non-empty")
            continue
        seen_essential_ids.add(improvement_id)
        for field in ("title", "objective", "preserve_essence"):
            if not isinstance(improvement.get(field), str) or not improvement.get(field):
                errors.append(f"benchmark-signals: {improvement_id} {field} required")
        if len(ensure_list_of_strings(improvement.get("why_now"))) < 1:
            errors.append(f"benchmark-signals: {improvement_id} why_now required")
        if len(ensure_list_of_strings(improvement.get("delivered_by"))) < 1:
            errors.append(f"benchmark-signals: {improvement_id} delivered_by required")
        refs = ensure_list_of_strings(improvement.get("benchmark_refs"))
        if len(refs) < 1:
            errors.append(f"benchmark-signals: {improvement_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"benchmark-signals: {improvement_id} unknown benchmark ref -> {ref}")
        for focus_id in ensure_list_of_strings(improvement.get("related_focus_ids")):
            if focus_id not in seen_focus_ids:
                errors.append(f"benchmark-signals: {improvement_id} unknown related focus -> {focus_id}")

    seen_mode_ids: set[str] = set()
    for mode in planning_modes:
        mode_id = mode.get("id")
        if mode_id in seen_mode_ids:
            errors.append(f"planning-studio-modes: duplicate mode id -> {mode_id}")
        if not isinstance(mode_id, str) or not mode_id:
            errors.append("planning-studio-modes: modes[].id must be non-empty")
            continue
        seen_mode_ids.add(mode_id)
        for field in ("title", "summary", "preserve_essence"):
            if not isinstance(mode.get(field), str) or not mode.get(field):
                errors.append(f"planning-studio-modes: {mode_id} {field} required")
        sections = mode.get("sections", [])
        if not isinstance(sections, list) or not sections:
            errors.append(f"planning-studio-modes: {mode_id} sections required")
        section_ids: set[str] = set()
        for section in sections:
            section_id = section.get("id")
            if section_id in section_ids:
                errors.append(f"planning-studio-modes: {mode_id} duplicate section id -> {section_id}")
            if not isinstance(section_id, str) or not section_id:
                errors.append(f"planning-studio-modes: {mode_id} section.id required")
                continue
            section_ids.add(section_id)
            for field in ("label", "prompt"):
                if not isinstance(section.get(field), str) or not section.get(field):
                    errors.append(f"planning-studio-modes: {mode_id}.{section_id} {field} required")
        refs = ensure_list_of_strings(mode.get("benchmark_refs"))
        if not refs:
            errors.append(f"planning-studio-modes: {mode_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"planning-studio-modes: {mode_id} unknown benchmark ref -> {ref}")

    seen_transition_ids: set[str] = set()
    for playbook in transition_playbooks:
        playbook_id = playbook.get("id")
        if playbook_id in seen_transition_ids:
            errors.append(f"adapter-transition-playbooks: duplicate transition id -> {playbook_id}")
        if not isinstance(playbook_id, str) or not playbook_id:
            errors.append("adapter-transition-playbooks: transitions[].id must be non-empty")
            continue
        seen_transition_ids.add(playbook_id)
        from_profile = playbook.get("from_profile")
        to_profile = playbook.get("to_profile")
        if from_profile not in profile_map:
            errors.append(f"adapter-transition-playbooks: {playbook_id} unknown from_profile -> {from_profile}")
        if to_profile not in profile_map:
            errors.append(f"adapter-transition-playbooks: {playbook_id} unknown to_profile -> {to_profile}")
        for field in ("title", "preserve_essence"):
            if not isinstance(playbook.get(field), str) or not playbook.get(field):
                errors.append(f"adapter-transition-playbooks: {playbook_id} {field} required")
        if len(ensure_list_of_strings(playbook.get("triggers"))) < 1:
            errors.append(f"adapter-transition-playbooks: {playbook_id} triggers required")
        if len(ensure_list_of_strings(playbook.get("validation_commands"))) < 1:
            errors.append(f"adapter-transition-playbooks: {playbook_id} validation_commands required")
        refs = ensure_list_of_strings(playbook.get("benchmark_refs"))
        if not refs:
            errors.append(f"adapter-transition-playbooks: {playbook_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"adapter-transition-playbooks: {playbook_id} unknown benchmark ref -> {ref}")

    allowed_intake_goals = {
        option.get("id")
        for question in intake_questions
        if question.get("id") == "primary_goal"
        for option in question.get("options", [])
        if isinstance(option.get("id"), str)
    }
    template_ids: set[str] = set()
    for template in execution_templates:
        template_id = template.get("id")
        if template_id in template_ids:
            errors.append(f"execution-packet-templates: duplicate template id -> {template_id}")
        if not isinstance(template_id, str) or not template_id:
            errors.append("execution-packet-templates: templates[].id must be non-empty")
            continue
        template_ids.add(template_id)
        if not isinstance(template.get("title"), str) or not template.get("title"):
            errors.append(f"execution-packet-templates: {template_id} title required")
        if not isinstance(template.get("when_to_use"), str) or not template.get("when_to_use"):
            errors.append(f"execution-packet-templates: {template_id} when_to_use required")
        refs = ensure_list_of_strings(template.get("benchmark_refs"))
        if not refs:
            errors.append(f"execution-packet-templates: {template_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"execution-packet-templates: {template_id} unknown benchmark ref -> {ref}")
        packet_defaults = template.get("packet_defaults", {})
        if not isinstance(packet_defaults, dict):
            errors.append(f"execution-packet-templates: {template_id} packet_defaults required")
            continue
        if packet_defaults.get("type") not in {"planning", "domain", "governance", "arch", "infra", "meta"}:
            errors.append(f"execution-packet-templates: {template_id} invalid type -> {packet_defaults.get('type')}")
        if packet_defaults.get("stage") not in {"A", "B", "C", "D", "E"}:
            errors.append(f"execution-packet-templates: {template_id} invalid stage -> {packet_defaults.get('stage')}")
        if len(ensure_list_of_strings(packet_defaults.get("constraints"))) < 1:
            errors.append(f"execution-packet-templates: {template_id} constraints required")
        if len(ensure_list_of_strings(packet_defaults.get("validation"))) < 1:
            errors.append(f"execution-packet-templates: {template_id} validation required")
        context_budget = packet_defaults.get("context_budget", {})
        if not isinstance(context_budget, dict):
            errors.append(f"execution-packet-templates: {template_id} context_budget required")
        else:
            for field in ("estimated_turns", "max_new_files", "max_modified_files"):
                if not isinstance(context_budget.get(field), int) or context_budget.get(field) < 1:
                    errors.append(f"execution-packet-templates: {template_id} {field} must be positive integer")

    routing_ids: set[str] = set()
    for profile in routing_profiles:
        profile_id = profile.get("id")
        if profile_id in routing_ids:
            errors.append(f"context-routing-profiles: duplicate profile id -> {profile_id}")
        if not isinstance(profile_id, str) or not profile_id:
            errors.append("context-routing-profiles: profiles[].id must be non-empty")
            continue
        routing_ids.add(profile_id)
        intake_goal = profile.get("intake_goal")
        if intake_goal not in allowed_intake_goals:
            errors.append(f"context-routing-profiles: {profile_id} unknown intake_goal -> {intake_goal}")
        if not isinstance(profile.get("objective"), str) or not profile.get("objective"):
            errors.append(f"context-routing-profiles: {profile_id} objective required")
        refs = ensure_list_of_strings(profile.get("benchmark_refs"))
        if not refs:
            errors.append(f"context-routing-profiles: {profile_id} benchmark_refs required")
        for ref in refs:
            if ref not in benchmark_signal_ids:
                errors.append(f"context-routing-profiles: {profile_id} unknown benchmark ref -> {ref}")
        for field in ("max_primary_files", "max_secondary_files"):
            if not isinstance(profile.get(field), int) or profile.get(field) < 1:
                errors.append(f"context-routing-profiles: {profile_id} {field} must be positive integer")
        for field in ("must_read", "expand_if_needed", "defer_until_execution"):
            values = ensure_list_of_strings(profile.get(field))
            if not values:
                errors.append(f"context-routing-profiles: {profile_id} {field} required")

    lens_ids: set[str] = set()
    allowed_event_tags = {"audit", "reflection", "report", "git", "timeline"}
    for lens in replay_lenses:
        lens_id = lens.get("id")
        if lens_id in lens_ids:
            errors.append(f"learning-replay-lenses: duplicate lens id -> {lens_id}")
        if not isinstance(lens_id, str) or not lens_id:
            errors.append("learning-replay-lenses: lenses[].id must be non-empty")
            continue
        lens_ids.add(lens_id)
        if lens.get("event_tag") not in allowed_event_tags:
            errors.append(f"learning-replay-lenses: {lens_id} invalid event_tag -> {lens.get('event_tag')}")
        if not isinstance(lens.get("title"), str) or not lens.get("title"):
            errors.append(f"learning-replay-lenses: {lens_id} title required")
        if not isinstance(lens.get("teaches"), str) or not lens.get("teaches"):
            errors.append(f"learning-replay-lenses: {lens_id} teaches required")
        if lens.get("track_ref") not in learning_track_ids:
            errors.append(f"learning-replay-lenses: {lens_id} unknown track_ref -> {lens.get('track_ref')}")
        if len(ensure_list_of_strings(lens.get("next_reads"))) < 1:
            errors.append(f"learning-replay-lenses: {lens_id} next_reads required")

    allowed_relation_types = {"uses-profile", "teaches", "implements", "fits-profile"}
    allowed_source_types = {"blueprint", "recipe", "module"}
    allowed_target_types = {"profile", "learning-track", "blueprint"}
    seen_relations: set[tuple[str, str, str, str, str]] = set()
    for relation in relation_items:
        source_type = relation.get("source_type")
        source_id = relation.get("source_id")
        relation_type = relation.get("relation")
        target_type = relation.get("target_type")
        target_id = relation.get("target_id")
        key = (str(source_type), str(source_id), str(relation_type), str(target_type), str(target_id))
        if key in seen_relations:
            errors.append(f"master-os-relations: duplicate relation -> {key}")
            continue
        seen_relations.add(key)
        if source_type not in allowed_source_types:
            errors.append(f"master-os-relations: invalid source_type -> {source_type}")
        if target_type not in allowed_target_types:
            errors.append(f"master-os-relations: invalid target_type -> {target_type}")
        if relation_type not in allowed_relation_types:
            errors.append(f"master-os-relations: invalid relation -> {relation_type}")
        if source_type == "blueprint" and source_id not in blueprint_ids:
            errors.append(f"master-os-relations: unknown blueprint source -> {source_id}")
        if source_type == "recipe" and source_id not in recipe_ids:
            errors.append(f"master-os-relations: unknown recipe source -> {source_id}")
        if source_type == "module" and source_id not in module_ids:
            errors.append(f"master-os-relations: unknown module source -> {source_id}")
        if target_type == "profile" and target_id not in profile_map:
            errors.append(f"master-os-relations: unknown profile target -> {target_id}")
        if target_type == "learning-track" and target_id not in learning_track_ids:
            errors.append(f"master-os-relations: unknown learning track target -> {target_id}")
        if target_type == "blueprint" and target_id not in blueprint_ids:
            errors.append(f"master-os-relations: unknown blueprint target -> {target_id}")

    if set(metadata_flags.keys()) != feature_flags:
        missing_metadata = sorted(feature_flags - set(metadata_flags.keys()))
        unknown_metadata = sorted(set(metadata_flags.keys()) - feature_flags)
        for flag_name in missing_metadata:
            errors.append(f"feature-flag metadata missing -> {flag_name}")
        for flag_name in unknown_metadata:
            errors.append(f"feature-flag metadata orphaned -> {flag_name}")

    today = date.today().isoformat()
    allowed_stages = {"internal", "canary", "beta", "released", "archived"}
    allowed_rollout_buckets = {"userId", "route", "method"}
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
        rollout = metadata.get("rollout")
        if rollout is not None:
            if not isinstance(rollout, dict):
                errors.append(f"{flag_name}: metadata.rollout must be an object")
            else:
                percentage = rollout.get("percentage")
                bucket_by = rollout.get("bucket_by")
                if not isinstance(percentage, (int, float)) or percentage < 0 or percentage > 100:
                    errors.append(f"{flag_name}: metadata.rollout.percentage must be within [0, 100]")
                if bucket_by not in allowed_rollout_buckets:
                    errors.append(
                        f"{flag_name}: metadata.rollout.bucket_by must be one of {', '.join(sorted(allowed_rollout_buckets))}"
                    )

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

    # ── Requirements ↔ plugin-registry cross-check ──────────────────────────────
    # Every requirements/*.yaml with a module.id must have a matching plugin
    # (plugin.module_id) registered in the plugin-registry. This enforces that
    # Stage C (master-shell registration) is completed for every declared domain.
    req_dir = REPO_ROOT / "requirements"
    for req_path in sorted(req_dir.glob("*.yaml")):
        try:
            req_data = yaml.safe_load(req_path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        req_module_id = req_data.get("module", {}).get("id") if isinstance(req_data, dict) else None
        if not isinstance(req_module_id, str) or not req_module_id:
            continue
        if req_module_id not in module_ids:
            errors.append(
                f"requirements/{req_path.name}: module.id '{req_module_id}' has no matching "
                f"plugin in plugin-registry (plugin.module_id). Stage C not completed?"
            )
        else:
            # Also verify routing.entry_point matches plugin.entry_point
            req_entry = req_data.get("routing", {}).get("entry_point")
            for plugin in plugins:
                if plugin.get("module_id") == req_module_id:
                    plugin_entry = plugin.get("entry_point")
                    if req_entry and plugin_entry and req_entry != plugin_entry:
                        errors.append(
                            f"requirements/{req_path.name}: routing.entry_point '{req_entry}' "
                            f"does not match plugin entry_point '{plugin_entry}' "
                            f"for module '{req_module_id}'"
                        )
                    break

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("master-shell composition validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
