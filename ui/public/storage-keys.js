export function browserDraftStorage(getStorage = () => window.localStorage, getTabStorage = () => window.sessionStorage) {
  function mutate(method, ...args) {
    let failure;
    for (const get of [getTabStorage, getStorage]) {
      try { get()[method](...args); } catch (error) { failure = error; }
    }
    if (failure) throw failure;
  }
  // Each tab restores its own working copy; localStorage is only the fallback for a new tab.
  return {
    getItem(key) {
      try {
        const own = getTabStorage().getItem(key);
        if (own !== null) return own;
      } catch {}
      const fallback = getStorage().getItem(key);
      if (fallback !== null) {
        try { getTabStorage().setItem(key, fallback); } catch {}
      }
      return fallback;
    },
    setItem: (key, value) => mutate('setItem', key, value),
    removeItem: key => mutate('removeItem', key),
  };
}

const legacyKeys = {
  route: 'bigJourneyK6RouteBuilder',
  profile: 'bigJourneyK6LoadProfileBuilder',
};

export function workspaceDraftKey(storage, kind, workspaceId) {
  const suffix = workspaceId === 'default' ? '' : `:${workspaceId}`;
  const key = `flowload:${kind}${suffix}`;
  const legacy = legacyKeys[kind] + suffix;
  try {
    if (storage.getItem(key) === null) {
      const value = storage.getItem(legacy);
      if (value !== null) storage.setItem(key, value);
    }
    storage.removeItem(legacy);
  } catch {
    // Preserve the legacy copy if migration cannot write to browser storage.
  }
  return key;
}
