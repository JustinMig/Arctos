import { mhRepository } from './supabase-repository.js';
import { clientSaveResult } from './record-changes.js';

const CARRIERS = ['Aetna', 'Humana', 'Cigna/Healthspring', 'Devoted', 'United Health Care'];
const PLAN_TYPES = ['Supplement', 'Medicare Advantage'];
const planTypeByClient = new Map();
const baseSaveClient = mhRepository.saveClient.bind(mhRepository);

mhRepository.saveClient = async function (record, ...args) {
  const originalId = record?.id || '';
  const planKey = originalId || '__new__';
  const selectedPlanType = planTypeByClient.has(planKey)
    ? planTypeByClient.get(planKey)
    : (record?.health_plan_type || '');

  // The core Medicare upsert and health-plan write now include these fields.
  // Keep the confirmed save result instead of fetching the whole client again.
  const saved = await baseSaveClient({ ...record, health_plan_type: selectedPlanType }, ...args);
  if (!saved?.id) return saved;

  if (!originalId) {
    planTypeByClient.delete('__new__');
    planTypeByClient.set(saved.id, selectedPlanType || '');
  }

  return { ...clientSaveResult(saved), license_number:'', health_plan_type: selectedPlanType };
};

function makeOptions(values, current = '') {
  const all = [...values];
  if (current && !all.includes(current)) all.unshift(current);
  return '<option value="">Select…</option>' + all.map(value => {
    const selected = value === current ? ' selected' : '';
    const label = values.includes(value) ? value : `${value} (Existing)`;
    return `<option value="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"${selected}>${label}</option>`;
  }).join('');
}

async function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  if (dialog.dataset.medicareCleanup === 'true') return;

  const panel = dialog.querySelector('[data-panel="medicare"]');
  const medicaidNumber = panel?.querySelector('[name="medicaid_number"]')?.closest('label');
  const medicaidLevel = panel?.querySelector('[name="medicaid_level"]')?.closest('label');
  const healthCarrierInput = panel?.querySelector('[name="health_carrier"]');
  if (!panel || !medicaidNumber || !medicaidLevel || !healthCarrierInput) return;

  dialog.dataset.medicareCleanup = 'true';
  const clientId = dialog.dataset.clientId || '';

  const currentCarrier = healthCarrierInput.value || '';
  const carrierSelect = document.createElement('select');
  carrierSelect.name = 'health_carrier';
  carrierSelect.innerHTML = makeOptions(CARRIERS, currentCarrier);
  healthCarrierInput.replaceWith(carrierSelect);

  const carrierLabel = carrierSelect.closest('label');
  const healthGroup = carrierLabel?.closest('details.field-group');
  if (healthGroup && !healthGroup.querySelector('[data-health-plan-type]')) {
    const typeLabel = document.createElement('label');
    typeLabel.className = 'field';
    typeLabel.innerHTML = `<span>Type of Plan</span><select data-health-plan-type>${makeOptions(PLAN_TYPES)}</select>`;
    carrierLabel.insertAdjacentElement('afterend', typeLabel);

    const typeSelect = typeLabel.querySelector('[data-health-plan-type]');
    const key = clientId || '__new__';
    const loadedType = dialog.querySelector('[data-loaded-health-plan-type]');
    const initial = loadedType?.value || '';
    loadedType?.remove();
    typeSelect.name = 'health_plan_type';
    if (initial && !PLAN_TYPES.includes(initial)) {
      typeSelect.insertAdjacentHTML('beforeend', `<option value="${initial.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${initial} (Existing)</option>`);
    }
    typeSelect.value = initial;
    planTypeByClient.set(key, initial);
    typeSelect.addEventListener('change', () => planTypeByClient.set(key, typeSelect.value));
  }
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const dialog = node.matches?.('dialog.client-dialog') ? node : node.closest?.('dialog.client-dialog');
      if (dialog) queueMicrotask(() => enhanceDialog(dialog));
      node.querySelectorAll?.('dialog.client-dialog').forEach(d => queueMicrotask(() => enhanceDialog(d)));
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(dialog => enhanceDialog(dialog));
