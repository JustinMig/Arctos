import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV, CLIENT_TABS, esc, monthDays, isoDate, dateISO, dateText, stable, snapshot, disconnectedRepository, NotConnectedError } from '../core.js';
import { shell, clientForm } from '../views.js';

test('sidebar contains only workspace pages, not client sections', () => {
  const names = NAV.map(([key]) => key);
  for (const key of ['client', 'medicare', 'life', 'retirement', 'documents']) assert.equal(names.includes(key), false);
  assert.equal(names.includes('clients'), true);
});
test('client sections are nested in the information dialog', () => {
  assert.deepEqual(CLIENT_TABS.map(([key]) => key), [
    'information','medicare','doctors','medications','hospital_indemnity','life','retirement','notes'
  ]);
});
test('client records expose only four main tabs while retaining all eight original data panels', () => {
  const markup = clientForm(true);
  for(const label of ['Overview','Coverage','Medical','Notes & Files']){
    assert.ok(markup.includes('>'+label+'</button>'),label+' main tab exists');
  }
  assert.equal((markup.match(/data-client-group-tab="/g)||[]).length,4);
  assert.equal((markup.match(/data-client-group-panel="/g)||[]).length,4);
  for(const key of CLIENT_TABS.map(([id])=>id)){
    assert.ok(markup.includes('data-panel="'+key+'"'),key+' remains available to CRM integrations');
    assert.ok(markup.includes('data-tab="'+key+'"'),key+' legacy navigation hook remains');
  }
  assert.match(markup,/data-client-category="medicare"/);
  assert.match(markup,/data-client-category="life"/);
  assert.match(markup,/data-client-category="hospital_indemnity"/);
  assert.match(markup,/data-client-category="retirement"/);
  assert.match(markup,/data-client-category="doctors"/);
  assert.match(markup,/data-client-category="medications"/);
  assert.match(markup,/data-client-jump="notes"/);
});

test('Documents is merged into Notes Extras', () => {
  const labels = Object.fromEntries(CLIENT_TABS);
  assert.equal('documents' in labels, false);
  assert.equal(labels.notes, 'Notes / Extras');
});
test('client health sections stay inside the client record and not the sidebar', () => {
  const nav = new Set(NAV.map(([key]) => key));
  const tabs = new Set(CLIENT_TABS.map(([key]) => key));
  for (const key of ['doctors','medications','hospital_indemnity']) {
    assert.equal(nav.has(key), false);
    assert.equal(tabs.has(key), true);
  }
});
test('month grids start Sunday, end Saturday and contain complete weeks', () => {
  for (let year = 2024; year <= 2032; year++) for (let month = 0; month < 12; month++) {
    const days = monthDays(year, month);
    assert.equal(days[0].getDay(), 0); assert.equal(days.at(-1).getDay(), 6);
    assert.equal(days.length % 7, 0);
    assert.equal(new Set(days.map(isoDate)).size, days.length);
    assert.equal(days.filter(d => d.getMonth() === month).length, new Date(year, month + 1, 0).getDate());
  }
});
test('manual dates accept slash entry and compact numeric entry', () => {
  assert.equal(dateISO('2/29/2024'), '2024-02-29');
  assert.equal(dateISO('02292024'), '2024-02-29');
  assert.equal(dateText('2024-02-29'), '02/29/2024');
});
test('impossible and incomplete dates do not silently roll into another month', () => {
  for (const value of ['02/29/2025','04/31/2026','13/01/2026','00/10/2026','02/00/2026','02/02/26','02/02/1800']) assert.equal(dateISO(value), null);
});
test('dirty comparison is order-independent and reversions become clean', () => {
  const value = { name: '', selected: false, notes: '' };
  const initial = stable(value);
  assert.equal(initial, stable({ notes: '', selected: false, name: '' }));
  value.selected = true; assert.notEqual(stable(value), initial);
  value.selected = false; assert.equal(stable(value), initial);
});
test('all named form fields count, including fields in hidden tab panels', () => {
  const elements = [
    {name:'name', type:'text', value:'', disabled:false},
    {name:'product_life', type:'checkbox', checked:true},
    {name:'life_notes', type:'textarea', value:'changed', hidden:true},
    {name:'ssn', type:'text', value:'', disabled:true},
    {name:'action', type:'submit', value:'save'}
  ];
  assert.deepEqual(snapshot({elements}), {name:'', product_life:true, life_notes:'changed'});
});
test('untrusted strings are escaped before insertion into markup', () => {
  assert.equal(esc('<img onerror="x">&'), '&lt;img onerror=&quot;x&quot;&gt;&amp;');
});
test('disconnected provider never returns a false save confirmation', async () => {
  for (const method of ['saveClient','saveEvent','saveNote']) await assert.rejects(disconnectedRepository[method]({}), NotConnectedError);
});
test('no demo rows, users or financial data are seeded by the provider', async () => {
  assert.equal(disconnectedRepository.connected, false);
  assert.deepEqual(disconnectedRepository.agents, []);
  for (const method of ['searchClients','listEvents','listNotes','searchContacts','commissions','getBuildChart']) await assert.rejects(disconnectedRepository[method]({}), NotConnectedError);
});

test('Arctos groups the sidebar into five primary destinations plus More while preserving routes', () => {
  const markup = shell('dashboard', true, '<div>Dashboard</div>');
  const entries = ['dashboard','clients','athena-medicare','campaigns','communications'];
  for(const route of entries) assert.match(markup, new RegExp('class="nav-primary[^"]*" href="#/' + route + '"'));
  assert.match(markup, /data-nav-toggle="medicare"/);
  assert.match(markup, /data-nav-toggle="work"/);
  assert.match(markup, /data-nav-toggle="more"/);
  assert.match(markup, /href="#\/medicare-intake"/);
  assert.match(markup, /href="#\/ma-plans"/);
  assert.match(markup, /href="#\/carriers"/);
  assert.match(markup, /href="#\/agents"/);
  assert.match(markup, /data-tool="leads"/);
  for(const tool of ['appointments','notes','contacts','build','commissions']) {
    assert.match(markup, new RegExp('data-tool="' + tool + '"'));
  }
  assert.doesNotMatch(markup, /href="#\/settings"/);
  const plans = shell('ma-plans', true, '');
  assert.match(plans, /class="nav-primary active" href="#\/athena-medicare"/);
  assert.match(plans, /id="nav-children-medicare"><a/);
  const carriers = shell('carriers', true, '');
  assert.match(carriers, /nav-more-trigger active/);
  assert.match(carriers, /id="nav-children-more"><a/);
});

test('Settings is hidden from CRM navigation without removing other pages', () => {
  const markup = shell('dashboard', true, '<div>Dashboard</div>');
  assert.doesNotMatch(markup, /<a href="#\/settings"/);
  for (const route of ['dashboard', 'clients', 'medicare-intake', 'ma-plans', 'campaigns', 'communications']) {
    assert.ok(markup.includes('href="#/' + route + '"'), route + ' should stay visible');
  }
  // Keep the old route available to existing direct links; this is a UI-only hide.
  assert.ok(NAV.some(([key]) => key === 'settings'));
});
