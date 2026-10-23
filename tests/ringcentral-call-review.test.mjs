import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../ringcentral-call-review.js',import.meta.url),'utf8');
const backend=readFileSync(new URL('../api/ringcentral-voicemail-sync.js',import.meta.url),'utf8');
const audio=readFileSync(new URL('../api/ringcentral-voicemail-audio.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../workspace.js',import.meta.url),'utf8');

test('Call Data offers missed calls and voicemails with a day filter',()=>{
 assert.match(js,/data-review-view="missed"/);
 assert.match(js,/data-review-view="voicemail"/);
 assert.match(js,/data-review-date/);
 assert.match(js,/data-review-all-days/);
 assert.match(js,/data-review-today/);
 assert.match(js,/mh-review-day-heading/);
});
test('Call result classification only marks inbound missed outcomes',()=>{
 const fn=new Function('window','setTimeout',js.replace(/^import .*$/gm,'')+';return {missed,dayKey};');
 const {missed,dayKey}=fn({addEventListener:()=>{}},()=>{});
 assert.equal(missed({direction:'Inbound',result:'Missed'}),true);
 assert.equal(missed({direction:'Inbound',result:'No Answer'}),true);
 assert.equal(missed({direction:'Inbound',result:'Abandoned'}),true);
 assert.equal(missed({direction:'Outbound',result:'Missed'}),false);
 assert.equal(missed({direction:'Inbound',result:'Call connected'}),false);
 assert.equal(dayKey('2026-10-23T03:30:00Z'),'2026-10-22'); // central time
 assert.equal(dayKey('2026-10-23T18:30:00Z'),'2026-10-23');
});
test('review notes, delete and appointment are backed by CRM workflows',()=>{
 assert.match(js,/save_ringcentral_review_note/);
 assert.match(js,/hide_my_communication/);
 assert.match(js,/mig:communications-appointment/);
 assert.match(js,/ringcentral-voicemail-audio\?id=/);
 assert.match(ui,/mig:communications-appointment/);
 assert.match(ui,/openAppointment\(todayKey\(\),null,null,client\)/);
});
test('Sync does not reset hidden state or saved staff notes',()=>{
 assert.doesNotMatch(backend,/hidden_at:\s*null/);
 assert.doesNotMatch(backend,/staff_note:\s*null/);
 assert.match(backend,/getClients\(/);
 assert.match(backend,/requireCrmUser\(/);
 assert.match(audio,/getClient\(row\.client_id,user\)/);
});
