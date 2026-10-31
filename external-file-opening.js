// iPadOS can advertise a desktop Mac user agent, so include touch-capable Macs.
export function isAppleTouchDevice(nav = globalThis.navigator) {
  return /iPhone|iPad|iPod/i.test(nav?.userAgent || '') ||
    (/Mac/i.test(nav?.platform || nav?.userAgent || '') && Number(nav?.maxTouchPoints) > 1);
}

export function browserDestination(value, { preferSafari = false, nav = globalThis.navigator } = {}) {
  const href = String(value || '');
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!['https:', 'http:', 'blob:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  const version = Number((String(nav?.userAgent || '').match(/(?:OS |Version\/)(\d+)/) || [])[1]);
  // Safari's app handoff is unavailable on iOS 16. Keep a standard browser link
  // there, for HTTP sites, and for temporary local files.
  const safari = preferSafari && isAppleTouchDevice(nav) && version !== 16 && url.protocol === 'https:';
  return {
    href: safari ? href.replace(/^https:/i, 'x-safari-https:') : href,
    target: safari ? '_self' : '_blank',
    rel: 'external noopener noreferrer',
    safari
  };
}

export function setBrowserLink(link, value, options) {
  const destination = browserDestination(value, options);
  link.href = destination?.href || '#';
  link.target = destination?.target || '_blank';
  link.rel = destination?.rel || 'external noopener noreferrer';
  link.referrerPolicy = 'no-referrer';
  return destination;
}

// Native embedded PDFs on Apple touch devices can expose only their first page.
// Hand the original file to the full browser viewer; never send client files to
// a third-party document viewer. A visible link also survives delayed signing or
// a browser that requires another user gesture to leave a Home Screen app.
export function openAppleFile({ url, fileName = 'Document', mimeType = '', revokeOnClose = false }) {
  if (!isAppleTouchDevice()) return null;
  const mime = String(mimeType).toLowerCase().split(';')[0];
  const image = mime.startsWith('image/') ||
    (!mime && /\.(?:jpe?g|png|gif|webp|heic|heif|avif|bmp)(?:[?#]|$)/i.test(url));
  if (image) return null;
  const destination = browserDestination(url, { preferSafari: true });
  if (!destination) throw new Error('Unable to open this file link.');

  const modal = document.createElement('dialog');
  modal.className = 'mh-file-preview-dialog mh-file-external-dialog';
  modal.setAttribute('aria-label', 'Open full document');
  modal.innerHTML = `<div class="mh-file-preview-frame">
    <header class="mh-file-preview-head"><div><h2></h2><p>Full document</p></div>
      <button type="button" class="modal-close" data-full-file-close aria-label="Close file">×</button></header>
    <div class="mh-file-preview-body"><div class="mh-file-browser-open">
      <strong>View every page</strong>
      <p>Open the original file to read every page, zoom, share, or save it.</p>
      <a class="btn primary" data-full-file-open></a>
      <a class="btn secondary" data-full-file-browser>Open in Browser ↗</a>
      <small>If the file has not opened, tap a button above.</small>
    </div></div></div>`;
  modal.querySelector('h2').textContent = fileName;
  const primary = modal.querySelector('[data-full-file-open]');
  setBrowserLink(primary, url, { preferSafari: true });
  primary.textContent = destination.safari ? 'Open Full File in Safari ↗' : 'Open Full File ↗';
  const fallback = modal.querySelector('[data-full-file-browser]');
  setBrowserLink(fallback, url);
  fallback.hidden = !destination.safari;
  const close = () => { if (modal.isConnected) modal.close(); };
  modal.querySelector('[data-full-file-close]').onclick = close;
  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('close', () => {
    modal.remove();
    // A new browser tab may still be reading a queued local file.
    if (revokeOnClose) setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, { once: true });
  document.body.append(modal);
  modal.showModal();
  // App schemes do not require an asynchronously created popup. When the
  // original tap is still active, try the Safari handoff immediately.
  if (destination.safari && navigator.userActivation?.isActive) primary.click();
  return modal;
}
