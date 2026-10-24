// Keep normal calendar freshness, but avoid wasting requests on weak links.
export function calendarRefreshInterval(connection, online = true) {
  if (!online) return Infinity;
  return connection?.saveData || ['slow-2g','2g','3g'].includes(connection?.effectiveType)
    ? 60000 : 15000;
}
