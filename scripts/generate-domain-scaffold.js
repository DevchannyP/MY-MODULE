#!/usr/bin/env node
// scripts/generate-domain-scaffold.js
// 도메인 스캐폴드 생성기 — blueprint + recipe 선택 기반
// 외부 의존성 없음 — Node.js 내장 모듈만 사용

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 인수 파싱
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (token === '--list-blueprints') { args.listBlueprints = true; continue; }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// 경량 YAML 파서 (외부 라이브러리 금지)
// ---------------------------------------------------------------------------
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1, lastKey: undefined, isArray: false }];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.replace(/\s*#.*$/, '').trimEnd();
    i++;
    if (!trimmed.trim()) continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    const content = trimmed.trimStart();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];
    const parent = frame.obj;

    if (content.startsWith('- ')) {
      const val = content.slice(2).trim();
      // Find nearest array ancestor in stack
      let arrFrame = null;
      for (let j = stack.length - 1; j >= 0; j--) {
        if (Array.isArray(stack[j].obj)) { arrFrame = stack[j]; break; }
      }
      if (arrFrame) {
        if (val.includes(': ')) {
          const itemObj = {};
          const cidx = val.indexOf(': ');
          const k = val.slice(0, cidx).trim();
          const v = parseScalar(val.slice(cidx + 2).trim());
          itemObj[k] = v;
          arrFrame.obj.push(itemObj);
          stack.push({ obj: itemObj, indent, lastKey: k, isArray: false });
        } else if (val === '') {
          const itemObj = {};
          arrFrame.obj.push(itemObj);
          stack.push({ obj: itemObj, indent, lastKey: undefined, isArray: false });
        } else {
          arrFrame.obj.push(parseScalar(val));
        }
      }
    } else if (content.includes(': ')) {
      const colonIdx = content.indexOf(': ');
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 2).trim();

      if (val === '' || val === '|' || val === '>') {
        if (val === '|' || val === '>') {
          const blockLines = [];
          while (i < lines.length) {
            const nextRaw = lines[i];
            const nextIndent = nextRaw.length - nextRaw.trimStart().length;
            if (nextRaw.trim() === '' || nextIndent > indent) {
              blockLines.push(nextRaw.trimStart());
              i++;
            } else { break; }
          }
          parent[key] = blockLines.join('\n').trim();
          frame.lastKey = key;
        } else {
          parent[key] = {};
          frame.lastKey = key;
          stack.push({ obj: parent[key], indent, lastKey: undefined, isArray: false });
        }
      } else if (val.startsWith('[')) {
        parent[key] = parseInlineArray(val);
        frame.lastKey = key;
      } else {
        parent[key] = parseScalar(val);
        frame.lastKey = key;
      }
    } else if (content.endsWith(':')) {
      const key = content.slice(0, -1).trim();
      const nextLine = (lines[i] || '').trimStart();
      if (nextLine.startsWith('- ') || nextLine === '-') {
        parent[key] = [];
        frame.lastKey = key;
        stack.push({ obj: parent[key], indent, lastKey: key, isArray: true });
      } else {
        parent[key] = {};
        frame.lastKey = key;
        stack.push({ obj: parent[key], indent, lastKey: undefined, isArray: false });
      }
    }
  }
  return root;
}

function parseScalar(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  const num = Number(val);
  if (!Number.isNaN(num) && val !== '') return num;
  return val.replace(/^["']|["']$/g, '');
}

function parseInlineArray(val) {
  const inner = val.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => parseScalar(s.trim()));
}

// ---------------------------------------------------------------------------
// 카탈로그 로더
// ---------------------------------------------------------------------------
function loadCatalogAtRoot(runtimeRoot, filename) {
  const filePath = path.join(path.resolve(runtimeRoot), 'master-shell', 'catalog', filename);
  try {
    return parseYaml(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// --list-blueprints
// ---------------------------------------------------------------------------
function cmdListBlueprints() {
  const blueprints = loadCatalogAtRoot(DEFAULT_ROOT, 'project-blueprints.yaml');
  const recipes = loadCatalogAtRoot(DEFAULT_ROOT, 'ai-runtime-recipes.yaml');
  const matrix = loadCatalogAtRoot(DEFAULT_ROOT, 'adapter-compatibility-matrix.yaml');

  process.stdout.write('\n=== 사용 가능한 블루프린트 ===\n\n');

  if (!blueprints || !Array.isArray(blueprints.blueprints)) {
    process.stdout.write('블루프린트 데이터를 읽을 수 없습니다.\n');
    return;
  }

  for (const bp of blueprints.blueprints) {
    process.stdout.write(`  [${bp.id}]  ${bp.name}\n`);
    process.stdout.write(`    설명: ${bp.summary}\n`);
    process.stdout.write(`    사용 시점: ${bp.when_to_use}\n`);
    process.stdout.write(`    아키텍처 프로파일: ${bp.architecture_profile}\n`);

    if (recipes && Array.isArray(recipes.recipes)) {
      const matched = recipes.recipes.filter(r =>
        Array.isArray(r.blueprint_refs) && r.blueprint_refs.includes(bp.id)
      );
      if (matched.length > 0) {
        process.stdout.write(`    추천 레시피: ${matched.map(r => r.id).join(', ')}\n`);
      }
    }

    if (matrix && Array.isArray(matrix.profiles)) {
      const prof = matrix.profiles.find(p => p.profile_id === bp.architecture_profile);
      if (prof && Array.isArray(prof.notes) && prof.notes.length > 0) {
        process.stdout.write(`    주의사항: ${prof.notes[0]}\n`);
      }
    }

    process.stdout.write('\n');
  }

  process.stdout.write('=== 사용 가능한 레시피 ===\n\n');
  if (recipes && Array.isArray(recipes.recipes)) {
    for (const r of recipes.recipes) {
      process.stdout.write(`  [${r.id}]  ${r.name}\n`);
      process.stdout.write(`    목표: ${r.objective}\n`);
      const bestFor = Array.isArray(r.best_for) ? r.best_for : [];
      process.stdout.write(`    최적 상황: ${bestFor.join(', ')}\n`);
      process.stdout.write('\n');
    }
  }

  process.stdout.write('사용법: node scripts/generate-domain-scaffold.js --domain NAME --blueprint BLUEPRINT_ID [--recipe RECIPE_ID] [--dry-run]\n\n');
}

// ---------------------------------------------------------------------------
// requirements.yaml 템플릿 생성
// ---------------------------------------------------------------------------
function buildRequirementsYaml(opts) {
  const { domain, blueprint, recipe, profile, adapterRefs } = opts;
  const adapterList = (adapterRefs || []).map(a => `#   - "${a}"`).join('\n');
  const recipeNote = recipe ? `# 선택 레시피: ${recipe}\n` : '';

  return `# Workflow OS - Requirements
# 이 파일만 교체하면 Stage A→E 전체가 반복 실행된다.
# Schema: requirements/requirements.schema.json
#
# 블루프린트: ${blueprint}
# 아키텍처 프로파일: ${profile}
${recipeNote}
version: "0.1.0"

module:
  id: "${domain}"
  name: "${domain}"
  domain: "TODO"
  bounded_context: "${domain}-context"
  owner: "TODO"
  description: |
    TODO: ${domain} 도메인의 목적과 범위를 기술하세요.

stage: "A"
# A: bounded context / 용어 / 권한 / 불변조건 / public contract 변경 시
# B: stageA memory / domain-map / 화면 구성 / shared libs / composition policy 변경 시
# C: plugin registry / navigation / feature flag / rollout 정책 변경 시
# D: 구현 후 검증, 수정 후 재검증 필요 시
# E: 반복 실패, 수동 개입 증가, 구조 단순화 필요 시

contracts:
  http: "domains/${domain}/contract/openapi.yaml"
  events: "domains/${domain}/contract/events.schema.json"
  ui: "domains/${domain}/contract/ui-contract.yaml"
  capability: "domains/${domain}/contract/capability.yaml"

nfr:
  latency_p99_ms: 200
  availability_percent: 99.9
  rpo_minutes: 60
  rto_minutes: 30

quality_gates:
  correctness:
    - "unit-tests"
    - "contract-tests"
    - "integration-tests"
    - "e2e-smoke"
  code_health:
    - "lint"
    - "type-check"
    - "static-analysis"
  security:
    - "secret-scan"
    - "dependency-scan"
    - "authn-authz-regression"
    - "input-validation"
  supply_chain:
    - "sbom"
    - "provenance-evidence"
    - "rollback-verification"
    - "observability-check"

composition:
  depends_on: []
  # 의존 추가 시 계약 참조 경로만 허용. 예:
  # - "domains/identity/auth/contract/capability.yaml"
  provides:
    - "domains/${domain}/contract/capability.yaml"

feature_flags:
  enable_${domain.replace(/-/g, '_')}: false

routing:
  entry_point: "/${domain}"
  navigation_group: "${domain}"
  plugin_slot: "main-content"

# 아키텍처 프로파일 어댑터 참고 (Stage A 설계 시 활성화)
# adapters:
${adapterList || '#   (어댑터 목록 없음)'}
`;
}

// ---------------------------------------------------------------------------
// 유효성 검사 헬퍼
// ---------------------------------------------------------------------------
function validateBlueprint(blueprints, blueprintId) {
  if (!blueprints || !Array.isArray(blueprints.blueprints)) return null;
  return blueprints.blueprints.find(b => b.id === blueprintId) || null;
}

function validateRecipe(recipes, recipeId) {
  if (!recipeId) return null;
  if (!recipes || !Array.isArray(recipes.recipes)) return null;
  return recipes.recipes.find(r => r.id === recipeId) || null;
}

function getAdapterRefsForProfile(registry, profileId) {
  if (!registry || !Array.isArray(registry.adapter_profiles)) return [];
  const prof = registry.adapter_profiles.find(p => p.id === profileId);
  return prof && Array.isArray(prof.adapter_refs) ? prof.adapter_refs : [];
}

function validateProfileCompatibility(matrix, profileId, recipeId) {
  if (!matrix || !recipeId) return { ok: true, notes: [] };
  if (!Array.isArray(matrix.profiles)) return { ok: true, notes: [] };
  const prof = matrix.profiles.find(p => p.profile_id === profileId);
  if (!prof) return { ok: true, notes: [] };
  const recommended = Array.isArray(prof.recommended_recipes) ? prof.recommended_recipes : [];
  if (recommended.length > 0 && !recommended.includes(recipeId)) {
    return {
      ok: false,
      notes: [`레시피 '${recipeId}'는 프로파일 '${profileId}'에 권장되지 않습니다. 권장 레시피: ${recommended.join(', ')}`],
    };
  }
  return { ok: true, notes: [] };
}

// ---------------------------------------------------------------------------
// 실행 계획 출력
// ---------------------------------------------------------------------------
function printPlan(opts) {
  const { domain, blueprint, recipe, profile, adapterRefs, outFile, exists } = opts;

  process.stdout.write('\n--- 도메인 스캐폴드 생성 계획 ---\n\n');
  process.stdout.write(`  도메인 ID        : ${domain}\n`);
  process.stdout.write(`  블루프린트       : ${blueprint}\n`);
  process.stdout.write(`  아키텍처 프로파일: ${profile}\n`);
  if (recipe) process.stdout.write(`  레시피           : ${recipe}\n`);
  process.stdout.write(`  출력 파일        : ${outFile}\n`);
  if (adapterRefs.length > 0) {
    process.stdout.write('  어댑터 참고      :\n');
    for (const a of adapterRefs) {
      process.stdout.write(`    - ${a}\n`);
    }
  }
  if (exists) {
    process.stdout.write('\n  [주의] 파일이 이미 존재합니다 — 덮어쓰지 않습니다 (안전 보호).\n');
  }
  process.stdout.write('\n');
}

function printNextSteps(domain) {
  process.stdout.write('--- 다음 단계 ---\n\n');
  process.stdout.write('  1. requirements 파일을 편집하여 TODO 항목을 채우세요:\n');
  process.stdout.write(`     requirements/${domain}.yaml\n\n`);
  process.stdout.write('  2. Work Packet 스케줄러 확인:\n');
  process.stdout.write('     npm run wp:next\n\n');
  process.stdout.write('  3. CLAUDE.md 키워드로 Stage A 실행:\n');
  process.stdout.write(`     A ${domain}\n\n`);
  process.stdout.write('  4. 조합 검증:\n');
  process.stdout.write('     npm run validate:composition\n\n');
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);

  if (args.listBlueprints) {
    cmdListBlueprints();
    return;
  }

  const domain = args.domain;
  const blueprintId = args.blueprint;

  if (!domain || !blueprintId) {
    process.stderr.write('[오류] --domain 과 --blueprint 는 필수 인수입니다.\n\n');
    process.stderr.write('사용법:\n');
    process.stderr.write('  node scripts/generate-domain-scaffold.js --domain NAME --blueprint BLUEPRINT_ID [--recipe RECIPE_ID] [--dry-run]\n');
    process.stderr.write('  node scripts/generate-domain-scaffold.js --list-blueprints\n\n');
    process.exit(1);
  }

  const recipeId = args.recipe || null;
  const isDryRun = Boolean(args.dryRun);
  const runtimeRoot = path.resolve(typeof args.root === 'string' ? args.root : DEFAULT_ROOT);

  const blueprints = loadCatalogAtRoot(runtimeRoot, 'project-blueprints.yaml');
  const recipes = loadCatalogAtRoot(runtimeRoot, 'ai-runtime-recipes.yaml');
  const registry = loadCatalogAtRoot(runtimeRoot, 'adapter-registry.yaml');
  const matrix = loadCatalogAtRoot(runtimeRoot, 'adapter-compatibility-matrix.yaml');

  const bp = validateBlueprint(blueprints, blueprintId);
  if (!bp) {
    const available = blueprints && Array.isArray(blueprints.blueprints)
      ? blueprints.blueprints.map(b => b.id).join(', ')
      : '알 수 없음';
    process.stderr.write(`[오류] 블루프린트 '${blueprintId}'를 찾을 수 없습니다.\n`);
    process.stderr.write(`사용 가능한 블루프린트: ${available}\n`);
    process.stderr.write('목록 보기: node scripts/generate-domain-scaffold.js --list-blueprints\n\n');
    process.exit(1);
  }

  const profile = bp.architecture_profile || 'workflow-domain-module';

  if (recipeId) {
    const rc = validateRecipe(recipes, recipeId);
    if (!rc) {
      const available = recipes && Array.isArray(recipes.recipes)
        ? recipes.recipes.map(r => r.id).join(', ')
        : '알 수 없음';
      process.stderr.write(`[오류] 레시피 '${recipeId}'를 찾을 수 없습니다.\n`);
      process.stderr.write(`사용 가능한 레시피: ${available}\n\n`);
      process.exit(1);
    }

    const compat = validateProfileCompatibility(matrix, profile, recipeId);
    if (!compat.ok) {
      process.stderr.write('[경고] 호환성 문제:\n');
      for (const note of compat.notes) {
        process.stderr.write(`  - ${note}\n`);
      }
      process.stderr.write('  계속하려면 --recipe 를 생략하거나 권장 레시피를 선택하세요.\n\n');
      process.exit(1);
    }
  }

  const adapterRefs = getAdapterRefsForProfile(registry, profile);
  const requirementsDir = path.join(runtimeRoot, 'requirements');
  const outFile = path.join(requirementsDir, `${domain}.yaml`);
  const relativeOut = path.relative(runtimeRoot, outFile);
  const exists = fs.existsSync(outFile);

  printPlan({ domain, blueprint: blueprintId, recipe: recipeId, profile, adapterRefs, outFile: relativeOut, exists });

  if (isDryRun) {
    process.stdout.write('[dry-run] 파일을 생성하지 않습니다.\n\n');
    process.stdout.write('--- 생성될 requirements 파일 미리보기 ---\n\n');
    process.stdout.write(buildRequirementsYaml({ domain, blueprint: blueprintId, recipe: recipeId, profile, adapterRefs }));
    process.stdout.write('\n');
    printNextSteps(domain);
    return;
  }

  if (exists) {
    process.stderr.write(`[중단] requirements/${domain}.yaml 이 이미 존재합니다.\n`);
    process.stderr.write('기존 파일을 유지합니다. 덮어쓰려면 파일을 먼저 삭제하세요.\n\n');
    printNextSteps(domain);
    process.exit(1);
  }

  if (!fs.existsSync(requirementsDir)) {
    fs.mkdirSync(requirementsDir, { recursive: true });
  }

  const content = buildRequirementsYaml({ domain, blueprint: blueprintId, recipe: recipeId, profile, adapterRefs });
  fs.writeFileSync(outFile, content, 'utf8');

  process.stdout.write(`생성 완료: requirements/${domain}.yaml\n\n`);
  printNextSteps(domain);
}

main();
