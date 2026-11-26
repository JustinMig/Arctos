import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage} from '../api/text-reminders.js';
const from='+16625550101',to='+16625550102';
const message={from,to,sid:'SM'+'1'.repeat(32),direction:'inbound',date_sent:'2026-11-25T14:00:00Z'};
const parse=(body,extra={})=>parseMessage({...message,body,...extra},from,to);
test('commands retain day and time and ordinary texts stay out of the list',()=>{
 assert.equal(parse('Make note: Call John about life Wed at 11am.').description,'Call John about life Wed at 11am.');
 assert.equal(parse('make note, call back').description,'call back');
 for(const body of ['make notebook','Make note: ','Call John','Please make note of this'])assert.equal(parse(body),null);
});
test('only incoming messages from the chosen mobile to the agency number qualify',()=>{
 for(const changes of [{from:to},{to:from},{direction:'outbound-api'},{sid:'invalid'}])assert.equal(parse('make note: hello',changes),null);
 assert.equal(parse('Link Arctos abcdef123456').code,'ABCDEF123456');
});
