export function catalogValidator(state) {
  const key = item => `${String(item.method).toUpperCase()} ${item.path}`;
  const active = new Map((state.sources || []).flatMap(source => source.endpoints)
    .map(item => [item.catalogMethodId, item]));
  const deletedKeys = new Set((state.deleted || []).map(item => item.key));
  return item => {
    if (!item.catalogMethodId) return deletedKeys.has(key(item));
    const current = active.get(item.catalogMethodId);
    return !current || current.sourceId !== item.sourceId || key(current) !== key(item);
  };
}
