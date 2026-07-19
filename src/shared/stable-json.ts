function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [
      key,
      canonical((value as Record<string, unknown>)[key])
    ]));
  }
  return value;
}

export function stableJson(value: unknown, space = 0): string {
  return JSON.stringify(canonical(value), null, space);
}

export function stableFingerprint(value: unknown): string {
  const source = stableJson(value);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
