import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const startup=source('workspace-start.js');
const texts=source('client-texting.js');
const call=source('ringcentral-ui-adjustments.js');
const workspace=source('workspace.js');
const dialogs=source('dialogs.js');

test('text and call footer actions initialize at login, without visiting Messages',()=>{
  assert.match(startup,/^import '\.\/ringcentral-ui-adjustments\.js\?v=client-footer-always-1';/m);
  assert.doesNotMatch(startup,/\.then\(\(\) => import\('\.\/ringcentral-ui-adjustments\.js/);
  assert.match(call,/import \{ smsAuthHeaders \} from '\.\/client-texting\.js'/);
  assert.match(texts,/Dialogs\.prototype\.open = function/);
  assert.match(call,/observeClientDialogs\(attachFooterButton/);
});
test('footer buttons use ID of loaded client instead of last focused search button',()=>{
  assert.match(dialogs,/if \(clientId\) node\.dataset\.clientId/);
  assert.match(workspace,/kind: 'client-dialog', clientId: id \|\| null/);
  assert.match(texts,/options\.clientId \|\| invoker/);
  assert.match(texts,/node\.dataset\.smsClientId = id/);
  assert.match(call,/dialog\.dataset\.smsClientId/);
});
test('new client save updates and enables text and call actions immediately',()=>{
  assert.match(workspace,/d\.node\.dataset\.clientId = saved\.id/);
  assert.match(workspace,/if \(titleNode && savedName\) titleNode\.textContent = savedName;\s*return saved;/);
  assert.match(texts,/result\?\.id \|\| controller\?\.node\?\.dataset\.clientId/);
  assert.match(texts,/controller\?\.__setSmsClientId\?\.\(id\)/);
  assert.match(call,/attributes:\['data-sms-client-id'\]/);
});
