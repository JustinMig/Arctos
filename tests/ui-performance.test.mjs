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

test('Office and campaign appointments are edited and followed up in their native Arctos row', async () => {
  const dom = new JSDOM('<body></body>', {runScripts:'outside-only'});
  const w = dom.window;
  const row = {id:'local', title:'Initial', event_type:'appointment', status:'scheduled'};
  const repo = {user:{id:'justin'}};
  const bridgeCalls = [];
  try {
    w.testCalendar = {mhRepository:repo, supabase:{
      auth:{async getSession(){return {data:{session:{access_token:'SYNTHETIC-INVALID'}}};}},
      from(table) {
        let id, changes, expectedStatus;
        const query = {
          select(){return query;}, eq(column,value){if(column==='id')id=value;else if(column==='status')expectedStatus=value;return query;},
          update(value){changes=value;return query;}, upsert(){return Promise.resolve({error:null});},
          delete(){return query;},
          maybeSingle(){return Promise.resolve({data:id===row.id ? {...row} : null,error:null});},
          single(){
            assert.equal(table,'appointments');
            assert.equal(id,row.id);
            if(expectedStatus)assert.equal(row.status,expectedStatus);
            return Promise.resolve({data:{...Object.assign(row,changes)},error:null});
          }
        };
        return query;
      }
    }};
    w.fetch=async(url,options)=>{
      bridgeCalls.push(options.method);
      return Response.json({event:{id:'shared',...JSON.parse(options.body)}});
    };
    w.eval((await read('calendar-sync.js')).replace(/^import .*;$/m,'const {mhRepository,supabase}=window.testCalendar;').replace('export function installMayerJustinCalendar','window.installCalendar = function'));
    w.installCalendar();
    const edited=await repo.saveEvent({event_id:'local',title:'Updated',event_type:'Activity'});
    assert.equal(edited.title,'Updated');
    assert.equal(edited.event_type,'activity');
    const followup=await repo.rescheduleEvent('local','Call back');
    assert.equal(followup.reschedule_note,'Call back');
    assert.equal(followup.status,'needs_reschedule');
    const moved=await repo.saveEvent({event_id:'local',title:'Rebooked',event_date:'2026-11-26',start_time:'09:00'});
    assert.equal(moved.status,'scheduled');
    await repo.completeEvent('local');
    const afterEdit=await repo.saveEvent({event_id:'local',title:'Updated notes',status:'scheduled'});
    assert.equal(afterEdit.status,'completed','An edit from a stale form cannot reopen a completed appointment.');
    assert.deepEqual(bridgeCalls,[]);
    await repo.saveEvent({event_id:'shared',title:'Updated shared event'});
    await repo.rescheduleEvent('shared','Follow up');
    assert.deepEqual(bridgeCalls,['PATCH','PATCH']);
  } finally { w.close(); }
});

test('refresh started before a completion cannot cache the earlier status',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window,repo={};
  const month={start:'2026-11-01',end:'2026-11-30'};
  let status='scheduled',release;
  try{
    w.testCalendar={mhRepository:repo,supabase:{
      auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})},
      from(){const q={maybeSingle:async()=>({data:null}),then:resolve=>resolve({data:[]})};
        for(const method of ['select','eq','gte','lte','order','in'])q[method]=()=>q;
        return q;}
    }};
    w.fetch=async(url,options)=>{
      const before=status;
      if(options.method==='PATCH'){status='completed';return Response.json({event:{id:'e',status}});}
      if(!release)await new Promise(resolve=>{release=resolve;});
      return Response.json({events:[{id:'e',status:before,event_date:'2026-11-20'}]});
    };
    w.eval((await read('calendar-sync.js')).replace(/^import .*;$/m,'const {mhRepository,supabase}=window.testCalendar;').replace('export function installMayerJustinCalendar','window.installCalendar = function'));
    w.installCalendar();
    const before=repo.listEvents(month);await tick();
    await repo.completeEvent('e');release();
    assert.equal((await before)[0].status,'completed');
    assert.equal((await repo.listEvents(month))[0].status,'completed');
  }finally{w.close();}
});

test('an open day moves Office completions into Completed and reflects changes and deletions',async t=>{
  const {build}=await import('esbuild');
  const root=new URL('../',import.meta.url).pathname;
  const bundle=await build({stdin:{contents:"import {createWorkspace} from './workspace.js'; window.workspace=createWorkspace(document.getElementById('app'),window.repo);",resolveDir:root},bundle:true,format:'iife',write:false,logLevel:'silent',
    plugins:[{name:'synthetic-calendar',setup(b){
      b.onResolve({filter:/supabase-(repository|client)\.js(?:\?|$)/},()=>({path:'db',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase={};export const mhRepository=window.repo;export const initialAuthUrl="";'}));
      b.onResolve({filter:/^\.\.?\/.*\?/},args=>({path:new URL(args.path.split('?')[0],'file://'+args.resolveDir+'/').pathname}));
    }}]});
  const dom=new JSDOM('<main id="app"></main>',{url:'https://synthetic.invalid/#/dashboard',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document;
  w.CSS={escape:String};w.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const today=new Date(),day=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),'12'].join('-');
  let records=[{id:'synthetic-event',event_date:day,title:'Initial',event_type:'appointment',status:'scheduled',start_time:'10:00'}];
  w.repo={connected:true,user:{id:'synthetic'},agents:[],listEvents:async()=>records};
  w.eval(bundle.outputFiles[0].text);
  t.after(()=>{w.workspace.destroy();w.close();});
  await tick();
  doc.querySelector('[data-daily-calendar]').open=true;
  await tick();
  doc.querySelector('[data-day="'+day+'"]').click();
  const active=doc.querySelector('[data-day-events]'),completed=doc.querySelector('[data-completed-events]');
  assert.match(active.textContent,/Initial/);
  const refresh=async()=>{w.dispatchEvent(new w.Event('mig:calendar-refresh-request'));await tick();};
  records=[{...records[0],title:'Office change'}];await refresh();
  assert.match(active.textContent,/Office change/);
  records=[{...records[0],status:'completed'}];await refresh();
  assert.equal(active.querySelectorAll('[data-event-id]').length,0);
  assert.match(completed.textContent,/Office change/);
  records=[];await refresh();
  assert.equal(completed.querySelectorAll('[data-event-id]').length,0);
});
