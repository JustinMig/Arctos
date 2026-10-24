// Compare only fields owned by this editor, after its normal type conversion.
// Baselines live in the existing per-client, in-memory caches; no disk storage.
export function sameRecordFields(next, previous) {
  return !!previous && Object.keys(next).every(key =>
    JSON.stringify(next[key] ?? null) === JSON.stringify(previous[key] ?? null));
}

export function sameRecordList(rows, previous, payload) {
  if (!Array.isArray(previous) || rows.length !== previous.length) return false;
  if (new Set(rows.map(row => row.id)).size !== rows.length) return false;
  const byId = new Map(previous.map(row => [row.id, row]));
  return rows.every(row => row.id && byId.has(row.id) &&
    sameRecordFields(payload(row), payload(byId.get(row.id))));
}

// A server re-read used to discard these transient form fields after saving.
// Keep that boundary when returning the confirmed result without the re-read:
// deleted cards must not reappear from a previous save's serialized inputs,
// and encrypted inputs must not enter search-cache / client-saved events.
export function clientSaveResult(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) =>
    !/^(?:doctor|medication|indemnity|life_policy)_\d+_/.test(key) &&
    !/^(?:banking_|medicare_gov_)/.test(key) && !['ssn','medicare_number','license_number'].includes(key)));
}
