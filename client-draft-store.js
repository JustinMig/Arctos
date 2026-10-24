// Recovery only: encrypted on this device, never a server-save receipt.
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function createClientDraftStore({ indexedDB = globalThis.indexedDB, crypto = globalThis.crypto, now = Date.now } = {}) {
  let opening;
  async function open() {
    if (!indexedDB || !crypto?.subtle) throw new Error('Encrypted device storage is unavailable. Keep this record open until it saves.');
    return opening ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('arctos-client-recovery-v1', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('keys');
        req.result.createObjectStore('drafts');
      };
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opening = null; }; resolve(req.result); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Device draft storage is blocked by another tab.'));
    }).catch(error => { opening = null; throw error; });
  }
  async function request(store, mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result;
      run(tx.objectStore(store), value => { result = value; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Device draft storage failed.'));
    });
  }
  function scope(user, client) {
    if (!user || typeof user !== 'string') throw new Error('Sign in to recover a client draft.');
    return JSON.stringify([user, client || 'new']);
  }
  async function key(user) {
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // One read/write transaction prevents concurrent tabs replacing the key.
    return request('keys', 'readwrite', (store, done) => {
      const get = store.get(user);
      get.onsuccess = () => { if (!get.result) store.put(candidate, user); done(get.result || candidate); };
    });
  }
  return {
    async save(user, client, id, draft) {
      const owner = scope(user, client), savedAt = now();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(user),
        new TextEncoder().encode(JSON.stringify({ ...draft, version: 1, savedAt })));
      await request('drafts', 'readwrite', (store) => { store.put({ owner, savedAt, iv, encrypted }, JSON.stringify([user, client || 'new', id])); });
    },
    async latest(user, client) {
      const owner = scope(user, client);
      const item = await request('drafts', 'readwrite', (store, done) => {
        let latest = null;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) { done(latest); return; }
          if (row.value.savedAt < now() - MAX_AGE) row.delete();
          else if (row.value.owner === owner && (!latest || row.value.savedAt > latest.savedAt)) latest = { ...row.value, storageKey: row.key };
          row.continue();
        };
      });
      if (!item) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: item.iv, additionalData: new TextEncoder().encode(owner) }, await key(user), item.encrypted);
      const value = JSON.parse(new TextDecoder().decode(plain));
      return value.version === 1 ? { ...value, storageKey: item.storageKey } : null;
    },
    async remove(user, client, id) {
      scope(user, client);
      await request('drafts', 'readwrite', store => { store.delete(JSON.stringify([user, client || 'new', id])); });
    }
  };
}
export const clientDraftStore = createClientDraftStore();
