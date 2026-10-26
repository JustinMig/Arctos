import { requireCrmUser, smsConnectionStatus, validServiceProbe } from '../server/platinum-sms.js';
export async function GET(request) {
  try {
    if (!validServiceProbe(request)) await requireCrmUser(request);
    return Response.json(await smsConnectionStatus(), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) { return Response.json({ error: error.message || 'Texting is unavailable.' }, { status: Number(error.status) || 503 }); }
}

export const config = { maxDuration: 60 };
