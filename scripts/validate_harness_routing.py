#!/usr/bin/env python3
"""Validate harness cost/latency routing baseline."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ROUTING = ROOT / "master-shell" / "catalog" / "context-routing-profiles.yaml"
RECIPES = ROOT / "master-shell" / "catalog" / "ai-runtime-recipes.yaml"
FLAGS = ROOT / "master-shell" / "feature-flags" / "flags.yaml"
METADATA = ROOT / "master-shell" / "feature-flags" / "metadata.json"
ENV_EXAMPLE = ROOT / ".env.example"


def require(path: Path, snippets: list[str], label: str) -> None:
    if not path.exists():
        raise SystemExit(f"harness routing validation FAIL: missing {label} -> {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")
    missing = [snippet for snippet in snippets if snippet not in text]
    if missing:
        raise SystemExit(
            f"harness routing validation FAIL: {label} missing sections -> " + ", ".join(missing)
        )


def main() -> None:
    require(ROUTING, [
        'id: "harness-mode-routing"',
        'intake_goal: "harness-vnext"',
        'benchmark_refs:',
        '"openai-prompt-caching"',
        '"openai-batch-api"',
    ], "context-routing-profiles")
    require(RECIPES, [
        'id: "harness-vnext-router"',
        "Research는 frontier 경로, Build/Operate는 mini 경로를 우선 고려한다",
        "비실시간 replay/eval은 batch 대상으로 보낸다",
    ], "ai-runtime-recipes")
    require(FLAGS, [
        "harness_routing_frontier_research: false",
        "harness_routing_mini_build: false",
        "harness_prompt_caching_enabled: false",
        "harness_batch_eval_enabled: false",
    ], "feature flags")
    require(METADATA, [
        '"harness_routing_frontier_research"',
        '"harness_routing_mini_build"',
        '"harness_prompt_caching_enabled"',
        '"harness_batch_eval_enabled"',
    ], "feature flag metadata")
    require(ENV_EXAMPLE, [
        "WOS_FLAG_HARNESS_ROUTING_FRONTIER_RESEARCH",
        "WOS_FLAG_HARNESS_ROUTING_MINI_BUILD",
        "WOS_FLAG_HARNESS_PROMPT_CACHING_ENABLED",
        "WOS_FLAG_HARNESS_BATCH_EVAL_ENABLED",
    ], ".env.example")
    print("harness routing validation PASS")


if __name__ == "__main__":
    main()
