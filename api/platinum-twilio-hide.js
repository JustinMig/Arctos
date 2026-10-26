import { adminRest, getClient, requireCrmUser } from '../server/platinum-sms.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request) {
  try {
    const user = await requireCrmUser(request);
    const { kind, id } = await request.json();
    if (!UUID.test(String(id || '')) || !['text','conversation'].includes(kind)) return Response.json({ error: 'Invalid conversation.' }, { status: 400 });
    let clientId = id;
    if (kind === 'text') {
      const rows = await adminRest(`/rest/v1/client_sms_messages?id=eq.${id}&select=id,client_id&limit=1`);
      if (!rows?.[0]) return Response.json({ error: 'Message not found.' }, { status: 404 });
      clientId = rows[0].client_id;
    }
    if (!await getClient(clientId, user)) return Response.json({ error: 'Client not found.' }, { status: 404 });
    const filter = kind === 'text' ? `id=eq.${id}` : `client_id=eq.${clientId}`;
    await adminRest(`/rest/v1/client_sms_messages?${filter}`, { method: 'PATCH', body: { hidden_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error.message || 'Unable to remove conversation.' }, { status: Number(error.status) || 500 }); }
}

export const config = { maxDuration: 60 };
