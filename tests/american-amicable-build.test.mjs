import test from 'node:test';
import assert from 'node:assert/strict';
import {americanAmicablePlans, listAmericanAmicablePlans, getAmericanAmicableBuild} from '../american-amicable-build-data.js';
import {listBuildCharts,lookupBuildChart} from '../build-charts.js';

test('six named American Amicable product guides remain independently selectable', () => {
  assert.equal(americanAmicablePlans.length,6);
  assert.deepEqual(americanAmicablePlans.map(p=>p.key),[
    'family-choice','intelligent-choice','platinum-family','platinum-legacy',
    'safecare-term','security-solution'
  ]);
  const catalog=listBuildCharts().find(c=>c.company==='American Amicable');
  assert.ok(catalog);
  assert.equal(catalog.plans.length,7); // six uploaded products + retained older Senior Choice
  assert.ok(catalog.plans.every(p=>p.ageGroups.every(g=>g.heights.length>0)));
});
test('source tables preserve distinct age bands and both standard and preferred', () => {
  const plans=listAmericanAmicablePlans();
  assert.deepEqual(plans.find(p=>p.key==='family-choice').ageGroups.map(g=>g.key),['0-2','3-9','10-14','15-17','18-49']);
  assert.deepEqual(plans.find(p=>p.key==='platinum-family').ageGroups.map(g=>g.key),['0-2','3-9','10-14','15-17','18-49']);
  assert.deepEqual(plans.find(p=>p.key==='safecare-term').ageGroups.map(g=>g.key),['standard','preferred']);
  assert.deepEqual(plans.find(p=>p.key==='security-solution').ageGroups.map(g=>g.key),['standard','preferred']);
});
test('Family Choice adult chart p.11 at 6 foot 2 is 343 maximum immediate and 344–374 ROP',()=>{
  const row=getAmericanAmicableBuild({plan:'family-choice',ageGroup:'18-49',heightInches:74});
  assert.deepEqual(row.values.map(v=>v.value),['343 lb','344-374 lb','142 lb','137-141 lb']);
});
test('Platinum Family p.40 prints a distinct 221-230 ROP high band at 4 foot 10',()=>{
  const pl=getAmericanAmicableBuild({plan:'platinum-family',ageGroup:'18-49',heightInches:58});
  const family=getAmericanAmicableBuild({plan:'family-choice',ageGroup:'18-49',heightInches:58});
  assert.equal(pl.values[1].value,'221-230 lb');
  assert.equal(family.values[1].value,'212-230 lb');
  assert.ok(pl.warnings.some(w=>w.includes('SOURCE DISCREPANCY')));
  assert.ok(!getAmericanAmicableBuild({plan:'platinum-family',ageGroup:'18-49',heightInches:59}).warnings.some(w=>w.includes('SOURCE DISCREPANCY')));
});
test('Juvenile age/height limits differ from 18-49 table',()=>{
  const j=getAmericanAmicableBuild({plan:'family-choice',ageGroup:'0-2',heightInches:24});
  assert.deepEqual(j.values.map(v=>v.value),['8 lb','23 lb']);
  const teen=getAmericanAmicableBuild({plan:'platinum-family',ageGroup:'15-17',heightInches:74});
  assert.deepEqual(teen.values.map(v=>v.value),['129 lb','296 lb']);
  assert.equal(getAmericanAmicableBuild({plan:'family-choice',ageGroup:'18-49',heightInches:24}),null);
});
test('Intelligent Choice and Security standard p.18/p.21 have precise table 2 and table 4 limits',()=>{
  for (const plan of ['intelligent-choice','security-solution']){
    const value=lookupBuildChart({company:'American Amicable',plan,ageGroup:plan==='security-solution'?'standard':'adult',heightInches:74});
    assert.deepEqual(value.values.map(v=>v.value),['136 lb','296 lb','323 lb']);
  }
});
test('SafeCare has extra 6 foot 7 through 6 foot 9 rows and preferred table p.16',()=>{
  assert.deepEqual(getAmericanAmicableBuild({plan:'safecare-term',ageGroup:'standard',heightInches:81}).values.map(v=>v.value),['160 lb','355 lb','387 lb']);
  assert.deepEqual(getAmericanAmicableBuild({plan:'safecare-term',ageGroup:'preferred',heightInches:56}).values.map(v=>v.value),['88 lb','144 lb']);
  assert.equal(getAmericanAmicableBuild({plan:'intelligent-choice',ageGroup:'adult',heightInches:81}),null);
});
test('Preferred Security table p.23 applies separately, no inference outside printed ranges',()=>{
  assert.deepEqual(getAmericanAmicableBuild({plan:'security-solution',ageGroup:'preferred',heightInches:79}).values.map(v=>v.value),['158 lb','287 lb']);
  assert.equal(getAmericanAmicableBuild({plan:'security-solution',ageGroup:'preferred',heightInches:80}),null);
});
test('Older saved Senior Choice chart and other company references are retained unchanged',()=>{
  const old=lookupBuildChart({company:'American Amicable',plan:'senior-choice-reference',heightInches:74});
  assert.equal(old.values[0].value,'343 lb');
  assert.ok(lookupBuildChart({company:'Mutual of Omaha',heightInches:74}));
  assert.ok(lookupBuildChart({company:'Physicians Mutual',heightInches:74}));
  assert.ok(lookupBuildChart({company:'Corebridge Financial — SimpliNow Legacy',heightInches:74}));
});
