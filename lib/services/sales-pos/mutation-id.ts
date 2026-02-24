import { createHash, randomUUID } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashToUuid(hex: string): string {
  const raw = hex.slice(0, 32);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

export function stableMutationId(input: {
  tenantId: string;
  tabId: string;
  mutationType: string;
  operationKey?: string | null;
  payload: Record<string, unknown>;
}): string {
  const operationKey = String(input.operationKey || '').trim();
  if (operationKey) {
    const direct = `${input.tenantId}|${input.tabId}|${input.mutationType}|${operationKey}`;
    return hashToUuid(createHash('sha256').update(direct).digest('hex'));
  }

  const canonical = JSON.stringify({
    tenantId: input.tenantId,
    tabId: input.tabId,
    mutationType: input.mutationType,
    payload: normalize(input.payload),
  });
  return hashToUuid(createHash('sha256').update(canonical).digest('hex'));
}

export function fallbackEntityId(): string {
  return randomUUID();
}
