import {callLink} from './phone-dialer.js';
function enhanceCampaignCallButton(card) {
  if (!(card instanceof Element) || card.dataset.cmpCallPlaceholder === 'true') return;
  if(card.querySelector('.cmp-badge.is-deceased'))return;
  const person = card.querySelector('.cmp-person');
  const name = person?.querySelector('strong');
  if (!person || !name) return;

  card.dataset.cmpCallPlaceholder = 'true';

  const line = document.createElement('div');
  line.className = 'cmp-name-call-line';
  name.before(line);
  line.append(name);

  const phone=person.querySelector(':scope > span')?.textContent||'';
  const call=callLink(phone,'Call');
  if(!call)return;
  call.className='cmp-call-placeholder';
  call.setAttribute('aria-label','Call '+(name.textContent?.trim()||'client')+' in RingCentral');
  call.addEventListener('click',event=>event.stopPropagation());
  line.append(call);
}

function scanCampaignCallButtons(root = document) {
  if (root instanceof Element && root.matches('.cmp-member')) enhanceCampaignCallButton(root);
  root.querySelectorAll?.('.campaigns-root .cmp-member').forEach(enhanceCampaignCallButton);
}

let queued = false;
function queueScan() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    scanCampaignCallButtons();
  });
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.cmp-member,.cmp-members,.campaigns-root') || node.querySelector?.('.cmp-member'))))) {
    queueScan();
  }
}).observe(document.body, { childList: true, subtree: true });

scanCampaignCallButtons();
