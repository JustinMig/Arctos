
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd(),errors=[],blocked=[];
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1250,height:930}});
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  page.on('dialog',async dialog=>dialog.accept());
  const fixture=fs.readFileSync(path.join(root,'tests/fixtures/athena-supabase.js'));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'){blocked.push(url.href);return route.abort();}
    if(url.pathname==='/athena-harness.html')return route.fulfill({contentType:'text/html',body:
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<link rel="stylesheet" href="/athena-medicare.css"></head><body style="background:#f0f5f7">'+
      '<main id="athena-medicare-host"></main></body></html>'});
    if(url.pathname==='/supabase-client.js')return route.fulfill({contentType:'application/javascript',body:fixture});
    const file=path.resolve(root,'.'+url.pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    const type={'.js':'application/javascript','.css':'text/css'}[path.extname(file)]||'text/plain';
    return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  await page.goto('http://127.0.0.1/athena-harness.html');
  await page.evaluate(async()=>{
    const {createAthenaMedicareFeature}=await import('/athena-medicare.js');
    window.__athenaFeature=createAthenaMedicareFeature();
    window.__athenaFeature.mount(document.querySelector('#athena-medicare-host'));
  });
  assert.equal(await page.locator('[data-at-new]').count(),2);
  await page.locator('[data-at-new="annual_review"]').click();
  assert.equal(await page.locator('[data-at-step]').count(),9);
  await page.locator('[data-at-client-search]').fill('Jane');
  await page.locator('[data-at-select-client]').first().click();
  assert.match(await page.locator('.at-linked').innerText(),/Jane Example/);
  await page.locator('[data-at-step="3"] > summary').click();
  await page.locator('[name="current_plan"]').fill('Synthetic Health PPO');
  await page.locator('[data-at-step="4"] > summary').click();
  await page.locator('[data-at-skip="4"]').check();
  assert.equal(await page.locator('[data-at-step="4"] [data-at-step-fields]').isVisible(),false);
  await page.locator('[data-at-step="9"] > summary').click();
  await page.locator('[name="soa_status"]').selectOption('signed');
  await page.locator('[name="workflow_status"]').selectOption('follow_up');
  await page.locator('[name="followup_date"]').fill('10/20/2026');
  await page.locator('[name="followup_action"]').fill('Confirm doctor network');
  await page.locator('[data-at-save]').first().click();
  await page.waitForFunction(()=>document.querySelector('[data-at-status]')?.textContent.includes('Saved successfully'));
  const first=await page.evaluate(()=>structuredClone(window.__athenaFixture.reviews[0]));
  assert.equal(first.review_kind,'annual_review');
  assert.equal(first.workflow_status,'follow_up');
  assert.equal(first.form_data.current_plan,'Synthetic Health PPO');
  assert.deepEqual(first.form_data.skipped_sections,[4]);
  assert.equal(first.next_contact_date,'2026-10-20');
  assert.equal(await page.evaluate(()=>window.__athenaFixture.clients.length),1);
  await page.locator('[data-at-home]').click();
  await page.locator('[data-at-saved]').click();
  await page.locator('[data-at-open]').click();
  await page.locator('[data-at-step="4"]').waitFor();
  assert.equal(await page.locator('[data-at-skip="4"]').isChecked(),true);
  await page.locator('[data-at-step="9"] > summary').click();
  assert.equal(await page.locator('[name="workflow_status"]').inputValue(),'follow_up');
  await page.locator('[name="workflow_status"]').selectOption('completed');
  await page.locator('[data-at-save]').first().click();
  await page.waitForFunction(()=>window.__athenaFixture.reviews[0]?.workflow_status==='completed');
  await page.locator('[data-at-home]').click();
  await page.locator('[data-at-saved]').click();
  await page.locator('[data-at-delete]').click();
  await page.waitForFunction(()=>window.__athenaFixture.reviews.length===0);
  assert.equal(await page.evaluate(()=>window.__athenaFixture.clients.length),1);

  await page.locator('[data-at-home]').click();
  await page.locator('[data-at-new="new_intake"]').click();
  await page.locator('[name="first_name"]').fill('Synthetic');
  await page.locator('[name="last_name"]').fill('Newcase');
  await page.locator('[name="dob"]').fill('08/23/1961');
  await page.locator('[name="phone"]').fill('6625550188');
  await page.locator('[data-at-step="2"] > summary').click();
  await page.locator('[name="medicare_number"]').fill('1EG4TE5MK73');
  await page.locator('[data-at-files]').setInputFiles({
    name:'synthetic-document.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic test')
  });
  await page.locator('[data-at-save]').first().click();
  await page.waitForFunction(()=>document.querySelector('[data-at-status]')?.textContent.includes('Saved successfully'));
  const output=await page.evaluate(()=>({
    reviews:structuredClone(window.__athenaFixture.reviews),
    clients:structuredClone(window.__athenaFixture.clients),
    docs:structuredClone(window.__athenaFixture.documents),
    vault:structuredClone(window.__athenaFixture.vault)
  }));
  assert.equal(output.reviews.length,1);
  assert.equal(output.reviews[0].review_kind,'new_intake');
  assert.equal(output.reviews[0].form_data.dob,'1961-08-23');
  assert.equal(output.clients.length,2);
  assert.equal(output.docs.length,1);
  assert.equal(output.reviews[0].form_data.medicare_number,undefined);
  assert.equal(output.reviews[0].form_data.card_number,undefined);
  assert.equal(output.vault[output.reviews[0].client_id].medicare_number,'1EG4TE5MK73');
  for(const w of [390,1250]){
    await page.setViewportSize({width:w,height:930});
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+w);
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({scenario:'Synthetic Athena Medicare end-to-end browser',annualReview:'pass',persistedSkip:'pass',followup:'pass',statusUpdate:'pass',deletePreservesClient:'pass',newClient:'pass',secureMedicareVault:'pass',documentUpload:'pass',mobile:'pass',externalRequests:blocked.length,pageErrors:errors.length}));
  await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
