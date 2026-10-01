export interface VersioningConfig {
  enabled: boolean;
  debounceMs: number;
  maxDebounceMs: number;
}

/** Invalid enabled-mode configuration must not silently change save semantics. */
export function readVersioningConfig(
  env: Record<string, string | undefined> = process.env,
): Readonly<VersioningConfig> {
  const flag = env.SOP_VERSION_CAPTURE_ENABLED;
  if (flag && flag !== 'true' && flag !== 'false') {
    throw new Error('SOP_VERSION_CAPTURE_ENABLED must be true or false');
  }
  if (flag !== 'true') {
    return Object.freeze({
      enabled: false,
      debounceMs: 10000,
      maxDebounceMs: 45000,
    });
  }
  const debounceMs = parseMs(env, 'SOP_VERSION_DEBOUNCE_MS', 5000, 60000);
  const maxDebounceMs = parseMs(
    env,
    'SOP_VERSION_MAX_DEBOUNCE_MS',
    30000,
    300000,
  );
  if (maxDebounceMs < debounceMs) {
    throw new Error('Version maximum wait must not be shorter than debounce');
  }
  return Object.freeze({ enabled: true, debounceMs, maxDebounceMs });
}

function parseMs(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw) || raw !== raw.trim())
    throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > maximum) {
    throw new Error(`${name} must be between 1000 and ${maximum}`);
  }
  return value;
}
