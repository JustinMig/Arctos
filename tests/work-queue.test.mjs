import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkQueue,filterWorkQueue,WORK_VIEWS} from '../work-queue-model.js';
import {readFile} from 'node:fs/promises';
const source=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

const leads=[
 {id:'l1',first_name:'Ada',last_name:'New',phone:'6625550100',status:'lead',created_at:'2026-10-14T08:30:00'},
 {id:'l2',first_name:'Bob',last_name:'Converted',status:'converted',created_at:'2026-10-13T08:30:00'}
];
const campaigns=[
 {id:'c1',name:'October Medicare',status:'active'},
 {id:'c2',name:'Second list',status:'active'},
 {id:'old',name:'Archived campaign',status:'archived'}
];
const members=[
 {id:'m1',campaign_id:'c1',client_id:'p1',first_name:'Mary',last_name:'Review',contact_status:'follow_up',next_event_id:'a1',next_event_date:'2026-10-16',next_event_status:'scheduled'},
 {id:'m2',campaign_id:'c1',client_id:'p2',first_name:'John',last_name:'Contact',contact_status:'not_contacted',added_at:'2026-10-01'},
 {id:'m3',campaign_id:'c2',client_id:'p2',first_name:'John',last_name:'Contact',contact_status:'no_answer',added_at:'2026-10-02'},
 {id:'m4',campaign_id:'c1',client_id:'p3',first_name:'Declined',last_name:'Client',contact_status:'declined'},
 {id:'m5',campaign_id:'c1',client_id:'p4',first_name:'Done',last_name:'Followup',contact_status:'follow_up',next_event_id:'a2',next_event_date:'2026-10-12',next_event_status:'completed'},
 {id:'oldm',campaign_id:'old',client_id:'p6',first_name:'Old',last_name:'Record',contact_status:'not_contacted'},
 {id:'dead',campaign_id:'c2',client_id:'p7',first_name:'Inactive',last_name:'Client',contact_status:'not_contacted',client_status:'deceased'}
];
const appointments=[
 {id:'a1',event_type:'follow_up',event_date:'2026-10-16',status:'scheduled',title:'Linked campaign followup'},
 {id:'a2',event_type:'follow_up',event_date:'2026-10-12',status:'completed',title:'Linked complete'},
 {id:'a3',event_type:'follow_up',event_date:'2026-10-18',status:'scheduled',title:'Standalone followup'},
 {id:'a4',event_type:'appointment',event_date:'2026-10-11',status:'needs_reschedule',title:'Needs a new date'},
 {id:'a5',event_type:'appointment',event_date:'2026-10-13',status:'completed',title:'Completed appointment'},
 {id:'a6',event_type:'appointment',event_date:'2026-10-17',status:'scheduled',title:'Not a followup'}
];

test('Work Queue uses four understandable views',()=>assert.deepEqual(WORK_VIEWS.map(([key])=>key),['leads','contact','followups','completed']));
test('Work Queue combines original records without duplicating linked appointments',()=>{
 const q=buildWorkQueue({leads,campaigns,members,appointments,today:'2026-10-14'});
 assert.deepEqual(q.leads.map(x=>x.key),['lead:l1']);
 assert.equal(q.contact.length,1,'two campaign memberships of same client make one contact entry');
 assert.equal(q.contact[0].id,'m3','latest relevant campaign membership is selected');
 assert.deepEqual(q.followups.map(x=>x.key),['appointment:a4','campaign:m1','appointment:a3']);
 assert.deepEqual(new Set(q.followups.map(x=>x.key)).size,q.followups.length);
 assert.ok(q.completed.some(x=>x.key==='campaign:m5'));
 assert.equal(q.completed.filter(x=>x.key==='appointment:a2').length,0,'linked completed appointment does not duplicate campaign');
 assert.ok(q.completed.some(x=>x.key==='appointment:a5'));
 assert.ok(q.completed.some(x=>x.key==='lead:l2'));
 assert.equal(q.contact.find(x=>x.clientId==='p7'),undefined,'deceased client cannot be contacted');
 assert.equal(q.contact.find(x=>x.clientId==='p6'),undefined,'archived campaign omitted');
});
test('Work Queue searches client, campaign and action without altering originals',()=>{
 const q=buildWorkQueue({leads,campaigns,members,appointments,today:'2026-10-14'});
 assert.equal(filterWorkQueue(q.followups,'Mary').length,1);
 assert.equal(filterWorkQueue(q.followups,'October Medicare').length,1);
 assert.equal(filterWorkQueue(q.followups,'nonexistent').length,0);
 assert.equal(q.followups.length,3);
});
test('Work Queue reuses existing database tables and existing editors, not a new task table',async()=>{
 const ui=await source('work-queue-ui.js'),workspace=await source('workspace.js'),lead=await source('leads-icon-screen.js');
 for(const table of ['workspace_leads','campaign_summaries','campaign_member_results','appointments'])assert.match(ui,new RegExp("from\\('"+table+"'\\)"));
 assert.match(workspace,/createWorkQueueFeature/);
 assert.match(workspace,/feature\.mount\(host,\{campaignId\}\)/);
 assert.match(lead,/export async function openLeadFromQueue/);
 assert.doesNotMatch(ui,/\.insert\(|\.update\(|\.delete\(/,'Work Queue must not create competing data records');
});
