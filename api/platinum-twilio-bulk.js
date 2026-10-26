import { adminRest, getClients, normalizeUsPhone, requireCrmUser, sendClientSms } from '../server/platinum-sms.js';

const MAX_RECIPIENTS = 250;
const CONCURRENCY = 10;

async function runPool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return results;
}

export async function POST(request) {
  try {
    const user = await requireCrmUser(request);
    const payload = await request.json().catch(() => ({}));
    const rawIds=Array.isArray(payload.clientIds)?payload.clientIds.map(String).filter(Boolean):[];
    const ids = Array.from(new Set(rawIds));
    const body = String(payload.body || '').trim();
    if(!payload.consentConfirmed) return Response.json({error:'Confirm recipient permission and opt-out compliance before sending bulk text.'},{status:400});
    if(ids.length>MAX_RECIPIENTS) return Response.json({error:'A maximum of 250 clients may be texted at once. No texts sent.'},{status:400});
    if (!ids.length) return Response.json({ error: 'Choose at least one client.' }, { status: 400 });
    if (!body) return Response.json({ error: 'Enter a message.' }, { status: 400 });
    if (body.length > 1500) return Response.json({ error: 'Message is too long.' }, { status: 400 });

    const clients = await getClients(ids, user);
    if (clients.length !== ids.length) return Response.json({error:'One or more selected clients are unavailable. No messages were sent.'},{status:404});
    const failures = [];
    // STOP / START are honored even when a user accidentally selects an
    // opted-out client. Twilio's own opt-out control remains in effect.
    const suppressed=await adminRest('/rest/v1/rpc/bulk_sms_opted_out_clients',{
      method:'POST',body:{p_ids:ids}
    });
    const stoppedIds=new Set(Array.isArray(suppressed)?suppressed.map(x=>x.client_id):[]);
    const seenPhones=new Set();
    const eligible=[];
    for(const client of clients){
      const name=[client?.first_name,client?.last_name].filter(Boolean).join(' ')||'Client';
      const phone=normalizeUsPhone(client?.phone||'');
      if(String(client.status||'').toLowerCase()==='deceased'){
        failures.push(name+': Deceased client — skipped.');continue;
      }
      if(!phone){failures.push(name+': Invalid phone number — skipped.');continue;}
      if(stoppedIds.has(client.id)){failures.push(name+': Text opt-out recorded — skipped.');continue;}
      if(seenPhones.has(phone)){failures.push(name+': Duplicate telephone number — skipped.');continue;}
      seenPhones.add(phone);eligible.push(client);
    }
    if(!eligible.length)return Response.json({ok:false,requested:ids.length,sent:0,failed:failures.length,failures:failures.slice(0,20)},
      {status:200});
    const results = await runPool(eligible, client => sendClientSms(client, user.id, body));
    let sent = 0;
    results.forEach((result, index) => {
      if (result.ok) sent += 1;
      else {
        const client = eligible[index];
        const name = [client?.first_name, client?.last_name].filter(Boolean).join(' ') || 'Client';
        failures.push(`${name}: ${result.error instanceof Error ? result.error.message : 'send failed'}`);
      }
    });

    return Response.json({
      ok: failures.length === 0,
      requested: ids.length,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 20)
    }, { status: sent ? 200 : 502 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to send mass text.' }, { status });
  }
}

export const config = { maxDuration: 60 };
