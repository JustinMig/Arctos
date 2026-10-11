import { MA_CARRIERS, MA_PLAN_YEAR, MA_PLANS_2027, plansByCarrier } from './ma-plans-data.js?v=ma-plans-5';
import { countyForMississippiZip } from './ma-ms-zip-county.js?v=ma-plans-4';
import { supabase } from './supabase-repository.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const ROWS = Object.freeze([
  ['Plan price', 'premium'],
  ['Part B giveback', 'part_b_giveback'],
  ['Medical deductible', 'medical_deductible'],
  ['Medical max out-of-pocket', 'medical_moop'],
  ['Primary care (PCP)', 'pcp'],
  ['Specialist', 'specialist'],
  ['Inpatient hospital stay', 'inpatient'],
  ['Ambulance', 'ambulance'],
  ['Emergency room', 'emergency_room'],
  ['Urgent care', 'urgent_care'],
  ['Drug deductible', 'drug_deductible'],
  ['Prescription max out-of-pocket', 'rx_oop'],
  ['Dental', 'dental'],
  ['Vision', 'vision'],
  ['Hearing', 'hearing'],
  ['OTC / Food / Utilities', 'otc_food_utilities'],
  ['Transportation', 'transportation'],
  ['Fitness', 'fitness'],
  ['Eligibility', 'eligibility']
]);

export function createMAPlansFeature({ dialogs }) {
  let host = null;
  const selected = new Set();
  let carrierFilters = [];
  let medicaidFilter = 'ALL';
  let zipCode = '';
  let zipCounty = null;
  let availablePlanIds = null;
  let zipLoading = false;
  let zipError = '';
  let zipToken = 0;

  function selectedPlans() {
    return MA_PLANS_2027.filter(plan => selected.has(plan.plan_number));
  }

  function chosenCarriers() {
    return [...new Set(carrierFilters.filter(Boolean))];
  }

  function toggleCarrier(carrier) {
    carrierFilters = carrierFilters.includes(carrier)
      ? carrierFilters.filter(value => value !== carrier)
      : [...carrierFilters, carrier];
    render();
  }

  function matchesMedicaid(plan) {
    if (medicaidFilter === 'ALL') return true;
    if (medicaidFilter === 'NONE') return !plan.is_dsnp;
    return plan.medicaid_levels.includes(medicaidFilter) || plan.medicaid_levels.includes('DUAL_VERIFY');
  }

  function matchesZip(plan) {
    if (!zipCode) return true;
    if (zipCode.length !== 5 || zipLoading || zipError || !(availablePlanIds instanceof Set)) return false;
    return availablePlanIds.has(plan.plan_number);
  }

  function visiblePlansForCarrier(carrier) {
    return plansByCarrier(carrier).filter(plan => matchesMedicaid(plan) && matchesZip(plan));
  }

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Your Mayer MIG CRM session expired. Sign in again.');
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function loadZipAvailability(value, preserveFocus = false) {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, 5);
    zipCode = normalized;
    const token = ++zipToken;
    zipCounty = null;
    availablePlanIds = null;
    zipError = '';
    if (!normalized) { zipLoading = false; return; }
    if (normalized.length !== 5) { zipLoading = false; return; }

    const match = countyForMississippiZip(normalized);
    if (!match) {
      zipLoading = false;
      zipError = 'That ZIP was not found as a Mississippi ZIP code.';
      render(preserveFocus);
      return;
    }

    zipCounty = match;
    zipLoading = true;
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/ma-plan-availability?county=${encodeURIComponent(match.county)}`, { headers, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to check 2027 plan availability.');
      if (token !== zipToken) return;
      availablePlanIds = new Set(Array.isArray(payload.plans) ? payload.plans : []);
      zipLoading = false;
      render(preserveFocus);
    } catch (error) {
      if (token !== zipToken) return;
      zipLoading = false;
      zipError = error?.message || 'Unable to check this ZIP right now.';
      render(preserveFocus);
    }
  }

  function carrierMarkup(carrier) {
    const plans = visiblePlansForCarrier(carrier);
    if (!plans.length) return '';
    return `
      <section class="ma-carrier-section" data-ma-carrier="${esc(carrier)}">
        <div class="ma-carrier-head">
          <h2>${esc(carrier)}</h2>
          <span>${plans.length} plan${plans.length === 1 ? '' : 's'}</span>
        </div>
        <div class="ma-plan-list">
          ${plans.map(plan => {
            const checked = selected.has(plan.plan_number);
            return `
              <label class="ma-plan-row${checked ? ' selected' : ''}">
                <input type="checkbox" data-ma-plan="${esc(plan.plan_number)}" ${checked ? 'checked' : ''} ${!checked && selected.size >= 5 ? 'disabled' : ''}>
                <span class="ma-plan-copy">
                  <strong>${esc(plan.plan_name)}</strong>
                  <small>${esc(plan.plan_number)}</small>
                  <em>${esc(plan.medicaid_label)}</em>
                </span>
              </label>`;
          }).join('')}
        </div>
      </section>`;
  }

  function pageMarkup() {
    return `
      <section class="ma-plans-page">
        <header class="ma-plans-intro">
          <div>
            <span class="eyebrow">Mississippi • ${MA_PLAN_YEAR}</span>
            <h2>Medicare Advantage Plans</h2>
            <p>Select up to 5 plans to compare benefits side by side.</p>
          </div>
          <div class="ma-plan-actions">
            <span data-ma-count>${selected.size} of 5 selected</span>
            <button type="button" class="btn secondary" data-ma-clear ${selected.size ? '' : 'disabled'}>Clear</button>
            <button type="button" class="btn primary" data-ma-compare ${selected.size ? '' : 'disabled'}>Compare Plans</button>
          </div>
        </header>
        <section class="ma-filter-bar ma-filter-bar-expanded" aria-label="MA plan filters">
          <label class="ma-zip-filter">
            <span>ZIP code</span>
            <input data-ma-zip value="${esc(zipCode)}" inputmode="numeric" maxlength="5" placeholder="Example: 38834" autocomplete="postal-code">
            <small data-ma-zip-status>${zipLoading ? 'Checking 2027 CMS plan availability…' : zipError ? esc(zipError) : zipCounty ? `${esc(zipCounty.county)} County, Mississippi` : 'Enter a 5-digit Mississippi ZIP'}</small>
          </label>
          <div class="ma-carrier-picker">
            <span class="ma-filter-label">Carriers</span>
            <div class="ma-carrier-buttons" role="group" aria-label="Select Medicare Advantage carriers">
              ${MA_CARRIERS.map(carrier => {
                const active = carrierFilters.includes(carrier);
                const label = carrier === 'UnitedHealthcare' ? 'UHC' : carrier;
                return `<button type="button" class="ma-carrier-toggle${active ? ' active' : ''}" data-ma-carrier-toggle="${esc(carrier)}" aria-pressed="${String(active)}">${esc(label)}</button>`;
              }).join('')}
            </div>
          </div>
          <label>
            <span>Medicaid level</span>
            <select data-ma-medicaid-filter>
              ${[
                ['ALL','All Medicaid levels'],
                ['NONE','No Medicaid / regular MA'],
                ['QMB','QMB'],
                ['QMB+','QMB+'],
                ['SLMB','SLMB'],
                ['SLMB+','SLMB+'],
                ['QI','QI'],
                ['QDWI','QDWI'],
                ['FBDE','FBDE / Full Medicaid']
              ].map(([value,label]) => `<option value="${value}"${medicaidFilter === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </section>
        <div class="ma-plan-note">
          <strong>2027 Mississippi reference • 64 plans.</strong>
          Benefits are loaded from the October 10, 2026 Mississippi plan reference. Exact Medicaid levels are shown where verified. “Dual eligible — verify exact Medicaid level” means the source did not confirm the exact Medicaid category list.
        </div>
        <div class="ma-carrier-grid">
          ${chosenCarriers().length
  ? (zipCode && zipCode.length !== 5
      ? '<div class="ma-no-results">Enter the complete 5-digit ZIP code to filter plan availability.</div>'
      : zipLoading
        ? '<div class="ma-no-results">Checking CMS 2027 plan availability for this ZIP…</div>'
        : zipError
          ? `<div class="ma-no-results">${esc(zipError)}</div>`
          : chosenCarriers().map(carrierMarkup).join('') || '<div class="ma-no-results">No matching 2027 plans were found for those selections.</div>')
  : '<div class="ma-no-results">Select at least one carrier above to show plans.</div>'}
        </div>
      </section>`;
  }

  function compareMarkup(plans) {
    return `
      <div class="ma-compare-wrap">
        <div class="ma-compare-scroll">
          <table class="ma-compare-table">
            <thead>
              <tr>
                <th>Benefit / Cost</th>
                ${plans.map(plan => `
                  <th>
                    <span>${esc(plan.carrier)}</span>
                    <strong>${esc(plan.plan_name)}</strong>
                    <small>${esc(plan.plan_number)}</small>
                  </th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${ROWS.map(([label, key]) => `
                <tr>
                  <th>${esc(label)}</th>
                  ${plans.map(plan => `<td>${esc(plan[key] || 'Verify in official 2027 SOB/EOC')}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="ma-compare-footnote">2027 Mississippi plans. Verify county/service area, Medicaid/LIS eligibility, and final benefit details in the carrier Summary of Benefits or Evidence of Coverage before enrollment.</p>
      </div>`;
  }

  function openComparison() {
    const plans = selectedPlans();
    if (!plans.length) return;
    dialogs.open({
      title: `Compare MA Plans (${plans.length})`,
      hint: '2027 Mississippi Medicare Advantage comparison',
      kind: 'ma-plan-compare-dialog',
      body: compareMarkup(plans)
    });
  }

  function bind() {
    if (!host?.isConnected) return;
    host.querySelectorAll('[data-ma-plan]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.dataset.maPlan;
        if (input.checked) {
          if (selected.size >= 5 && !selected.has(id)) {
            input.checked = false;
            alert('You can compare up to 5 plans at a time.');
            return;
          }
          selected.add(id);
        } else {
          selected.delete(id);
        }
        render();
      });
    });
    host.querySelectorAll('[data-ma-carrier-toggle]').forEach(button => {
      button.addEventListener('click', () => toggleCarrier(button.dataset.maCarrierToggle));
    });
    const zipInput = host.querySelector('[data-ma-zip]');
    if (zipInput) {
      let timer = null;
      zipInput.addEventListener('input', event => {
        const value = String(event.target.value || '').replace(/\D/g, '').slice(0, 5);
        event.target.value = value;
        zipCode = value;
        window.clearTimeout(timer);

        const status = host.querySelector('[data-ma-zip-status]');
        if (value.length < 5) {
          zipToken++;
          zipLoading = false;
          zipCounty = null;
          availablePlanIds = null;
          zipError = '';
          if (status) status.textContent = value ? 'Enter the complete 5-digit Mississippi ZIP' : 'Enter a 5-digit Mississippi ZIP';
          return;
        }

        if (status) status.textContent = 'Checking 2027 plan availability…';
        timer = window.setTimeout(() => void loadZipAvailability(value, true), 120);
      });
    }
    host.querySelector('[data-ma-medicaid-filter]')?.addEventListener('change', event => {
      medicaidFilter = event.target.value;
      render();
    });
    host.querySelector('[data-ma-compare]')?.addEventListener('click', openComparison);
    host.querySelector('[data-ma-clear]')?.addEventListener('click', () => {
      selected.clear();
      render();
    });
  }

  function render(preserveZipFocus = false) {
    if (!host?.isConnected) return;
    const currentZip = host.querySelector('[data-ma-zip]');
    const activeZip = preserveZipFocus || document.activeElement === currentZip;
    const zipSelection = activeZip && document.activeElement instanceof HTMLInputElement
      ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
      : null;
    host.innerHTML = pageMarkup();
    bind();
    if (activeZip) {
      const input = host.querySelector('[data-ma-zip]');
      if (input) {
        input.focus({ preventScroll: true });
        const start = zipSelection?.[0] ?? input.value.length;
        const end = zipSelection?.[1] ?? start;
        try { input.setSelectionRange(start, end); } catch {}
      }
    }
  }

  return {
    mount(target) {
      host = target;
      render();
    },
    unmount() {
      host = null;
    },
    destroy() {
      host = null;
      selected.clear();
    }
  };
}
