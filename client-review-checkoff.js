import { medicareReviewYear } from './medicare-review-cycle.js';

export function bindClientReviewCheckoff({ form, clientId, database, onChange = () => {} }) {
  const check = form.querySelector('[data-client-review-manual]');
  const status = form.querySelector('[data-client-review-status]');
  const label = form.querySelector('[data-client-review-label]');
  if (!check || !status) return () => {};
  let year = medicareReviewYear(), saved = false, busy = false, request = 0, stopped = false;
  const connected = () => !stopped && form.isConnected;
  const updateLabel = () => {
    if (label) label.textContent = 'Mark ' + year + ' review complete (outside Athena)';
  };
  updateLabel();
  check.disabled = true;
  if (!clientId) {
    status.textContent = 'Save the client before marking reviews.';
    return () => {};
  }
  async function load() {
    const token = ++request;
    check.disabled = true;
    check.checked = false;
    status.textContent = 'Loading reviews…';
    try {
      const [manual, automatic] = await Promise.all([
        database.rpc('client_medicare_review_status', { p_client_id: clientId }),
        database.from('athena_medicare_reviews').select('review_date,updated_at')
          .eq('client_id', clientId).eq('workflow_status', 'completed')
          .order('updated_at', { ascending: false }).limit(20)
      ]);
      if (!connected() || token !== request) return;
      if (manual.error) throw manual.error;
      year = Number(manual.data.review_year);
      saved = manual.data.completed === true;
      updateLabel();
      check.checked = saved;
      check.disabled = false;
      const latest = (automatic.data || [])[0];
      const date = latest?.review_date || latest?.updated_at?.slice(0, 10);
      status.textContent = (date ? '✓ Latest Athena review: ' + date + ' · ' : '') +
        (saved ? '✓ ' + year + ' review marked complete manually' : 'No manual ' + year + ' review checkoff.');
      if (automatic.error) status.textContent += ' Athena review history could not load.';
    } catch (error) {
      if (connected() && token === request) status.textContent = 'Could not load review status: ' + (error?.message || 'Please reopen the record.');
    }
  }
  const refresh = () => {
    if (!connected() || busy || year === medicareReviewYear()) return;
    year = medicareReviewYear();
    updateLabel();
    void load();
  };
  const change = async () => {
    if (busy || check.disabled || !connected()) return;
    // An old tab cannot accidentally mark a new season using the old label.
    if (year !== medicareReviewYear()) { refresh(); return; }
    const completed = check.checked;
    busy = true;
    ++request; // Ignore any older status response.
    check.disabled = true;
    status.textContent = 'Saving review checkoff…';
    try {
      const result = await database.rpc('set_client_medicare_review_completed', {
        p_client_id: clientId, p_review_year: year, p_completed: completed
      });
      if (result.error) throw result.error;
      saved = result.data.completed === true;
      if (connected()) {
        check.checked = saved;
        status.textContent = saved ? '✓ ' + year + ' review marked complete manually' : 'Manual ' + year + ' checkoff cleared.';
      }
      onChange();
    } catch (error) {
      if (connected()) {
        check.checked = saved;
        status.textContent = 'Could not save: ' + (error?.message || 'Please try again.');
      }
    } finally {
      busy = false;
      if (connected()) { check.disabled = false; refresh(); }
    }
  };
  check.addEventListener('change', change);
  document.addEventListener('visibilitychange', refresh);
  const timer = setInterval(refresh, 60_000);
  void load();
  return () => {
    stopped = true; ++request;
    clearInterval(timer);
    check.removeEventListener('change', change);
    document.removeEventListener('visibilitychange', refresh);
  };
}
