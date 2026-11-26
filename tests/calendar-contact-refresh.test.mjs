import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('Arctos separates calendar changes from open-day contact revisions and pauses hidden tabs', async t => {
  const root = new URL('../',import.meta.url).pathname;
  const bundle = await build({
    stdin:{resolveDir:root,contents:`
      import { createWorkspace } from './workspace.js';
      import { installMayerJustinCalendar } from './calendar-sync.js';
      import { mhRepository } from './supabase-repository.js';
      mhRepository.user = {id:'agent'};
      installMayerJustinCalendar();
      window.workspace = createWorkspace(document.getElementById('app'),mhRepository);
    `},
    bundle:true,format:'iife',write:false,logLevel:'silent',
    plugins:[{name:'synthetic-supabase',setup(builder) {
      builder.onResolve({filter:/supabase-client\.js(?:\?|$)/},()=>({path:'db',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase=window.db;export const initialAuthUrl="";'}));
      builder.onResolve({filter:/^\.\.?\/.*\?/},args=>({path:new URL(args.path.split('?')[0],'file://'+args.resolveDir+'/').pathname}));
    }}]
  });
  const dom = new JSDOM('<main id="app"></main>',{url:'https://test.invalid/#/dashboard',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, doc = w.document;
  t.after(()=>{w.workspace?.destroy();w.close();});
  let now = Date.UTC(2026,10,20,16);
  const day = '2026-11-20';
  const events = Array.from({length:80},(_,i)=>({
    id:'appointment'+i,client_id:'client'+(i%79),event_date:day,start_time:'10:30',title:'Visit '+i,
    event_type:'appointment',status:i===79?'completed':'scheduled'
  }));
  const queries = [], timers = [];
  let visibility = 'visible', revision = '1', contactRevision = '0', contactName = 'Original';
  let probes = 0, months = 0, offline = false, deferProbe, deferContacts;

  w.Date = class extends w.Date {
    constructor(...args){ super(...(args.length?args:[now])); }
    static now(){ return now; }
  };
  Object.defineProperty(doc,'visibilityState',{get:()=>visibility});
  w.CSS = {escape:String}; w.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.setInterval=(fn,delay)=>{timers.push({fn,delay});return timers.length;};
  w.clearInterval=()=>{};
  w.db = {
    auth:{getSession:async()=>({data:{session:{access_token:'SYNTHETIC'}}})},
    from(table){
      const q = {}; let ids=[],fields;
      for (const key of ['gte','lte','or','order']) q[key]=()=>q;
      q.select=value=>{fields=value;return q;};
      q.in=(key,value)=>{ids=value;return q;};
      q.then=(resolve,reject)=>{
        if (table!=='clients') return Promise.resolve({data:[]}).then(resolve,reject);
        assert.equal(fields,'id,first_name,last_name,phone,email');
        queries.push([...ids]);
        const data=ids.map(id=>({id,first_name:contactName,last_name:id,phone:'5555551234',email:'client@example.invalid'}));
        const response=deferContacts?deferContacts():Promise.resolve();
        return response.then(()=>({data})).then(resolve,reject);
      };
      return q;
    }
  };
  w.fetch = async url=>{
    const params=new URL(url,'https://test.invalid').searchParams;
    if (params.has('revision')) {
      probes++;
      if (deferProbe) await deferProbe();
      return offline?Response.json({}, {status:503}):Response.json({revision,contactRevision});
    }
    assert.ok(params.has('start') && params.has('end')); months++;
    return Response.json({events});
  };
  const tick = () => new Promise(resolve=>setTimeout(resolve,0));
  const settle = async()=>{await tick();await tick();};
  const poll = async(expectedProbes,expectedReads,advance=15_000)=>{
    const before=[probes,months];now+=advance;
    for (const timer of timers) if (timer.delay===15_000) timer.fn();
    await settle();
    assert.deepEqual([probes-before[0],months-before[1]],[expectedProbes,expectedReads]);
  };
  w.eval(bundle.outputFiles[0].text);
  await settle();
  assert.equal(months,1);
  await poll(1,1);
  await poll(1,0);
  revision='2';await poll(1,1);
  offline=true;await poll(1,1);offline=false;
  await poll(1,0,299_999);
  await poll(1,1);

  let releaseProbe;
  deferProbe=()=>new Promise(resolve=>{releaseProbe=resolve;});
  const first=w.MHCalendarSync.checkForChanges();
  assert.equal(first,w.MHCalendarSync.checkForChanges());
  await settle();
  visibility='hidden';revision='3';
  const hiddenCounts=[probes,months];
  releaseProbe();await first;deferProbe=null;
  await poll(0,0);
  w.dispatchEvent(new w.Event('focus'));
  await w.MHCalendarSync.checkForChanges();await settle();
  assert.deepEqual([probes,months],hiddenCounts);
  visibility='visible';doc.dispatchEvent(new w.Event('visibilitychange'));await settle();
  assert.deepEqual([probes,months],[hiddenCounts[0]+1,hiddenCounts[1]+1]);

  doc.querySelector('[data-daily-calendar]').open=true;await settle();
  doc.querySelector('[data-day="'+day+'"]').click();await settle();
  const active=doc.querySelector('[data-day-events]'),completed=doc.querySelector('[data-completed-events]');
  assert.equal(active.querySelectorAll('[data-event-id]').length,79);
  assert.equal(completed.querySelectorAll('[data-event-id]').length,1);
  assert.deepEqual(queries.map(q=>q.length),[75,4]);
  assert.equal(new Set(queries.flat()).size,79);
  assert.match(active.textContent,/Original client0/);
  active.querySelector('[data-event-id]').open=true;
  revision='4';await poll(1,1);
  assert.equal(queries.length,2);

  contactName='Outdated';revision='5';contactRevision='1';
  let releaseStale;
  deferContacts=()=>{deferContacts=null;return new Promise(resolve=>{releaseStale=resolve;});};
  await poll(1,1);
  contactName='Updated';revision='6';contactRevision='2';await poll(1,1);
  assert.match(active.textContent,/Updated client0/);
  assert.match(completed.textContent,/Updated client0/);
  releaseStale();await settle();
  assert.match(active.textContent,/Updated client0/);
  assert.doesNotMatch(active.textContent,/Outdated/);
  assert.ok(active.querySelector('[data-event-id]').open);

  const beforeFallback=queries.length;
  contactName='Legacy';revision='7';contactRevision=undefined;await poll(1,1);
  assert.match(active.textContent,/Legacy client0/);
  assert.equal(queries.length-beforeFallback,2);
});
