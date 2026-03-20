#!/bin/bash
# 사용법: bash scripts/auto-commit.sh <type> <scope> <message>
set -euo pipefail
TYPE=${1:?type 필요}
SCOPE=${2:?scope 필요}
MSG=${3:?message 필요}
FULL="${TYPE}(${SCOPE}): ${MSG}"
git add -A
git commit -m "$FULL"
echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"${TYPE}\",\"scope\":\"${SCOPE}\",\"message\":\"${MSG}\",\"hash\":\"$(git rev-parse --short HEAD)\"}" >> worklog/commit-log.jsonl
