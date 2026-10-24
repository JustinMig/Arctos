import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { build } from 'esbuild';
import { createClientDraftStore } from '../client-draft-store.js';
import { clientFixture } from './helpers/client-performance-fixture.mjs';

const bundle = (await build({ stdin: { contents: "import * as recovery from './client-draft-recovery.js'; window.recovery = recovery;", resolveDir: new URL('..', import.meta.url).pathname }, bundle:true,format:'iife',write:false })).outputFiles[0].text;
async function fixture() {
  const f = await clientFixture(); f.w.eval(bundle); return f;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('drafts are encrypted, scoped by agent and client, and expire after seven days', async () => {
  const indexedDB = new IDBFactory(); let now = 100;
  const store = createClientDraftStore({ indexedDB, crypto:webcrypto, now:()=>now });
  await store.save('agent-a','client-a','draft-a',{fields:{ssn:'SYNTHETIC-PRIVATE'}});
  assert.equal((await store.latest('agent-a','client-a')).fields.ssn,'SYNTHETIC-PRIVATE');
  assert.equal(await store.latest('agent-b','client-a'),null);
  assert.equal(await store.latest('agent-a','client-b'),null);
  const db = await new Promise(resolve => { const r=indexedDB.open('arctos-client-recovery-v1',1);r.onsuccess=()=>resolve(r.result); });
  const rows = await new Promise(resolve => { const r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result); });
  assert.ok(rows[0].encrypted instanceof ArrayBuffer);
  assert.equal(new TextDecoder().decode(rows[0].encrypted).includes('SYNTHETIC-PRIVATE'),false);
  const key = await new Promise(resolve => { const r=db.transaction('keys').objectStore('keys').get('agent-a');r.onsuccess=()=>resolve(r.result); });
  assert.equal(key.extractable,false); db.close();
  now += 8*24*60*60*1000;
  assert.equal(await store.latest('agent-a','client-a'),null);
});
test('concurrent tabs retain a usable encryption key and cannot clear another draft', async () => {
  const indexedDB = new IDBFactory();
  const a=createClientDraftStore({indexedDB,crypto:webcrypto}),b=createClientDraftStore({indexedDB,crypto:webcrypto});
  await Promise.all([a.save('agent','a','one',{fields:{name:'A'}}),b.save('agent','b','two',{fields:{name:'B'}})]);
  assert.equal((await b.latest('agent','a')).fields.name,'A');
  assert.equal((await a.latest('agent','b')).fields.name,'B');
  await a.remove('agent','a','other');
  assert.ok(await a.latest('agent','a'));
  await a.remove('agent','a','one');
  assert.equal(await a.latest('agent','a'),null);
});
test('recovery restores added/removed doctors, life and pharmacy edits without saving or persisting CVV', async () => {
  const f=await fixture();try {
    f.fill('phone','RECOVER-PHONE');f.fill('ssn','RECOVER-SSN');
    f.form.querySelector('[name=doctor_0_id]').closest('[data-health-card]').remove();
    f.form.querySelector('[data-add-health-record=doctors]').click(); f.fill('doctor_2_doctor_name','Recovery Doctor');
    f.fill('life_policy_0_premium','77');f.fill('pharmacy_name','Recovery Pharmacy');
    const cvv=f.w.document.createElement('input');cvv.name='banking_cvv';cvv.value='999';f.form.append(cvv);
    const draft=f.w.recovery.captureClientDraft(f.form,new Set(['ssn','banking_cvv']));
    assert.equal(draft.fields.banking_cvv,undefined);assert.equal(draft.fields.medicare_number,undefined);
    f.fill('phone','CHANGED');f.fill('ssn','CHANGED');f.fill('pharmacy_name','CHANGED');
    f.w.recovery.restoreClientDraft(f.form,draft);
    assert.equal(f.form.elements.namedItem('phone').value,'RECOVER-PHONE');
    assert.equal(f.form.elements.namedItem('ssn').value,'RECOVER-SSN');
    assert.equal(f.form.elements.namedItem('pharmacy_name').value,'Recovery Pharmacy');
    const doctors=[...f.form.querySelectorAll('[data-health-list=doctors] input[name$=_doctor_name]')].map(e=>e.value);
    assert.equal(doctors.length,2);assert.ok(doctors.includes('Recovery Doctor'));
    assert.equal(f.form.querySelector('[data-life-policy-list] input[name$=_premium]').value,'77');
    assert.equal(f.requests.filter(r=>r.action!=='select'&&r.action!=='get').length,0);
  } finally {await new Promise(resolve=>setTimeout(resolve,300)); f.close();}
});
test('offline Save retains a draft without calling the server or reporting success; online success clears it', async () => {
  const f=await fixture();try {
    const writes=[],removed=[]; let saves=0;
    const controller={node:f.form.closest('dialog'),onSave:async()=>{saves++;return {id:'client'};},finish(){}};
    const record={id:'client',updated_at:'v1'};
    f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>record,getUserId:()=> 'agent',store:{latest:async()=>null,save:async(...args)=>writes.push(args),remove:async(...args)=>removed.push(args)}});
    f.fill('phone','OFFLINE-PHONE');
    Object.defineProperty(f.w.navigator,'onLine',{configurable:true,value:false});
    await assert.rejects(controller.onSave(f.form),/not been saved to the CRM/);
    assert.equal(saves,0);assert.equal(writes.at(-1)[3].fields.phone,'OFFLINE-PHONE');assert.equal(removed.length,0);
    Object.defineProperty(f.w.navigator,'onLine',{configurable:true,value:true});
    await controller.onSave(f.form);assert.equal(saves,1);assert.equal(removed.length,1);
    assert.equal(writes.at(-1)[3].serverAttempted,true);
    controller.finish();
  } finally {await new Promise(resolve=>setTimeout(resolve,300)); f.close();}
});
test('version conflicts and uncertain new-client saves never offer automatic restoration',async()=>{
  for(const [record,draft] of [[{id:'client',updated_at:'v2'},{recordVersion:'v1'}],[{}, {recordVersion:null,serverAttempted:true}]]){
    const f=await fixture();try{
      const controller={node:f.form.closest('dialog'),onSave:async()=>{},finish(){}};
      f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>record,getUserId:()=> 'agent',store:{latest:async()=>({...draft,fields:{phone:'OLD'},storageKey:'["agent","client","id"]'}),save:async()=>{},remove:async()=>{}}});
      await tick();
      assert.match(controller.node.querySelector('.modal-error').textContent,/may have changed|may have succeeded/);
      assert.equal(controller.node.querySelector('.modal-error button'),null);
      assert.notEqual(f.form.elements.namedItem('phone').value,'OLD');controller.finish();
    }finally{await new Promise(resolve=>setTimeout(resolve,300)); f.close();}
  }
});
test('a changed login prevents persistence and saving of the previous agent’s open record',async()=>{
  const f=await fixture();try{
    let user='agent-a',calls=0;
    const controller={node:f.form.closest('dialog'),onSave:async()=>{calls++;},finish(){}};
    const recovery=f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>({id:'client'}),getUserId:()=>user,store:{latest:async()=>null,save:async()=>{calls++;},remove:async()=>{}}});
    f.fill('phone','UNSAVED');user='agent-b';
    assert.equal(await recovery.persist(),false);
    await assert.rejects(controller.onSave(f.form),/Sign in again/);assert.equal(calls,0);controller.finish();
  }finally{await new Promise(resolve=>setTimeout(resolve,300)); f.close();}
});
test('a matching draft restores only after clicking Recover and remains unsaved',async()=>{
  const f=await fixture();try{
    let saves=0;
    const controller={node:f.form.closest('dialog'),onSave:async()=>{saves++;},finish(){}};
    f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>({id:'client',updated_at:'v1'}),getUserId:()=> 'agent',store:{latest:async()=>({recordVersion:'v1',fields:{phone:'RECOVERED'},groups:[],storageKey:'["agent","client","draft"]'}),save:async()=>{},remove:async()=>{}}});
    await tick(); assert.notEqual(f.form.elements.namedItem('phone').value,'RECOVERED');
    controller.node.querySelector('.modal-error button').click();
    assert.equal(f.form.elements.namedItem('phone').value,'RECOVERED');assert.equal(saves,0);
    assert.match(controller.node.querySelector('.modal-error').textContent,/Review the record/);
    controller.finish();
  }finally{await new Promise(resolve=>setTimeout(resolve,300));f.close();}
});
test('a failed server save retains the draft and a discard waits for pending encryption',async()=>{
  const f=await fixture();try{
    const operations=[];let last;
    const controller={node:f.form.closest('dialog'),onSave:async()=>{throw new Error('Lost response');},finish(){}};
    const recovery=f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>({id:'client',updated_at:'v1'}),getUserId:()=> 'agent',store:{latest:async()=>null,save:async(...args)=>{await tick();last=args[3];operations.push('write');},remove:async()=>{operations.push('remove');}}});
    f.fill('phone','RETAIN');await assert.rejects(controller.onSave(f.form),/Lost response/);
    assert.equal(last.fields.phone,'RETAIN');assert.equal(last.serverAttempted,true);assert.deepEqual(operations,['write']);
    const pending=recovery.persist();await controller.discardDraft();await pending;
    assert.deepEqual(operations,['write','write','remove']);controller.finish();
  }finally{await new Promise(resolve=>setTimeout(resolve,300));f.close();}
});
test('unavailable device storage does not block online saving or discarding an unsaved form',async()=>{
  const f=await fixture();try{
    let saves=0;
    const unavailable=async()=>{throw new Error('Storage unavailable');};
    const controller={node:f.form.closest('dialog'),onSave:async()=>{saves++;},finish(){}};
    f.w.recovery.installClientRecovery({controller,form:f.form,getRecord:()=>({id:'client'}),getUserId:()=> 'agent',store:{latest:unavailable,save:unavailable,remove:unavailable}});
    f.fill('phone','SAVE-ONLINE');await controller.onSave(f.form);assert.equal(saves,1);
    f.fill('phone','DISCARD');await controller.discardDraft();controller.finish();
  }finally{await new Promise(resolve=>setTimeout(resolve,300));f.close();}
});
