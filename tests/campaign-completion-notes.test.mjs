import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { CONTACT_OUTCOMES, outcomeLabel, isScheduledOutcome } from '../campaigns-model.js';
import { campaignUpdateOptions, RETURN_TO_STEP_ONE } from '../campaign-return-step-one.js';
import { createCampaignRepository } from '../campaigns-repository.js';

const ui=readFileSync(new URL('../campaigns-ui.js',import.meta.url),'utf8');
const stage=readFileSync(new URL('../campaign-stage-layout.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../campaign-stage-layout.css',import.meta.url),'utf8');

test('Face to Face Meeting and Completed are distinct unscheduled contact outcomes',()=>{
  assert.deepEqual(CONTACT_OUTCOMES.filter(([key])=>['face_to_face','completed'].includes(key)),[
    ['face_to_face','Face to Face Meeting'],['completed','Completed']
  ]);
  assert.equal(outcomeLabel('face_to_face'),'Face to Face Meeting');
  assert.equal(outcomeLabel('completed'),'Completed');
  assert.equal(outcomeLabel('note'),'Note Added');
  assert.equal(isScheduledOutcome('face_to_face'),false);
  assert.equal(isScheduledOutcome('completed'),false);
});
test('Completed cards remain archived in Completed until explicitly reset',()=>{
  assert.deepEqual(campaignUpdateOptions({contact_status:'completed'}),[[RETURN_TO_STEP_ONE,'Return to Step 1']]);
  assert.match(stage,/status === 'completed'/);
  assert.match(stage,/grouped\.completed\.length/);
  assert.match(stage,/counterButton\('completed'/);
});
test('Face to Face has an independently browsable counter',()=>{
  assert.match(stage,/counterButton\('face_to_face'/);
  assert.match(stage,/grouped\.face_to_face/);
  assert.match(css,/data-cmp-counter-view=face_to_face/);
});
test('Each client card has a collapsible note and a Save Note action',()=>{
  assert.match(ui,/data-cmp-card-notes/);
  assert.match(ui,/data-cmp-note-input/);
  assert.match(ui,/data-cmp-save-note/);
  assert.match(ui,/api\.saveMemberNote/);
  assert.match(ui,/state\.noteOpen/);
  assert.match(ui,/Campaign Note \(optional\)/);
  assert.match(css,/grid-column:1\/-1/);
});
test('Standalone note saves use a server-validated RPC, not fake local state',async()=>{
  const calls=[];
  const db={rpc:async(name,payload)=>{calls.push({name,payload});return {data:{saved:true},error:null};}};
  const api=createCampaignRepository(db);
  const payload={p_member_id:'member-123',p_operation_id:'operation-123',p_expected_version:5,p_note:'In-person meeting confirmed'};
  assert.deepEqual(await api.saveMemberNote(payload),{saved:true});
  assert.deepEqual(calls,[{name:'campaign_save_member_note',payload}]);
  await assert.rejects(api.saveMemberNote({...payload,p_note:' '}),/Enter a note/);
  assert.equal(calls.length,1);
});
