import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ageFromBirthDate} from '../client-age-utils.js';

const at=(year,month,day)=>new Date(year,month-1,day,12);
test('Client at a Glance age advances on birthday, not January 1',()=>{
  assert.equal(ageFromBirthDate('10/23/1960',at(2026,10,22)),65);
  assert.equal(ageFromBirthDate('10/23/1960',at(2026,10,23)),66);
  assert.equal(ageFromBirthDate('10/23/1960',at(2027,10,22)),66);
  assert.equal(ageFromBirthDate('10/23/1960',at(2027,10,23)),67);
});
test('ISO dates from database and MM/DD/YYYY form dates calculate same age',()=>{
  assert.equal(ageFromBirthDate('1960-10-23',at(2026,10,23)),66);
  assert.equal(ageFromBirthDate('10/23/1960',at(2026,10,23)),66);
  assert.equal(ageFromBirthDate('1/5/2000',at(2026,1,4)),25);
});
test('Age ignores incomplete, invalid or future DOB rather than showing wrong age',()=>{
  for(const value of ['',null,'10/23/','02/30/1960','13/01/1980','2026-02-29','bad date']){
    assert.equal(ageFromBirthDate(value,at(2026,10,23)),null,String(value));
  }
  assert.equal(ageFromBirthDate('10/24/2026',at(2026,10,23)),null);
});
test('Leap-day clients update correctly across leap and non-leap years',()=>{
  assert.equal(ageFromBirthDate('02/29/2000',at(2028,2,28)),27);
  assert.equal(ageFromBirthDate('02/29/2000',at(2028,2,29)),28);
  assert.equal(ageFromBirthDate('02/29/2000',at(2029,3,1)),29);
});
test('Overview uses dynamic age and local midnight refresh without saving calculated age',()=>{
  const source=readFileSync(new URL('../workspace.js',import.meta.url),'utf8');
  assert.match(source,/ageFromBirthDate\(dob\)/);
  assert.match(source,/\(Age: /);
  assert.match(source,/nextMidnight/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/clearTimeout\(ageRefreshTimer\)/);
});
