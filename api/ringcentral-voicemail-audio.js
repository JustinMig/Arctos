import {adminRest,requireCrmUser,getClient} from '../server/communications.js';

const BRIDGE='https://crm.mayerig.com/api/mh-ringcentral/voicemails';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request){
 try{
  const user=await requireCrmUser(request);
  const id=new URL(request.url).searchParams.get('id')||'';
  if(!UUID.test(id))return Response.json({error:'Invalid voicemail record.'},{status:400});
  const data=await adminRest('/rest/v1/ringcentral_voicemails?id=eq.'+encodeURIComponent(id)+'&hidden_at=is.null&select=id,client_id,source_voicemail_id&limit=1');
  const row=Array.isArray(data)?data[0]:null;
  if(!row || !await getClient(row.client_id,user))return Response.json({error:'Voicemail is not available.'},{status:404});
  const response=await fetch(BRIDGE+'/'+encodeURIComponent(row.source_voicemail_id),{
   headers:{Authorization:request.headers.get('authorization')||''},
   cache:'no-store',signal:AbortSignal.timeout(28000)
  });
  if(!response.ok){const err=await response.json().catch(()=>({}));return Response.json({error:err.error||'Could not load voicemail.'},{status:response.status});}
  return new Response(response.body,{headers:{
   'Content-Type':response.headers.get('content-type')||'audio/wav',
   'Cache-Control':'private, no-store','Content-Disposition':'inline; filename="voicemail.wav"'
  }});
 }catch(error){return Response.json({error:error?.message||'Unable to stream voicemail.'},{status:Number(error?.status)||500});}
}
