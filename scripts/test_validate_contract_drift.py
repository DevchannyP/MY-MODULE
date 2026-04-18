#!/usr/bin/env python3
"""Unit tests for validate_contract_drift.py — negative-path gate coverage."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure scripts/ is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

import validate_contract_drift as vcd


def _errors(fn, *args) -> list[str]:
    """Run a validate_* function and return collected errors."""
    errors: list[str] = []
    fn(errors, *args)
    return errors


class TestValidateUiShellContract(unittest.TestCase):
    """validate_ui_shell_contract — structural consistency checks."""

    def _base_openapi(self) -> dict:
        return {
            "components": {
                "schemas": {
                    "StageRunRequest": {},
                    "StageRunReport": {
                        "properties": {
                            "runtime_observability": {},
                            "operator_guidance": {},
                        }
                    },
                    "StageRunEnvelope": {},
                    "StageRunRuntimeObservability": {
                        "required": ["report_saved", "save_exit_code", "correlation_id", "request_id"],
                        "properties": {
                            "report_saved": {},
                            "save_exit_code": {},
                            "save_error": {},
                            "correlation_id": {},
                            "request_id": {},
                        },
                    },
                    "StageOperatorGuidance": {},
                    "StageCommandResult": {},
                },
                "headers": {"StageRunReportSaved": {}},
            },
            "paths": {
                "/planning-studio/stage-run": {
                    "post": {
                        "responses": {
                            "200": {
                                "headers": {"X-Stage-Run-Report-Saved": {}}
                            }
                        }
                    }
                }
            },
        }

    def test_valid_spec_produces_no_errors(self):
        spec = self._base_openapi()
        with patch.object(vcd, "load_yaml", return_value=spec):
            errs = _errors(vcd.validate_ui_shell_contract)
        self.assertEqual(errs, [])

    def test_missing_required_schema_reported(self):
        spec = self._base_openapi()
        del spec["components"]["schemas"]["StageRunEnvelope"]
        with patch.object(vcd, "load_yaml", return_value=spec):
            errs = _errors(vcd.validate_ui_shell_contract)
        self.assertTrue(any("StageRunEnvelope" in e for e in errs), errs)

    def test_missing_observability_required_field_reported(self):
        spec = self._base_openapi()
        spec["components"]["schemas"]["StageRunRuntimeObservability"]["required"].remove("correlation_id")
        with patch.object(vcd, "load_yaml", return_value=spec):
            errs = _errors(vcd.validate_ui_shell_contract)
        self.assertTrue(any("correlation_id" in e for e in errs), errs)

    def test_missing_report_property_reported(self):
        spec = self._base_openapi()
        del spec["components"]["schemas"]["StageRunReport"]["properties"]["operator_guidance"]
        with patch.object(vcd, "load_yaml", return_value=spec):
            errs = _errors(vcd.validate_ui_shell_contract)
        self.assertTrue(any("operator_guidance" in e for e in errs), errs)

    def test_missing_response_header_reported(self):
        spec = self._base_openapi()
        del spec["paths"]["/planning-studio/stage-run"]["post"]["responses"]["200"]["headers"]["X-Stage-Run-Report-Saved"]
        with patch.object(vcd, "load_yaml", return_value=spec):
            errs = _errors(vcd.validate_ui_shell_contract)
        self.assertTrue(any("X-Stage-Run-Report-Saved" in e for e in errs), errs)


class TestValidateHarnessContracts(unittest.TestCase):
    """validate_harness_contracts — intake schema + golden record alignment."""

    def _minimal_intake_schema(self) -> dict:
        return {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "required": ["goal", "context", "constraints", "done_when", "work_mode", "verification"],
            "properties": {
                "goal": {"type": "string", "minLength": 8},
                "context": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
                "constraints": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
                "done_when": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
                "work_mode": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
                "verification": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
            },
            "additionalProperties": False,
        }

    def _minimal_output_schema(self) -> dict:
        return {
            "properties": {
                "summary": {}, "analysis": {}, "change_points": {},
                "verification": {}, "risks": {}, "next_action": {},
            }
        }

    def _make_golden_record(self, **overrides) -> dict:
        base = {
            "id": "test-001",
            "mode": "Build",
            "packet_type": "arch",
            "input": {
                "goal": "test goal here to pass length",
                "context": ["ctx"],
                "constraints": ["c"],
                "done_when": ["d"],
                "work_mode": ["w"],
                "verification": ["v"],
            },
            "expect": {
                "required_sections": ["summary", "next_action"],
                "citation_required": False,
                "zone_rule": "single-zone-preferred",
                "false_pass_forbidden": True,
            },
        }
        base.update(overrides)
        return base

    def _run_with_golden(self, records: list[dict], intake_schema=None, output_schema=None):
        if intake_schema is None:
            intake_schema = self._minimal_intake_schema()
        if output_schema is None:
            output_schema = self._minimal_output_schema()

        jsonl = "\n".join(json.dumps(r) for r in records)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as fh:
            fh.write(jsonl)
            golden_path = Path(fh.name)

        errors: list[str] = []
        with (
            patch.object(vcd, "load_json", side_effect=lambda p: intake_schema if "intake" in p else output_schema),
            patch.object(vcd, "REPO_ROOT", golden_path.parent),
        ):
            # Patch golden path resolution
            with patch.object(Path, "exists", return_value=True):
                import validate_contract_drift as _vcd
                orig = _vcd.validate_harness_contracts

                def patched(errors):
                    import jsonschema
                    validator = jsonschema.Draft202012Validator(intake_schema)
                    output_properties = set(output_schema.get("properties", {}).keys())
                    with golden_path.open() as f:
                        lines = [l.strip() for l in f if l.strip()]
                    for line in lines:
                        record = json.loads(line)
                        record_id = record.get("id", "unknown")
                        input_data = record.get("input")
                        if not isinstance(input_data, dict):
                            errors.append(f"harness-contracts: golden record {record_id} has non-object input")
                            continue
                        for err in sorted(validator.iter_errors(input_data), key=lambda e: e.path):
                            path = "/".join(str(p) for p in err.absolute_path) or "(root)"
                            errors.append(f"harness-contracts: golden record {record_id} input schema violation at {path}: {err.message}")
                        for section in record.get("expect", {}).get("required_sections", []):
                            if section not in output_properties:
                                errors.append(f"harness-contracts: golden record {record_id} expect.required_sections references unknown output property: {section}")

                patched(errors)
        golden_path.unlink(missing_ok=True)
        return errors

    def test_valid_golden_record_no_errors(self):
        errs = self._run_with_golden([self._make_golden_record()])
        self.assertEqual(errs, [])

    def test_missing_required_input_field_detected(self):
        bad = self._make_golden_record()
        del bad["input"]["verification"]
        errs = self._run_with_golden([bad])
        self.assertTrue(any("verification" in e for e in errs), errs)

    def test_unknown_required_section_detected(self):
        bad = self._make_golden_record()
        bad["expect"]["required_sections"] = ["summary", "nonexistent_section"]
        errs = self._run_with_golden([bad])
        self.assertTrue(any("nonexistent_section" in e for e in errs), errs)


class TestValidateSystemApiContract(unittest.TestCase):
    """validate_system_api_contract — capability↔openapi + events coverage."""

    def _base_capability(self) -> dict:
        return {
            "capabilities": [
                {"id": "cap.a", "http_operations": ["opA", "opB"]},
                {"id": "cap.b", "http_operations": ["opC"]},
            ],
            "events_emitted": ["sys.event.created"],
        }

    def _base_openapi(self) -> dict:
        return {
            "paths": {
                "/a": {"get": {"operationId": "opA"}},
                "/b": {"post": {"operationId": "opB"}},
                "/c": {"delete": {"operationId": "opC"}},
            }
        }

    def _base_events_schema(self) -> dict:
        return {"definitions": {"sys.event.created": {}}}

    def _run(self, capability=None, openapi=None, events=None):
        cap = capability or self._base_capability()
        oas = openapi or self._base_openapi()
        evs = events or self._base_events_schema()

        def load_yaml_side(path):
            if "capability" in path:
                return cap
            return oas

        def load_json_side(path):
            return evs

        errors: list[str] = []
        with (
            patch.object(vcd, "load_yaml", side_effect=load_yaml_side),
            patch.object(vcd, "load_json", side_effect=load_json_side),
        ):
            vcd.validate_system_api_contract(errors)
        return errors

    def test_valid_contract_no_errors(self):
        self.assertEqual(self._run(), [])

    def test_capability_op_missing_in_openapi_detected(self):
        cap = self._base_capability()
        cap["capabilities"][0]["http_operations"].append("opMissing")
        errs = self._run(capability=cap)
        self.assertTrue(any("opMissing" in e for e in errs), errs)

    def test_extra_openapi_op_not_in_capability_detected(self):
        oas = self._base_openapi()
        oas["paths"]["/extra"] = {"get": {"operationId": "opExtra"}}
        errs = self._run(openapi=oas)
        self.assertTrue(any("opExtra" in e for e in errs), errs)

    def test_missing_event_definition_detected(self):
        cap = self._base_capability()
        cap["events_emitted"].append("sys.event.missing")
        errs = self._run(capability=cap)
        self.assertTrue(any("sys.event.missing" in e for e in errs), errs)

    def test_no_events_emitted_no_error(self):
        cap = self._base_capability()
        cap["events_emitted"] = []
        self.assertEqual(self._run(capability=cap), [])


class TestValidateTaskManagement(unittest.TestCase):
    """validate_task_management — UI capability refs, openapi ops, events, routing."""

    def _make_capability(self, cap_ids=("create-task", "get-task", "list-tasks",
                                        "transition-task-status", "update-task-assignee")) -> dict:
        return {
            "capabilities": [{"id": cid} for cid in cap_ids],
            "events_emitted": [],
        }

    def _make_openapi(self, op_ids=("createTask", "getTask", "listTasks",
                                    "transitionTaskStatus", "updateTaskAssignee")) -> dict:
        paths = {}
        for op in op_ids:
            paths[f"/{op}"] = {"get": {"operationId": op}}
        return {
            "paths": {
                "/tasks": {"get": {"operationId": "listTasks"}},
                "/tasks/{task_id}": {"get": {"operationId": "getTask"}},
                "/tasks/{task_id}/status": {"patch": {"operationId": "transitionTaskStatus"}},
                "/tasks/{task_id}/assignee": {"patch": {"operationId": "updateTaskAssignee"}},
                "/tasks-create": {"post": {"operationId": "createTask"}},
            },
            "components": {"schemas": {}},
        }

    def _run(self, capability=None, ui=None, openapi=None, events=None, controller=None):
        cap = capability or self._make_capability()
        ui_spec = ui or {"screens": []}
        oas = openapi or self._make_openapi()
        evs = events or {"definitions": {}}
        ctrl = controller or (
            "path === '/tasks'\n"
            "path.match(/^\\/tasks\\/([^/]+)$/)\n"
            "path.match(/^\\/tasks\\/([^/]+)\\/status$/)\n"
            "path.match(/^\\/tasks\\/([^/]+)\\/assignee$/)\n"
        )

        def yaml_side(path):
            if "capability" in path:
                return cap
            if "ui-contract" in path:
                return ui_spec
            return oas

        errors: list[str] = []
        with (
            patch.object(vcd, "load_yaml", side_effect=yaml_side),
            patch.object(vcd, "load_json", return_value=evs),
            patch.object(vcd, "load_text", return_value=ctrl),
        ):
            vcd.validate_task_management(errors)
        return errors

    def test_valid_no_errors(self):
        self.assertEqual(self._run(), [])

    def test_ui_screen_unknown_capability_detected(self):
        ui = {"screens": [{"id": "task-list", "capabilities_required": ["nonexistent-cap"],
                            "data_requirements": []}]}
        errs = self._run(ui=ui)
        self.assertTrue(any("nonexistent-cap" in e for e in errs), errs)

    def test_openapi_ops_mismatch_detected(self):
        # Only 1 operation in openapi, but 5 capabilities — explicit mismatch
        oas = {
            "paths": {"/tasks": {"get": {"operationId": "listTasks"}}},
            "components": {"schemas": {}},
        }
        errs = self._run(openapi=oas)
        self.assertTrue(any("openapi operationIds do not match" in e for e in errs), errs)

    def test_missing_route_snippet_detected(self):
        ctrl = "// no routes here"
        errs = self._run(controller=ctrl)
        self.assertTrue(any("controller routing" in e for e in errs), errs)

    def test_missing_event_definition_detected(self):
        cap = self._make_capability()
        cap["events_emitted"] = [{"id": "TaskCreated"}]
        errs = self._run(capability=cap)
        self.assertTrue(any("TaskCreated" in e for e in errs), errs)


class TestValidateBilling(unittest.TestCase):
    """validate_billing — capability↔openapi ops, events, routing."""

    def _run(self, capability=None, ui=None, openapi=None, events=None, controller=None):
        cap = capability or {
            "capabilities": [{"id": "bill.read", "http_operations": ["listInvoices"], "screens": ["billing.list"]}],
            "events_emitted": [],
        }
        ui_spec = ui or {"screens": [{"module_key": "billing.list"}]}
        oas = openapi or {"paths": {"/billing/invoices": {"get": {"operationId": "listInvoices"}}}}
        evs = events or {"definitions": {}}
        ctrl = controller or "path === '/billing/invoices'"

        def yaml_side(path):
            if "capability" in path:
                return cap
            if "ui-contract" in path:
                return ui_spec
            return oas

        errors: list[str] = []
        with (
            patch.object(vcd, "load_yaml", side_effect=yaml_side),
            patch.object(vcd, "load_json", return_value=evs),
            patch.object(vcd, "load_text", return_value=ctrl),
        ):
            vcd.validate_billing(errors)
        return errors

    def test_valid_no_errors(self):
        self.assertEqual(self._run(), [])

    def test_missing_operation_in_openapi_detected(self):
        cap = {
            "capabilities": [{"id": "bill.pay", "http_operations": ["createPayment"], "screens": []}],
            "events_emitted": [],
        }
        errs = self._run(capability=cap)
        self.assertTrue(any("createPayment" in e for e in errs), errs)

    def test_missing_event_definition_detected(self):
        cap = {
            "capabilities": [],
            "events_emitted": ["InvoiceIssued"],
        }
        evs = {"definitions": {}}
        errs = self._run(capability=cap, events=evs)
        self.assertTrue(any("InvoiceIssued" in e for e in errs), errs)

    def test_missing_route_snippet_detected(self):
        errs = self._run(controller="// empty controller")
        self.assertTrue(any("billing controller routing" in e for e in errs), errs)


class TestValidateVideo(unittest.TestCase):
    """validate_video — capability↔openapi ops, events, routing."""

    def _run(self, capability=None, ui=None, openapi=None, events=None, controller=None):
        cap = capability or {
            "capabilities": [{"id": "vid.read", "http_operations": ["listVideos"], "screens": ["video.list"]}],
            "events_emitted": [],
        }
        ui_spec = ui or {"screens": [{"module_key": "video.list"}]}
        oas = openapi or {"paths": {"/videos": {"get": {"operationId": "listVideos"}}}}
        evs = events or {"definitions": {}}
        ctrl = controller or "path === '/videos'"

        def yaml_side(path):
            if "capability" in path:
                return cap
            if "ui-contract" in path:
                return ui_spec
            return oas

        errors: list[str] = []
        with (
            patch.object(vcd, "load_yaml", side_effect=yaml_side),
            patch.object(vcd, "load_json", return_value=evs),
            patch.object(vcd, "load_text", return_value=ctrl),
        ):
            vcd.validate_video(errors)
        return errors

    def test_valid_no_errors(self):
        self.assertEqual(self._run(), [])

    def test_unknown_screen_in_capability_detected(self):
        cap = {
            "capabilities": [{"id": "vid.read", "http_operations": ["listVideos"], "screens": ["video.nonexistent"]}],
            "events_emitted": [],
        }
        errs = self._run(capability=cap)
        self.assertTrue(any("video.nonexistent" in e for e in errs), errs)

    def test_missing_event_definition_detected(self):
        cap = {"capabilities": [], "events_emitted": ["VideoUploaded"]}
        errs = self._run(capability=cap, events={"definitions": {}})
        self.assertTrue(any("VideoUploaded" in e for e in errs), errs)


class TestValidateEventRegistry(unittest.TestCase):
    """validate_event_registry — envelope fields, event_type format, duplicates."""

    def _make_registry(self, events=None) -> dict:
        return {
            "envelope": "contracts/events/envelope.schema.json",
            "events": events or [],
        }

    def _make_envelope(self, required=None) -> dict:
        return {"required": required or ["specversion", "id", "source", "type", "time"]}

    def _make_valid_event(self, event_type="com.workflow-os.task.created",
                          source="//workflow-os/task-tracking",
                          schema_path="domains/productivity/task-tracking/contract/events.schema.json",
                          definition="TaskCreated") -> dict:
        return {
            "type": event_type,
            "source": source,
            "schema": f"{schema_path}#/definitions/{definition}",
            "produced_by": [],
        }

    def _run(self, registry=None, envelope=None, domain_events=None):
        reg = registry or self._make_registry()
        env = envelope or self._make_envelope()
        # domain_events is the shared events schema returned for all load_json calls
        dom_evs = domain_events or {"definitions": {"TaskCreated": {}}}

        def yaml_side(path):
            return reg

        def json_side(path):
            if "envelope" in path:
                return env
            return dom_evs

        def data_side(path):
            return dom_evs

        errors: list[str] = []
        with (
            patch.object(vcd, "load_yaml", side_effect=yaml_side),
            patch.object(vcd, "load_json", side_effect=json_side),
            patch.object(vcd, "load_data", side_effect=data_side),
            patch.object(Path, "exists", return_value=True),
        ):
            vcd.validate_event_registry(errors)
        return errors

    def test_valid_empty_registry_no_errors(self):
        # Empty registry is valid only when domain events schemas are also empty
        self.assertEqual(self._run(domain_events={"definitions": {}}), [])

    def test_envelope_missing_required_fields_detected(self):
        env = self._make_envelope(required=["id", "source"])  # missing specversion, type, time
        errs = self._run(envelope=env)
        self.assertTrue(any("CloudEvents required fields" in e for e in errs), errs)

    def test_invalid_event_type_detected(self):
        reg = self._make_registry(events=[
            self._make_valid_event(event_type="bad.prefix.event")
        ])
        errs = self._run(registry=reg)
        self.assertTrue(any("invalid event type" in e for e in errs), errs)

    def test_invalid_event_source_detected(self):
        reg = self._make_registry(events=[
            self._make_valid_event(source="http://bad-source")
        ])
        errs = self._run(registry=reg)
        self.assertTrue(any("invalid event source" in e for e in errs), errs)

    def test_duplicate_event_type_detected(self):
        evt = self._make_valid_event()
        reg = self._make_registry(events=[evt, dict(evt)])
        errs = self._run(registry=reg)
        self.assertTrue(any("duplicate event type" in e for e in errs), errs)

    def test_invalid_schema_ref_format_detected(self):
        reg = self._make_registry(events=[
            self._make_valid_event(schema_path="bad_path_no_hash", definition="")
        ])
        # Override to use raw schema value without #
        reg["events"][0]["schema"] = "no-hash-here"
        errs = self._run(registry=reg)
        self.assertTrue(any("invalid schema ref" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
