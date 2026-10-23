import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workspace = readFileSync(new URL('../workspace.js', import.meta.url),'utf8');
const views = readFileSync(new URL('../views.js', import.meta.url),'utf8');
const campaigns = readFileSync(new URL('../campaigns-ui.js', import.meta.url),'utf8');

test('Client at a Glance Add to Campaign has its own reliable direct picker',()=>{
  assert.match(views,/data-client-add-campaign/);
  assert.match(views,/data-client-campaign-status/);
  assert.match(workspace,/function openClientCampaignPicker\(client, onAdded/);
  assert.match(workspace,/openClientCampaignPicker\(\{\.\.\.record,status:selectedStatus\}/);
  assert.match(workspace,/repository\.campaigns/);
  // Do not wait for optional campaign-page observer plug-ins to load from the client editor.
  assert.doesNotMatch(workspace,/campaignShortcut\?\.addEventListener\('click',async/);
  assert.match(workspace,/footer: saveFooter\('Add to Campaign'\)\.replace\('data-save="stay"', 'data-save="close"'\)/);
});
test('Picker supports existing and new active campaigns and confirms actual membership',()=>{
  assert.match(workspace,/api\.list\(\{status: 'active', cursor\}\)/);
  assert.match(workspace,/api\.existingClients\(id, \[client\.id\]\)/);
  assert.match(workspace,/api\.addClients\(id, \[client\.id\], repository\.user\.id\)/);
  assert.match(workspace,/api\.save\(\{/);
  assert.match(workspace,/This client is already in/);
  assert.match(workspace,/Client added to/);
  assert.match(workspace,/Deceased clients cannot be added to a campaign/);
});
test('Bulk clients search Add to Campaign does not treat DOM click event as a client array',()=>{
  assert.match(campaigns,/const fromClient = Array\.isArray\(clientsOverride\)/);
  assert.match(campaigns,/const clients=fromClient \? clientsOverride : \[\.\.\.selection\.values\(\)\]/);
  assert.match(campaigns,/if\(!fromClient\)selection\.clear\(\)/);
});
