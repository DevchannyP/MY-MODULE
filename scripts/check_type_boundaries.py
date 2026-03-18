#!/usr/bin/env python3
"""Validate minimal JSDoc-based type boundaries for core files."""

from __future__ import annotations

from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parent.parent

REQUIRED_MARKERS = {
    "domains/productivity/task-tracking/src/application/ports/TaskRepository.js": [
        "// @ts-check",
        "@typedef {import('../../domain/entities/Task').Task} Task",
        "@param {Task} _task",
        "@param {string} _taskId",
        "@param {TaskFilters} [_filters]",
    ],
    "domains/billing/src/application/ports/InvoiceRepository.js": [
        "// @ts-check",
        "@typedef {import('../../domain/entities/Invoice').Invoice} Invoice",
        "@param {string} _invoiceId",
        "@param {Invoice} _invoice",
        "@param {InvoiceQuery} [",
    ],
    "domains/billing/src/application/ports/PaymentRepository.js": [
        "// @ts-check",
        "@typedef {import('../../domain/entities/Payment').Payment} Payment",
        "@param {string} _paymentId",
        "@param {PaymentQuery} [",
        "@param {Payment} _payment",
    ],
    "domains/billing/src/application/ports/BillingExceptionRepository.js": [
        "// @ts-check",
        "@typedef {import('../../domain/entities/BillingException').BillingException} BillingException",
        "@param {string} _exceptionId",
        "@param {BillingExceptionQuery} [",
        "@param {BillingException} _billingException",
    ],
    "domains/productivity/task-tracking/src/domain/entities/Task.js": [
        "// @ts-check",
        "@typedef {{",
        "@returns {Task}",
        "@param {CreateTaskInput}",
        "@param {TaskSnapshot}",
    ],
    "domains/billing/src/domain/entities/Invoice.js": [
        "// @ts-check",
        "@typedef {{",
        "@param {InvoiceSnapshot}",
        "@param {CreateInvoiceInput}",
        "@returns {Invoice}",
    ],
    "domains/billing/src/domain/entities/Payment.js": [
        "// @ts-check",
        "@typedef {{",
        "@param {PaymentSnapshot}",
        "@param {CreatePaymentInput}",
        "@returns {Payment}",
    ],
    "domains/billing/src/domain/entities/BillingException.js": [
        "// @ts-check",
        "@typedef {{",
        "@param {BillingExceptionSnapshot}",
        "@param {CreateBillingExceptionInput}",
        "@returns {BillingException}",
    ],
    "domains/productivity/task-tracking/src/interface/TaskController.js": [
        "// @ts-check",
        "@returns {Promise<{ status: number, body: unknown }>}",
    ],
    "domains/billing/src/interface/BillingController.js": [
        "// @ts-check",
        "@returns {Promise<{ status: number, body: object }>}",
    ],
}


def main() -> int:
    errors: list[str] = []
    for relative_path, markers in REQUIRED_MARKERS.items():
        content = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        for marker in markers:
            if marker not in content:
                errors.append(f"{relative_path}: missing marker -> {marker}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("type boundary validation PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
