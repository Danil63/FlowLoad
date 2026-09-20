export function createDraftWriter(storage, { onError = () => {}, onSuccess = () => {}, delay = 250,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  const pending = new Map();
  const saved = new Map();
  let timer = null;
  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    let failed = false;
    for (const [key, snapshot] of pending) {
      try {
        const content = JSON.stringify(snapshot());
        if (saved.get(key) !== content) {
          storage.setItem(key, content);
          saved.set(key, content);
        }
        pending.delete(key);
      } catch {
        failed = true;
        onError();
      }
    }
    if (!failed) onSuccess();
  }
  return {
    save(key, snapshot) {
      pending.set(key, snapshot);
      if (timer !== null) cancel(timer);
      timer = schedule(flush, delay);
    },
    flush,
  };
}
