import crypto from 'node:crypto';

const SUPABASE_URL = 'https://sggzshbdfgkyyvxbebul.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wLDvDmI4pmIcADkUlc6-LQ_RWMoQU1Y';
export const ISAIAH_AGENT_ID = '8099c3d2-dff1-4a34-8c90-06931f64177e';
const INTEGRATION_START = '2026-09-15T07:50:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function normalizeUsPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

export function phone10(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// The existing provider credentials stay in Arctos. The scoped data bridge
// can read client summaries and write SMS only in Platinum's own database.
export async function adminRest(path, { method = 'GET', body, prefer = '' } = {}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/platinum-sms-data`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json',
      'x-platinum-sms-key': required('PLATINUM_SMS_BRIDGE_KEY') },
    body: JSON.stringify({ path, method, body, prefer }),
    cache: 'no-store', signal: AbortSignal.timeout(25000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error || 'Platinum texting database is unavailable.'), { status: response.status });
  return payload;
}

export async function requireCrmUser(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sign in to Platinum Financial first.'), { status: 401 });

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    },
    cache: 'no-store', signal: AbortSignal.timeout(25000)
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user?.id) throw Object.assign(new Error('Your Platinum Financial session has expired. Sign in again.'), { status: 401 });

  const profiles = await adminRest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,active&limit=1`);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile?.active) throw Object.assign(new Error('This Platinum Financial user is not active.'), { status: 403 });
  return { id: user.id, email: user.email || '', profile };
}

export function canAccessClient(user, client) {
  return Boolean(user?.id && user?.profile?.active && client?.assigned_agent_id === ISAIAH_AGENT_ID &&
    (['owner','admin'].includes(user.profile.role) || client.assigned_agent_id === user.id));
}
export function requireCrmAdmin(user) {
  if (!user?.profile?.active || !['owner','admin'].includes(user.profile.role)) {
    throw Object.assign(new Error('Owner or administrator access is required.'), { status:403 });
  }
}
export async function getClient(clientId, user) {
  if (!UUID.test(String(clientId || ''))) return null;
  const rows = await adminRest(`/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,first_name,last_name,phone,assigned_agent_id,status&limit=1`);
  const client = Array.isArray(rows) ? rows[0] || null : null;
  return canAccessClient(user, client) ? client : null;
}

export async function getClients(clientIds, user) {
  const ids = Array.from(new Set((clientIds || []).map(String).filter(id => UUID.test(id)))).slice(0, 250);
  if (!ids.length) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    const data = await adminRest(`/rest/v1/clients?id=in.(${chunk.join(',')})&select=id,first_name,last_name,phone,assigned_agent_id,status`);
    if (Array.isArray(data)) rows.push(...data);
  }
  return rows.filter(client => canAccessClient(user, client));
}

async function getAllClientPhones() {
  const clients = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await adminRest(`/rest/v1/clients?select=id,first_name,last_name,phone,assigned_agent_id,status&assigned_agent_id=eq.${ISAIAH_AGENT_ID}&phone=not.is.null&order=id&limit=500&offset=${offset}`);
    if (!Array.isArray(rows)) throw new Error('Unable to load Isaiah clients.');
    clients.push(...rows);
    if (rows.length < 500) return clients;
  }
}

function twilioConfig() {
  return {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    messagingServiceSid: required('TWILIO_MESSAGING_SERVICE_SID'),
    officeNumber: normalizeUsPhone(required('TWILIO_PHONE_NUMBER'))
  };
}

async function twilioRequest(pathOrUrl, { method = 'GET', form } = {}) {
  const { accountSid, authToken } = twilioConfig();
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `https://api.twilio.com${pathOrUrl}`;
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['api.twilio.com', 'messaging.twilio.com'].includes(target.hostname)) throw new Error('Invalid messaging provider URL.');
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: form ? form.toString() : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(25000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.message || `Twilio request failed (${response.status}).`));
    error.code = payload?.code ? String(payload.code) : '';
    throw error;
  }
  return payload;
}

function dateFloor(daysBack) {
  const d = new Date(Date.now() - daysBack * 86400000);
  return d.toISOString().slice(0, 10);
}

async function listTwilioMessages(filters = {}, { daysBack = 365, maxPages = 3, pageSize = 200 } = {}) {
  const { accountSid } = twilioConfig();
  const params = new URLSearchParams();
  params.set('PageSize', String(pageSize));
  params.set('DateSent>=', dateFloor(daysBack));
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  let next = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json?${params.toString()}`;
  const messages = [];
  for (let page = 0; next && page < maxPages; page += 1) {
    const payload = await twilioRequest(next);
    if (Array.isArray(payload.messages)) messages.push(...payload.messages);
    next = payload.next_page_uri || '';
  }
  return messages;
}

function twilioOccurredAt(message) {
  const value = message.date_sent || message.date_created || message.date_updated;
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function storedMessage(message, client, userId) {
  const { officeNumber } = twilioConfig();
  const from = normalizeUsPhone(message.from || '');
  const to = normalizeUsPhone(message.to || '');
  const direction = from === officeNumber ? 'outbound' : 'inbound';
  return {
    client_id: client.id,
    origin: 'platinum_twilio_sync',
    user_id: client.assigned_agent_id || userId || null,
    direction,
    body: String(message.body || ''),
    from_number: from || String(message.from || '') || null,
    to_number: to || String(message.to || '') || null,
    twilio_message_sid: String(message.sid || ''),
    status: String(message.status || (direction === 'inbound' ? 'received' : 'sent')),
    error_code: message.error_code === null || message.error_code === undefined ? null : String(message.error_code),
    error_message: message.error_message ? String(message.error_message) : null,
    occurred_at: twilioOccurredAt(message),
    last_synced_at: new Date().toISOString()
  };
}

async function upsertTwilioMessages(records) {
  const clean = records.filter(row => row.twilio_message_sid && row.client_id);
  if (!clean.length) return 0;
  for (let i = 0; i < clean.length; i += 100) {
    await adminRest('/rest/v1/client_sms_messages?on_conflict=twilio_message_sid', {
      method: 'POST',
      body: clean.slice(i, i + 100),
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }
  await adminRest(`/rest/v1/client_sms_messages?direction=eq.inbound&read_at=is.null&occurred_at=lt.${encodeURIComponent(INTEGRATION_START)}`, {
    method: 'PATCH',
    body: { read_at: INTEGRATION_START, updated_at: new Date().toISOString() },
    prefer: 'return=minimal'
  });
  return clean.length;
}

export async function syncClientMessages(client, userId) {
  const clientPhone = normalizeUsPhone(client?.phone || '');
  if (!clientPhone) return { synced: 0, reason: 'no_phone' };
  const matches = (await getAllClientPhones()).filter(row => normalizeUsPhone(row.phone) === clientPhone);
  if (client?.assigned_agent_id !== ISAIAH_AGENT_ID || matches.length !== 1 || matches[0].id !== client.id) return { synced: 0, reason: 'ambiguous_phone' };
  const { officeNumber } = twilioConfig();
  const [toClient, fromClient] = await Promise.all([
    listTwilioMessages({ To: clientPhone, From: officeNumber }, { daysBack: 365, maxPages: 3, pageSize: 200 }),
    listTwilioMessages({ From: clientPhone, To: officeNumber }, { daysBack: 365, maxPages: 3, pageSize: 200 })
  ]);
  const seen = new Map();
  for (const message of [...toClient, ...fromClient]) {
    const from = normalizeUsPhone(message.from || '');
    const to = normalizeUsPhone(message.to || '');
    if (!message.sid) continue;
    if (!((from === officeNumber && to === clientPhone) || (from === clientPhone && to === officeNumber))) continue;
    seen.set(message.sid, message);
  }
  const records = Array.from(seen.values()).map(message => storedMessage(message, client, userId));
  return { synced: await upsertTwilioMessages(records) };
}

export async function syncRecentMessages(userId, user) {
  const { officeNumber } = twilioConfig();
  const [messages, clients] = await Promise.all([
    listTwilioMessages({}, { daysBack: 45, maxPages: 4, pageSize: 200 }),
    getAllClientPhones()
  ]);
  const phoneMap = new Map();
  for (const client of clients) {
    const key = phone10(client.phone);
    if (!key) continue;
    if (!phoneMap.has(key)) phoneMap.set(key, []);
    phoneMap.get(key).push(client);
  }
  const records = [];
  let skipped = 0;
  for (const message of messages) {
    const from = normalizeUsPhone(message.from || '');
    const to = normalizeUsPhone(message.to || '');
    if (from !== officeNumber && to !== officeNumber) continue;
    const counterpart = from === officeNumber ? to : from;
    const matches = phoneMap.get(phone10(counterpart)) || [];
    if (matches.length !== 1) { skipped += 1; continue; }
    if (!canAccessClient(user, matches[0])) continue;
    records.push(storedMessage(message, matches[0], userId));
  }
  return { synced: await upsertTwilioMessages(records), skipped };
}

export async function sendClientSms(client, userId, messageBody) {
  if (client?.assigned_agent_id !== ISAIAH_AGENT_ID) throw Object.assign(new Error('Client not found.'), { status: 404 });
  if (String(client.status || '').toLowerCase() === 'deceased') throw Object.assign(new Error('Deceased clients cannot be texted.'), { status: 400 });
  const stopped = await adminRest('/rest/v1/rpc/bulk_sms_opted_out_clients', { method: 'POST', body: { p_ids: [client.id] } });
  if (stopped?.some(row => row.client_id === client.id)) throw Object.assign(new Error('This client has opted out of texts.'), { status: 400 });
  const body = String(messageBody || '').trim();
  if (!body) throw new Error('Enter a message.');
  if (body.length > 1500) throw new Error('Message is too long.');
  const to = normalizeUsPhone(client?.phone || '');
  if (!to) throw new Error('This client does not have a valid U.S. mobile number.');
  const { accountSid, messagingServiceSid, officeNumber } = twilioConfig();
  const now = new Date().toISOString();
  const inserted = await adminRest('/rest/v1/client_sms_messages', {
    method: 'POST',
    body: {
      client_id: client.id,
      user_id: userId,
      direction: 'outbound',
      body,
      from_number: officeNumber || null,
      to_number: to,
      status: 'sending',
      read_at: now,
      origin: 'platinum',
      occurred_at: now,
      updated_at: now
    },
    prefer: 'return=representation'
  });
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (!row?.id) throw new Error('Unable to create the Platinum text record.');

  try {
    const form = new URLSearchParams();
    form.set('To', to);
    form.set('Body', body);
    form.set('MessagingServiceSid', messagingServiceSid);
    form.set('From', officeNumber);
    form.set('StatusCallback', 'https://mh.mayerig.com/api/platinum-twilio-status');
    const sent = await twilioRequest(`/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, { method: 'POST', form });
    const occurredAt = twilioOccurredAt(sent);
    await adminRest(`/rest/v1/client_sms_messages?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: {
        twilio_message_sid: sent.sid || null,
        status: sent.status || 'queued',
        from_number: normalizeUsPhone(sent.from || '') || officeNumber || null,
        to_number: normalizeUsPhone(sent.to || '') || to,
        occurred_at: occurredAt,
        last_synced_at: now,
        updated_at: now
      },
      prefer: 'return=minimal'
    });
    return { id: row.id, sid: sent.sid || '', status: sent.status || 'queued', to };
  } catch (error) {
    await adminRest(`/rest/v1/client_sms_messages?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: {
        status: 'failed',
        error_code: error?.code ? String(error.code) : null,
        error_message: error instanceof Error ? error.message : 'Unable to send text.',
        updated_at: new Date().toISOString()
      },
      prefer: 'return=minimal'
    }).catch(() => null);
    throw error;
  }
}

export function publicRequestUrl(request) {
  const parsed = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || parsed.host;
  const proto = request.headers.get('x-forwarded-proto') || parsed.protocol.replace(':', '') || 'https';
  return `${proto}://${host}${parsed.pathname}${parsed.search}`;
}

export function validateTwilioRequest(url, params, signature) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  if (!authToken || !signature) return false;
  const keys = Array.from(new Set(Array.from(params.keys()))).sort();
  let payload = url;
  for (const key of keys) {
    const values = params.getAll(key).sort();
    for (const value of values) payload += `${key}${value}`;
  }
  const expected = crypto.createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function validServiceProbe(request) {
  const expected = process.env.PLATINUM_SMS_BRIDGE_KEY || '';
  const supplied = request.headers.get('x-platinum-sms-key') || '';
  if (!expected || !supplied) return false;
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)); } catch { return false; }
}

export async function smsConnectionStatus() {
  const { messagingServiceSid, officeNumber } = twilioConfig();
  const [senders, clients] = await Promise.all([
    twilioRequest(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers?PageSize=100`),
    getAllClientPhones()
  ]);
  const sender = (senders.phone_numbers || []).find(row => normalizeUsPhone(row.phone_number) === officeNumber);
  if (!sender) throw new Error('The office sender is not connected to the messaging service.');
  return { connected: true, phoneNumber: officeNumber, clientCount: clients.length, scope: 'isaiah', maxRecipients: 250 };
}
