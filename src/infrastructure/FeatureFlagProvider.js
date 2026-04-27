//@ts-check
'use strict';

/**
 * FeatureFlagProvider — 런타임 Feature Flag 평가기
 *
 * Benchmark:
 *   - OpenFeature SDK (CNCF 표준 interface) — vendor-neutral flag evaluation
 *   - Trunk-Based Development (DORA) — 코드 브랜치 없이 flag으로 기능 제어
 *   - LaunchDarkly evaluation model — context-aware targeting
 *
 * 설계 원칙:
 *   - flags.yaml (master-shell 설정)을 단일 진실원으로 읽는다
 *   - false가 기본값 (safe default)
 *   - 미래에 원격 provider(LaunchDarkly, Flagsmith, Flipt)로 교체 가능한 인터페이스
 */

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FLAGS_PATH = path.resolve(__dirname, '../../master-shell/feature-flags/flags.yaml');
const FLAG_METADATA_PATH = path.resolve(__dirname, '../../master-shell/feature-flags/metadata.json');

/**
 * 단순 YAML 파서 (flat + 1-depth section, flags.yaml 형식 전용)
 * 외부 의존성 없이 동작.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseSimpleYaml(text) {
  /** @type {Record<string, Record<string,unknown>|unknown>} */
  const result = {};
  let section = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');          // strip comments
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Section header (e.g. "global_flags:")
    if (/^[a-z_]+:$/.test(trimmed)) {
      section = trimmed.slice(0, -1);
      result[section] = {};
      continue;
    }

    // Key-value (may have leading whitespace for nested)
    const kv = line.match(/^(\s*)([a-z_.]+):\s*(.*)$/);
    if (!kv) continue;

    const [, indent, key, rawVal] = kv;
    const val = rawVal.trim();

    let parsed;
    if (val === 'true')                        parsed = true;
    else if (val === 'false')                  parsed = false;
    else if (val === 'null' || val === '~' || val === '') parsed = null;
    else if (/^".*"$/.test(val))               parsed = val.slice(1, -1);
    else if (/^\d+(\.\d+)?$/.test(val))        parsed = Number(val);
    else                                       parsed = val;

    if (indent.length > 0 && section && typeof result[section] === 'object' && result[section] !== null) {
      /** @type {Record<string,unknown>} */ (result[section])[key] = parsed;
    } else {
      section = '';
      result[key] = parsed;
    }
  }

  return result;
}

class FeatureFlagProvider {
  /**
   * @param {string} [flagsPath]
   * @param {string} [metadataPath]
   */
  constructor(flagsPath = FLAGS_PATH, metadataPath = FLAG_METADATA_PATH) {
    /** @type {Record<string, boolean>} */
    this._flags = {};
    /** @type {Record<string, { owner?: string, description?: string, expires_on?: string, stage?: string, allow?: { users?: string[], permissions_any?: string[] }, rollout?: { percentage?: number, bucket_by?: string } }>} */
    this._metadata = {};
    /** @type {Array<{ beforeEvaluate?: Function, afterEvaluate?: Function }>} */
    this._hooks = [];
    /** @type {Set<string>} env 오버라이드된 플래그 집합 — evaluate() 내 롤아웃 건너뜀 */
    this._envOverriddenFlags = new Set();
    this._state = {
      flagsLoaded: false,
      metadataLoaded: false,
      errors: [],
      envOverridesApplied: 0,
    };
    this._load(flagsPath);
    this._loadMetadata(metadataPath);
  }

  _load(flagsPath) {
    try {
      const text = fs.readFileSync(flagsPath, 'utf8');
      const parsed = parseSimpleYaml(text);

      // Flatten global_flags + plugin_flags into a single map
      const sections = ['global_flags', 'plugin_flags'];
      for (const section of sections) {
        const group = parsed[section];
        if (group && typeof group === 'object') {
          for (const [k, v] of Object.entries(group)) {
            this._flags[k] = Boolean(v);
          }
        }
      }
      this._state.flagsLoaded = true;
      this._applyEnvOverrides();
    } catch (err) {
      process.stderr.write(`[FeatureFlagProvider] Failed to load flags: ${err.message}\n`);
      this._state.flagsLoaded = false;
      this._state.errors.push(`flags:${err.message}`);
      // Safe default: all flags disabled
    }
  }

  /**
   * process.env に WOS_FLAG_ 접두어 변수가 있으면 이미 flags.yaml에 선언된 키에 한해 오버라이드한다.
   * 변환 규칙: flag key의 dot/hyphen → underscore, 대문자 + WOS_FLAG_ 접두어
   * 예) enable_task_management → WOS_FLAG_ENABLE_TASK_MANAGEMENT
   *     billing.enabled       → WOS_FLAG_BILLING_ENABLED
   * phantom flag(yaml 미선언 키)는 생성하지 않는다.
   */
  _applyEnvOverrides() {
    let applied = 0;
    for (const flagKey of Object.keys(this._flags)) {
      const envKey = 'WOS_FLAG_' + flagKey.replace(/[.-]/g, '_').toUpperCase();
      const envVal = process.env[envKey];
      if (envVal === 'true' || envVal === '1') {
        this._flags[flagKey] = true;
        this._envOverriddenFlags.add(flagKey);
        applied++;
        process.stderr.write(`[FeatureFlagProvider] ENV override: ${flagKey}=true (via ${envKey}) — rollout bypassed\n`);
      } else if (envVal === 'false' || envVal === '0') {
        this._flags[flagKey] = false;
        this._envOverriddenFlags.add(flagKey);
        applied++;
        process.stderr.write(`[FeatureFlagProvider] ENV override: ${flagKey}=false (via ${envKey}) — rollout bypassed\n`);
      }
    }
    this._state.envOverridesApplied = applied;
  }

  _loadMetadata(metadataPath) {
    try {
      const raw = fs.readFileSync(metadataPath, 'utf8');
      const parsed = JSON.parse(raw);
      const flags = parsed && typeof parsed === 'object' ? parsed.flags : null;
      if (flags && typeof flags === 'object') {
        this._metadata = flags;
        this._state.metadataLoaded = true;
      }
    } catch (err) {
      process.stderr.write(`[FeatureFlagProvider] Failed to load flag metadata: ${err.message}\n`);
      this._metadata = {};
      this._state.metadataLoaded = false;
      this._state.errors.push(`metadata:${err.message}`);
    }
  }

  /**
   * @param {Record<string, unknown>} metadata
   * @returns {{ percentage?: number, bucket_by?: string }}
   */
  _getRollout(metadata) {
    return metadata && typeof metadata.rollout === 'object' && metadata.rollout !== null
      ? /** @type {{ percentage?: number, bucket_by?: string }} */ (metadata.rollout)
      : {};
  }

  /**
   * @param {{ userId?: string, route?: string, method?: string, targetingKey?: string }} context
   * @param {string | undefined} bucketBy
   * @returns {string}
   */
  _resolveBucketValue(context, bucketBy) {
    if (typeof context.targetingKey === 'string' && context.targetingKey) {
      return context.targetingKey;
    }
    if (bucketBy === 'route' && typeof context.route === 'string' && context.route) {
      return context.route;
    }
    if (bucketBy === 'method' && typeof context.method === 'string' && context.method) {
      return context.method;
    }
    return typeof context.userId === 'string' && context.userId ? context.userId : 'anonymous';
  }

  /**
   * @param {string} flagName
   * @param {string} bucketValue
   * @returns {number}
   */
  _stableBucket(flagName, bucketValue) {
    const digest = crypto.createHash('sha256').update(`${flagName}:${bucketValue}`).digest('hex');
    return Number.parseInt(digest.slice(0, 8), 16) % 100;
  }

  /**
   * @param {{ beforeEvaluate?: Function, afterEvaluate?: Function }} hook
   * @returns {FeatureFlagProvider}
   */
  registerHook(hook) {
    if (hook && typeof hook === 'object') {
      this._hooks.push(hook);
    }
    return this;
  }

  /**
   * @param {string} flagName
   * @returns {Record<string, unknown>}
   */
  getMetadata(flagName) {
    return { ...(this._metadata[flagName] || {}) };
  }

  /**
   * @param {string} flagName
   * @param {{ userId?: string, permissions?: string[], route?: string, method?: string, targetingKey?: string }} [context]
   * @param {boolean} [defaultValue=false]
   * @returns {{ flagName: string, value: boolean, reason: string, metadata: Record<string, unknown>, stale: boolean, context: Record<string, unknown> }}
   */
  evaluate(flagName, context = {}, defaultValue = false) {
    const metadata = this.getMetadata(flagName);
    const normalizedContext = {
      userId: typeof context.userId === 'string' ? context.userId : undefined,
      permissions: Array.isArray(context.permissions) ? context.permissions : [],
      route: typeof context.route === 'string' ? context.route : undefined,
      method: typeof context.method === 'string' ? context.method : undefined,
      targetingKey: typeof context.targetingKey === 'string' ? context.targetingKey : undefined,
    };

    for (const hook of this._hooks) {
      if (typeof hook.beforeEvaluate === 'function') {
        hook.beforeEvaluate({ flagName, context: normalizedContext, metadata });
      }
    }

    const configured = flagName in this._flags;
    const baseValue = configured ? this._flags[flagName] : defaultValue;
    let value = baseValue;
    let reason = this._envOverriddenFlags.has(flagName)
      ? (baseValue ? 'ENV_OVERRIDE_TRUE' : 'ENV_OVERRIDE_FALSE')
      : (configured ? (baseValue ? 'STATIC_TRUE' : 'STATIC_FALSE') : 'DEFAULT');

    const targetedUsers = Array.isArray(metadata.allow?.users) ? metadata.allow.users : [];
    if (normalizedContext.userId && targetedUsers.includes(normalizedContext.userId)) {
      value = true;
      reason = 'TARGET_USER';
    }

    const targetedPermissions = Array.isArray(metadata.allow?.permissions_any) ? metadata.allow.permissions_any : [];
    if (!value && targetedPermissions.length > 0) {
      const hasPermission = normalizedContext.permissions.some((permission) => targetedPermissions.includes(permission));
      if (hasPermission) {
        value = true;
        reason = 'TARGET_PERMISSION';
      }
    }

    // env 오버라이드된 플래그는 환경 전체 강제 적용이므로 rollout을 건너뛴다
    if (value && !this._envOverriddenFlags.has(flagName)) {
      const rollout = this._getRollout(metadata);
      if (typeof rollout.percentage === 'number' && rollout.percentage >= 0 && rollout.percentage < 100) {
        const bucketValue = this._resolveBucketValue(normalizedContext, rollout.bucket_by);
        const bucket = this._stableBucket(flagName, bucketValue);
        if (bucket < rollout.percentage) {
          reason = 'ROLLOUT_MATCH';
        } else {
          value = false;
          reason = 'ROLLOUT_SKIP';
        }
      }
    }

    const stale = typeof metadata.expires_on === 'string'
      && metadata.expires_on.length > 0
      && metadata.expires_on < new Date().toISOString().slice(0, 10);

    const details = { flagName, value, reason, metadata, stale, context: normalizedContext };
    for (const hook of this._hooks) {
      if (typeof hook.afterEvaluate === 'function') {
        hook.afterEvaluate(details);
      }
    }
    return details;
  }

  /**
   * 플래그 활성화 여부를 반환한다.
   * @param {string} flagName
   * @param {boolean} [defaultValue=false]
   * @param {{ userId?: string, permissions?: string[], route?: string, method?: string, targetingKey?: string }} [context]
   * @returns {boolean}
   */
  isEnabled(flagName, defaultValue = false, context = {}) {
    return this.evaluate(flagName, context, defaultValue).value;
  }

  /** 전체 플래그 스냅샷 */
  getAll() {
    return { ...this._flags };
  }

  /** 런타임 readiness 판단에 사용하는 상태 스냅샷 */
  getRuntimeStatus() {
    return {
      flagsLoaded: this._state.flagsLoaded,
      metadataLoaded: this._state.metadataLoaded,
      errors: [...this._state.errors],
      flagCount: Object.keys(this._flags).length,
      metadataCount: Object.keys(this._metadata).length,
      envOverridesApplied: this._state.envOverridesApplied,
      env_overridden_flags: [...this._envOverriddenFlags].sort(),
      enabled_flags: Object.entries(this._flags)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
        .sort(),
    };
  }

  /**
   * 전체 플래그 상세 목록 — /flags 엔드포인트용
   * @returns {Array<{ flag: string, enabled: boolean, env_overridden: boolean, source: string }>}
   */
  getFullFlagDetails() {
    return Object.entries(this._flags)
      .map(([flag, enabled]) => ({
        flag,
        enabled,
        env_overridden: this._envOverriddenFlags.has(flag),
        source: this._envOverriddenFlags.has(flag) ? 'env' : 'flags.yaml',
      }))
      .sort((a, b) => a.flag.localeCompare(b.flag));
  }
}

/** 싱글턴 인스턴스 (서버 수명과 동일) */
let _instance = null;

/** @returns {FeatureFlagProvider} */
function getFeatureFlags() {
  if (!_instance) _instance = new FeatureFlagProvider();
  return _instance;
}

/** 테스트에서 인스턴스를 교체할 때 사용 */
function resetFeatureFlags() {
  _instance = null;
}

module.exports = { FeatureFlagProvider, getFeatureFlags, resetFeatureFlags, FLAG_METADATA_PATH };
