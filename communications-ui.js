import {openMassText} from './mass-text.js';
import { syncSms } from './sms-sync.js';
import { communicationsRendered } from './communications-events.js';
import { mhRepository, supabase } from './supabase-repository.js';
import { openClientThread, smsAuthHeaders } from './client-texting.js';

const MH_TEXT_START = '2026-09-15T07:50:00.000Z';
const AUTO_SYNC_MS = 120000;
const SYNC_COOLDOWN_MS = 60000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const when = value => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone:'America/Chicago', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
};
let refreshTimer = null;
let loading = false;
let syncing = false;
let lastSyncAt = 0;

function updateUnreadBadge(unread) {
  const link = document.querySelector('.nav a[href="#/communications"]');
  if (!link) return;
  let badge = link.querySelector('.sms-nav-badge');
  if (!badge && unread) {
    badge = document.createElement('span');
    badge.className = 'sms-nav-badge';
    link.append(badge);
  }
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = !unread;
  }
}

async function syncRecent(force = false) { return syncSms('', { force }); }

async function conversationRows() {
  const { data: messages, error } = await supabase
    .from('client_sms_messages')
    .select('id,client_id,direction,body,status,read_at,occurred_at,created_at')
    .gte('occurred_at', MH_TEXT_START)
    .order('occurred_at', { ascending:false })
    .limit(1000);
  if (error) throw error;
  const ids = Array.from(new Set((messages || []).map(row => row.client_id).filter(Boolean)));
  let clients = [];
  if (ids.length) {
    const { data, error: clientError } = await supabase.from('clients').select('id,first_name,last_name,phone').in('id', ids);
    if (clientError) throw clientError;
    clients = data || [];
  }
  const byId = new Map(clients.map(client => [client.id, client]));
  const groups = new Map();
  for (const message of messages || []) {
    const client = byId.get(message.client_id);
    // Communications is intentionally client-only: never show an unknown,
    // deleted, unmatched, otherwise unsaved Mayer MIG client, or pre-M&H history.
    if (!client) continue;
    let group = groups.get(message.client_id);
    if (!group) {
      group = { client, latest:message, unread:0, count:0 };
      groups.set(message.client_id, group);
    }
    group.count += 1;
    if (message.direction === 'inbound' && !message.read_at) group.unread += 1;
  }
  return Array.from(groups.values());
}

function conversationMarkup(groups) {
  if (!groups.length) return '<div class="sms-center-empty"><h3>No Arctos text conversations yet</h3><p>Only text messages matched to saved Arctos clients since CRM texting was connected appear here.</p></div>';
  return groups.map(group => {
    const client = group.client;
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client';
    const latest = group.latest;
    return `<button type="button" class="sms-conversation-card${group.unread ? ' has-unread' : ''}" data-sms-conversation="${esc(client.id)}">
      <span class="sms-conversation-name"><strong>${esc(name)}</strong><small>${esc(client.phone || 'No phone')}</small></span>
      <span class="sms-conversation-preview"><span>${esc(latest.body || '').slice(0,150)}</span><small>${esc(latest.direction === 'inbound' ? 'Received' : 'Sent')} · ${esc(when(latest.occurred_at || latest.created_at))}</small></span>
      ${group.unread ? `<span class="sms-conversation-unread">${group.unread > 99 ? '99+' : group.unread}</span>` : '<span class="sms-conversation-arrow">›</span>'}
    </button>`;
  }).join('');
}

async function loadCenter(host) {
  if (!host?.isConnected || loading) return;
  loading = true;
  const status = host.querySelector('[data-sms-center-status]');
  try {
    const groups = await conversationRows();
    if (!host.isConnected) return;
    const unread = groups.reduce((sum, group) => sum + group.unread, 0);
    host.querySelector('[data-sms-unread-total]').textContent = String(unread);
    host.querySelector('[data-sms-conversation-total]').textContent = String(groups.length);
    host.querySelector('[data-sms-conversations]').innerHTML = conversationMarkup(groups);
    host.querySelectorAll('[data-sms-conversation]').forEach(button => button.onclick = async () => {
      await openClientThread(button.dataset.smsConversation);
      if (host.isConnected) void loadCenter(host);
    });
    communicationsRendered(host);
    updateUnreadBadge(unread);
    status.textContent = `Saved Arctos clients · CRM texting activity only · Updated ${new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`;
  } catch (error) {
    if (host.isConnected) status.textContent = error instanceof Error ? error.message : 'Unable to load text messages.';
  } finally {
    loading = false;
  }
}

async function syncAndRefresh(host, { force = false } = {}) {
  if (!host?.isConnected || syncing) return;
  const now = Date.now();
  if (!force && lastSyncAt && now - lastSyncAt < SYNC_COOLDOWN_MS) return;
  syncing = true;
  const status = host.querySelector('[data-sms-center-status]');
  try {
    if (status) status.textContent = 'Checking Twilio for new saved-client replies…';
    await syncRecent(force);
    lastSyncAt = Date.now();
    if (host.isConnected) await loadCenter(host);
  } catch (error) {
    if (host.isConnected && status) status.textContent = error instanceof Error ? error.message : 'Unable to sync new text messages.';
  } finally {
    syncing = false;
  }
}

function massTextDialog() { return openMassText(); }

function mountCommunications() {
  if (!location.hash.startsWith('#/communications')) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
    return;
  }
  const content = document.querySelector('.content');
  if (!content) return;
  let host = content.querySelector('#sms-communications-center');
  if (!host) {
    const old = Array.from(content.children).find(node => node.matches?.('.panel-card'));
    if (!old) return;
    host = document.createElement('section');
    host.id = 'sms-communications-center';
    host.className = 'sms-center';
    old.replaceWith(host);
  }
  const firstMount = !host.dataset.mounted;
  if (firstMount) {
    host.dataset.mounted = 'true';
    host.innerHTML = `<div class="sms-center-head"><div><span class="eyebrow">Twilio</span><h2>Client Text Messages</h2><p data-sms-office-number>Checking office texting connection…</p></div><div class="sms-center-actions"><button type="button" class="btn secondary" data-sms-sync>Sync Replies</button><button type="button" class="btn primary" data-sms-mass>+ Mass Text</button></div></div>
      <div class="sms-center-metrics"><div><span>Unread Replies</span><strong data-sms-unread-total>—</strong></div><div><span>Client Conversations</span><strong data-sms-conversation-total>—</strong></div><div><span>Twilio</span><strong class="sms-connected" data-sms-connection>Checking…</strong></div></div>
      <div class="sms-center-status" data-sms-center-status>Loading saved Arctos conversations…</div>
      <div class="sms-conversations" data-sms-conversations></div>`;
    host.querySelector('[data-sms-sync]').onclick = () => void syncAndRefresh(host, { force:true });
    host.querySelector('[data-sms-mass]').onclick = massTextDialog;
    (async()=>{
      try{
        const response=await fetch('/api/twilio-config',{headers:await smsAuthHeaders(),cache:'no-store'});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Texting connection unavailable.');
        if(!host.isConnected)return;
        host.querySelector('[data-sms-office-number]').textContent='Office number: '+result.phoneNumber;
        host.querySelector('[data-sms-connection]').textContent='Connected';
      }catch(error){
        if(!host.isConnected)return;
        host.querySelector('[data-sms-connection]').textContent='Unavailable';
        host.querySelector('[data-sms-office-number]').textContent=error.message;
      }
    })();
  }

  // Render the Supabase copy first so opening Communications never waits on
  // Twilio network/history work. Then check Twilio in the background.
  void loadCenter(host).then(() => {
    if (!host.isConnected || !location.hash.startsWith('#/communications')) return;
    window.setTimeout(() => void syncAndRefresh(host), firstMount ? 250 : 0);
  });

  if (!refreshTimer) {
    refreshTimer = window.setInterval(() => {
      if (location.hash.startsWith('#/communications') && document.visibilityState === 'visible') void syncAndRefresh(host);
    }, AUTO_SYNC_MS);
  }
}

window.addEventListener('hashchange', () => window.setTimeout(mountCommunications, 0));
window.addEventListener('focus', () => {
  if (location.hash.startsWith('#/communications')) window.setTimeout(mountCommunications, 0);
});
window.setTimeout(mountCommunications, 0);

window.addEventListener('mig:communications-changed', event => {
  if (event.detail?.kind !== 'texts') return;
  const host = document.querySelector('#sms-communications-center');
  if (host) void loadCenter(host);
});
