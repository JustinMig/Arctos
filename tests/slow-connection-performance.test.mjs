import test from 'node:test';
import assert from 'node:assert/strict';
import {clientFixture} from './helpers/client-performance-fixture.mjs';
import {sameRecordFields,sameRecordList} from '../record-changes.js';

test('change detection compares typed editor fields and distinguishes a cleared value',()=>{
 assert.equal(sameRecordFields({premium:0,notes:null},{id:'one',premium:0,notes:null}),true);
 assert.equal(sameRecordFields({premium:0},{premium:10}),false);
 assert.equal(sameRecordFields({notes:null},{notes:'Saved notes'}),false);
 assert.equal(sameRecordList([{id:'one',name:'One'}],[{id:'one',name:'One'}],r=>({name:r.name})),true);
 assert.equal(sameRecordList([],[{id:'one'}],r=>r),false);
});
test('editing a phone preserves other client data without rewriting unchanged medical, pharmacy and life rows',async()=>{
 const f=await clientFixture();try{
  const before=structuredClone({doctors:f.db.client_doctors,medications:f.db.client_medications,life:f.db.life_policies,pharmacies:f.db.client_pharmacies,vault:f.vault});
  f.fill('phone','555-UPDATED');await f.save();
  assert.equal(f.db.clients[0].phone,'555-UPDATED');
  for(const table of ['client_doctors','client_medications','hospital_indemnity_plans','client_pharmacies','life_policies'])assert.equal(f.requests.filter(r=>r.table===table).length,0,table+' should need no requests');
  assert.equal(f.requests.filter(r=>r.table==='clients'&&r.action==='update').length,1);
  assert.equal(f.requests.filter(r=>r.action==='select').length,0,'No full-client reload after saving');
  assert.equal(f.requests.length,1,'A phone-only save needs just the version-checked client write');
  assert.deepEqual({doctors:f.db.client_doctors,medications:f.db.client_medications,life:f.db.life_policies,pharmacies:f.db.client_pharmacies,vault:f.vault},before);
  assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('Medicaid, Sunfire, plan type, underwriting and doctor notes survive a save and reopen',async()=>{
 const f=await clientFixture();try{
  f.fill('sunfire_code','UPDATED-SUNFIRE');f.fill('medicaid_number','UPDATED-MEDICAID');f.fill('medicaid_level','SLMB');f.fill('height_feet','5');f.fill('height_inches','11');f.fill('veteran','true');f.fill('doctors_section_notes','Updated doctor note');f.fill('health_plan_type','Supplement');
  const saved=await f.save(),loaded=await f.repo.getClient(saved.id);
  assert.equal(loaded.sunfire_code,'UPDATED-SUNFIRE');assert.equal(loaded.medicaid_level,'SLMB');assert.equal(loaded.medicaid_number,'UPDATED-MEDICAID');assert.equal(loaded.health_plan_type,'Supplement');
  assert.equal(loaded.height_feet,5);assert.equal(loaded.veteran,true);assert.equal(loaded.doctors_section_notes,'Updated doctor note');
  assert.equal(f.requests.filter(r=>r.table==='clients'&&r.action==='update').length,1);
  assert.equal(f.requests.filter(r=>r.table==='medicare_details'&&r.action==='update').length,0);
  assert.equal(f.requests.filter(r=>r.table==='health_plans'&&r.action==='update').length,1);
  assert.equal(f.db.clients[0].updated_at,saved.updated_at);assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('changed and removed medical records save; unchanged sibling records are not rewritten',async()=>{
 const f=await clientFixture();try{
  f.fill('doctor_0_phone','555-CHANGED');f.form.querySelector('[name=medication_0_id]').closest('[data-health-card]').remove();await f.save();
  const writes=f.requests.filter(r=>r.table==='client_doctors'&&r.action==='update');assert.equal(writes.length,1);assert.equal(f.db.client_doctors[0].phone,'555-CHANGED');assert.equal(f.db.client_doctors[1].phone,'555-0102');assert.equal(f.db.client_medications.length,0);
  assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('protected edits still use encrypted endpoints, and failed writes remain retryable',async()=>{
 const f=await clientFixture();try{
  f.fill('ssn','UPDATED-SSN');f.fill('banking_account_number','123456789');f.fill('doctor_0_phone','555-RETRY');f.fail('client_doctors');
  await assert.rejects(f.save(),/interrupted save/);assert.equal(f.form.elements.namedItem('doctor_0_phone').value,'555-RETRY');assert.equal(f.db.client_doctors[0].phone,'555-0101');
  // Re-open after a partial save, as the existing client version check requires.
  const current=await f.repo.getClient(f.db.clients[0].id);
  await f.repo.saveClient({...current,...f.api.serializable(f.form)},{expectedVersion:current.updated_at});
  assert.equal(f.db.client_doctors[0].phone,'555-RETRY');assert.equal(f.vault.sensitive.ssn,'UPDATED-SSN');assert.equal(f.vault.banking.account_number,'123456789');
 }finally{f.close();}
});
test('a medical row removed in another session cannot silently pass as saved',async()=>{
 const f=await clientFixture();try{
  f.fill('doctor_0_phone','UNSAVED-EDIT');
  f.db.client_doctors.splice(0,1);
  const remaining=structuredClone(f.db.client_doctors);
  await assert.rejects(f.save(),/medical record changed or is no longer available/);
  assert.equal(f.form.elements.namedItem('doctor_0_phone').value,'UNSAVED-EDIT');
  assert.deepEqual(f.db.client_doctors,remaining);
  assert.equal(f.requests.filter(r=>r.table==='client_doctors'&&r.action==='delete').length,0);
 }finally{f.close();}
});
test('successive saves retain new row IDs, remove deleted cards, and keep protected values out of returned client events',async()=>{
 const f=await clientFixture();try{
  f.form.querySelector('[data-add-health-record=doctors]').click();f.fill('doctor_2_doctor_name','New Synthetic Doctor');
  f.fill('ssn','UPDATED-SSN');const saved=await f.save();
  assert.equal(f.db.client_doctors.length,3);assert.ok(f.form.elements.namedItem('doctor_2_id').value);
  assert.equal(Object.keys(saved).some(k=>/^(?:doctor|medication|indemnity|life_policy)_\d+_/.test(k)),false);
  assert.equal(saved.ssn,undefined);assert.equal(saved.banking_account_number,undefined);
  f.form.elements.namedItem('doctor_2_id').closest('[data-health-card]').remove();await f.save();assert.equal(f.db.client_doctors.length,2);
  await f.save();assert.equal(f.db.client_doctors.length,2,'Removed row must stay removed after another save');
  assert.equal(f.vault.sensitive.ssn,'UPDATED-SSN');assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('life-policy and pharmacy edits save once, then remain unchanged on the next save',async()=>{
 const f=await clientFixture();try{
  f.fill('life_policy_0_premium','25');f.fill('pharmacy_name','Updated Synthetic Pharmacy');await f.save();
  assert.equal(f.db.life_policies[0].premium,25);assert.equal(f.db.client_pharmacies[0].pharmacy_name,'Updated Synthetic Pharmacy');
  assert.equal(f.requests.filter(r=>r.table==='life_policies'&&r.action==='update').length,1);
  f.requests.length=0;await f.save();assert.equal(f.requests.length,1,'Repeated Save must not rewrite the policy or pharmacy');assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('date validation binds once even when several editor modules enhance the same form',async()=>{
 const f=await clientFixture();try{
  const input=f.form.querySelector('[name=date_of_birth]');let calls=0;const original=input.setCustomValidity.bind(input);input.setCustomValidity=value=>{calls++;original(value);};
  for(let i=0;i<5;i++)f.api.wireDates(f.form);calls=0;f.fill('date_of_birth','02/31/1960');
  assert.equal(calls,1);assert.equal(input.checkValidity(),false);assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
test('a failed protected read cannot overwrite other identifiers with empty values during a license save',async()=>{
 const f=await clientFixture();try{
  const before=structuredClone(f.vault.sensitive);f.fill('license_number','NEW-SYNTHETIC-LICENSE');f.failProtectedRead();
  await assert.rejects(f.save(),/protected read failed/);
  assert.equal(f.requests.some(r=>r.table==='client-sensitive'&&r.action==='save'),false);
  assert.deepEqual(f.vault.sensitive,before);assert.equal(f.form.elements.namedItem('license_number').value,'NEW-SYNTHETIC-LICENSE');
 }finally{f.close();}
});
