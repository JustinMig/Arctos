import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_BORN_IN_OPTIONS } from '../us-states.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('state of birth dropdown lists all states and DC with name and abbreviation', () => {
  assert.equal(STATE_BORN_IN_OPTIONS.length, 52);
  assert.deepEqual(STATE_BORN_IN_OPTIONS[0], ['', 'Select state…']);
  assert.deepEqual(STATE_BORN_IN_OPTIONS.find(([code]) => code === 'MS'), ['MS', 'Mississippi (MS)']);
  assert.deepEqual(STATE_BORN_IN_OPTIONS.find(([code]) => code === 'DC'), ['DC', 'District of Columbia (DC)']);
  assert.equal(new Set(STATE_BORN_IN_OPTIONS.slice(1).map(([code]) => code)).size, 51);
});

test('client overview places birthplace immediately below SSN and saves it', () => {
  const view = read('../views.js');
  const layout = read('../client-intake-sections.js');
  const repo = read('../supabase-repository.js');
  assert.match(view, /input\('ssn',[^\n]+\n\s*select\('state_born_in', 'State Born In', STATE_BORN_IN_OPTIONS\)/);
  assert.match(layout, /demographics\.append\(ssnField\);[\s\S]*?demographics\.append\(birthplaceField\)/);
  assert.match(repo, /state_born_in: clean\(record\.state_born_in\)/);
});

test('Medicare intake preserves the state of birth in the saved intake and client', () => {
  const intake = read('../medicare-intake.js');
  assert.match(intake, /'veteran','state_born_in'/);
  assert.match(intake, /choice\('state_born_in','State Born In',STATE_BORN_IN_OPTIONS\.slice\(1\),true\)/);
  assert.match(intake, /state_born_in:value\.state_born_in \|\| null/);
});
