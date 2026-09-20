const gameOpenPaths = [
  '/profile', '/aircraft', '/routes', '/routes/map', '/quests',
  '/carousel', '/shop', '/raffles/me',
];

export function suggestCriticalRoute(endpoints) {
  const available = new Map(endpoints
    .filter(endpoint => endpoint.method === 'GET')
    .map(endpoint => [endpoint.path, endpoint]));
  const missing = gameOpenPaths.slice(0, 3).filter(path => !available.has(path));
  if (missing.length) return { steps: [], missing };
  return {
    steps: gameOpenPaths.map(path => available.get(path)).filter(Boolean),
    missing: gameOpenPaths.filter(path => !available.has(path)),
  };
}
