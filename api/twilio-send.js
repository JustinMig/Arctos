import {resolveTextAttachment} from '../server/text-attachments.js';
import { getClient, requireCrmUser, sendClientSms } from '../server/communications.js';

export async function POST(request) {
  try {
    const user = await requireCrmUser(request);
    const payload = await request.json().catch(() => ({}));
    if(payload.bulk&&payload.consentConfirmed!==true)return Response.json({error:'Confirm recipient permission before sending.'},{status:400});
    const client = await getClient(payload.clientId, user);
    if (!client) return Response.json({ error: 'Client not found.' }, { status: 404 });
    const media=await resolveTextAttachment(request,'arctos',payload.attachmentId);
    const result = await sendClientSms(client, user.id, payload.body,{...media,operationId:payload.operationId});
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to send text.' }, { status });
  }
}
