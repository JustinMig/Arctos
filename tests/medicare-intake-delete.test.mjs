import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('saved Medicare intakes have a separate Delete button without nesting buttons', async () => {
  const js = await read('medicare-intake.js');
  assert.match(js, /class="mi-saved-entry"/);
  assert.match(js, /class="mi-saved-row" data-mi-open=/);
  assert.match(js, /data-mi-delete="' \+ safe\(f\.id\)/);
  assert.match(js, /data-mi-updated="' \+ safe\(f\.updated_at/);
  assert.match(js, /target\.matches\('\[data-mi-delete\]'\)/);
});

test('editing an existing intake allows Delete Form but a new form does not', async () => {
  const js = await read('medicare-intake.js');
  assert.match(js, /function formHTML\(savedIntake = null\)/);
  assert.match(js, /savedIntake\?\.id \? '[^']*data-mi-delete/);
  assert.match(js, /host\.innerHTML = formHTML\(row\)/);
});

test('deletion asks for confirmation and deletes only one form version, not a client', async () => {
  const js = await read('medicare-intake.js');
  const start = js.indexOf('async function deleteIntake(');
  const end = js.indexOf('async function openSaved(', start);
  assert.ok(start >= 0 && end > start);
  const deletion = js.slice(start, end);
  assert.match(deletion, /window\.confirm\(/);
  assert.match(deletion, /cannot be undone/);
  assert.match(deletion, /supabase\.from\('medicare_intakes'\)\.delete\(\)\.eq\('id', id\)/);
  assert.match(deletion, /query\.eq\('updated_at', updatedAt\)/);
  assert.match(deletion, /query\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(deletion, /savedForms\(\{ skipLeaveCheck: true \}\)/);
  assert.doesNotMatch(deletion, /from\('clients'\)|from\('documents'\)|storage\.from|client-banking|client-sensitive/);
});

test('only users allowed to access the related client can delete a Medicare intake', async () => {
  const sql = await read('supabase/migrations/20261011121000_medicare_intakes_delete_policy.sql');
  assert.match(sql, /CREATE POLICY medicare_intakes_delete/);
  assert.match(sql, /ON public\.medicare_intakes/);
  assert.match(sql, /FOR DELETE TO authenticated/);
  assert.match(sql, /USING \(private\.mig_can_access_client\(client_id\)\)/);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY|TO public\b|USING \(true\)/i);
});

test('intake delete actions remain usable on mobile screens', async () => {
  const css = await read('medicare-intake.css');
  assert.match(css, /\.mi-saved-entry/);
  assert.match(css, /\.mi-delete-list/);
  assert.match(css, /\.mi-delete-form/);
  assert.match(css, /@media\(max-width:750px\)/);
});
