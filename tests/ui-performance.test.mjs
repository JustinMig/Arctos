import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('call footer observer ignores unrelated page changes and still notices a saved client ID',async()=>{
 const dom=new JSDOM('<body><main></main></body>',{runScripts:'outside-only'}),w=dom.window;let calls=0;
 try{
  w.eval((await read('client-dialog-observer.js')).replace('export function observeClientDialogs','window.observeClientDialogs = function'));
  const disconnect=w.observeClientDialogs(()=>calls++,{attributes:['data-sms-client-id']});
  for(let i=0;i<10;i++)w.document.querySelector('main').append(w.document.createElement('p'));
  await tick();assert.equal(calls,0);
  const dialog=w.document.createElement('dialog');dialog.className='client-dialog';w.document.body.append(dialog);await tick();assert.equal(calls,1);
  dialog.dataset.smsClientId='synthetic-client';await tick();assert.equal(calls,2);
  dialog.dispatchEvent(new w.Event('close'));dialog.append(w.document.createElement('input'));await tick();assert.equal(calls,2);disconnect();
 }finally{w.close();}
});
test('calendar starts local reads while the upstream calendar is still in flight and merges both sources',async()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window,requests=[];let completeShared;
 try{
  const repo={};w.CustomEvent=w.CustomEvent;
  w.testCalendar={mhRepository:repo,supabase:{auth:{async getSession(){return {data:{session:{access_token:'SYNTHETIC-INVALID'}}};}},from(table){
   const query={select(){return query;},gte(){return query;},lte(){return query;},order(){return query;},or(){return query;},in(){return query;},then(resolve){requests.push(table);return Promise.resolve({data:table==='appointments'?[{id:'local',event_date:'2026-10-24',start_time:'09:00',title:'Synthetic local appointment'}]:[],error:null}).then(resolve);}};return query;
  }}};
  w.fetch=()=>new Promise(resolve=>{completeShared=()=>resolve(Response.json({events:[{id:'shared',event_date:'2026-10-24',start_time:'08:00',title:'Synthetic shared appointment'}]}));});
  w.eval((await read('calendar-sync.js')).replace(/^import .*;$/m,'const {mhRepository,supabase}=window.testCalendar;').replace('export function installMayerJustinCalendar','window.installCalendar = function'));
  w.installCalendar();const pending=repo.listEvents({start:'2026-10-01',end:'2026-10-31',includeToday:true,includeReschedule:true});await tick();
  assert.equal(requests.filter(table=>table==='appointments').length,2,'Independent local and follow-up reads must start before the shared API responds');
  completeShared();const result=await pending;assert.deepEqual(Array.from(result,event=>event.id),['shared','local']);
  assert.equal(result[1].calendar_source,'arctos_campaign');assert.equal(requests.filter(table=>table==='calendar_event_details').length,1);
 }finally{w.close();}
});
