import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ISAIAH_AGENT_ID, canAccessClient } from '../server/platinum-sms.js';
import { POST as send } from '../api/platinum-twilio-send.js';
import { POST as bulk } from '../api/platinum-twilio-bulk.js';
import { GET as sync } from '../api/platinum-twilio-sync.js';
import { POST as status } from '../api/platinum-twilio-status.js';
const clientId='10000000-0000-4000-8000-000000000001';
const otherId='10000000-0000-4000-8000-000000000002';
const dupId='10000000-0000-4000-8000-000000000003';
let clients, messages, stored, providerRequests, optedOut, patches;
const originalFetch=globalThis.fetch;
test.beforeEach(()=>{
  Object.assign(process.env,{TWILIO_ACCOUNT_SID:'ACsynthetic',TWILIO_AUTH_TOKEN:'synthetic-token',TWILIO_MESSAGING_SERVICE_SID:'MGsynthetic',TWILIO_PHONE_NUMBER:'+16625550000',PLATINUM_SMS_BRIDGE_KEY:'a'.repeat(64)});
  clients=[{id:clientId,assigned_agent_id:ISAIAH_AGENT_ID,first_name:'Synthetic',last_name:'Isaiah',phone:'6625550101',status:'active'}, {id:otherId,assigned_agent_id:'20000000-0000-4000-8000-000000000002',first_name:'Synthetic',last_name:'Other',phone:'6625550102',status:'active'}];
  messages=[];stored=[];providerRequests=[];optedOut=[];patches=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);
    if(url.hostname==='sggzshbdfgkyyvxbebul.supabase.co'){
      if(url.pathname==='/auth/v1/user')return Response.json({id:ISAIAH_AGENT_ID});
      assert.equal(url.pathname,'/functions/v1/platinum-sms-data');
      assert.equal(options.headers['x-platinum-sms-key'],'a'.repeat(64));
      const payload=JSON.parse(options.body), path=new URL(payload.path,'https://db.invalid');
      if(path.pathname.endsWith('/profiles'))return Response.json([{id:ISAIAH_AGENT_ID,role:'owner',active:true}]);
      if(path.pathname.endsWith('/clients')){
        let rows=clients;
        const id=path.searchParams.get('id')||'';
        if(id.startsWith('eq.'))rows=rows.filter(c=>c.id===id.slice(3));
        if(id.startsWith('in.'))rows=rows.filter(c=>id.includes(c.id));
        if(path.searchParams.has('assigned_agent_id'))rows=rows.filter(c=>c.assigned_agent_id===ISAIAH_AGENT_ID);
        return Response.json(rows);
      }
      if(path.pathname.includes('bulk_sms_opted_out_clients'))return Response.json(optedOut.map(id=>({client_id:id})));
      if(path.pathname.endsWith('/client_sms_messages')){
        if(payload.method==='POST'){
          const rows=Array.isArray(payload.body)?payload.body:[payload.body];stored.push(...rows);
          return Response.json(rows.map((r,i)=>({id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,...r})));
        }
        if(payload.method==='PATCH'){patches.push(payload);return Response.json(null);}
        return Response.json([]);
      }
      throw new Error('Unexpected DB operation '+payload.path);
    }
    assert.equal(url.hostname,'api.twilio.com');
    providerRequests.push({url,options});
    if(options.method==='POST')return Response.json({sid:'SMsynthetic',status:'queued',from:'+16625550000',to:'+16625550101',date_created:new Date().toISOString()});
    return Response.json({messages,next_page_uri:null});
  };
});
test.after(()=>{globalThis.fetch=originalFetch;});
const request=(body,path='send')=>new Request(`https://mh.mayerig.com/api/platinum-twilio-${path}`,{method:'POST',headers:{authorization:'Bearer synthetic', 'Content-Type':'application/json'},body:JSON.stringify(body)});

test('Platinum rejects an unauthenticated request before any provider access',async()=>{
 const response=await send(new Request('https://mh.mayerig.com/api/platinum-twilio-send',{method:'POST',body:'{}'}));
 assert.equal(response.status,401);assert.equal(providerRequests.length,0);
});
test('even an owner cannot text another agent client',async()=>{
 assert.equal(canAccessClient({id:ISAIAH_AGENT_ID,profile:{active:true,role:'owner'}},clients[1]),false);
 const response=await send(request({clientId:otherId,body:'Synthetic'}));
 assert.equal(response.status,404);assert.equal(providerRequests.length,0);assert.equal(stored.length,0);
});
test('one-to-one texting uses Platinum storage, the pinned sender and Platinum delivery callback',async()=>{
 const response=await send(request({clientId,body:'Synthetic message'}));
 assert.equal(response.status,200);assert.equal(stored[0].client_id,clientId);assert.equal(stored[0].origin,'platinum');
 const form=new URLSearchParams(providerRequests[0].options.body);
 assert.equal(form.get('From'),'+16625550000');
 assert.equal(form.get('StatusCallback'),'https://mh.mayerig.com/api/platinum-twilio-status');
 assert.equal(patches[0].body.twilio_message_sid,'SMsynthetic');
});
test('individual STOP and deceased clients are blocked before sending',async()=>{
 optedOut=[clientId];assert.equal((await send(request({clientId,body:'Synthetic'}))).status,400);
 optedOut=[];clients[0].status='deceased';assert.equal((await send(request({clientId,body:'Synthetic'}))).status,400);
 assert.equal(providerRequests.length,0);assert.equal(stored.length,0);
});
test('bulk permission, maximum and foreign-client checks send nothing on failure',async()=>{
 assert.equal((await bulk(request({clientIds:[clientId],body:'Synthetic'},'bulk'))).status,400);
 assert.equal((await bulk(request({clientIds:[clientId,otherId],body:'Synthetic',consentConfirmed:true},'bulk'))).status,404);
 const ids=Array.from({length:251},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 assert.equal((await bulk(request({clientIds:ids,body:'Synthetic',consentConfirmed:true},'bulk'))).status,400);
 assert.equal(providerRequests.length,0);
});
test('bulk sends only one separate text for a duplicate household number',async()=>{
 clients.push({...clients[0],id:dupId});
 const response=await bulk(request({clientIds:[clientId,dupId],body:'Synthetic',consentConfirmed:true},'bulk'));
 const result=await response.json();assert.equal(result.sent,1);assert.equal(result.failed,1);assert.equal(providerRequests.length,1);
});
test('reply sync ignores foreign, unknown and ambiguous phone numbers',async()=>{
 messages=[{sid:'SMown',from:'+16625550101',to:'+16625550000',body:'Synthetic own',status:'received',date_sent:new Date().toISOString()}, {sid:'SMforeign',from:'+16625550102',to:'+16625550000',body:'Synthetic foreign'}, {sid:'SMunknown',from:'+16625550999',to:'+16625550000',body:'Synthetic unknown'}];
 const response=await sync(new Request('https://mh.mayerig.com/api/platinum-twilio-sync',{headers:{authorization:'Bearer synthetic'}}));
 assert.equal(response.status,200);assert.equal(stored.length,1);assert.equal(stored[0].twilio_message_sid,'SMown');
 clients.push({...clients[0],id:dupId});stored=[];
 await sync(new Request(`https://mh.mayerig.com/api/platinum-twilio-sync?clientId=${clientId}`,{headers:{authorization:'Bearer synthetic'}}));
 assert.equal(stored.length,0);
});
test('delivery callbacks require the provider signature and update only the matching SID',async()=>{
 const url='https://mh.mayerig.com/api/platinum-twilio-status';
 const params=new URLSearchParams({MessageSid:'SMsynthetic',MessageStatus:'delivered'});
 assert.equal((await status(new Request(url,{method:'POST',body:params}))).status,403);
 let signed=url;for(const key of [...params.keys()].sort())signed+=key+params.get(key);
 const signature=crypto.createHmac('sha1','synthetic-token').update(signed).digest('base64');
 const response=await status(new Request(url,{method:'POST',body:params,headers:{'x-twilio-signature':signature}}));
 assert.equal(response.status,200);assert.match(patches[0].path,/twilio_message_sid=eq.SMsynthetic/);assert.equal(patches[0].body.status,'delivered');
});
