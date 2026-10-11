import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const sourceFile = new URL('../medicare-intake.js', import.meta.url);
const cssFile = new URL('../medicare-intake.css', import.meta.url);
const js = await readFile(sourceFile, 'utf8');

test('all thirteen intake sections show a separate Already in CRM checkbox and a skip action', () => {
  const start = js.indexOf('const block = ');
  const end = js.indexOf('const repeatRow', start);
  assert.ok(start >= 0 && end > start, 'Expected step generator');
  const block = runInNewContext(js.slice(start, end) + '\nblock;', {
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  });
  for (let step = 1; step <= 13; step++) {
    const html = block(step, 'Step title ' + step, '<input name="example">');
    assert.match(html, new RegExp('data-mi-skip-toggle="' + step + '"'));
    assert.match(html, /Already in CRM/);
    assert.match(html, /data-mi-skip-panel hidden/);
    assert.match(html, /class="mi-step-fields"/);
    assert.match(html, new RegExp('data-mi-next="' + step + '"'));
    assert.match(html, step === 13 ? /Finish & Save/ : new RegExp('Skip to Step ' + (step + 1)));
  }
});

test('skipping a section preserves its saved flag and hides its inputs without deleting entered values', () => {
  assert.match(js, /out\.already_in_crm = skippedSections\(\)/);
  assert.match(js, /Array\.isArray\(data\.already_in_crm\)/);
  assert.match(js, /if \(fields\) fields\.hidden = skip/);
  assert.match(js, /if \(panel\) panel\.hidden = !skip/);
  assert.match(js, /checkbox\.checked && step/);
  assert.match(js, /showSkipSections\(\)/);
});

test('skipped sections cannot overwrite previously stored CRM information', () => {
  assert.match(js, /!createdClient && !isSkipped\(1\)/);
  assert.match(js, /!isSkipped\(1\) && sec\.ssn/);
  assert.match(js, /!isSkipped\(3\) && sec\.medicare_number/);
  assert.match(js, /!isSkipped\(4\) && \(sec\.medicaid_number/);
  assert.match(js, /!isSkipped\(11\) && \(bankReady/);
  assert.match(js, /!isSkipped\(7\)\) await uploadFiles/);
  assert.match(js, /!isSkipped\(3\) && \(value\.part_a/);
  assert.match(js, /!isSkipped\(4\) && \(value\.has_medicaid/);
  assert.match(js, /if \(!isSkipped\(5\) && out\.soa_signed/);
  assert.match(js, /if \(!isSkipped\(12\) && out\.needs_phone/);
});

test('skipping client details on a new intake requires selecting an accessible existing CRM client', () => {
  assert.match(js, /select\('id,first_name,last_name,phone,date_of_birth'\)/);
  assert.match(js, /Step 1: Select an existing CRM client before skipping Client Information/);
  assert.match(js, /row = \{client_id:linkedClient\.id\}/);
  assert.match(js, /data-mi-client-select/);
});

test('skip controls are visible outside each accordion body and on mobile screens', async () => {
  const css = await readFile(cssFile, 'utf8');
  assert.match(css, /\.mi-already-in-crm/);
  assert.match(css, /\.mi-step-fields\[hidden\]/);
  assert.match(css, /\.mi-skip-panel\[hidden\]/);
  assert.match(css, /@media\(max-width:750px\)/);
});
