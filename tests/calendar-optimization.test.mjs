import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarMarkup } from '../views.js';
import { isoDate, monthDays } from '../core.js';

const source = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('month grid handles many appointments without filtering the full list per day', async () => {
  const view = await source('views.js');
  const code = view.slice(view.indexOf('export function calendarMarkup'), view.indexOf('export function shell'));
  assert.match(code, /const eventsByDate = new Map\(\)/);
  assert.match(code, /eventsByDate\.get\(key\)/);
  assert.doesNotMatch(code, /days\.map\([\s\S]*?events\.filter\(/);

  const month = new Date(2026, 9, 1, 12);
  const dates = monthDays(2026, 9).map(isoDate);
  const events = Array.from({ length: 1500 }, (_, i) => ({
    id: String(i),
    event_date: dates[i % dates.length],
    title: i === 0 ? '<script>alert(1)</script>' : 'Appointment ' + i,
    start_time: '09:30',
    status: i % 13 === 0 ? 'needs_reschedule' : 'scheduled'
  }));
  const markup = calendarMarkup(month, events, true, []);
  assert.equal((markup.match(/class="calendar-day(?: outside| today)*"/g) || []).length, dates.length);
  assert.match(markup, /RESCHEDULE <span>116<\/span>/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /calendar-event/);
});

test('startup paints the calendar without waiting for optional screen modules', async () => {
  const start = await source('workspace-start.js');
  const atShell = start.indexOf('createWorkspace(root, mhRepository)');
  const atExtras = start.indexOf("import('./workspace-extensions.js");
  assert.ok(atShell >= 0 && atExtras > atShell);
  assert.match(start, /Promise\.allSettled/);
  const app = await source('app.js');
  assert.match(app, /Promise\.all\(\[stylesReady, workspaceModule\]\)/);
});

test('navigation updates the live calendar rather than losing results for a detached host', async () => {
  const workspace = await source('workspace.js');
  assert.match(workspace, /const visibleHost = root\.querySelector\('#calendar-host'\)/);
  assert.match(workspace, /mig-calendar:\$\{repository\.user\?\.id/);
  const sync = await source('calendar-sync.js');
  assert.match(sync, /record\.events = merged/);
  assert.match(sync, /calendarCache\.get\(key\) !== record/);
});
