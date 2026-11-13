import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { medicareReviewYear, loadMedicareReviewClients } from '../medicare-review-cycle.js';
import { bindClientReviewCheckoff } from '../client-review-checkoff.js';

test('review season changes at September 1 Central midnight, through multiple years', () => {
  for (const [at, year] of [
    ['2026-09-01T04:59:59Z', 2025], ['2026-09-01T05:00:00Z', 2026],
    ['2026-11-13T18:00:00Z', 2026], ['2027-01-01T06:00:00Z', 2026],
    ['2027-08-31T23:00:00Z', 2026], ['2027-09-01T04:59:59Z', 2026],
    ['2027-09-01T05:00:00Z', 2027], ['2028-02-29T18:00:00Z', 2027],
    ['2028-09-01T05:00:00Z', 2028]
  ]) assert.equal(medicareReviewYear(new Date(at)), year, at);
});

test('review list loads all clients beyond the API row cap and propagates errors', async () => {
  const rows = Array.from({ length:1201 }, (_, id) => ({ id })), ranges = [];
  const database = { rpc(name) {
    assert.equal(name, 'client_medicare_reviews_current_cycle');
    return { async range(start, end) { ranges.push([start, end]); return { data:rows.slice(start, end + 1) }; } };
  } };
  assert.deepEqual(await loadMedicareReviewClients(database), rows);
  assert.deepEqual(ranges, [[0,499],[500,999],[1000,1499]]);
  await assert.rejects(loadMedicareReviewClients({ rpc:() => ({ range:async () => ({ error:Error('Offline') }) }) }), /Offline/);
});

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function fixture(t, { completed = true } = {}) {
  t.mock.timers.enable({ apis:['Date','setInterval'], now:new Date('2026-11-13T18:00:00Z') });
  const dom = new JSDOM('<form><input type="checkbox" data-client-review-manual><span data-client-review-label></span><span data-client-review-status></span></form>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const form = document.querySelector('form'), check = form.querySelector('input');
  const history = new Map([[2026, completed]]), writes = [], changes = [];
  let failSave = false, failLoad = false;
  const database = {
    async rpc(name, args) {
      const year = medicareReviewYear();
      if (name === 'client_medicare_review_status') {
        return failLoad ? { error:Error('Load interrupted') } : { data:{ review_year:year, completed:history.get(year) === true } };
      }
      assert.equal(name, 'set_client_medicare_review_completed');
      if (failSave) throw Error('Save interrupted');
      assert.equal(args.p_review_year, year);
      writes.push(args);
      history.set(year, args.p_completed);
      return { data:{ review_year:year, completed:args.p_completed } };
    },
    from() { const q = {}; for (const key of ['select','eq','order','limit']) q[key] = () => q;
      q.then = resolve => resolve({ data:[] }); return q; }
  };
  let stop;
  const start = () => stop = bindClientReviewCheckoff({ form, clientId:'synthetic-client', database, onChange:() => changes.push(true) });
  t.after(() => { stop?.(); dom.window.close(); globalThis.document = previous; });
  const toggle = async value => { check.checked = value; check.dispatchEvent(new dom.window.Event('change')); await settle(); };
  return { form, check, history, writes, changes, start, toggle,
    failSave:() => { failSave = true; }, failLoad:() => { failLoad = true; },
    visibility:() => document.dispatchEvent(new dom.window.Event('visibilitychange')) };
}

test('existing 2026 checks survive rollout; clear and recheck save immediately', async t => {
  const f = fixture(t); f.start(); await settle();
  assert.equal(f.check.checked, true);
  assert.equal(f.check.disabled, false);
  assert.match(f.form.textContent, /Mark 2026 review complete/);
  assert.equal(f.writes.length, 0);
  await f.toggle(false);
  assert.equal(f.history.get(2026), false);
  await f.toggle(true);
  assert.equal(f.history.get(2026), true);
  assert.equal(f.changes.length, 2);
});

test('an open record resets in September and keeps historical completions intact', async t => {
  const f = fixture(t); f.start(); await settle();
  t.mock.timers.setTime(new Date('2027-01-01T18:00:00Z').getTime());
  f.visibility(); await settle();
  assert.equal(f.check.checked, true);
  t.mock.timers.setTime(new Date('2027-09-01T05:00:00Z').getTime());
  f.visibility(); await settle();
  assert.equal(f.check.checked, false);
  assert.equal(f.check.disabled, false);
  assert.match(f.form.textContent, /Mark 2027 review complete/);
  assert.equal(f.history.get(2026), true);
  assert.equal(f.writes.length, 0);
  await f.toggle(true);
  assert.equal(f.history.get(2027), true);
  assert.equal(f.writes[0].p_review_year, 2027);
});

test('save failures restore the saved check and leave retry available', async t => {
  const f = fixture(t); f.start(); await settle(); f.failSave();
  await f.toggle(false);
  assert.equal(f.check.checked, true);
  assert.equal(f.check.disabled, false);
  assert.match(f.form.textContent, /Could not save: Save interrupted/);
  assert.equal(f.changes.length, 0);
});

test('a failed status load cannot be mistaken for an unchecked review', async t => {
  const f = fixture(t); f.failLoad(); f.start(); await settle();
  assert.equal(f.check.disabled, true);
  assert.match(f.form.textContent, /Could not load review status/);
  assert.equal(f.writes.length, 0);
});
