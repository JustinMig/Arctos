import {adminRest,requireCrmUser,getClients} from '../server/communications.js';

const BRIDGE='https://crm.mayerig.com/api/mh-ringcentral/voicemails';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request){
 try{
  const user=await requireCrmUser(request);
  const response=await fetch(BRIDGE,{headers:{
   Authorization:request.headers.get('authorization')||'',Accept:'application/json'
  },cache:'no-store',signal:AbortSignal.timeout(25000)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(payload.error||'Unable to sync voicemail.'),{status:response.status});
  const rows=(Array.isArray(payload.voicemails)?payload.voicemails:[]).map(row=>{
   if(!UUID.test(String(row.client_id||''))||!/^\d{1,30}$/.test(String(row.source_voicemail_id||'')))return null;
   const received=new Date(row.received_at||'');
   if(Number.isNaN(received.getTime()))return null;
   return {client_id:row.client_id,source_voicemail_id:String(row.source_voicemail_id),
    received_at:received.toISOString(),from_phone:row.from_phone||null,
    duration_seconds:Math.max(0,Math.round(Number(row.duration_seconds||0))),
    audio_attachment_id:row.audio_attachment_id?String(row.audio_attachment_id):null,
    read_status:row.read_status||null,updated_at:new Date().toISOString()};
  }).filter(Boolean);
  const ids=[...new Set(rows.map(row=>row.client_id))];
  const allowed=new Set();
  for(let i=0;i<ids.length;i+=250)for(const client of await getClients(ids.slice(i,i+250),user))allowed.add(client.id);
  if(rows.some(row=>!allowed.has(row.client_id)))throw Object.assign(new Error('Voicemail data contains an unauthorized client.'),{status:403});
  // Critically: hidden_at and staff_note are OMITTED from upserts. A deleted
  // voicemail stays deleted on every subsequent RingCentral sync.
  for(let i=0;i<rows.length;i+=80)await adminRest('/rest/v1/ringcentral_voicemails?on_conflict=source_voicemail_id',{
   method:'POST',body:rows.slice(i,i+80),prefer:'resolution=merge-duplicates,return=minimal'
  });
  return Response.json({ok:true,matched:rows.length},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return Response.json({error:error?.message||'Voicemail sync failed.'},{status:Number(error?.status)||500});}
}
