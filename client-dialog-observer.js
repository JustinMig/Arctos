// Observe only actual client dialogs, rather than every DOM update across
// the entire CRM. Client forms are injected after the native dialog opens.
export function observeClientDialogs(onChange, { attributes = [] } = {}) {
  if (typeof onChange !== 'function') throw new TypeError('A dialog callback is required.');
  const attached = new WeakSet();
  const install = dialog => {
    if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog') || attached.has(dialog)) return;
    attached.add(dialog);
    let queued = false;
    const notify = () => {
      if (queued || !dialog.isConnected) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (dialog.isConnected) onChange(dialog); });
    };
    const inner = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' || record.addedNodes.length)) notify();
    });
    inner.observe(dialog, { childList:true, subtree:true });
    if (attributes.length) inner.observe(dialog, { childList:true, subtree:true, attributes:true, attributeFilter:attributes });
    dialog.addEventListener('close', () => inner.disconnect(), { once:true });
    notify();
  };
  const outer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLDialogElement) install(node);
    }
  });
  outer.observe(document.body,{childList:true});
  document.querySelectorAll('dialog.client-dialog').forEach(install);
  return () => outer.disconnect();
}
