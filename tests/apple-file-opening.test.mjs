import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { browserDestination, isAppleTouchDevice } from '../external-file-opening.js';

const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Version/18.5 Mobile Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const windows = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0', platform: 'Win32', maxTouchPoints: 10 };
const signed = 'https://storage.example/storage/v1/object/sign/mh-client-documents/test/three-pages.pdf?token=TEST_ONLY&redirect=https://example.com';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('recognizes iPad desktop mode without changing Windows or desktop Mac opening', () => {
  assert.equal(isAppleTouchDevice(iphone), true);
  assert.equal(isAppleTouchDevice(ipad), true);
  assert.equal(isAppleTouchDevice(windows), false);
  assert.equal(isAppleTouchDevice({ ...ipad, maxTouchPoints: 0 }), false);
  for (const nav of [iphone, ipad]) {
    const d = browserDestination(signed, { preferSafari: true, nav });
    assert.equal(d.href, signed.replace(/^https:/, 'x-safari-https:'));
    assert.equal(d.target, '_self');
    assert.ok(d.href.includes('redirect=https://example.com'), 'Nested URL and signed token remain intact');
  }
  assert.equal(browserDestination(signed, { preferSafari: true, nav: windows }).target, '_blank');
  assert.equal(browserDestination(signed, { nav: iphone }).href, signed);
});

test('older Apple systems and HTTP/local files retain usable native browser links', () => {
  const ios16 = { ...iphone, userAgent: 'iPhone OS 16_7 Version/16.0' };
  for (const [url, nav] of [[signed, ios16], ['http://carrier.example/path', iphone], ['blob:https://crm.example/test', ipad]]) {
    const d = browserDestination(url, { preferSafari: true, nav });
    assert.equal(d.href, url);
    assert.equal(d.safari, false);
    assert.equal(d.target, '_blank');
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com', '']) {
    assert.equal(browserDestination(url, { preferSafari: true, nav: iphone }), null);
  }
});

async function fixture(nav, html = '<body></body>') {
  const dom = new JSDOM(html, { url: 'https://crm.example/#/carriers', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [key, value] of Object.entries(nav)) Object.defineProperty(w.navigator, key, { configurable: true, value });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.open = () => { throw new Error('Do not open a scripted popup after signing'); };
  w.eval((await readFile(new URL('../external-file-opening.js', import.meta.url), 'utf8')).replace(/export function (\w+)/g, 'window.$1 = function $1'));
  return { dom, w, close: () => w.close() };
}

test('a slow signed-file response still gives iPhone/iPad a full original document link without an iframe', async () => {
  for (const nav of [iphone, ipad]) {
    const f = await fixture(nav);
    try {
      await tick(); // The URL can arrive after the original tap has ended.
      const modal = f.w.openAppleFile({ url: signed, fileName: '<Client> policy.pdf', mimeType: 'application/pdf' });
      assert.equal(modal.open, true);
      assert.equal(modal.querySelector('iframe, object, embed'), null);
      assert.equal(modal.querySelector('h2').textContent, '<Client> policy.pdf');
      assert.equal(modal.querySelector('h2').children.length, 0);
      const safari = modal.querySelector('[data-full-file-open]');
      assert.equal(safari.getAttribute('href'), signed.replace(/^https:/, 'x-safari-https:'));
      assert.equal(safari.target, '_self');
      const fallback = modal.querySelector('[data-full-file-browser]');
      assert.equal(fallback.hidden, false);
      assert.equal(fallback.href, signed);
      assert.equal(fallback.target, '_blank');
      assert.ok(fallback.rel.includes('noreferrer'));
      assert.equal(fallback.hasAttribute('download'), false, 'Open the entire PDF in a top-level browser viewer');
      modal.querySelector('[data-full-file-close]').click();
      assert.equal(modal.isConnected, false);
    } finally { f.close(); }
  }
});

test('the original active tap hands the full file to Safari and leaves a retry link', async () => {
  const f = await fixture(iphone);
  try {
    Object.defineProperty(f.w.navigator, 'userActivation', { value: { isActive: true } });
    const clicks = [];
    f.w.document.addEventListener('click', e => {
      if (e.target.matches('[data-full-file-open]')) { clicks.push(e.target.href); e.preventDefault(); }
    });
    const modal = f.w.openAppleFile({ url: signed, mimeType: 'application/pdf' });
    assert.deepEqual(clicks, [signed.replace(/^https:/, 'x-safari-https:')]);
    assert.equal(modal.open, true);
  } finally { f.close(); }
});

test('desktop previews and Apple photos stay intact; queued PDFs keep their URL until after close', async () => {
  const desktop = await fixture(windows);
  try { assert.equal(desktop.w.openAppleFile({ url: signed, mimeType: 'application/pdf' }), null); }
  finally { desktop.close(); }
  const f = await fixture(ipad);
  try {
    assert.equal(f.w.openAppleFile({ url: 'https://storage.example/photo.jpg?token=TEST', mimeType: '' }), null);
    assert.equal(f.w.openAppleFile({ url: 'blob:https://crm.example/photo', mimeType: 'image/png' }), null);
    const revoked = [], timers = [];
    f.w.URL.revokeObjectURL = url => revoked.push(url);
    f.w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); };
    const url = 'blob:https://crm.example/queued-pdf';
    const modal = f.w.openAppleFile({ url, mimeType: 'application/pdf', revokeOnClose: true });
    assert.equal(modal.querySelector('[data-full-file-open]').href, url);
    assert.equal(modal.querySelector('[data-full-file-browser]').hidden, true);
    assert.equal(timers.length, 0);
    modal.close();
    assert.equal(revoked.length, 0);
    assert.equal(timers[0].ms, 60000);
    timers[0].fn();
    assert.deepEqual(revoked, [url]);
  } finally { f.close(); }
});

const carrierBundle = build({
  stdin: { contents: "import {installCarrierVault} from './carriers-ui.js'; window.installCarrierVault=installCarrierVault;", resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, format: 'iife', write: false,
  plugins: [{ name: 'synthetic-carriers', setup(b) {
    b.onResolve({ filter: /supabase-repository\.js$/ }, () => ({ path: 'carrier-db', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const supabase=window.testCarrierDatabase;' }));
  } }]
}).then(r => r.outputFiles[0].text);

const previewEntries = {
  'client-file-experience.js': 'openPreview',
  'client-pharmacy.js': 'previewFile',
  'client-files-hub.js': 'openFileModal',
  'client-notes-extras.js': 'preview',
  'life-policy-documents.js': 'preview',
  'hospital-indemnity-documents.js': 'preview',
  'client-audit-fixes.js': 'openSignedPreview'
};
const previewBundle = build({
  stdin: { contents: Object.keys(previewEntries).map(name => `import './${name}';`).join('\n'), resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, format: 'iife', write: false,
  plugins: [{ name: 'synthetic-previews', setup(b) {
    b.onResolve({ filter: /supabase-repository\.js$/ }, () => ({ path: 'preview-db', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const mhRepository={saveClient(){},getClient(){}}; export const supabase={functions:{invoke(){}}};' }));
    b.onLoad({ filter: /\.js$/ }, async args => {
      const name = args.path.split('/').pop(), fn = previewEntries[name];
      if (!fn) return;
      return { contents: await readFile(args.path, 'utf8') + `\n(window.testFileViewers??={})[${JSON.stringify(name)}]=${fn};`, loader: 'js' };
    });
  } }]
}).then(r => r.outputFiles[0].text);

test('every client file location opens the full original on iPad and retains a desktop preview', async () => {
  for (const nav of [ipad, windows]) {
    const f = await fixture(nav);
    try {
      f.w.eval(await previewBundle);
      const r = { file_name: 'Three pages.pdf', mime_type: 'application/pdf' };
      const viewers = f.w.testFileViewers;
      const calls = [
        () => viewers['client-file-experience.js']({ url: signed, fileName: r.file_name, mimeType: r.mime_type }),
        () => viewers['client-pharmacy.js']({ url: signed, fileName: r.file_name, mimeType: r.mime_type }),
        () => viewers['client-files-hub.js'](r, signed),
        () => viewers['client-notes-extras.js'](signed, r),
        () => viewers['life-policy-documents.js'](signed, r),
        () => viewers['hospital-indemnity-documents.js'](signed, r),
        () => viewers['client-audit-fixes.js'](signed)
      ];
      for (const open of calls) {
        open();
        const modal = f.w.document.querySelector('.mh-file-preview-dialog');
        assert.ok(modal?.open);
        if (nav === ipad) {
          assert.equal(modal.querySelector('iframe'), null);
          assert.equal(modal.querySelector('[data-full-file-browser]').href, signed);
        } else {
          assert.equal(modal.querySelector('iframe').src, signed);
        }
        modal.close(); modal.remove();
      }
    } finally { f.close(); }
  }
});

test('Saved Carriers opens Safari on Apple devices and tracks edits while preserving desktop tabs', async () => {
  for (const nav of [iphone, ipad, windows]) {
    const f = await fixture(nav, '<body><div id="app"><div class="content"><div class="page-heading"></div></div></div></body>');
    try {
      f.w.testCarrierDatabase = { rpc: async () => ({ data: [{ id: 'synthetic', carrier_name: 'Test Carrier', site_url: 'https://carrier.example/login?return=https://carrier.example/agent' }], error: null }) };
      f.w.eval(await carrierBundle);
      f.w.installCarrierVault(f.w.document.querySelector('#app'));
      await tick();
      const select = f.w.document.querySelector('[data-carrier-select]');
      select.value = 'synthetic'; select.dispatchEvent(new f.w.Event('change'));
      const dialog = f.w.document.querySelector('.carrier-edit-dialog');
      const link = dialog.querySelector('[data-dialog-site]');
      const fallback = dialog.querySelector('[data-dialog-browser]');
      assert.equal(link.target, nav === windows ? '_blank' : '_self');
      assert.equal(link.href.startsWith('x-safari-https:'), nav !== windows);
      assert.equal(fallback.hidden, nav === windows);
      assert.ok(link.href.endsWith('return=https://carrier.example/agent'));
      const input = dialog.querySelector('[name="site_url"]');
      input.value = 'https://new-carrier.example/'; input.dispatchEvent(new f.w.Event('input'));
      assert.equal(link.href, nav === windows ? input.value : 'x-safari-https://new-carrier.example/');
      assert.equal(fallback.href, input.value);
      input.value = ''; input.dispatchEvent(new f.w.Event('input'));
      assert.equal(link.getAttribute('aria-disabled'), 'true');
      assert.equal(fallback.hidden, true);
      dialog.querySelector('[data-close]').click();
      assert.equal(dialog.isConnected, false);
    } finally { f.close(); }
  }
});
