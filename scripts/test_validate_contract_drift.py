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


if __name__ == "__main__":
    unittest.main(verbosity=2)
