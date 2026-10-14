
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NAV } from '../core.js';
import { shell } from '../views.js';

const read = name => readFile(new URL('../'+name,import.meta.url),'utf8');

test('Athena Medicare is a separate navigation page directly under Agents and Admin', async () => {
  const keys=NAV.map(x=>x[0]);
  assert.equal(keys[keys.indexOf('agents')+1],'athena-medicare');
  assert.equal(NAV.find(x=>x[0]==='athena-medicare')[1],"Athena's Medicare");
  const markup=shell('athena-medicare',true,'<div id="athena-medicare-host"></div>');
  assert.match(markup,/href="#\/athena-medicare"/);
  assert.doesNotMatch(markup,/href="#\/medicare-intake"/);
  assert.ok(!keys.includes('medicare-intake'), 'Retired Medicare Reviews is not an active route');
  assert.match(markup,/aria-current="page"/);
  assert.doesNotMatch(markup,/href="#\/settings"/);
  const workspace=await read('workspace.js');
  assert.match(workspace,/createAthenaMedicareFeature/);
  assert.doesNotMatch(workspace,/createMedicareIntakeFeature|import\('\.\/medicare-intake\.js'\)/);
  assert.match(workspace,/\['medicare-intake','medicare-reviews'\]\.includes\(requested\)/);
  assert.match(workspace,/athenaFeature\?\.unmount\(\)/);
  assert.match(workspace,/athenaFeature && !athenaFeature\.canLeave\(\)/);
});

test('new intake and annual Medicare review get separate starter actions and nine comprehensive sections', async () => {
  const s=await read('athena-medicare.js');
  assert.match(s,/data-at-new="new_intake"/);
  assert.match(s,/data-at-new="annual_review"/);
  assert.match(s,/href="#\/ma-plans" data-at-compare/);
  assert.match(s,/data-at-saved/);
  assert.match(s,/const SECTIONS = \[/);
  for(const key of ['Doctors & pharmacies','Prescriptions','Needs & priorities','Plan recommendation',
    'Hospital protection','Review, SOA & follow-up','Medicare & Medicaid'])
    assert.ok(s.includes(key),key);
  assert.match(s,/Already in CRM — skip this section/);
  assert.match(s,/data-at-hip-total/);
  assert.match(s,/review_kind/);
  assert.match(s,/workflow_status/);
  assert.match(s,/follow_up/);
  assert.match(s,/completed/);
  assert.match(s,/data-at-save/);
  assert.match(s,/data-at-saved/);
  assert.match(s,/data-at-delete/);
});

test('Athena review storage requires linked CRM client and never puts government IDs or payments into review JSON', async () => {
  const s=await read('athena-medicare.js');
  const start=s.indexOf('function collectData()'),end=s.indexOf('function calcHip()',start);
  assert.ok(start>0 && end>start);
  const code=s.slice(start,end);
  for(const key of ['medicare_number','medicaid_number','card_number','ssn','bank_account','cvv']){
    assert.ok(!code.includes("'"+key+"'"),key+' must never be serialized in review');
  }
  assert.match(s,/client-sensitive/);
  assert.match(s,/vaultOriginal/);
  assert.match(s,/record\?\.review_kind/);
  assert.match(s,/if\(type==='annual_review' && !linkedClient\?\.id\)/);
  assert.match(s,/findPotentialDuplicate/);
  assert.match(s,/This review was changed elsewhere/);
  const migration=await read('supabase/migrations/20261013150000_athena_medicare_reviews.sql');
  assert.match(migration,/enable row level security/);
  assert.match(migration,/private\.mig_can_access_client\(client_id\)/);
  assert.match(migration,/grant update \(full_name,review_kind,workflow_status,review_date,next_contact_date,form_data,updated_at\)/);
  assert.match(migration,/athena_no_payment_or_id_json/);
});

test('Athena includes secure attached documents without deleting client files', async () => {
  const s=await read('athena-medicare.js');
  assert.match(s,/const BUCKET = 'mh-client-documents'/);
  assert.match(s,/createSignedUrl/);
  assert.match(s,/supabase\.storage\.from\(BUCKET\)\.upload/);
  assert.match(s,/const result=await supabase\.from\('documents'\)\.insert/);
  const p=s.slice(s.indexOf('async function removeReview'),s.indexOf('async function viewAttachment'));
  assert.match(p,/supabase\.from\(TABLE\)\.delete\(\)/);
  assert.doesNotMatch(p,/from\('clients'\)|from\('documents'\)|storage\.from/);
  const style=await read('workspace-styles.css');
  assert.match(style,/athena-medicare\.css/);
  const css=await read('athena-medicare.css');
  assert.match(css,/@media\(max-width:680px\)/);
});
