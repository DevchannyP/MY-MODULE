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
    /** @type {Record<string, { owner?: string, description?: string, expires_on?: string, stage?: string, allow?: { users?: string[], permissions_any?: string[] } }>} */
    this._metadata = {};
    /** @type {Array<{ beforeEvaluate?: Function, afterEvaluate?: Function }>} */
    this._hooks = [];
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
    } catch (err) {
      process.stderr.write(`[FeatureFlagProvider] Failed to load flags: ${err.message}\n`);
      // Safe default: all flags disabled
    }
  }

  _loadMetadata(metadataPath) {
    try {
      const raw = fs.readFileSync(metadataPath, 'utf8');
      const parsed = JSON.parse(raw);
      const flags = parsed && typeof parsed === 'object' ? parsed.flags : null;
      if (flags && typeof flags === 'object') {
        this._metadata = flags;
      }
    } catch (err) {
      process.stderr.write(`[FeatureFlagProvider] Failed to load flag metadata: ${err.message}\n`);
      this._metadata = {};
    }
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
   * @param {{ userId?: string, permissions?: string[], route?: string, method?: string }} [context]
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
    };

    for (const hook of this._hooks) {
      if (typeof hook.beforeEvaluate === 'function') {
        hook.beforeEvaluate({ flagName, context: normalizedContext, metadata });
      }
    }

    const configured = flagName in this._flags;
    const baseValue = configured ? this._flags[flagName] : defaultValue;
    let value = baseValue;
    let reason = configured ? (baseValue ? 'STATIC_TRUE' : 'STATIC_FALSE') : 'DEFAULT';

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
   * @param {{ userId?: string, permissions?: string[], route?: string, method?: string }} [context]
   * @returns {boolean}
   */
  isEnabled(flagName, defaultValue = false, context = {}) {
    return this.evaluate(flagName, context, defaultValue).value;
  }

  /** 전체 플래그 스냅샷 */
  getAll() {
    return { ...this._flags };
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
