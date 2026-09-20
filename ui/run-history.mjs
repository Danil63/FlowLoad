export function pruneRunHistory(runs, { now = Date.now(), limit = 30, ttl = 60 * 60 * 1000 } = {}) {
  const completed = [...runs.values()].filter(run => run.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
  for (const run of completed) {
    if (runs.size > limit || now - (run.finishedAt ?? run.startedAt) >= ttl) runs.delete(run.id);
  }
}
