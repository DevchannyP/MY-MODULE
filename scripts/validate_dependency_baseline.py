#!/usr/bin/env python3
"""
Offline dependency baseline validator.

이 스크립트는 "인터넷 없이도 설명 가능한 의존성 점검"을 만든다.
아이디어는 단순하다.

1. package.json 과 package-lock.json 이 서로 같은 말을 하는지 확인한다.
2. 코어 저장소에 런타임 dependency 가 새로 들어오지 않았는지 확인한다.
3. lockfile 안의 모든 패키지가 버전, integrity, license 를 가지는지 확인한다.
4. 허용된 라이선스 집합 안에 있는지 확인한다.

이 검증은 CVE 데이터베이스를 조회하지는 않는다.
대신 "무엇이 설치됐는지, 얼마나 잠겨 있는지, 코어가 얼마나 얇게 유지되는지"를
오프라인에서 재현 가능하게 보장한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
PACKAGE_LOCK = ROOT / "package-lock.json"

ALLOWED_LICENSES = {
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BlueOak-1.0.0",
    "ISC",
    "MIT",
    "Python-2.0",   # PSF(Python Software Foundation) 오픈소스 — argparse(js-yaml 의존성) 허용
}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str) -> None:
    raise SystemExit(f"dependency baseline validation FAIL: {message}")


def validate() -> None:
    package_json = load_json(PACKAGE_JSON)
    package_lock = load_json(PACKAGE_LOCK)

    if package_lock.get("lockfileVersion", 0) < 3:
        fail("lockfileVersion 3 이상이 필요합니다")

    root_lock = package_lock.get("packages", {}).get("")
    if not root_lock:
        fail("package-lock.json root package metadata 가 없습니다")

    package_json_runtime = package_json.get("dependencies", {})
    package_json_dev = package_json.get("devDependencies", {})
    lock_runtime = root_lock.get("dependencies", {})
    lock_dev = root_lock.get("devDependencies", {})

    if package_json_runtime != lock_runtime:
        fail("package.json dependencies 와 package-lock root dependencies 가 다릅니다")

    if package_json_dev != lock_dev:
        fail("package.json devDependencies 와 package-lock root devDependencies 가 다릅니다")

    if package_json_runtime:
        fail("코어 저장소 baseline 에서는 runtime dependencies 가 없어야 합니다")

    packages = package_lock.get("packages", {})
    non_dev_packages: list[str] = []
    missing_integrity: list[str] = []
    missing_license: list[str] = []
    disallowed_license: list[str] = []

    for name, meta in packages.items():
        if name == "":
            continue

        if "version" not in meta or "integrity" not in meta:
            missing_integrity.append(name)

        license_name = meta.get("license")
        if not license_name:
            missing_license.append(name)
        elif license_name not in ALLOWED_LICENSES:
            disallowed_license.append(f"{name} ({license_name})")

        # 현재 baseline 은 "런타임 의존성 없음 + dev tooling 만 존재"를 보장한다.
        if not meta.get("dev", False):
            non_dev_packages.append(name)

    if missing_integrity:
        fail(f"integrity/version 누락 패키지 {len(missing_integrity)}건")
    if missing_license:
        fail(f"license 누락 패키지 {len(missing_license)}건")
    if disallowed_license:
        fail(f"허용되지 않은 license 패키지 {len(disallowed_license)}건")
    if non_dev_packages:
        fail(f"dev 전용 baseline 을 벗어난 패키지 {len(non_dev_packages)}건")

    print(
        "dependency baseline validation PASS: "
        f"runtime deps 0, direct dev deps {len(package_json_dev)}, "
        f"locked packages {len(packages) - 1}, licenses ok, integrity ok"
    )


if __name__ == "__main__":
    validate()
