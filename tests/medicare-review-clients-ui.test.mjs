import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medicareReviewYear } from '../medicare-review-cycle.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin:{ contents:`import { createWorkspace } from './workspace.js'; import './client-summary-commissions.js'; window.workspace=createWorkspace(document.getElementById('app'),window.repository);`, resolveDir:root },
  bundle:true, format:'iife', write:false, logLevel:'silent',
  plugins:[{ name:'isolated-review-data', setup(b) {
    b.onResolve({ filter:/supabase-(repository|client)\.js(?:\?|$)/ }, () => ({ path:'database', namespace:'fixture' }));
    b.onLoad({ filter:/.*/, namespace:'fixture' }, () => ({ contents:'export const supabase=window.database; export const mhRepository=window.repository; export const initialAuthUrl="";' }));
    b.onResolve({ filter:/^\.\.?\// }, args => args.resolveDir.includes('node_modules') ? undefined : ({ path:path.resolve(args.resolveDir,args.path.split('?')[0]) }));
  } }]
});
const settle = async () => { for(let n=0;n<5;n++) await new Promise(resolve => setImmediate(resolve)); };

test('review card opens checked clients, saves a cleared check, updates totals and returns to search', async t => {
  const dom = new JSDOM('<div id="app"></div>',{ url:'https://synthetic.invalid/#/clients', runScripts:'outside-only', pretendToBeVisual:true });
  const w=dom.window, year=medicareReviewYear();
  let reviewed=true;
  const client={ id:'synthetic-client', first_name:'Review', last_name:'<Client>', status:'active', products:['medicare'], phone:'555-0100' };
  w.repository={ connected:false, agents:[], user:{id:'synthetic-owner'}, profile:{role:'owner'},
    commissions:async()=>({}), saveClient:async value=>value, getClient:async()=>({...client}) };
  const counts={ select(){return this;},eq(){return this;},neq(){return this;},contains(){return this;},then(resolve){resolve({count:1});} };
  w.database={ from(table){
    if(table==='clients')return Object.create(counts);
    const q={};for(const key of ['select','eq','order','limit'])q[key]=()=>q;
    q.then=resolve=>resolve({data:[]});return q;
  }, rpc(name,args,options){
    if(name==='client_birthdays_this_month')return Promise.resolve({data:[]});
    if(name==='client_medicare_review_status')return Promise.resolve({data:{review_year:year,completed:reviewed}});
    if(name==='set_client_medicare_review_completed'){
      reviewed=args.p_completed;return Promise.resolve({data:{review_year:year,completed:reviewed}});
    }
    assert.equal(name,'client_medicare_reviews_current_cycle');
    if(options?.head)return Promise.resolve({count:reviewed?1:0});
    return {range:async()=>({data:reviewed?[{...client,review_year:year}]:[]})};
  } };
  w.CSS={escape:v=>String(v)};
  w.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  const errors=[];w.addEventListener('error',event=>errors.push(event.error?.message||event.message));
  w.eval(bundle.outputFiles[0].text);
  t.after(()=>{w.workspace.destroy();dom.window.close();});
  await settle();
  const doc=w.document,card=doc.querySelector('[data-open-medicare-reviews]');
  assert.ok(card);
  assert.equal(doc.querySelectorAll('[data-client-summary-grid] .client-summary-card').length,6);
  assert.equal(card.querySelector('strong').textContent,'1');
  card.click();await settle();
  assert.equal(doc.querySelector('#client-active-search').hidden,true);
  assert.equal(doc.querySelector('#client-medicare-review-list').hidden,false);
  assert.match(doc.querySelector('[data-medicare-review-heading]').textContent,/Medicare Reviews/);
  const row=doc.querySelector('#client-medicare-review-results [data-client-id]');
  assert.match(row.textContent,/Review <Client>/);
  assert.equal(row.querySelector('client'),null,'client names must be escaped');
  row.click();await settle();
  const dialog=doc.querySelector('dialog.client-dialog'),check=dialog.querySelector('[data-client-review-manual]');
  assert.equal(check.checked,true);
  assert.equal(check.disabled,false);
  check.checked=false;check.dispatchEvent(new w.Event('change'));await settle();
  assert.equal(reviewed,false);
  assert.equal(card.querySelector('strong').textContent,'0');
  assert.match(doc.querySelector('#client-medicare-review-results').textContent,/No clients have/);
  dialog.querySelector('[data-close]').click();await settle();
  doc.querySelector('[data-close-medicare-reviews]').click();
  assert.equal(doc.querySelector('#client-active-search').hidden,false);
  assert.equal(doc.querySelector('#client-medicare-review-list').hidden,true);
  assert.deepEqual(errors,[]);
});
