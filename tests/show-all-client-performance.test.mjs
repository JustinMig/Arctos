import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { makeClientSearch } from '../client-age-search.js';

const records = Array.from({length: 977}, (_, i) => ({
  id: String(i), first_name: 'Client', last_name: String(i), phone: i ? '5555551212' : '', status:'active'
}));

test('Show All uses two stable, scoped pages for 977 records, ordinary search still caps at 50', async () => {
  const calls = [];
  const query = {};
  for (const method of ['from','select','neq','eq','order','contains']) {
    query[method] = (...args) => { calls.push([method,...args]); return query; };
  }
  query.range = async (a,b) => { calls.push(['range',a,b]); return {data:records.slice(a,b+1)}; };
  const search = makeClientSearch(query);
  const options = {showAll:true,agent:'agent-a',product:'life'};
  const first = await search(options);
  const second = await search({...options,cursor:first.nextCursor});
  assert.equal(first.rows.length+second.rows.length,records.length);
  assert.equal(second.nextCursor,null);
  assert.deepEqual(calls.filter(([name])=>name==='range'),[['range',0,500],['range',500,1000]]);
  for (const filter of [['eq','assigned_agent_id','agent-a'],['neq','status','deceased'],['contains','products',['life']]]) {
    assert.equal(calls.filter(call=>JSON.stringify(call)===JSON.stringify(filter)).length,2);
  }
  assert.equal((await search({limit:500})).rows.length,50);
});

test('Select All uses the complete roster while cards are still being drawn, and a new agent cancels older work', async t => {
  const root = new URL('../',import.meta.url).pathname;
  const bundle = await build({
    stdin:{contents:"import {createWorkspace} from './workspace.js'; window.ws=createWorkspace(document.getElementById('app'),window.repo);",resolveDir:root},
    bundle:true,format:'iife',write:false,logLevel:'silent',
    plugins:[{name:'test-repository',setup(builder){
      builder.onResolve({filter:/supabase-(repository|client)\.js(?:\?|$)/},()=>({path:'db',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase={};export const mhRepository=window.repo;export const initialAuthUrl="";'}));
      builder.onResolve({filter:/^\.\.?\/.*\?/},args=>({path:new URL(args.path.split('?')[0],'file://'+args.resolveDir+'/').pathname}));
    }}]
  });
  const dom = new JSDOM('<main id="app"></main>',{url:'https://synthetic.invalid/#/clients',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, doc = w.document, calls = [], frames = [];
  w.CSS = {escape:String};
  w.scrollTo = ()=>{};
  w.requestAnimationFrame = fn => {frames.push(fn);return frames.length;};
  let blockNext = false, resume;
  w.repo = {connected:true,user:{id:'agent-a'},agents:[{id:'agent-a',full_name:'First'},{id:'agent-b',full_name:'Second'}],
    async searchClients(options) {
      calls.push(options);
      if (blockNext) { blockNext=false;await new Promise(resolve=>{resume=resolve;}); }
      if (options.agent==='agent-b') return {rows:[{...records[1],id:'other'}],nextCursor:null};
      return options.cursor ? {rows:records.slice(500),nextCursor:null} : {rows:records.slice(0,500),nextCursor:'500'};
    }};
  w.eval(bundle.outputFiles[0].text);
  t.after(()=>{w.ws.destroy();w.close();});
  const click = selector => doc.querySelector(selector).click();
  const tick = () => new Promise(resolve=>setTimeout(resolve,0));
  click('[data-start-mass-text]');
  click('[data-show-all]');
  await tick();
  const visible = () => doc.querySelectorAll('#client-results button.client-result');
  assert.ok(visible().length > 0 && visible().length < records.length);
  click('[data-sms-select-all]');
  assert.match(doc.querySelector('[data-sms-selected]').textContent,/^976 selected/);
  const checkboxes = () => [...doc.querySelectorAll('.sms-select-check input')];
  assert.equal(checkboxes()[0].disabled,true);
  checkboxes()[1].click();
  while(frames.length) frames.shift()();
  assert.equal(visible().length,977);
  assert.equal(checkboxes().filter(box=>box.checked).length,975);
  assert.equal(checkboxes()[1].checked,false);
  assert.equal(checkboxes().at(-1).checked,true);
  blockNext=true;
  click('[data-show-all]');
  const agent=doc.querySelector('#client-search [name=agent]');
  agent.value='agent-b';
  agent.dispatchEvent(new w.Event('change',{bubbles:true}));
  resume();await tick();
  while(frames.length) frames.shift()();
  assert.deepEqual([...visible()].map(el=>el.dataset.clientId),['other']);
  assert.match(doc.querySelector('[data-sms-selected]').textContent,/^0 selected/);
  assert.equal(calls.at(-1).agent,'agent-b');
});
