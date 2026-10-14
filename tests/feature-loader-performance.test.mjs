import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFeatureLoader} from '../feature-loader.js';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('concurrent views share one lazy feature import, and failed loads are retryable',async()=>{
  let calls=0;
  const ensure=createFeatureLoader({
    client:async()=>{calls++;return {client:true};},
    campaign:()=>Promise.resolve('campaign')
  });
  const values=await Promise.all([ensure('client'),ensure('client'),ensure('client')]);
  assert.equal(calls,1);
  assert.deepEqual(values,[{client:true},{client:true},{client:true}]);
  assert.equal(await ensure('campaign'),'campaign');
  await assert.rejects(ensure('missing'),/Unknown Arctos feature/);
  let tries=0;
  const retry=createFeatureLoader({lead:()=>{
    tries++;return tries===1?Promise.reject(Error('network')):Promise.resolve('ready');
  }});
  await assert.rejects(retry('lead'),/network/);
  assert.equal(await retry('lead'),'ready');
  assert.equal(tries,2);
});
test('separate observer groups are imported for the correct Arctos workflows only',async()=>{
 const [start,client,campaign,lead,workspace] = await Promise.all([
  read('workspace-start.js'),read('workspace-extensions.js'),read('workspace-campaign-extensions.js'),
  read('workspace-lead-extensions.js'),read('workspace.js')
 ]);
 assert.match(start,/client: \(\) => import\('\.\/workspace-extensions/);
 assert.match(start,/campaign: \(\) => import\('\.\/workspace-campaign-extensions/);
 assert.match(start,/lead: \(\) => import\('\.\/workspace-lead-extensions/);
 assert.match(client,/client-health-tabs\.js/);
 assert.match(client,/client-files-hub\.js/);
 assert.doesNotMatch(client,/campaign-stage-layout\.js|leads-icon-screen\.js|commission-icon-screen\.js/);
 assert.match(client,/client-summary-commissions\.js/);
 assert.match(campaign,/campaign-stage-layout\.js/);
 assert.match(campaign,/campaigns-smooth-load\.js/);
 assert.doesNotMatch(campaign,/client-medicare-assets\.js|lead-dob-format\.js/);
 assert.match(lead,/leads-icon-screen\.js/);
 assert.match(lead,/lead-dob-format\.js/);
 assert.match(workspace,/if \(ensureCampaignFeatures\) await ensureCampaignFeatures\(\)/);
 assert.match(workspace,/if \(ensureLeadFeatures\) await ensureLeadFeatures\(\)/);
 assert.match(workspace,/\.then\(\(\) => openClientReady\(id\)\)/);
 assert.match(workspace,/if \(route === 'clients'\)/);
});
