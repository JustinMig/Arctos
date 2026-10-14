import test from 'node:test';
import assert from 'node:assert/strict';
import { getMississippi2027Landscape } from '../server/ma-cms-2027-ms-snapshot.js';
import { MA_CARRIERS, MA_PLANS_2027 } from '../ma-plans-data.js';

const snapshot = getMississippi2027Landscape();
const counties = snapshot.counties;
const segmentCatalog = snapshot.segments;

test('official CMS 2027 Mississippi snapshot has every county and exactly five carrier brands', () => {
  assert.equal(snapshot.source.year, 2027);
  assert.equal(snapshot.source.release, '202609.1');
  assert.equal(Object.keys(counties).length, 82);
  assert.equal(Object.keys(segmentCatalog).length, 78);
  assert.equal(Object.values(counties).reduce((n,list)=>n+list.length,0), 3334);
  assert.deepEqual(new Set(Object.values(segmentCatalog).map(x=>x.carrier)), new Set(MA_CARRIERS));
});

test('all 74 published contract-plan IDs are included once in our 2027 reference', () => {
  const cms=new Set(Object.values(segmentCatalog).map(row=>row.plan_number));
  const local=new Set(MA_PLANS_2027.map(row=>row.plan_number));
  assert.equal(cms.size,74);
  assert.equal(local.size,74);
  assert.deepEqual(local,cms);
  assert.equal(MA_PLANS_2027.filter(p=>p.carrier==='Cigna/HealthSpring').length,10);
});

test('every county references existing segment, and no row silently combines two CMS segments', () => {
  for(const [county,ids] of Object.entries(counties)) {
    assert.ok(ids.length>0,'No plans for '+county);
    const planIds=new Set();
    for(const id of ids) {
      const row=segmentCatalog[id];
      assert.ok(row,'Unknown county segment '+county+':'+id);
      assert.equal(row.display_plan_id,id);
      assert.match(row.plan_number,/^[HR]\d{4}-\d{3}$/);
      assert.ok(!planIds.has(row.plan_number),'Duplicate PBP with different segments in '+county);
      planIds.add(row.plan_number);
    }
  }
});

test('HealthSpring H4407-030 MOOP varies by county segment and is never treated as one statewide number', () => {
  const options=Object.values(segmentCatalog).filter(p=>p.plan_number==='H4407-030');
  assert.equal(options.length,3);
  assert.deepEqual(new Set(options.map(p=>p.medical_moop)),new Set(['$5,700.00','$6,400.00','$7,150.00']));
  const seen=new Set();
  for(const ids of Object.values(counties)) for(const key of ids) {
    const plan=segmentCatalog[key];
    if(plan.plan_number==='H4407-030')seen.add(plan.segment);
  }
  assert.deepEqual(seen,new Set(['001','002','003']));
});

test('Medicare-only plans never display a $0 Part D deductible as if they included prescriptions', () => {
  for(const row of Object.values(segmentCatalog)) {
    if(row.part_d===false) {
      assert.equal(row.drug_deductible,'No Part D included',row.display_plan_id);
      assert.equal(row.rx_oop,'No Part D included',row.display_plan_id);
    } else {
      assert.match(row.drug_deductible,/^\$/,'CMS must specify Part D deductible for '+row.display_plan_id);
      assert.match(row.rx_oop,/^\$/,'CMS must specify Part D OOP for '+row.display_plan_id);
    }
  }
  assert.equal(segmentCatalog['H4407-011-000'].part_d,false);
});

test('D-SNP, C-SNP and I-SNP indicators are distinct in the CMS 2027 source', () => {
  assert.equal(segmentCatalog['H4407-029-000'].is_dsnp,true);
  assert.equal(segmentCatalog['H4407-034-000'].is_csnp,true);
  assert.equal(segmentCatalog['H0710-004-000'].is_isnp,true);
  assert.equal(segmentCatalog['H0710-004-000'].is_dsnp,false);
});
