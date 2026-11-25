import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const ws=read('workspace.js'),summary=read('client-summary-commissions.js');
const search=read('client-search.js'),bulk=read('api/twilio-bulk.js');
const style=read('client-summary-commissions.css');

test('Birthdays remain the fifth clickable card directly beside Deceased Clients',()=>{
 assert.match(summary,/statCard\('deceased','Deceased Clients'\),statCard\('birthdays','Birthdays'\)/);
 assert.match(summary,/data-open-birthdays/);
 assert.match(summary,/client_birthdays_this_month/);
 assert.match(summary,/timeZone:'America\/Chicago'/);
 assert.match(style,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});
test('Birthday list is live current-month and excludes deceased clients',()=>{
 assert.match(search,/id="client-birthday-list"/);
 assert.match(search,/data-close-birthdays/);
 assert.match(ws,/function bindBirthdayArchive\(\)/);
 assert.match(ws,/async function loadBirthdays\(\)/);
 assert.match(ws,/supabase\.rpc\('client_birthdays_this_month'\)/);
 assert.match(ws,/\.toLowerCase\(\)!=='deceased'/);
 assert.match(ws,/birthdayMonthPoll=setInterval\(refreshBirthdayMonth,60_000\)/);
 assert.match(ws,/clearInterval\(birthdayMonthPoll\)/);
 assert.match(ws,/function drawBirthdays\(\)/);
});
test('Client Records offers campaign-like checkbox SMS selection across searches',()=>{
 assert.match(search,/data-start-mass-text/);
 assert.match(ws,/function enhanceMassTextResults\(host,rows=\[\]\)/);
 assert.match(ws,/const selected=state\.massText\.selected/);
 assert.match(ws,/data-sms-select-all/);
 assert.match(ws,/data-sms-compose/);
 assert.match(ws,/data-sms-done/);
 assert.match(ws,/data-birthday-text-id/);
 assert.match(ws,/function openMassTextComposer\(\)/);
});
test('Mass SMS is user-confirmed and server-gated against deceased, STOP, duplicate and unlicensed numbers',()=>{
 const mass=readFileSync(new URL('../mass-text.js',import.meta.url),'utf8');
 assert.match(mass,/name="consent" required/);
 assert.match(mass,/api\/twilio-send/);
 assert.match(mass,/operationId:operation/);
 assert.match(mass,/seen\.has\(phone\)/);
 assert.match(bulk,/if\(!payload\.consentConfirmed\)/);
 assert.match(bulk,/bulk_sms_opted_out_clients/);
 assert.match(bulk,/String\(client\.status\|\|''\)\.toLowerCase\(\)==='deceased'/);
 assert.match(bulk,/seenPhones\.has\(phone\)/);
 assert.match(bulk,/MAX_RECIPIENTS = 250/);
});
