# ADR-0014: Master Plan Orchestrator (MPO) v1.0 Architecture

**Status**: Accepted  
**Date**: 2026-04-19  
**Author**: Workflow OS Core  
**Scope**: `scripts/mpo-pipeline.js`, `src/infrastructure/mpo/`, `src/server/routes/mpo.js`, `contracts/harness/`

---

## Context

The harness v0.2.0 had no intake validation, no output schema enforcement, no context isolation, and no token budgets. Every session loaded the entire repository context, and failures had no structured escalation path. This led to unpredictable token growth and unverified completion claims.

The goal was to replace the open-ended harness with a closed, contract-first pipeline that enforces determinism at every boundary.

## Decision

Implement MPO v1.0 as a 12-module deterministic pipeline with the following invariants:

**CONTRACT-INV-01**: A module must validate its input schema before executing.  
**CONTRACT-INV-02**: A module must validate its output schema before passing to the next module.  
**CONTRACT-INV-03**: Modules connect only through the pipeline orchestrator — never by direct import.  
**CONTRACT-INV-04**: Schema changes are detected by `validate:contracts` before merge.

### Module responsibilities (non-negotiable)

| Module | Type | Responsibility |
|--------|------|----------------|
| M01 | HTTP surface | Receive raw intent, attach session anchors (3 files only) |
| M02 | LLM-mini | Classify goal into 11-field Intake Packet |
| M03 | LLM-standard | Decompose into WP-DAG with domain/layer/dependency graph |
| M04 | Deterministic | Assign allowed/forbidden/read-only path sets per WP |
| M05 | Deterministic | Build minimum context envelope per WP, enforce generated/forbidden exclusion |
| M06 | Deterministic | Allocate token budget: `min(ctx×1.5 + reserve, cap)` |
| M07 | Deterministic | Route to provider tier by mode×risk matrix, bump on strict evidence |
| M08 | Deterministic | Assign verification bundle from validation-profiles.yaml |
| M09 | LLM-exec | Execute each WP inside its boundary; auto-replan on first failure |
| M10 | Deterministic | Truthfulness gate: schema + evidence existence + command result cross-check |
| M11 | Deterministic | 6-step atomic memory transaction; rollback on any step failure |
| M12 | SSE | Broadcast mpo.* events to Master UI via EventSource |

### Key design choices

1. **9 of 12 modules are deterministic** (zero LLM tokens). Token cost is bounded by WP, not session.
2. **Context envelopes** cap context per WP; `generated/**` and `forbidden/**` from `context-sources.yaml` are excluded at runtime.
3. **Boundary enforcement** happens twice: M09 rejects writes outside `allowed_paths` immediately; M10 re-verifies via `validate-completion-report.js`.
4. **Loop 3 escalation**: on the 3rd consecutive failure of the same `root_cause_category`, an ADR draft and a remediation WP are auto-generated into the queue.
5. **Auto-approval (Loop 1)**: `packet_type ∈ {docs, refactor}` with implied `risk=low` bypasses the user approval gate.

## Consequences

- Sessions that previously loaded 12-15 files now load 3 anchors + per-WP envelope.
- All completion reports must carry `evidence[].path` pointing to real files; the output schema enforces `minItems: 1`.
- `createServer.js` is read-only from MPO's perspective; harness surface lives in `src/server/routes/mpo.js`.

## Alternatives considered

- **Inline expansion into existing orchestrate.js**: Rejected. Would mix planning and execution concerns and make boundary enforcement impossible to verify in isolation.
- **Full LLM pipeline for all modules**: Rejected. 75% of modules need zero LLM calls; forcing LLM use inflates cost and removes reproducibility.

## Files introduced by this ADR

```
contracts/harness/raw-intent.schema.json       M01→M02 contract
contracts/harness/intake.schema.json           M02 output (11 fields)
contracts/harness/wp-dag.schema.json           M03-M08 progressive enrichment contract
contracts/harness/output.schema.json           M09-M10 execution result contract
contracts/harness/completion-report.schema.json M10 semantic checks
contracts/harness/context-sources.yaml         4-tier source classification manifest
contracts/harness/isolation-rules.yaml         M04 boundary rules per domain
scripts/mpo-pipeline.js                        Full pipeline orchestrator
src/infrastructure/mpo/ContractValidator.js    INV-01/02 runtime enforcement
src/infrastructure/mpo/ModuleRegistry.js       M02-M08 registry
src/server/routes/mpo.js                       M01 HTTP surface
src/server/routes/events.js                    M12 SSE surface
```
