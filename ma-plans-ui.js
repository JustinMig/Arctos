import { MA_CARRIERS, MA_PLAN_YEAR, MA_PLANS_2027 } from './ma-plans-data.js?v=ma-plans-5';
import { get2027PlanDocuments, applyVerified2027Benefits, audit2027Plan } from './ma-plan-documentation-2027.js';
import { countyForMississippiZip, MS_ZIP_COUNTY } from './ma-ms-zip-county.js?v=ma-plans-4';
import { supabase } from './supabase-repository.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const MS_COUNTIES = Object.freeze([...new Set(Object.values(MS_ZIP_COUNTY).map(row => row.county))].sort((a,b) => a.localeCompare(b)));

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
  ['Part D prescription drug coverage', 'part_d'],
  ['CMS 2027 overall star rating', 'overall_star_rating'],
  ['CMS D-SNP zero-dollar cost-sharing designation', 'zero_dollar_cost_sharing_dsnp'],
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
  let carrierFilters = [...MA_CARRIERS];
  let medicaidFilter = 'ALL';
  let zipCode = '';
  let zipCounty = null;
  let countySelection = '';
  let countyCatalog = [];
  let availablePlanIds = null;
  let zipLoading = false;
  let zipError = '';
  let zipToken = 0;

  function verifiedPlan(plan) {
    const corrected = applyVerified2027Benefits(plan);
    if (!Array.isArray(plan._cms_verified_fields)) return corrected;
    // CMS county-specific numbers must not be overwritten by a generic plan
    // reference when a contract has multiple geographic segments.
    for (const field of plan._cms_verified_fields)
      if (plan[field]) corrected[field] = plan[field];
    return corrected;
  }

  function catalog() {
    if (!countySelection && !zipCode) return MA_PLANS_2027.map(verifiedPlan);
    if (!(availablePlanIds instanceof Set)) return [];
    const detailed = new Map(MA_PLANS_2027.map(plan => [plan.plan_number,plan]));
    const combined = new Map();
    // The current CMS landscape has the complete 2027 plan inventory and
    // county-specific premiums/MOOP. Previously entered reference benefits
    // supplement it, but never replace newer CMS county-specific amounts.
    for (const entry of countyCatalog) {
      if (!MA_CARRIERS.includes(entry.carrier) || !availablePlanIds.has(entry.plan_number)) continue;
      const saved = detailed.get(entry.plan_number);
      combined.set(entry.plan_number, verifiedPlan({
        ...(saved || {}), ...entry,
        premium:entry.premium || saved?.premium || 'Verify 2027 SOB/EOC',
        medical_moop:entry.medical_moop || 'Verify county-specific 2027 SOB/EOC',
        drug_deductible:entry.drug_deductible || saved?.drug_deductible || 'Verify 2027 SOB/EOC',
        rx_oop:entry.rx_oop || saved?.rx_oop || 'Verify 2027 Part D OOP/SB',
        medicaid_levels:saved?.is_dsnp === entry.is_dsnp && saved?.medicaid_levels?.[0] !== 'DUAL_VERIFY'
          ? saved.medicaid_levels : entry.medicaid_levels,
        medicaid_label:saved?.is_dsnp === entry.is_dsnp && saved?.medicaid_levels?.[0] !== 'DUAL_VERIFY'
          ? saved.medicaid_label : entry.medicaid_label,
        source_note:'2027 CMS county values; other benefit lines may be unverified references except for explicit 2027 SB corrections.',
        _cms_verified_fields:Array.isArray(entry._cms_verified_fields) ? entry._cms_verified_fields : ['premium','medical_moop','drug_deductible','rx_oop'].filter(key=>Boolean(entry[key]))
      }));
    }
    for (const plan of MA_PLANS_2027) {
      if (availablePlanIds.has(plan.plan_number) && !combined.has(plan.plan_number))
        combined.set(plan.plan_number,verifiedPlan(plan));
    }
    return [...combined.values()].sort((a,b)=>a.carrier.localeCompare(b.carrier) || a.plan_name.localeCompare(b.plan_name));
  }

  function selectedPlans() {
    return catalog().filter(plan => selected.has(plan.plan_number));
  }

  function displayValue(plan,key) {
    if (key === 'part_d') return plan.part_d === true ? 'Included' : plan.part_d === false ? 'NOT included — no Part D coverage' : 'Verify 2027 carrier documents';
    const value = plan?.[key];
    return value == null || String(value).trim() === '' ? 'Not verified in 2027 SB/EOC' : String(value);
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
    // Unverified D-SNP Medicaid levels are not proof of eligibility for a chosen level.
    return plan.is_dsnp === true && Array.isArray(plan.medicaid_levels) && plan.medicaid_levels.includes(medicaidFilter);
  }

  function matchesCounty(plan) {
    if (!countySelection && !zipCode) return true;
    if (zipLoading || zipError || !(availablePlanIds instanceof Set)) return false;
    return availablePlanIds.has(plan.plan_number);
  }

  function visiblePlansForCarrier(carrier) {
    return catalog().filter(plan => plan.carrier === carrier && matchesMedicaid(plan) && matchesCounty(plan));
  }

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Your Mayer MIG CRM session expired. Sign in again.');
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function loadCountyAvailability(county, preserveFocus = false) {
    const token = ++zipToken;
    availablePlanIds = null;
    countyCatalog = [];
    zipError = '';
    if (!county) { zipLoading = false; render(preserveFocus); return; }
    zipLoading = true;
    render(preserveFocus);
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/ma-plan-availability?county=' + encodeURIComponent(county), {
        headers, cache:'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to check CMS 2027 county plan data.');
      if (token !== zipToken) return;
      if (payload.plan_year !== 2027 || !Array.isArray(payload.plans) || !Array.isArray(payload.entries))
        throw new Error('2027 CMS plan data was incomplete; no plans were displayed.');
      availablePlanIds = new Set(payload.plans);
      countyCatalog = payload.entries;
      zipLoading = false;
      selected.clear();
      render(preserveFocus);
    } catch (error) {
      if (token !== zipToken) return;
      zipLoading = false;
      zipError = error?.message || 'Unable to check the CMS 2027 Landscape right now.';
      render(preserveFocus);
    }
  }

  async function loadZipAvailability(value, preserveFocus = false) {
    zipCode = String(value || '').replace(/\D/g, '').slice(0,5);
    if (!zipCode) {
      countySelection = '';
      zipCounty = null;
      await loadCountyAvailability('', preserveFocus);
      return;
    }
    if (zipCode.length !== 5) return;
    const match = countyForMississippiZip(zipCode);
    if (!match) {
      ++zipToken;
      zipCounty = null;
      countySelection = '';
      zipLoading = false;
      zipError = 'That ZIP was not found as a Mississippi ZIP code.';
      render(preserveFocus);
      return;
    }
    zipCounty = match;
    countySelection = match.county;
    await loadCountyAvailability(match.county,preserveFocus);
  }

  function documentsMarkup(plan) {
    const docs = get2027PlanDocuments(plan);
    const audit = audit2027Plan(plan);
    const link = (url,label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
    return `<div class="ma-plan-source-status">
      <span class="${docs.directSB ? 'ma-sb-ready' : 'ma-sb-search'}">${docs.directSB ? 'Official 2027 SB found' : 'Official 2027 document lookup'}</span>
      <span>${audit.fieldsWithoutVerifiedSource.length} of ${audit.total} benefit fields need confirmation</span>
      ${audit.verifiedSBFields ? `<span>${audit.verifiedSBFields} fields checked against 2027 SB</span>` : ''}
    </div><div class="ma-plan-document-links">
      ${link(docs.sb,docs.directSB ? '2027 Summary of Benefits PDF' : 'Find 2027 Summary of Benefits')}
      ${link(docs.eoc,docs.directEOC ? '2027 Evidence of Coverage PDF' : 'Find 2027 Evidence of Coverage')}
    </div>
    ${!docs.directSB ? '<small class="ma-document-notice">Select plan year 2027 and verify the exact plan ID in the carrier lookup.</small>' : ''}`;
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
              <div class="ma-plan-result">
                <label class="ma-plan-row${checked ? ' selected' : ''}">
                  <input type="checkbox" data-ma-plan="${esc(plan.plan_number)}" ${checked ? 'checked' : ''} ${!checked && selected.size >= 5 ? 'disabled' : ''}>
                  <span class="ma-plan-copy">
                    <strong>${esc(plan.plan_name)}</strong>
                    <small>${esc(plan.display_plan_id || plan.plan_number)}</small>
                    ${plan.is_isnp ? '<em class="ma-plan-special-eligibility">I-SNP requires qualifying institutional status</em>' : ''}
                    ${plan.is_dsnp && plan.medicaid_levels.includes("DUAL_VERIFY") ? '<em class="ma-plan-special-eligibility">Medicaid level NOT verified: check 2027 SB/EOC</em>' : ''}
                    ${plan.part_d === false ? '<em class="ma-plan-no-rx">No Part D prescription drug coverage</em>' : ''}
                    <em>${esc(plan.is_csnp || /C-SNP/i.test(plan.plan_type || '') ? 'C-SNP — qualifying chronic condition required; no Medicaid requirement' : plan.medicaid_label)}</em>
                  </span>
                </label>
                <div class="ma-plan-documents">${documentsMarkup(plan)}</div>
              </div>`;
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
            <p>Select a Mississippi county or ZIP and compare up to 5 plans. Plan segments may differ by county.</p>
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
            <small data-ma-zip-status>${zipLoading ? 'Checking 2027 CMS plan availability…' : zipError ? esc(zipError) : zipCounty ? `${esc(zipCounty.county)} County, Mississippi` : 'Or choose county below'}</small>
          </label>
          <label class="ma-county-filter"><span>County (all 82 Mississippi counties)</span><select data-ma-county><option value="">Choose county for full 2027 listing</option>${MS_COUNTIES.map(county => `<option value="${esc(county)}"${countySelection === county ? ' selected' : ''}>${esc(county)} County</option>`).join('')}</select></label>
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
                ['NONE','No Medicaid requirement (MA or C-SNP)'],
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
          <strong>2027 Mississippi • five carriers • ${countySelection ? esc(countySelection) + ' County' : 'statewide reference'}.</strong>
          ${countySelection ? 'CMS 2027 county-specific contract/PBP and segment, premiums, deductibles and MOOP are checked against the official CMS Landscape. All other benefits still require exact-plan 2027 SB/EOC verification.' : 'Choose a county to see the official 2027 plan inventory. The static statewide reference is not sufficient to determine service-area or segment-specific benefits.'}
          <a href="https://www.cms.gov/medicare/coverage/prescription-drug-coverage" target="_blank" rel="noopener noreferrer">CMS 2027 Landscape</a> ·
          <a href="https://q1medicare.com/2027/medicare-advantage/ms" target="_blank" rel="noopener noreferrer">Q1Medicare 2027 Mississippi plans</a>
        </div>
        <p class="ma-plan-caution">The medical MOOP is the plan maximum, not necessarily what a QMB/D-SNP member owes. CMS lists the standard Part D deductible and premium; Extra Help/LIS may reduce what an individual pays. Food/utility cards require separate eligibility. ZIP codes can cross county lines; verify the beneficiary's actual county.</p>
        ${medicaidFilter !== 'ALL' && medicaidFilter !== 'NONE' ? '<p class="ma-plan-caution">D-SNPs without confirmed accepted Medicaid levels are hidden under this specific filter. Select All Medicaid levels to review unverified D-SNPs.</p>' : ''}
        <div class="ma-carrier-grid">
          ${chosenCarriers().length
  ? (!countySelection && !zipCode
      ? '<div class="ma-no-results">Select a Mississippi county or enter a complete ZIP code to see available 2027 plans.</div>'
      : zipCode && zipCode.length !== 5
      ? '<div class="ma-no-results">Enter the complete 5-digit ZIP code to filter plan availability.</div>'
      : zipLoading
        ? '<div class="ma-no-results">Checking CMS 2027 plan availability for this county…</div>'
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
                    <small>${esc(plan.display_plan_id || plan.plan_number)}</small>
                  </th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${ROWS.map(([label, key]) => `
                <tr>
                  <th>${esc(label)}</th>
                  ${plans.map(plan => `<td>${esc(displayValue(plan,key))}<small class="ma-value-status">${plan._cms_verified_fields?.includes(key) ? 'Official CMS 2027 county/segment' : plan._sb_verified_fields?.includes(key) ? 'Checked: 2027 SB' : 'Reference only — verify 2027 SB/EOC'}</small></td>`).join('')}
                </tr>`).join('')}
              <tr class="ma-documents-row"><th>2027 plan documents</th>
                ${plans.map(plan => `<td>${documentsMarkup(plan)}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
        <p class="ma-compare-footnote">Official CMS CY2027 Landscape (as of 2026-09-22) controls county/segment availability and base costs; MOOP is not the same as QMB member costs. Compare remaining benefits with each carrier's official 2027 Summary of Benefits/Evidence of Coverage before enrollment. HealthSpring: <a href="https://www.healthspring.com/medicare/member-resources/plan-documents" target="_blank" rel="noopener noreferrer">official plan documents</a>.</p>
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
          countySelection = '';
          countyCatalog = [];
          availablePlanIds = null;
          selected.clear();
          zipError = '';
          if (status) status.textContent = value ? 'Enter the complete 5-digit Mississippi ZIP' : 'Enter a 5-digit Mississippi ZIP';
          render(true);
          return;
        }

        if (status) status.textContent = 'Checking 2027 plan availability…';
        timer = window.setTimeout(() => void loadZipAvailability(value, true), 120);
      });
    }
    host.querySelector('[data-ma-county]')?.addEventListener('change', event => {
      countySelection = String(event.target.value || '');
      zipCode = '';
      zipCounty = countySelection ? {county:countySelection} : null;
      selected.clear();
      void loadCountyAvailability(countySelection);
    });
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
