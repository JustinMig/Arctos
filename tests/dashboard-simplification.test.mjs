import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDashboardMarkup } from '../views.js';
import { readFile } from 'node:fs/promises';

const file=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const localDate=new Date(2026,9,14,12);
const events=[
  {id:'1',title:'Mary Johnson review',event_type:'Medicare Review',event_date:'2026-10-14',start_time:'09:00',status:'scheduled'},
  {id:'2',title:'Cancelled visit',event_date:'2026-10-14',start_time:'10:00',status:'cancelled'},
  {id:'3',title:'Bob Smith call',event_type:'Follow Up',event_date:'2026-10-14',start_time:'13:30',status:'scheduled'},
  {id:'4',title:'Need new date',event_date:'2026-10-12',status:'needs_reschedule'},
  {id:'5',title:'Check renewal',event_date:'2026-10-20',status:'scheduled'},
  {id:'6',title:'Already completed',event_date:'2026-10-21',status:'completed'},
  {id:'7',title:'Next month',event_date:'2026-11-01',status:'scheduled'},
  {id:'8',title:'<img src=x onerror=alert(1)>',event_date:'2026-10-14',start_time:'15:45',status:'scheduled'}
];

test('daily dashboard prioritizes today and unscheduled followups without overstating totals',()=>{
  const html=dailyDashboardMarkup(events,true,localDate);
  assert.match(html,/Today.s Work/);
  assert.match(html,/9:00 AM/);
  assert.match(html,/1:30 PM/);
  assert.match(html,/Mary Johnson review/);
  assert.match(html,/Need new date/);
  assert.doesNotMatch(html,/Cancelled visit|Already completed/);
  assert.match(html,/data-daily-open-today/);
  assert.match(html,/data-daily-open-followups/);
  assert.match(html,/data-daily-open-calendar/);
  assert.match(html,/Coming up/);
  assert.match(html,/>3<\/strong><small>Active appointments<\/small>/);
  assert.match(html,/>1<\/strong><small>Need rescheduling<\/small>/);
  assert.match(html,/>1<\/strong><small>Later this month<\/small>/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/&lt;img src=x/);
});

test('dashboard shows loading placeholders instead of misleading zero totals',()=>{
  const html=dailyDashboardMarkup([],false,localDate);
  assert.match(html,/Loading today.s schedule/);
  assert.match(html,/>—<\/strong><small>Active appointments/);
  assert.doesNotMatch(html,/>0<\/strong>/);
});

test('monthly calendar is collapsed on Home and created only on demand',async()=>{
  const workspace=await file('workspace.js');
  assert.match(workspace,/data-daily-calendar/);
  assert.match(workspace,/data-daily-open-calendar/);
  assert.match(workspace,/if\(collapsed\)\{/);
  assert.match(workspace,/renderVisibleCalendar\(\)/);
  assert.match(workspace,/drawDailyDashboard\(\)/);
  assert.doesNotMatch(workspace,/<div class="metric-grid">/);
  const start=await file('workspace-start.js');
  assert.doesNotMatch(start,/installDashboardCleanup\(root\)/);
});
