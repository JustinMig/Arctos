// Review seasons run September 1–August 31 in the agency's time zone.
// A January calendar-year change must not clear the current review season.
export function medicareReviewYear(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit'
  }).formatToParts(at).map(part => [part.type, part.value]));
  return Number(parts.year) - (Number(parts.month) < 9 ? 1 : 0);
}

export async function loadMedicareReviewClients(database) {
  const rows = [], pageSize = 500;
  // PostgREST caps responses, so load every page rather than silently dropping
  // reviewed clients once the book grows beyond the server's row limit.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await database.rpc('client_medicare_reviews_current_cycle')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
