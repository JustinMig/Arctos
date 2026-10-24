import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarRefreshInterval} from '../connection-policy.js';
test('calendar refresh slows on weak links or data saver and stops polling offline',()=>{
 assert.equal(calendarRefreshInterval(undefined),15000);
 assert.equal(calendarRefreshInterval({effectiveType:'4g'}),15000);
 for(const effectiveType of ['slow-2g','2g','3g'])assert.equal(calendarRefreshInterval({effectiveType}),60000);
 assert.equal(calendarRefreshInterval({saveData:true}),60000);
 assert.equal(calendarRefreshInterval(undefined,false),Infinity);
});
