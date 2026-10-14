import test from 'node:test';
import assert from 'node:assert/strict';
import { MA_CARRIERS, MA_PLANS_2027 } from '../ma-plans-data.js';
import {
  DEVOTED_2027_DOCS, VERIFIED_2027_BENEFITS,
  get2027PlanDocuments, applyVerified2027Benefits, audit2027Plan,
  MA_BENEFIT_FIELDS
} from '../ma-plan-documentation-2027.js';

test('reference contains exactly the five Mississippi carriers', () => {
  assert.deepEqual([...MA_CARRIERS], [
    'Humana','Aetna','UnitedHealthcare','Devoted','Cigna/HealthSpring'
  ]);
  assert.equal(MA_PLANS_2027.length,72);
  assert.equal(MA_PLANS_2027.filter(p=>p.carrier==='Cigna/HealthSpring').length,8);
  const ids=new Set(MA_PLANS_2027.map(p=>p.plan_number));
  assert.equal(ids.size,MA_PLANS_2027.length,'Duplicate plan IDs can silently switch selections');
});

test('all ten Devoted 2027 plan reference entries resolve to an official 2027 SB PDF', () => {
  const devoted=MA_PLANS_2027.filter(p=>p.carrier==='Devoted');
  assert.equal(devoted.length,10);
  for(const plan of devoted) {
    const doc=get2027PlanDocuments(plan);
    assert.equal(doc.directSB,true,plan.plan_number);
    assert.match(doc.sb,/^https:\/\/assets\.devoted\.com\/plan-documents\/2027\/.*SB-H7355-\d{3}-ENG\.pdf$/);
    assert.match(doc.eoc,/^https:\/\/);
    assert.ok(!/\/2026\//.test(doc.eoc));
  }
});

test('all 2027 plans have a carrier or exact-plan document lookup', () => {
  for(const plan of MA_PLANS_2027) {
    const doc=get2027PlanDocuments(plan);
    assert.match(doc.sb,/^https:\/\//,plan.plan_number);
    assert.match(doc.eoc,/^https:\/\//,plan.plan_number);
    assert.equal(doc.directSB,!(!DEVOTED_2027_DOCS[plan.plan_number]),plan.plan_number);
    const audit=audit2027Plan(plan);
    assert.equal(audit.total,MA_BENEFIT_FIELDS.length);
    assert.ok(Array.isArray(audit.fieldsNeedingReview));
  }
});

test('Devoted 009 D-SNP official 2027 SB corrects prior medical copay mistakes', () => {
  const plan=MA_PLANS_2027.find(p=>p.plan_number==='H7355-009');
  assert.ok(plan);
  const updated=applyVerified2027Benefits(plan);
  assert.match(updated.inpatient,/\$0 copay\/stay IN/);
  assert.match(updated.pcp,/\$0 IN/);
  assert.match(updated.specialist,/\$0 IN/);
  assert.deepEqual(updated.medicaid_levels,['QMB+','SLMB+','FBDE']);
  assert.match(updated.otc_food_utilities,/\$301\/month/);
  assert.ok(updated._sb_verified_fields.includes('inpatient'));
});

test('Devoted 003 in-network inpatient is not charged at reference OON rate', () => {
  const plan=MA_PLANS_2027.find(p=>p.plan_number==='H7355-003');
  const corrected=applyVerified2027Benefits(plan);
  assert.match(corrected.inpatient,/\$0 copay\/stay IN/);
  assert.match(corrected.specialist,/\$0 IN/);
  assert.match(corrected.inpatient,/Out|OON/);
});

test('do not classify generic carriers document selectors as verified direct PDFs', () => {
  for(const plan of MA_PLANS_2027.filter(p=>p.carrier!=='Devoted')) {
    const docs=get2027PlanDocuments(plan);
    assert.equal(docs.directSB,false);
    assert.equal(docs.directEOC,false);
  }
  assert.equal(Object.keys(VERIFIED_2027_BENEFITS).length,11);
});

test('Aetna H3239-028 2027 SB/EOC corrects Medicaid eligibility and uncovered emergency/transport costs',()=>{
  const old=MA_PLANS_2027.find(p=>p.plan_number==='H3239-028');
  assert.ok(old);
  const corrected=applyVerified2027Benefits(old);
  assert.deepEqual(corrected.medicaid_levels,['QMB+','SLMB+','FBDE']);
  assert.match(corrected.medical_deductible,/\$0/);
  assert.match(corrected.ambulance,/\$0/);
  assert.match(corrected.emergency_room,/\$0/);
  assert.match(corrected.urgent_care,/\$0/);
  assert.match(corrected.transportation,/36 one-way/);
  assert.match(corrected.transportation,/60 miles/);
  assert.match(corrected.otc_food_utilities,/\$215\/month/);
  assert.match(corrected.dental,/\$3,500/);
  assert.match(corrected.vision,/\$275/);
  const links=get2027PlanDocuments(old);
  assert.match(links.sb,/plan\.H3239\.028\.html/);
  assert.equal(links.directSB,false,'Do not mislabel plan document landing pages as direct PDFs');
});
