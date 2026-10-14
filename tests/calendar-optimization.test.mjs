import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarMarkup } from '../views.js';
import { isoDate, monthDays, appointmentStartMinutes, sortAppointmentsByStartTime, timeLabel } from '../core.js';

const source = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('calendar day appointments sort earliest first, keep unknown times last, and preserve originals', () => {
  const events = [
    { id:'afternoon', event_date:'2026-10-14', start_time:'14:30:00', title:'Mary' },
    { id:'missing', event_date:'2026-10-14', start_time:null, title:'Unscheduled' },
    { id:'late-morning', event_date:'2026-10-14', start_time:'10:00', title:'Robert' },
    { id:'early', event_date:'2026-10-14', start_time:'08:00:00', title:'Anna' },
    { id:'same', event_date:'2026-10-14', start_time:'10:00:00', title:'Adam' }
  ];
  const original = events.map(e=>e.id);
  assert.equal(appointmentStartMinutes('08:00:00'), 480);
  assert.equal(appointmentStartMinutes('14:30'), 870);
  assert.equal(appointmentStartMinutes(null), Infinity);
  assert.equal(appointmentStartMinutes('25:90'), Infinity);
  assert.deepEqual(sortAppointmentsByStartTime(events).map(e=>e.id),
    ['early','same','late-morning','afternoon','missing']);
  assert.deepEqual(events.map(e=>e.id),original,'Sorting must not mutate the saved event list');
  assert.equal(timeLabel('08:00:00'),'8:00 AM');
  assert.equal(timeLabel('14:30'),'2:30 PM');
});
test('calendar day cards show time on the tab before the client name and apply sorting in both renders',async()=>{
  const workspace=await source('workspace.js');
  assert.match(workspace,/appointment-summary-time/);
  const summary=workspace.indexOf('<summary>\n            <span class="appointment-summary-time">');
  assert.ok(summary>=0, 'Appointment summary contains a visible time at the start');
  assert.ok(workspace.indexOf('appointment-summary-name',summary)>summary);
  assert.equal((workspace.match(/sortAppointmentsByStartTime\(state\.events\.filter\(matchesMode\)\)/g)||[]).length,2);
  assert.match(workspace,/timeLabel\(event\.start_time\)/);
  const css=await source('workspace-styles.css');
  assert.match(css,/\.appointment-summary-time/);
});

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

test('startup paints Home without importing client, lead, or campaign screens', async () => {
  const start = await source('workspace-start.js');
  assert.match(start, /createWorkspace\(root, mhRepository, features\)/);
  assert.match(start, /client: \(\) => import\('\.\/workspace-extensions\.js/);
  assert.match(start, /lead: \(\) => import\('\.\/workspace-lead-extensions\.js/);
  assert.match(start, /campaign: \(\) => import\('\.\/workspace-campaign-extensions\.js/);
  const afterMount = start.slice(start.indexOf('createWorkspace(root, mhRepository, features)'));
  assert.doesNotMatch(afterMount, /ensureFeature\('(client|campaign|lead)'\)/);
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
