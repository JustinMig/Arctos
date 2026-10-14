// A single promise per feature group ensures one import on repeated clicks.
// Failed imports are evicted so a later route change can retry.
export function createFeatureLoader(importers) {
  const inFlight = new Map();
  return function ensureFeature(group) {
    const loader = importers[group];
    if (typeof loader !== 'function') return Promise.reject(new Error('Unknown Arctos feature group: ' + group));
    if (!inFlight.has(group)) {
      let promise;
      promise = Promise.resolve().then(loader).catch(error => {
        if (inFlight.get(group) === promise) inFlight.delete(group);
        throw error;
      });
      inFlight.set(group, promise);
    }
    return inFlight.get(group);
  };
}
