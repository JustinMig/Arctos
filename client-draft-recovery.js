import { snapshot, wireDates } from './core.js';
import { clientDraftStore } from './client-draft-store.js';

const groups = [
  ['doctor', '[data-health-list="doctors"]', '[data-add-health-record="doctors"]'],
  ['medication', '[data-health-list="medications"]', '[data-add-health-record="medications"]'],
  ['indemnity', '[data-health-list="hospital_indemnity"]', '[data-add-health-record="hospital_indemnity"]'],
  ['life_policy', '[data-life-policy-list]', '[data-add-life-policy]']
];
const protectedField = name => /^(banking_|medicare_gov_)/.test(name) || ['ssn','medicare_number','medicaid_number','license_number'].includes(name);
const excluded = name => /cvv|cvc|security_code/i.test(name) || name.startsWith('_') || name === 'id';
export function captureClientDraft(form, touched) {
  const fields = {};
  for (const [name, value] of Object.entries(snapshot(form))) {
    if (excluded(name) || Array.isArray(value) || (protectedField(name) && !touched.has(name))) continue;
    fields[name] = value;
  }
  return { fields, groups: groups.filter(([, selector]) => form.querySelector(selector)).map(([prefix]) => prefix) };
}
export function restoreClientDraft(form, draft) {
  const fields = { ...draft.fields };
  for (const [prefix, list, add] of groups) {
    if (draft.groups?.includes(prefix) && (!form.querySelector(list) || !form.querySelector(add)))
      throw new Error('This editor cannot restore all draft sections. Keep the draft and reopen the record.');
  }
  for (const [prefix, listSelector, addSelector] of groups) {
    if (!draft.groups?.includes(prefix)) continue;
    const list = form.querySelector(listSelector), add = form.querySelector(addSelector);
    if (!list || !add) throw new Error('This editor cannot restore all draft sections. Keep the draft and reopen the record.');
    const pattern = new RegExp('^' + prefix + '_(\\d+)_(.+)$');
    const rows = new Map();
    for (const [name, value] of Object.entries(fields)) {
      const match = pattern.exec(name);
      if (match) { if (!rows.has(match[1])) rows.set(match[1], {}); rows.get(match[1])[match[2]] = value; delete fields[name]; }
    }
    list.replaceChildren();
    for (const row of rows.values()) {
      add.click();
      for (const input of list.lastElementChild.querySelectorAll('[name]')) {
        const match = pattern.exec(input.name);
        if (match && Object.hasOwn(row, match[2])) fields[input.name] = row[match[2]];
      }
    }
  }
  // Status runs last so Deceased retains its existing product exclusion rule.
  const names = Object.keys(fields).sort((a,b) => Number(a === 'status') - Number(b === 'status'));
  for (const name of names) {
    if (excluded(name)) continue;
    const input = form.elements.namedItem(name);
    if (!input || input.type === 'file' || !('value' in input)) continue;
    const value = fields[name];
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = String(value ?? '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  wireDates(form);
}

export function installClientRecovery({ controller, form, getRecord, getUserId, store = clientDraftStore }) {
  const user = getUserId();
  if (!user) return;
  let client = getRecord().id || null;
  let draftId = crypto.randomUUID(), timer, chain = Promise.resolve(), closed = false, restoring = false, edited = false;
  let serverAttempted = false;
  let ownsDraft = false;
  const touched = new Set();
  const valid = () => !closed && getUserId() === user;
  const badge = text => { const node = controller.node.querySelector('[data-dirty]'); if (node) node.textContent = text; };
  async function persist() {
    clearTimeout(timer);
    if (!valid() || !edited || Number(form.dataset.clientBackgroundLoads || 0)) return false;
    const draft = { ...captureClientDraft(form, touched), recordVersion: getRecord().updated_at || null, serverAttempted };
    const targetClient = client, targetId = draftId;
    const operation = chain.catch(() => {}).then(() => store.save(user, targetClient, targetId, draft));
    chain = operation;
    await operation;
    ownsDraft = true;
    return true;
  }
  function changed(event) {
    if (!valid() || restoring) return;
    if (event.target?.name) touched.add(event.target.name);
    edited = true;
    clearTimeout(timer);
    timer = setTimeout(() => { void persist().then(saved => { if (saved && valid()) badge('Draft on this device • not saved to CRM'); }).catch(() => { if (valid()) badge('Device draft unavailable • keep record open'); }); }, 500);
  }
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  const onSave = controller.onSave;
  controller.onSave = async function(currentForm) {
    if (!valid()) throw new Error('Sign in again before saving this client.');
    if (Number(form.dataset.clientBackgroundLoads || 0)) throw new Error('Client information is still loading. Please wait before saving.');
    if (navigator.onLine === false) {
      const saved = await persist();
      throw new Error(saved ? 'Offline. An encrypted draft is on this device; it has not been saved to the CRM. Reconnect, then select Save Client. Files must remain open or be attached again.' : 'Offline. Keep this record open and reconnect before saving.');
    }
    // Persist before sending. A lost response must not be mistaken for an
    // untouched server record, especially when creating a new client.
    serverAttempted = true;
    await persist().catch(() => {});
    if (!valid()) throw new Error('Sign in again before saving this client.');
    const result = await onSave(currentForm);
    clearTimeout(timer);
    await chain.catch(() => {});
    if (ownsDraft) await store.remove(user, client, draftId).catch(() => {});
    ownsDraft = false;
    edited = false; touched.clear(); serverAttempted = false;
    client = getRecord().id || null; draftId = crypto.randomUUID();
    return result;
  };
  const finish = controller.finish;
  controller.discardDraft = async () => {
    clearTimeout(timer);
    await chain.catch(() => {});
    if (ownsDraft) await store.remove(user, client, draftId);
    ownsDraft = false;
    edited = false;
  };
  controller.finish = function() {
    // Capture the last keystroke before cleanup; no timer can write after this.
    if (edited) void persist().catch(() => {});
    closed = true; clearTimeout(timer); observer.disconnect();
    window.removeEventListener('pagehide', pagehide);
    form.removeEventListener('input', changed); form.removeEventListener('change', changed);
    return finish.call(controller);
  };
  const pagehide = () => { void persist().catch(() => {}); };
  window.addEventListener('pagehide', pagehide);
  let offered = false;
  async function offer() {
    if (!valid() || offered || Number(form.dataset.clientBackgroundLoads || 0)) return;
    offered = true;
    try {
      const draft = await store.latest(user, client);
      if (!draft || !valid() || edited) return;
      const box = controller.node.querySelector('.modal-error');
      const conflict = (draft.recordVersion || null) !== (getRecord().updated_at || null) || (!client && draft.serverAttempted);
      box.hidden = false;
      box.textContent = conflict
        ? 'A device draft exists, but the server record may have changed or a previous save may have succeeded. The draft is retained; it will not overwrite this record. For a new client, check Client Search before creating another record.'
        : 'An encrypted device draft is available. Recover it to review your changes, then save. Files are not included and must be attached again.';
      if (!conflict) {
        const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'btn secondary'; recover.textContent = 'Recover draft';
        recover.onclick = () => {
          if (!valid() || edited || Number(form.dataset.clientBackgroundLoads || 0)) return;
          restoring = true;
          try {
            restoreClientDraft(form, draft);
            for (const name of Object.keys(draft.fields)) touched.add(name);
            draftId = JSON.parse(draft.storageKey)[2]; serverAttempted = draft.serverAttempted === true; edited = true; ownsDraft = true;
            box.replaceChildren(document.createTextNode('Draft recovered. Review the record and select Save Client. Reattach any files.'));
            badge('Recovered draft • not saved to CRM');
          } catch (error) { box.textContent = error.message; }
          finally { restoring = false; }
        };
        box.append(document.createTextNode(' '), recover);
      }
    } catch { /* No recovery storage: a later edit/save shows its status. */ }
  }
  const observer = new MutationObserver(() => {
    void offer();
    if (edited && !Number(form.dataset.clientBackgroundLoads || 0)) changed({});
  });
  observer.observe(form, { attributes: true, attributeFilter: ['data-client-background-loads'] });
  queueMicrotask(() => { void offer(); });
  return { persist };
}
