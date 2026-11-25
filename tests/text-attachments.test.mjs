import test from 'node:test';
import assert from 'node:assert/strict';
import {sendClientSms} from '../server/communications.js';
const client={id:'10000000-0000-4000-8000-000000000001',phone:'6625550100',status:'active'};
const operation='10000000-0000-4000-8000-000000000002';
test('photo-only sends, file links and retries use the scoped saved message',async()=>{
 const original=globalThis.fetch,old={...process.env},forms=[],writes=[];
 process.env.SUPABASE_SECRET_KEY='test';
 process.env.TWILIO_ACCOUNT_SID='ACtest';process.env.TWILIO_AUTH_TOKEN='test';
 process.env.TWILIO_MESSAGING_SERVICE_SID='MGtest';process.env.TWILIO_PHONE_NUMBER='6625550101';
 let existing=null,stopped=false;
 globalThis.fetch=async(url,init={})=>{
   if(String(url).includes('api.twilio.com')){forms.push(new URLSearchParams(init.body));return Response.json({sid:'SMtest',status:'queued'});}
   if(String(url).includes('bulk_sms_opted_out_clients'))return Response.json(stopped?[{client_id:client.id}]:[]);
   if((init.method||'GET')==='GET')return Response.json(existing?[existing]:[]);
   if(init.method==='POST'){writes.push(JSON.parse(init.body));return Response.json([{id:operation}]);}
   return new Response(null,{status:204});
 };
 try{
   const attachment={id:'file-id',name:'photo.jpg',kind:'photo',url:'https://crm.mayerig.com/f/test'};
   await sendClientSms(client,'actor','',{attachment,mediaUrl:'https://private.invalid/photo',operationId:operation});
   assert.equal(forms[0].get('MediaUrl'),'https://private.invalid/photo');
   assert.equal(forms[0].has('Body'),false);
   assert.deepEqual(writes[0].text_attachment,attachment);
   existing={id:operation,client_id:client.id,body:'',status:'queued',text_attachment:attachment,twilio_message_sid:'SMtest'};
   assert.equal((await sendClientSms(client,'actor','',{attachment,mediaUrl:'https://private.invalid/photo',operationId:operation})).alreadySaved,true);
   assert.equal(forms.length,1,'an identical retry cannot send twice');
   await assert.rejects(()=>sendClientSms({...client,id:'20000000-0000-4000-8000-000000000001'},'actor','',{attachment,mediaUrl:'photo',operationId:operation}),/already in use/);
   existing=null;
   const document={...attachment,kind:'file',name:'file.pdf'};
   await sendClientSms(client,'actor','Document',{attachment:document});
   assert.equal(forms[1].get('Body'),'Document\n'+document.url);
   assert.equal(forms[1].has('MediaUrl'),false);
   stopped=true;
   await assert.rejects(()=>sendClientSms(client,'actor','Message'),/opted out/);
   await assert.rejects(()=>sendClientSms({...client,status:'deceased'},'actor','Message'),/Deceased/);
   assert.equal(forms.length,2);
 }finally{globalThis.fetch=original;for(const name of Object.keys(process.env))if(!(name in old))delete process.env[name];Object.assign(process.env,old);}
});

test('RingCentral call links preserve Windows, Mac and iPhone/iPad dialing',async()=>{
 const {ringCentralHref}=await import('../phone-dialer.js');
 assert.equal(ringCentralHref('6625550100',{userAgent:'Windows',platform:'Win32'}),'https://app.ringcentral.com/r/call?number=16625550100');
 assert.equal(ringCentralHref('6625550100',{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0}),'tel:+16625550100');
 for(const device of [{userAgent:'iPhone like Mac OS X',platform:'iPhone'},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}])assert.equal(ringCentralHref('6625550100',device),'https://app.ringcentral.com/r/call?number=16625550100');
 assert.equal(ringCentralHref('invalid',{userAgent:'Windows'}),'');
});
