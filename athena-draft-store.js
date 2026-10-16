// Encrypted on-device recovery drafts for Athena's Medicare.
// Each signed-in agent has a separate draft; the AES-GCM key is non-exportable
// and stored by the browser in IndexedDB, never in localStorage.
const DB_NAME = 'arctos-athena-recovery-v1';
let openPromise, keyPromise;

function openDB() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
    return Promise.reject(new Error('Secure device draft storage is unavailable in this browser.'));
  if (!openPromise) {
    openPromise = new Promise((resolve,reject) => {
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts');
        if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys');
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Could not open recovery storage.'));
      req.onblocked=()=>reject(new Error('Recovery storage is blocked by another tab.'));
    }).catch(err=>{openPromise=null;throw err;});
  }
  return openPromise;
}
async function storeRequest(store,mode,operation) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,mode);
    const req=operation(tx.objectStore(store));
    let value;
    req.onsuccess=()=>{value=req.result;};
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error||req.error||new Error('Recovery storage failed.'));
    tx.onabort=()=>reject(tx.error||new Error('Recovery storage was interrupted.'));
  });
}
const get=(store,key)=>storeRequest(store,'readonly',s=>s.get(key));
const put=(store,key,value)=>storeRequest(store,'readwrite',s=>s.put(value,key));
const del=(store,key)=>storeRequest(store,'readwrite',s=>s.delete(key));

async function encryptionKey() {
  if(!keyPromise)keyPromise=(async()=>{
    const stored=await get('keys','device');
    if(stored)return stored;
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    await put('keys','device',key);
    return key;
  })().catch(error=>{keyPromise=null;throw error;});
  return keyPromise;
}
function userKey(userId){
  if(typeof userId!=='string'||!userId)throw new Error('Sign in to save an Athena recovery draft.');
  return 'agent:'+userId;
}
export async function saveAthenaRecoveryDraft(userId,draft){
  const key=await encryptionKey();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=new TextEncoder().encode(JSON.stringify(draft));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
  await put('drafts',userKey(userId),{iv,encrypted});
}
export async function readAthenaRecoveryDraft(userId){
  const item=await get('drafts',userKey(userId));
  if(!item)return null;
  const key=await encryptionKey();
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:item.iv},key,item.encrypted);
  const parsed=JSON.parse(new TextDecoder().decode(data));
  return parsed?.version===1?parsed:null;
}
export async function clearAthenaRecoveryDraft(userId){
  await del('drafts',userKey(userId));
}
