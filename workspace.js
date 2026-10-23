import { NAV, CLIENT_TABS, esc, disconnectedRepository, todayKey, parseISO, dateText, isoDate, monthDays, longDate, timeLabel, sortAppointmentsByStartTime, hydrate, serializable } from './core.js';
import { clientSearchMarkup, clientResultsMarkup, clientResultContent, clientSortDirectionOptions, clientSortDescription } from './client-search.js?v=compact-deceased-1';
import { appointmentSlots, slotIsBooked } from './campaigns-model.js';
import { Dialogs } from './dialogs.js';
import { ageFromBirthDate } from './client-age-utils.js?v=2026-10-23';
import { supabase } from './supabase-repository.js';
import { shell, TOOLS, icon, empty, note, pending, saveFooter, options, input, dateInput, select, textArea, clientForm, calendarMarkup, dailyDashboardMarkup } from './views.js?v=client-campaign-fix-1';

/** Repository injection is for the future isolated backend and local tests, never a legacy connection. */
export function createWorkspace(root, repository = disconnectedRepository, { ensureClientFeatures, ensureCampaignFeatures, ensureLeadFeatures, ensureQuickFeatures } = {}) {
  if (!(root instanceof HTMLElement)) throw new TypeError('Arctos needs an application root.');
  const dialogs = new Dialogs();
  let campaignFeature = null, campaignModule = null;
  let workFeature = null, workModule = null;
  async function workQueue() {
    if(!workModule) workModule=import('./work-queue-ui.js?v=arctos-work-1')
      .then(({createWorkQueueFeature})=>{
        workFeature=createWorkQueueFeature({
          openCampaign:showWorkCampaign,
          openLead:openWorkLead,
          openClient,
          openAppointment:openWorkAppointment
        });
        return workFeature;
      }).catch(error=>{workModule=null;throw error;});
    return workModule;
  }
  let athenaFeature = null, athenaModule = null;
  async function athenaMedicare() {
    if (!athenaModule) athenaModule = import('./athena-medicare.js?v=old-plan-1')
      .then(({ createAthenaMedicareFeature }) => {
        athenaFeature = createAthenaMedicareFeature();
        return athenaFeature;
      }).catch(error => { athenaModule = null; throw error; });
    return athenaModule;
  }
  let maPlansFeature = null, maPlansModule = null;
  async function maPlans() {
    if (!maPlansModule) maPlansModule = import('./ma-plans-ui.js?v=ma-plans-6').then(({ createMAPlansFeature }) => {
      maPlansFeature = createMAPlansFeature({ dialogs });
      return maPlansFeature;
    }).catch(error => { maPlansModule = null; throw error; });
    return maPlansModule;
  }
  async function campaigns() {
    if (!repository.campaigns) throw new Error('Campaign storage is not connected.');
    if (ensureCampaignFeatures) await ensureCampaignFeatures();
    if (!campaignModule) campaignModule = import('./campaigns-ui.js?v=client-campaign-fix-1').then(({ createCampaignFeature }) => {
      campaignFeature = createCampaignFeature({ repository, dialogs, openClient, onCalendarChange: () => { state.calendarLoadedKey = ''; state.calendarLoadedAt = 0; state.events = []; drawCalendar({ force: true }); } });
      return campaignFeature;
    }).catch(error => { campaignModule = null; throw error; });
    return campaignModule;
  }
  const now = new Date();
  const calendarMonthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  // Never display a previous agent's cached appointments after account switching.
  const calendarSessionKey = key => `mig-calendar:${repository.user?.id || 'anonymous'}:${key}`;
  function readCalendarSession(key) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(calendarSessionKey(key)) || 'null');
      if (!cached || !Array.isArray(cached.events)) return null;
      return cached;
    } catch { return null; }
  }
  function writeCalendarSession(key, events) {
    try {
      sessionStorage.setItem(calendarSessionKey(key), JSON.stringify({ events, loadedAt: Date.now() }));
    } catch {}
  }
  const initialCalendarKey = calendarMonthKey(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  const initialCalendarCache = readCalendarSession(initialCalendarKey);
  const state = {
    route: 'dashboard', month: new Date(now.getFullYear(), now.getMonth(), 1, 12),
    events: initialCalendarCache?.events || [], calendarToken: 0,
    calendarLoadedKey: initialCalendarCache ? initialCalendarKey : '',
    calendarLoadedAt: initialCalendarCache?.loadedAt || 0,
    calendarLoadingKey: '',
    search: { query: '', product: '', agent: '', sortBy: 'name', sortDirection: 'asc', applied: null, loading: false, rows: null, error: '', message: '', token: 0, cursor: null, nextCursor: null },
    archive: { open:false, rows:null, loading:false, error:'', message:'', nextCursor:null, token:0 },
    destroyed: false
  };
  const connected = repository.connected === true;
  const agents = Array.isArray(repository.agents) ? repository.agents : [];
  const money = v => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
  const info = connected ? '' : note(pending);

  function pageBody(route) {
    if (route === 'dashboard') return '<div id="daily-summary-host"></div><details class="daily-calendar" data-daily-calendar><summary><span class="daily-calendar-label">Monthly Calendar <small>Open the full appointment calendar when you need it</small></span><span class="daily-calendar-toggle-label">Show calendar ↓</span></summary><div id="calendar-host"></div></details><p class="daily-dashboard-error" data-daily-error hidden role="status"></p>';
    if (route === 'work') return '<div id="work-queue-host"><p class="subtle">Opening Work Queue…</p></div>'+
      '<section class="wq-campaign-panel" id="work-campaign-panel" hidden><header class="wq-campaign-back"><h3>Campaigns</h3><button type="button" class="btn secondary" data-work-back>← Back to Work Queue</button></header>'+
      '<div id="work-campaign-host"></div></section>';
    if (route === 'campaigns') return '<div id="campaigns-host"><p class="subtle">Loading campaigns…</p></div>';
    if (route === 'ma-plans') return '<div id="ma-plans-host"><p class="subtle">Loading 2027 Mississippi MA plans…</p></div>';
    if (route === 'athena-medicare') return '<div id="athena-medicare-host"><p class="subtle">Opening Athena\'s Medicare…</p></div>';
    if (route === 'clients') return clientSearchMarkup(state.search, agents);
    if (route === 'appointments') return '<div id="calendar-host"></div>';
    if (route === 'communications') return `<div class="panel-card dark-card"><h2>Communications</h2><div class="integration-grid">${['RingCentral Voice', 'Client Text Messages', 'Call Recordings'].map(x => `<div><h3>${x}</h3><span class="tag">Not connected</span></div>`).join('')}</div>${empty('No conversation selected', 'Calls, texts, and recordings are not connected to this framework.')}</div>`;
    if (route === 'notifications') return `<section class="panel-card dark-card">${empty('No notifications loaded', 'Form submissions and activity notifications require the new backend.')}</section>`;
    if (route === 'agents') return `<section class="panel-card dark-card"><h2>Roles &amp; Permissions</h2><p class="muted">Planned roles; no user accounts are created by this framework.</p><div class="integration-grid">${['Owner', 'Admin', 'Agent', 'Assistant'].map(role => `<div><h3>${role}</h3><span class="tag">Not configured</span></div>`).join('')}</div></section>`;
    return `<section class="panel-card dark-card"><h2>Arctos Environment</h2><dl class="settings-list"><dt>Site</dt><dd>mig.mayerig.com</dd><dt>Repository</dt><dd>JustinMig/MayerMig_CRM</dd><dt>Hosting project</dt><dd>mayer-mig-crm</dd><dt>Database / authentication</dt><dd>${connected ? 'Repository connected; review server permissions separately' : 'Not connected'}</dd><dt>Document storage</dt><dd>Not connected</dd><dt>App Store</dt><dd>Native packaging, signing, and submission not configured</dd></dl><p class="muted">Arctos retains the existing CRM records, logins, hosting, and integrations. Technical resource names may still use the original identifiers.</p></section>`;
  }
  function render(route) {
    workFeature?.unmount();
    campaignFeature?.unmount();
    maPlansFeature?.unmount();
    athenaFeature?.unmount();
    state.route = route;
    root.innerHTML = shell(route, connected, pageBody(route));
    root.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => openTool(button.dataset.tool));
    root.querySelectorAll('[data-add-client]').forEach(button => button.onclick = () => openClient());
    root.querySelectorAll('[data-new-appointment]').forEach(button => button.onclick = () => openAppointment());
    const menu = root.querySelector('.menu-toggle'), sidebar = root.querySelector('.sidebar'), shade = root.querySelector('.sidebar-shade');
    const closeMenu = () => { sidebar.classList.remove('open'); shade.hidden = true; menu.setAttribute('aria-expanded', 'false'); };
    menu.onclick = () => { const open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); shade.hidden = !open; menu.setAttribute('aria-expanded', String(open)); };
    shade.onclick = closeMenu;
    root.querySelector('.nav').onclick = event => {
      const trigger = event.target.closest('[data-nav-toggle]');
      if (trigger) {
        const section = trigger.dataset.navToggle;
        const children = root.querySelector('#nav-children-' + section);
        if (!children) return;
        const open = children.hidden;
        children.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        return;
      }
      const go = event.target.closest('[data-nav-go]');
      if (go) {
        closeMenu();
        location.hash = '#/' + go.dataset.navGo;
        return;
      }
      if (event.target.closest('a[href], [data-tool]')) closeMenu();
    };
    if (route === 'clients') {
      bindSearch();
      bindDeceasedArchive();
      // Start client enhancements while the user is searching, before they open the editor.
      if (ensureClientFeatures) void ensureClientFeatures().catch(error => console.error('Client features unavailable:', error));
    }
    if (route === 'work') {
      const host=root.querySelector('#work-queue-host');
      workQueue().then(feature=>{if(host.isConnected&&!state.destroyed)feature.mount(host);})
        .catch(error=>{if(host.isConnected)host.innerHTML=empty('Work Queue unavailable',error.message);});
      root.querySelector('[data-work-back]')?.addEventListener('click',()=>{
        campaignFeature?.unmount();
        const panel=root.querySelector('#work-campaign-panel'),list=root.querySelector('#work-queue-host');
        if(panel)panel.hidden=true;
        if(list)list.hidden=false;
        workFeature?.refresh();
      });
    }
    if (route === 'campaigns') {
      const host = root.querySelector('#campaigns-host');
      campaigns().then(feature => { if (host.isConnected && !state.destroyed) feature.mount(host); }).catch(error => { if (host.isConnected) host.innerHTML = empty('Campaigns unavailable', error.message); });
    }
    if (route === 'athena-medicare') {
      const host = root.querySelector('#athena-medicare-host');
      athenaMedicare().then(feature => {
        if (host.isConnected && !state.destroyed) feature.mount(host);
      }).catch(error => {
        if (host.isConnected) host.innerHTML = empty("Athena's Medicare unavailable", error.message);
      });
    }
    if (route === 'ma-plans') {
      const host = root.querySelector('#ma-plans-host');
      maPlans().then(feature => { if (host.isConnected && !state.destroyed) feature.mount(host); }).catch(error => { if (host.isConnected) host.innerHTML = empty('MA Plans unavailable', error.message); });
    }
    if (route === 'dashboard') {
      const details = root.querySelector('[data-daily-calendar]');
      details?.addEventListener('toggle', () => { if(details.open) drawCalendar(); else renderVisibleCalendar(); });
      drawDailyDashboard();
    }
    if (root.querySelector('#calendar-host')) drawCalendar();
  }

  async function showWorkCampaign(campaignId=null) {
    const container=root.querySelector('#work-campaign-panel');
    const host=root.querySelector('#work-campaign-host');
    const queue=root.querySelector('#work-queue-host');
    if(!container||!host||!queue)return;
    container.hidden=false;
    queue.hidden=true;
    host.innerHTML='<p class="subtle">Loading campaign…</p>';
    try {
      const feature=await campaigns();
      if(container.isConnected && !state.destroyed && state.route==='work'){
        feature.mount(host,{campaignId});
        container.scrollIntoView({block:'start'});
      }
    }catch(error){if(host.isConnected)host.innerHTML=empty('Campaign unavailable',error.message||'Please try again.');}
  }
  async function openWorkLead(id) {
    try {
      if (ensureLeadFeatures) await ensureLeadFeatures();
      const {openLeadFromQueue}=await import('./leads-icon-screen.js?v=arctos-work-1');
      await openLeadFromQueue(id);
    }catch(error){alert(error?.message||'Unable to open the lead. Refresh the Work Queue.');}
  }
  async function openWorkAppointment(id) {
    try {
      // The appointment is fetched by ID through existing database permissions.
      const {supabase}=await import('./supabase-repository.js');
      const {data,error}=await supabase.from('appointments').select('*').eq('id',id).single();
      if(error)throw error;
      if(!data?.id)throw Error('Appointment could not be found.');
      openAppointment(data.event_date,data,()=>workFeature?.refresh());
    }catch(error){alert(error?.message||'Unable to open appointment.');}
  }

  function bindDeceasedArchive() {
    // The three existing compact counters are injected after the page mounts.
    // Delegate the click so their matching compact Deceased card works immediately.
    const searchArea = root.querySelector('#client-active-search');
    const close = root.querySelector('[data-close-deceased]');
    if (!searchArea || !close) return;
    state.archive.token++;
    state.archive.open = false;
    state.archive.loading = false;
    const display = open => {
      state.archive.open = open;
      const button = root.querySelector('[data-open-deceased]');
      const search = root.querySelector('#client-active-search');
      const archive = root.querySelector('#deceased-client-archive');
      if (search) search.hidden = open;
      if (archive) archive.hidden = !open;
      if (button) {
        button.setAttribute('aria-expanded', String(open));
        button.classList.toggle('is-selected',open);
      }
      if (open) void loadDeceasedClients(false);
      else {
        state.archive.token++;
        state.archive.loading = false;
      }
    };
    searchArea.addEventListener('click', event => {
      if (event.target.closest('[data-open-deceased]')) display(!state.archive.open);
    });
    close.addEventListener('click', () => {
      display(false);
      root.querySelector('[data-open-deceased]')?.focus();
    });
  }
  async function loadDeceasedClients(more = false) {
    const a = state.archive;
    if (more && (a.loading || !a.nextCursor)) return;
    const token = ++a.token;
    if (!more) { a.rows=null; a.nextCursor=null; }
    a.loading = true; a.error=''; a.message='Loading deceased client records…';
    drawDeceasedClients();
    try {
      const restrictedAgent = ['owner','admin'].includes(repository.profile?.role)
        ? '' : repository.user?.id;
      if (restrictedAgent === undefined) throw new Error('Sign in before opening deceased client records.');
      const result = await repository.searchClients({
        product:'deceased',query:'',agent:restrictedAgent,sortBy:'name',sortDirection:'asc',
        limit:50,cursor:more?a.nextCursor:null
      });
      if (token !== a.token || state.destroyed || !a.open || state.route !== 'clients') return;
      if (!result || !Array.isArray(result.rows)) throw new Error('Archive query returned invalid records.');
      // Server-side status filtering keeps this list completely separate from active searches.
      const rows = more?[...(a.rows||[]),...result.rows]:result.rows;
      a.rows = [...new Map(rows.filter(row=>String(row.status||'').toLowerCase()==='deceased').map(row=>[row.id,row])).values()];
      a.nextCursor=result.nextCursor||null;
      a.message=a.rows.length
        ? a.rows.length+' deceased client'+(a.rows.length===1?'':'s')+' shown • Select a client to open their complete record and files.'
        : 'No deceased clients are currently recorded.';
    } catch (error) {
      if (token !== a.token || state.destroyed) return;
      a.error=error?.message||'Unable to load deceased clients.';
      a.message='';
    } finally {
      if (token===a.token && !state.destroyed) { a.loading=false; drawDeceasedClients(); }
    }
  }
  function drawDeceasedClients() {
    const host=root.querySelector('#deceased-client-results');
    if (!host || !state.archive.open) return;
    host.setAttribute('aria-busy',String(state.archive.loading));
    host.innerHTML=clientResultsMarkup(state.archive);
    host.querySelectorAll('[data-client-id]').forEach(button => button.addEventListener('click',()=>openClient(button.dataset.clientId)));
    host.querySelector('[data-more]')?.addEventListener('click',()=>loadDeceasedClients(true));
  }

  function bindSearch() {
    const form = root.querySelector('#client-search');
    for (const key of ['query', 'product', 'agent']) {
      form.elements.namedItem(key).addEventListener('input', e => state.search[key] = e.target.value);
      form.elements.namedItem(key).addEventListener('change', e => state.search[key] = e.target.value);
    }
    const sortBy = form.elements.namedItem('sortBy');
    const direction = form.elements.namedItem('sortDirection');
    sortBy.onchange = () => {
      state.search.sortBy = sortBy.value;
      state.search.sortDirection = sortBy.value === 'created_at' ? 'desc' : 'asc';
      direction.innerHTML = clientSortDirectionOptions(state.search.sortBy, state.search.sortDirection);
      // Changing order alone must not populate the untouched Clients screen.
      if (state.search.applied) form.requestSubmit();
    };
    direction.onchange = () => {
      state.search.sortDirection = direction.value;
      if (state.search.applied) form.requestSubmit();
    };
    form.onsubmit = e => { e.preventDefault(); searchClients(false); };
    form.querySelector('[data-reset-search]').onclick = () => {
      state.search.token++;
      Object.assign(state.search, { query: '', product: '', agent: '', sortBy: 'name', sortDirection: 'asc', applied: null, loading: false, rows: null, error: '', message: '', cursor: null, nextCursor: null });
      for (const key of ['query', 'product', 'agent']) form.elements.namedItem(key).value = '';
      sortBy.value = 'name';
      direction.innerHTML = clientSortDirectionOptions('name', 'asc');
      drawResults();
      form.elements.query.focus();
    };
    drawResults();
  }
  async function searchClients(more = false) {
    const s = state.search;
    if (more && (s.loading || !s.nextCursor || !s.applied)) return;
    const criteria = more ? { ...s.applied } : { query: s.query.trim(), product: s.product, agent: s.agent, sortBy: s.sortBy, sortDirection: s.sortDirection };
    const token = ++s.token;
    const cursor = more ? s.nextCursor : null;
    if (!more) { s.rows = null; s.nextCursor = null; }
    s.error = ''; s.message = ''; s.loading = false;
    if (!more) s.applied = criteria;
    s.loading = true; s.message = 'Searching…'; drawResults();
    try {
      const result = await repository.searchClients({ ...criteria, limit: 50, cursor });
      if (token !== s.token || state.destroyed) return;
      if (!result || !Array.isArray(result.rows)) throw new Error('Client search returned an invalid response.');
      const rows = more ? [...(s.rows || []), ...result.rows] : result.rows;
      s.rows = [...new Map(rows.map(row => [row.id, row])).values()];
      s.nextCursor = result.nextCursor || null;
      s.message = (s.rows.length ? `${s.rows.length} result${s.rows.length === 1 ? '' : 's'} displayed` : 'No matching clients found.') + ` • ${clientSortDescription(criteria.sortBy, criteria.sortDirection)}`;
    } catch (e) {
      if (token !== s.token || state.destroyed) return;
      s.error = connected ? e.message || 'Search failed. Please retry.' : 'Search is not connected to the new database yet. No clients were loaded from the original CRM.';
      s.message = '';
    } finally {
      if (token === s.token && !state.destroyed) {
        s.loading = false;
        if (state.route === 'clients') drawResults();
      }
    }
  }
  function drawResults() {
    const host = root.querySelector('#client-results');
    if (!host) return;
    const toolbar = root.querySelector('[data-client-result-toolbar]');
    if (toolbar) toolbar.hidden = !state.search.applied;
    host.setAttribute('aria-busy', String(state.search.loading));
    host.innerHTML = clientResultsMarkup(state.search);
    host.querySelectorAll('[data-client-id]').forEach(button => button.onclick = () => openClient(button.dataset.clientId));
    host.querySelector('[data-more]')?.addEventListener('click', () => searchClients(true));
    if (repository.campaigns) {
      const token = state.search.token;
      campaigns().then(feature => { if (host.isConnected && token === state.search.token && !state.destroyed) feature.enhanceSearch(host, state.search.rows || []); }).catch(() => {});
    }
  }
  function patchClient(saved) {
    campaignFeature?.refreshClient(saved);
    const isDeceased = String(saved.status||'').toLowerCase()==='deceased';
    if (state.search.rows) {
      state.search.rows = state.search.rows.map(row=>row.id===saved.id?{...row,...saved}:row)
        .filter(row=>String(row.status||'').toLowerCase()!=='deceased');
      const row = root.querySelector(`#client-results [data-client-id="${CSS.escape(saved.id)}"]`);
      const record = state.search.rows.find(item=>item.id===saved.id);
      if (row && record) row.innerHTML = clientResultContent(record);
      else if (row) row.remove();
      if (isDeceased && !state.search.rows.length && state.search.applied) {
        state.search.message='No matching active clients found.';
        drawResults();
      }
    }
    if (state.archive.open) void loadDeceasedClients(false);
  }
  function wireTabs(node) {
    const form=node.querySelector('form.client-form');
    if (!form || !form.classList.contains('client-four-tabs')) return;
    const buttons=[...form.querySelectorAll('[data-client-group-tab]')];
    const panels=[...form.querySelectorAll('[data-client-group-panel]')];
    const sectionToGroup={
      information:'overview',medicare:'coverage',life:'coverage',
      hospital_indemnity:'coverage',retirement:'coverage',
      doctors:'medical',medications:'medical',notes:'files'
    };
    function show(group,{section=null,focus=false}={}) {
      const selected=buttons.find(button=>button.dataset.clientGroupTab===group);
      if(!selected)return;
      // Reset every accordion whenever a main page is selected, including
      // category cards and nested field groups. Do this before showing the
      // destination page so previously expanded cards never carry over.
      form.querySelectorAll('details[open]').forEach(details=>{
        details.removeAttribute('open');
      });
      buttons.forEach(button=>{
        const active=button===selected;
        button.setAttribute('aria-selected',String(active));
        button.tabIndex=active?0:-1;
      });
      panels.forEach(panel=>{
        panel.hidden=panel.dataset.clientGroupPanel!==group;
      });
      if(section){
        const category=form.querySelector('[data-client-category="'+section+'"]');
        if(category)category.open=true;
      }
      if(focus)selected.focus();
    }
    buttons.forEach((button,i)=>{
      button.onclick=()=>show(button.dataset.clientGroupTab);
      button.onkeydown=event=>{
        const index=event.key==='ArrowRight'?(i+1)%buttons.length:
          event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:
          event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
        if(index<0)return;
        event.preventDefault();show(buttons[index].dataset.clientGroupTab,{focus:true});
      };
    });
    // Existing integrations can still click the old [data-tab] hooks. Those
    // hooks reveal the corresponding group and expand the requested card.
    form.querySelectorAll('[data-tab]').forEach(button=>{
      button.addEventListener('click',()=>{
        const section=button.dataset.tab;
        show(sectionToGroup[section]||'overview',{section});
      });
    });
    form.querySelectorAll('[data-client-jump]').forEach(button=>{
      button.addEventListener('click',()=>{
        const section=button.dataset.clientJump;
        show(sectionToGroup[section]||'overview',{section});
      });
    });
    const updateSummary=()=>{
      const value=name=>form.elements.namedItem(name)?.value?.trim()||'';
      const name=[value('first_name'),value('last_name')].filter(Boolean).join(' ')||'New Client';
      const dob=value('date_of_birth'),location=[value('city'),value('state')].filter(Boolean).join(', ');
      const age = ageFromBirthDate(dob);
      const dobAndAge=dob ? 'DOB: '+dob+(age===null?'':' (Age: '+age+')') : '';
      const zip=value('zip')||value('zip_code');
      const details=[dobAndAge,value('phone'),location,zip?'ZIP: '+zip:''].filter(Boolean);
      const title=form.querySelector('[data-client-summary-name]');
      const meta=form.querySelector('[data-client-summary-meta]');
      if(title)title.textContent=name;
      if(meta)meta.textContent=details.join('  •  ')||'Contact information not entered yet.';
    };
    form.addEventListener('input',updateSummary);
    form.addEventListener('change',updateSummary);
    updateSummary();
    // Age is derived afresh every time a record opens and also refreshes at
    // local midnight while the record stays open (including across birthdays).
    // Do not store age: DOB stays the single source of truth.
    let ageRefreshTimer = null;
    const refreshAfterMidnight = () => {
      if(!node.isConnected || !node.open)return;
      const now=new Date();
      const nextMidnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,2);
      ageRefreshTimer=setTimeout(()=>{
        if(!node.isConnected || !node.open)return;
        updateSummary();
        refreshAfterMidnight();
      },Math.max(1000,nextMidnight.getTime()-now.getTime()));
    };
    const onVisibilityChange=()=>{
      if(document.visibilityState==='visible' && node.isConnected && node.open){
        updateSummary();
        clearTimeout(ageRefreshTimer);
        refreshAfterMidnight();
      }
    };
    refreshAfterMidnight();
    document.addEventListener('visibilitychange',onVisibilityChange);
    node.addEventListener('close',()=>{
      clearTimeout(ageRefreshTimer);
      document.removeEventListener('visibilitychange',onVisibilityChange);
    },{once:true});
  }
  const pendingClientOpens = new Map();
  function openClient(id = null) {
    // New client and existing-client editors must not open until specialized
    // form/save handlers are ready. Coalesce rapid taps on a slow iPad.
    if (ensureClientFeatures) {
      const key = id || 'new-client';
      if (pendingClientOpens.has(key)) return pendingClientOpens.get(key);
      const fromRoute = state.route;
      const task = Promise.resolve().then(ensureClientFeatures)
        .then(() => {
          // Do not open a delayed dialog after the user has left the screen.
          if (state.destroyed || state.route !== fromRoute) return;
          return openClientReady(id);
        })
        .catch(error => {
          console.error('Client feature loading failed:', error);
          if (!state.destroyed) alert('Client information could not load. Check your connection and try again. No changes were made.');
        })
        .finally(() => pendingClientOpens.delete(key));
      pendingClientOpens.set(key, task);
      return task;
    }
    return openClientReady(id);
  }
  /**
   * A saved client's Add to Campaign button must work independently of the
   * campaign page and its optional observers. Reuse the authenticated campaign
   * repository directly; the ordinary campaign page still uses its existing UI.
   */
  function openClientCampaignPicker(client, onAdded = () => {}) {
    const api = repository.campaigns;
    if (!api) throw new Error('Campaign storage is not connected.');
    if (!client?.id) throw new Error('Save this client first, then add them to a campaign.');
    if (String(client.status || '').toLowerCase() === 'deceased')
      throw new Error('Deceased clients cannot be added to a campaign.');
    if (!repository.user?.id) throw new Error('Sign in before assigning a campaign.');

    const clientName = [client.first_name, client.last_name].filter(Boolean).join(' ').trim() || 'Client';
    const generatedId = crypto.randomUUID();
    const d = dialogs.open({
      title: 'Add Client to Campaign',
      hint: clientName,
      kind: 'campaign-dialog client-campaign-picker',
      body: `<form class="cmp-form client-campaign-picker-form" novalidate>
        <p class="cmp-help">Select an existing active campaign or create a new campaign. This will add ${esc(clientName)} without changing the client record.</p>
        <label class="field"><span>Campaign</span><select name="campaign_id" required>
          <option value="">Loading active campaigns…</option>
        </select></label>
        <label class="field" data-client-campaign-new hidden>
          <span>New Campaign Name</span>
          <input name="new_campaign_name" type="text" maxlength="120" placeholder="Name of the new campaign">
        </label>
        <button type="button" class="btn secondary" data-client-campaign-more hidden>Load More Campaigns</button>
        <p class="cmp-help" data-client-campaign-message role="status" aria-live="polite">Loading campaigns…</p>
      </form>`,
      footer: saveFooter('Add to Campaign').replace('data-save="stay"', 'data-save="close"'),
      onSave: async form => {
        let id = form.elements.namedItem('campaign_id')?.value;
        const label = form.elements.namedItem('campaign_id')?.selectedOptions?.[0]?.textContent || 'campaign';
        if (!id) throw new Error('Choose an existing campaign or create a new one.');
        if (id === '__new__') {
          const name = String(form.elements.namedItem('new_campaign_name')?.value || '').trim();
          if (!name || name.length > 120) throw new Error('Enter a campaign name (1–120 characters).');
          const created = await api.save({
            id: generatedId, name, topic: 'general',
            assigned_agent_id: repository.user.id
          }, repository.user.id);
          if (!created?.id) throw new Error('The new campaign was not saved.');
          id = created.id;
        }
        const already = await api.existingClients(id, [client.id]);
        if (already.some(row => row.client_id === client.id)) {
          onAdded('This client is already in ' + label + '.');
          return;
        }
        const count = await api.addClients(id, [client.id], repository.user.id);
        if (count < 1) {
          const check = await api.existingClients(id, [client.id]);
          if (!check.some(row => row.client_id === client.id))
            throw new Error('The client could not be added. Refresh and retry.');
        }
        onAdded('Client added to ' + (label === '+ Create a new campaign' ?
          String(form.elements.namedItem('new_campaign_name')?.value || '').trim() : label) + '.');
      }
    });

    const form = d.node.querySelector('.client-campaign-picker-form');
    const select = form.elements.namedItem('campaign_id');
    const nameField = form.querySelector('[data-client-campaign-new]');
    const newName = form.elements.namedItem('new_campaign_name');
    const more = form.querySelector('[data-client-campaign-more]');
    const message = form.querySelector('[data-client-campaign-message]');
    let rows = [], cursor = null, loading = false;
    const updateChoice = () => {
      const creating = select.value === '__new__';
      nameField.hidden = !creating;
      newName.required = creating;
      if (!creating) newName.value = '';
    };
    select.addEventListener('change', updateChoice);

    const load = async () => {
      if (loading || !d.node.isConnected) return;
      loading = true;
      more.disabled = true;
      message.textContent = 'Loading active campaigns…';
      try {
        const result = await api.list({status: 'active', cursor});
        if (!d.node.isConnected) return;
        if (!Array.isArray(result?.rows)) throw new Error('Campaign list could not be loaded.');
        rows = [...new Map([...rows, ...result.rows].map(row => [row.id, row])).values()];
        cursor = result.nextCursor || null;
        const previous = select.value;
        select.innerHTML = options([
          ['', 'Choose a campaign'],
          ...rows.map(c => [c.id, c.name]),
          ['__new__', '+ Create a new campaign']
        ], previous);
        if (!rows.some(row => row.id === previous) && previous !== '__new__') select.value = '';
        more.hidden = !cursor;
        message.textContent = rows.length
          ? rows.length + ' active campaign' + (rows.length === 1 ? '' : 's') + ' available.'
          : 'No active campaigns found. Choose Create a new campaign.';
        updateChoice();
      } catch (error) {
        if (!d.node.isConnected) return;
        message.textContent = 'Campaigns could not load: ' + (error?.message || 'Retry.');
        select.innerHTML = options([['', 'Choose a campaign'], ['__new__', '+ Create a new campaign']]);
      } finally {
        loading = false;
        if (d.node.isConnected) more.disabled = false;
      }
    };
    more.addEventListener('click', load);
    d.attachForm(form);
    void load();
    return d;
  }
  function openClientReady(id = null) {
    let record = {};
    let syncOverviewClientActions = null;
    const d = dialogs.open({ title: 'Client Information', hint: id ? 'Edit this client without leaving your search results' : 'New client • all sections in one window', icon: icon('client', true), kind: 'client-dialog', clientId: id || null, isNewClient: !id, body: '<p class="subtle">Loading client information…</p>', footer: saveFooter('Save Client'), onSave: async form => {
      const saved = await repository.saveClient({ ...record, ...serializable(form) }, { expectedVersion: record.updated_at || null });
      if (!saved?.id) throw new Error('The save was not confirmed by the database. Your changes remain open.');
      record = saved;
      // Keep the footer's Text Client / Call Data actions linked to the
      // saved client even when this dialog began as a new, unsaved record.
      d.node.dataset.clientId = saved.id;
      patchClient(saved);
      syncOverviewClientActions?.();
      const savedName = [saved.first_name, saved.last_name].filter(Boolean).join(' ').trim();
      const titleNode = d.node.querySelector('h2');
      if (titleNode && savedName) titleNode.textContent = savedName;
      return saved;
    } });
    const mount = loaded => {
      if (!d.node.isConnected) return;
      record = loaded;
      const clientName = [loaded.first_name, loaded.last_name].filter(Boolean).join(' ').trim();
      const titleNode = d.node.querySelector('h2');
      if (titleNode) titleNode.textContent = clientName || (id ? 'Client' : 'New Client');
      d.node.querySelector('.modal-body').innerHTML = `${info}${clientForm(connected, agents)}`;
      const form = d.node.querySelector('form');
      hydrate(form, record);
      wireTabs(d.node);
      d.attachForm(form);
      // These two shortcuts act on the exact saved client, not on a search result.
      // A new client must be saved first. Existing record edits remain in their
      // original dialog while the campaign/appointment dialog is opened.
      const campaignShortcut=form.querySelector('[data-client-add-campaign]');
      const appointmentShortcut=form.querySelector('[data-client-add-appointment]');
      syncOverviewClientActions=()=>{
        const selectedStatus=form.elements.namedItem('status')?.value || record.status || '';
        const available=!!record?.id && String(selectedStatus).toLowerCase()!=='deceased';
        for(const button of [campaignShortcut,appointmentShortcut]) {
          if(!button)continue;
          button.disabled=!available;
          button.title=!record?.id?'Save this client before scheduling or adding to a campaign.':
            !available?'Deceased clients cannot be added to new campaigns or appointments.':'';
        }
      };
      syncOverviewClientActions();
      form.addEventListener('change', syncOverviewClientActions);
      campaignShortcut?.addEventListener('click',()=>{
        if(!record?.id) return;
        const selectedStatus = form.elements.namedItem('status')?.value || record.status;
        if(String(selectedStatus||'').toLowerCase()==='deceased')return;
        const status = form.querySelector('[data-client-campaign-status]');
        try {
          openClientCampaignPicker({...record,status:selectedStatus}, message=>{
            if(status?.isConnected)status.textContent=message;
          });
        } catch(error) {
          if(status?.isConnected)status.textContent=error?.message || 'Unable to open campaign selector.';
          else if(form.isConnected)d.error(error?.message||'Unable to open campaign selector.');
        }
      });
      appointmentShortcut?.addEventListener('click',()=>{
        if(!record?.id)return;
        openAppointment(todayKey(),null,null,{
          id:record.id,first_name:record.first_name,last_name:record.last_name,
          phone:record.phone,assigned_agent_id:record.assigned_agent_id,status:record.status
        });
      });
      // Deceased archive records open directly to their retained documents and files.
      if (loaded.id && state.archive.open && String(loaded.status||'').toLowerCase()==='deceased') {
        form.querySelector('[data-client-group-tab="files"]')?.click();
      }
      // One editable overview note, backed by the existing clients.notes field.
      // Sync with Notes & Files so either view edits the same note and Save Client persists it.
      const glanceNote = form.querySelector('[data-client-glance-note]');
      const clientNote = form.elements.namedItem('notes');
      if (glanceNote && clientNote) {
        glanceNote.value = clientNote.value || '';
        glanceNote.addEventListener('input', () => {
          if (clientNote.value === glanceNote.value) return;
          clientNote.value = glanceNote.value;
          clientNote.dispatchEvent(new Event('input', { bubbles: true }));
        });
        clientNote.addEventListener('input', () => {
          if (glanceNote.value !== clientNote.value) glanceNote.value = clientNote.value;
        });
      }
      // Show Athena-completed reviews automatically; permit a separate manual checkoff.
      const reviewCheck=form.querySelector('[data-client-review-manual]');
      const reviewStatus=form.querySelector('[data-client-review-status]');
      const reviewYear=new Date().getFullYear();
      if(loaded.id && reviewCheck && reviewStatus){
        void (async()=>{
          const [automatic,manual]=await Promise.all([
            supabase.from('athena_medicare_reviews').select('review_date,updated_at').eq('client_id',loaded.id).eq('workflow_status','completed').order('updated_at',{ascending:false}).limit(20),
            supabase.from('client_review_manual').select('completed').eq('client_id',loaded.id).eq('review_year',reviewYear).maybeSingle()
          ]);
          if(!form.isConnected)return;
          reviewCheck.checked=manual.data?.completed===true;
          const dates=(automatic.data||[]).map(x=>x.review_date||x.updated_at?.slice(0,10)).filter(Boolean);
          const latest=dates[0];
          reviewStatus.textContent=(latest?'✓ Athena review complete: '+latest+' · ':'')+(reviewCheck.checked?'✓ Marked complete manually':(!latest?'No completed reviews recorded':''));
          if(automatic.error||manual.error)reviewStatus.textContent='Could not load all review records.';
        })().catch(error=>{if(form.isConnected)reviewStatus.textContent=error.message||'Could not load review status.';});
        reviewCheck.addEventListener('change',async()=>{
          reviewCheck.disabled=true;reviewStatus.textContent='Saving review checkoff…';
          const {data:{user},error:authError}=await supabase.auth.getUser();
          const result=authError?{error:authError}:await supabase.from('client_review_manual').upsert({
            client_id:loaded.id,review_year:reviewYear,completed:reviewCheck.checked,
            completed_at:reviewCheck.checked?new Date().toISOString():null,updated_by:user?.id
          },{onConflict:'client_id,review_year'});
          reviewCheck.disabled=false;
          if(result.error){reviewCheck.checked=!reviewCheck.checked;reviewStatus.textContent='Could not save: '+result.error.message;}
          else reviewStatus.textContent=reviewCheck.checked?'✓ '+reviewYear+' review marked complete manually':'Manual '+reviewYear+' checkoff cleared.';
        });
      }else if(reviewCheck){reviewCheck.disabled=true;if(reviewStatus)reviewStatus.textContent='Save the client before marking reviews.';}
      // A one-click Medicare review from an existing client. Preserve the
      // unsaved-change confirmation before leaving, then hand off only the
      // client UUID (never personal data) to Athena for authorized lookup.
      if (loaded.id) {
        const shortcuts=form.querySelector('.client-overview-shortcuts');
        if (shortcuts && !shortcuts.querySelector('[data-client-athena]')) {
          const reviewButton=document.createElement('button');
          reviewButton.type='button';
          reviewButton.dataset.clientAthena='true';
          reviewButton.textContent='Medicare Review';
          shortcuts.prepend(reviewButton);
          reviewButton.addEventListener('click',async()=>{
            const closed=await d.requestClose();
            if (!closed) return;
            try {
              sessionStorage.setItem('arctos:athena-review-client',String(loaded.id));
            } catch (error) {
              console.warn('Client handoff unavailable; open Athena and search for the client.',error);
            }
            location.hash='#/athena-medicare';
          });
        }
      }
    };
    if (!id) mount({});
    else repository.getClient(id).then(loaded => {
      if (!loaded?.id) throw new Error('The client could not be found.');
      mount(loaded);
    }).catch(e => {
      if (!d.node.isConnected) return;
      d.node.querySelector('.modal-body').innerHTML = empty('Client unavailable', e.message || 'Please close this window and retry.');
      d.node.querySelector('[data-save]').disabled = true;
    });
    return d;
  }

  function bindCalendarHost(host) {
    host.querySelectorAll('[data-month]').forEach(button => button.onclick = () => {
      state.month = button.dataset.month === 'today'
        ? new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)
        : new Date(state.month.getFullYear(), state.month.getMonth() + Number(button.dataset.month), 1, 12);
      const key = calendarMonthKey(state.month);
      const cached = readCalendarSession(key);
      if (cached) {
        state.events = cached.events;
        state.calendarLoadedKey = key;
        state.calendarLoadedAt = cached.loadedAt || 0;
      } else if (state.calendarLoadedKey !== key) {
        state.events = [];
      }
      drawCalendar({ force: !cached || Date.now() - (cached.loadedAt || 0) > 5 * 60 * 1000 });
    });
    host.querySelectorAll('[data-day]').forEach(button => button.onclick = () => openDay('day', button.dataset.day));
    host.querySelectorAll('[data-queue]').forEach(button => button.onclick = () => openDay(button.dataset.queue, todayKey()));
    host.querySelector('[data-new-appointment]')?.addEventListener('click', () => openAppointment());
  }

  function drawDailyDashboard() {
    const host=root.querySelector('#daily-summary-host');
    if(!host || !host.isConnected)return;
    const thisMonth=calendarMonthKey(new Date());
    let rows=[],loaded=false;
    if(state.calendarLoadedKey===thisMonth){
      rows=state.events;loaded=true;
    } else {
      const cached=readCalendarSession(thisMonth);
      if(cached){rows=cached.events;loaded=true;}
    }
    host.innerHTML=dailyDashboardMarkup(rows,connected&&loaded,new Date());
    host.querySelectorAll('[data-new-appointment]').forEach(button=>button.onclick=()=>openAppointment());
    host.querySelectorAll('[data-add-client]').forEach(button=>button.onclick=()=>openClient());
    host.querySelectorAll('[data-daily-open-today]').forEach(button=>button.onclick=()=>openDay('today',todayKey()));
    host.querySelectorAll('[data-daily-open-followups]').forEach(button=>button.onclick=()=>openDay('reschedule',todayKey()));
    host.querySelectorAll('[data-daily-event-day]').forEach(button=>button.onclick=()=>openDay('day',button.dataset.dailyEventDay));
    host.querySelectorAll('[data-daily-open-calendar]').forEach(button=>button.onclick=()=>{
      const details=root.querySelector('[data-daily-calendar]');
      if(!details)return;
      details.open=true;
      details.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

  function renderVisibleCalendar() {
    const host=root.querySelector('#calendar-host');
    if(!host || !host.isConnected)return;
    // A month grid contains 35-42 date cells. Do not render or bind them
    // while the dashboard's calendar is closed.
    const collapsed=state.route==='dashboard' && !root.querySelector('[data-daily-calendar]')?.open;
    if(collapsed){
      host.replaceChildren();
      return;
    }
    host.innerHTML=calendarMarkup(state.month,state.events,connected,agents);
    bindCalendarHost(host);
  }

  function drawCalendar({ force = false } = {}) {
    const host = root.querySelector('#calendar-host');
    if (!host) return;
    const key = calendarMonthKey(state.month);
    renderVisibleCalendar();
    drawDailyDashboard();
    if (connected && state.calendarLoadedKey !== key) {
      const status = host.querySelector('.calendar-status');
      if (status) status.textContent = 'Loading appointments…';
    }

    if (!connected) return;

    const hasCurrentMonth = state.calendarLoadedKey === key;
    const stale = !state.calendarLoadedAt || Date.now() - state.calendarLoadedAt > 5 * 60 * 1000;

    // Returning to Dashboard should be instant. Do not refetch a month we already have.
    if (hasCurrentMonth && !force) {
      if (stale) {
        const refresh = () => {
          if (state.route === 'dashboard' || state.route === 'appointments') {
            void loadEvents(root.querySelector('#calendar-host'), { background: true });
          }
        };
        if ('requestIdleCallback' in window) requestIdleCallback(refresh, { timeout: 1500 });
        else setTimeout(refresh, 250);
      }
      return;
    }

    void loadEvents(host, { background: hasCurrentMonth });
  }

  async function loadEvents(host, { background = false } = {}) {
    if (!host?.isConnected) return;
    const key = calendarMonthKey(state.month);
    if (state.calendarLoadingKey === key) return;

    const token = ++state.calendarToken;
    state.calendarLoadingKey = key;
    const days = monthDays(state.month.getFullYear(), state.month.getMonth());
    try {
      const events = await repository.listEvents({
        start: isoDate(days[0]),
        end: isoDate(days.at(-1)),
        includeToday: true,
        includeReschedule: true
      });
      if (token !== state.calendarToken || calendarMonthKey(state.month) !== key) return;
      if (!Array.isArray(events)) throw new Error('Calendar returned an invalid response.');

      state.events = events;
      state.calendarLoadedKey = key;
      state.calendarLoadedAt = Date.now();
      writeCalendarSession(key, events);

      // A user may navigate away and back while the request is in flight.
      // Always update the CURRENT host, not the detached host from request start.
      const visibleHost = root.querySelector('#calendar-host');
      if (visibleHost?.isConnected) {
        renderVisibleCalendar();
        drawDailyDashboard();
        const notice=root.querySelector('[data-daily-error]');
        if(notice)notice.hidden=true;
      }
    } catch (e) {
      if (!background && token === state.calendarToken && calendarMonthKey(state.month) === key) {
        const status = root.querySelector('#calendar-host .calendar-status');
        if (status) status.textContent = e.message || 'Calendar could not load. Try another month or Today to retry.';
        const dailyError=root.querySelector('[data-daily-error]');
        if(dailyError){dailyError.textContent=e.message || 'Could not load your appointments. Open the calendar to try again.';dailyError.hidden=false;}
      }
    } finally {
      if (state.calendarLoadingKey === key) state.calendarLoadingKey = '';
    }
  }

  function persistVisibleCalendar() {
    const key = calendarMonthKey(state.month);
    if (state.calendarLoadedKey === key) {
      state.calendarLoadedAt = Date.now();
      writeCalendarSession(key, state.events);
      drawDailyDashboard();
    }
  }

  function openDay(mode, key) {
    const title = mode === 'today' ? 'Today’s Appointments' : mode === 'reschedule' ? 'Follow Up / Reassign' : longDate(key);
    const matchesMode = event => mode === 'reschedule'
      ? event.status === 'needs_reschedule'
      : event.event_date === key && event.status !== 'needs_reschedule' && event.status !== 'completed';

    const d = dialogs.open({
      title,
      hint: mode === 'today' ? longDate(key) : 'Calendar appointments and activities',
      icon: icon('appointments', true),
      kind: 'day-dialog',
      body: `${info}<div class="day-add"><button type="button" class="btn primary" data-day-add>+ ADD APPOINTMENT / ACTIVITY</button></div><div data-day-events></div>${mode === 'reschedule' ? '' : '<details class="day-completed-box" data-day-completed><summary>Completed Appointments <span data-completed-count>0</span></summary><div data-completed-events></div></details>'}`
    });
    d.node.querySelector('[data-day-add]').onclick = () => openAppointment(key, null, saved => {
      if (saved?.id) {
        const index = state.events.findIndex(item => item.id === saved.id);
        if (index >= 0) state.events[index] = saved;
        else state.events.push(saved);
        persistVisibleCalendar();
        renderCards();
      }
    });

    const host = d.node.querySelector('[data-day-events]');
    let clients = new Map();

    const appointmentName = (event, client = null) => {
      const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(' ').trim();
      if (clientName) return clientName;
      return String(event?.title || 'Appointment').replace(/^Appointment:\\s*/i, '').trim() || 'Appointment';
    };

    const safeDate = value => {
      try { return value ? longDate(value) : ''; } catch { return value || ''; }
    };

    const cardMarkup = event => {
      const client = clients.get(event.client_id) || null;
      const clientName = appointmentName(event, client);
      const agent = agents.find(item => item.id === event.assigned_agent_id);
      const statusLabel = String(event.status || 'scheduled').replaceAll('_', ' ');
      return `
        <details class="event-card appointment-card" data-event-id="${esc(event.id || '')}">
          <summary>
            <span class="appointment-summary-time">${esc(event.start_time ? timeLabel(event.start_time) : 'Time not set')}</span>
            <span class="appointment-summary-name">${esc(clientName)}</span>
          </summary>
          <div class="appointment-card-body">
            <div class="appointment-overview">
              <div class="appointment-overview-main">
                <span class="appointment-kicker">${esc(event.event_type || 'Appointment')}</span>
                <h3>${esc(event.title || 'Appointment')}</h3>
              </div>
              <span class="appointment-status">${esc(statusLabel)}</span>
            </div>
            <div class="appointment-detail-grid">
              <section><small>Date</small><strong>${esc(safeDate(event.event_date))}</strong></section>
              <section><small>Time</small><strong>${esc(timeLabel(event.start_time) || '—')}</strong></section>
              <section><small>Assigned Agent</small><strong>${esc(agent?.full_name || '—')}</strong></section>
              <section><small>Client</small><strong>${esc(clientName)}</strong></section>
              <section><small>Phone</small><strong>${esc(client?.phone || event.person_phone || String(event.notes || '').match(/(?:^|\n)Phone:\s*([^\n]+)/i)?.[1]?.trim() || '—')}</strong></section>
              <section><small>Email</small><strong>${esc(client?.email || '—')}</strong></section>
            </div>
            <section class="appointment-notes-box"><small>Appointment / Activity</small><p class="preserve-lines">${esc(event.activity_title || "—")}</p></section>
            <section class="appointment-notes-box">
              <small>Notes</small>
              <p class="preserve-lines">${esc(event.notes || 'No notes')}</p>
            </section>
            ${event.reschedule_note ? `<section class="appointment-followup-note"><small>Follow-up / Reassign Note</small><p class="preserve-lines">${esc(event.reschedule_note)}</p></section>` : ''}
            <div class="appointment-actions">
              <button type="button" class="btn secondary" data-event-edit>Edit Appointment</button>
              ${event.client_id ? '<button type="button" class="btn secondary" data-event-client>Open Client</button>' : ''}
              ${event.status !== 'completed' ? '<button type="button" class="btn secondary" data-event-complete>Mark Completed</button>' : ''}
              <button type="button" class="btn secondary" data-event-followup>Follow Up / Reassign</button>
              <button type="button" class="btn danger" data-event-delete>Delete Appointment</button>
            </div>
            <div class="appointment-action-status" data-event-status role="status" aria-live="polite"></div>
          </div>
        </details>`;
    };

    const renderCards = () => {
      if (!host?.isConnected) return;
      const entries = sortAppointmentsByStartTime(state.events.filter(matchesMode));
      host.innerHTML = entries.length
        ? entries.map(cardMarkup).join('')
        : empty(connected ? 'Nothing scheduled' : 'No appointments loaded', connected ? 'Use Add Appointment / Activity to schedule this day.' : 'Scheduling and reschedule queues require the standalone backend.');
      const completedBox = d.node.querySelector('[data-day-completed]');
      if (completedBox) {
        const completed = sortAppointmentsByStartTime(state.events.filter(event => event.event_date === key && event.status === 'completed'));
        completedBox.querySelector('[data-completed-count]').textContent = String(completed.length);
        completedBox.querySelector('[data-completed-events]').innerHTML = completed.length
          ? completed.map(cardMarkup).join('')
          : '<p class="day-completed-empty">No completed appointments for this day.</p>';
      }
    };

    const loadClients = async () => {
      const entries = sortAppointmentsByStartTime(state.events.filter(matchesMode));
      const completed = mode === 'reschedule' ? [] : state.events.filter(event => event.event_date === key && event.status === 'completed');
      const ids = [...new Set([...entries,...completed].map(event => event.client_id).filter(Boolean))];
      const rows = await Promise.all(ids.map(async id => {
        try { return [id, await repository.getClient(id)]; }
        catch { return [id, null]; }
      }));
      if (!d.node.isConnected) return;
      clients = new Map(rows);
      renderCards();
    };

    renderCards();
    void loadClients();

    d.node.addEventListener('click', async event => {
      const card = event.target.closest?.('[data-event-id]');
      if (!card) return;
      const appointment = state.events.find(item => item.id === card.dataset.eventId);
      if (!appointment) return;
      const status = card.querySelector('[data-event-status]');
      const setStatus = (message = '', error = false) => {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', error);
      };

      if (event.target.closest('[data-event-edit]')) {
        openAppointment(appointment.event_date || key, appointment, saved => {
          if (!saved?.id) return;
          const index = state.events.findIndex(item => item.id === saved.id);
          if (index >= 0) state.events[index] = saved;
          else state.events.push(saved);
          persistVisibleCalendar();
          renderCards();
          void loadClients();
        });
        return;
      }

      if (event.target.closest('[data-event-client]')) {
        if (appointment.client_id) openClient(appointment.client_id);
        return;
      }

      if (event.target.closest('[data-event-complete]')) {
        try {
          setStatus('Marking appointment completed…');
          const saved = await repository.completeEvent(appointment.id);
          if (appointment.client_id) {
            const { error: historyError } = await supabase.from('client_completed_appointments').upsert({
              event_id:String(appointment.id),client_id:appointment.client_id,
              event_date:appointment.event_date,start_time:appointment.start_time || null,
              activity_title:appointment.activity_title || '',
              completed_by:repository.user?.id || null
            },{onConflict:'event_id'});
            if(historyError)console.warn('Completed appointment history not recorded:',historyError);
          }
          const index = state.events.findIndex(item => item.id === appointment.id);
          if (index >= 0) state.events[index] = saved || { ...appointment, status: 'completed' };
          persistVisibleCalendar();
          drawCalendar();
          renderCards();
        } catch (error) {
          setStatus(error?.message || 'Unable to mark this appointment completed.', true);
        }
        return;
      }

      if (event.target.closest('[data-event-followup]')) {
        const note = prompt('Enter the follow-up or reassignment note:');
        if (note === null) return;
        try {
          setStatus('Sending appointment to Follow Up / Reassign…');
          const saved = await repository.rescheduleEvent(appointment.id, note.trim());
          const index = state.events.findIndex(item => item.id === appointment.id);
          if (index >= 0) state.events[index] = saved || { ...appointment, status: 'needs_reschedule', reschedule_note: note.trim() };
          persistVisibleCalendar();
          drawCalendar();
          renderCards();
        } catch (error) {
          setStatus(error?.message || 'Unable to move this appointment to Follow Up / Reassign.', true);
        }
        return;
      }

      if (event.target.closest('[data-event-delete]')) {
        if (!confirm(`Delete the appointment for ${appointmentName(appointment, clients.get(appointment.client_id) || null)}? This cannot be undone.`)) return;
        try {
          setStatus('Deleting appointment…');
          await repository.deleteEvent(appointment.id);
          state.events = state.events.filter(item => item.id !== appointment.id);
          persistVisibleCalendar();
          drawCalendar();
          renderCards();
        } catch (error) {
          setStatus(error?.message || 'Unable to delete this appointment.', true);
        }
      }
    });
  }


  function openAppointment(key = todayKey(), existing = null, onSaved = null, selectedClient = null) {
    const editing = !!existing?.id;
    const timeOptions = [['', 'Select appointment time'], ...appointmentSlots().map(t => [t, timeLabel(t)])];
    const body = `${info}<div class="intro"><strong>${editing ? 'Edit Appointment' : 'Set Appointment'}</strong><p>${editing ? 'Update the saved appointment information.' : 'Schedule an existing client or a new/non-client on the calendar.'}</p></div><form class="appointment-form" autocomplete="off" novalidate><div class="form-grid">${select('assigned_agent_id', 'Agent', [['', connected ? 'Select agent' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected)}${select('event_type', 'Type', ['Appointment', 'Activity'])}</div><div class="mode-picker" role="group" aria-label="Appointment person type"><button type="button" class="active" data-mode="existing" aria-pressed="true">EXISTING CLIENT</button><button type="button" data-mode="new" aria-pressed="false">NEW / NON-CLIENT</button></div><input type="hidden" name="person_type" value="existing"><input type="hidden" name="client_id" value=""><div data-existing><label class="field"><span>Client</span><input data-person-search placeholder="Type client name or phone" autocomplete="off"></label><div data-person-results class="lookup-results" aria-live="polite"></div><p data-selected-person class="subtle">No client selected</p></div><div data-new-person hidden><div class="form-grid">${input('person_name', 'New / Non-client Name')}${input('person_phone', 'Phone Number', { type: 'tel' })}</div></div><div class="form-grid">${input('title', 'Appointment / Activity Title', { span: true })}${dateInput('event_date', 'Appointment Date', true)}${select('start_time', 'Appointment Time', timeOptions)}</div><p class="subtle appointment-slot-status" data-appointment-slot-status role="status" aria-live="polite">Checking available appointment times…</p>${textArea('notes', 'Notes (optional)', 'Purpose of appointment or anything to remember')}<p class="subtle">${connected ? 'Unavailable times are disabled. The calendar is checked again before saving.' : 'Availability cannot be checked until scheduling is connected.'}</p></form>`;
    const d = dialogs.open({ title: editing ? 'Edit Appointment' : 'Appointments', hint: editing ? 'Update appointment details' : 'Set an appointment', icon: icon('appointments', true), kind: 'appointment-dialog', body, footer: saveFooter(editing ? 'Save Changes' : 'Add to Calendar').replace('data-save="stay"', 'data-save="close"'), onSave: async form => {
      if (slotLoading || !slotsReady) throw new Error('Check appointment availability before saving.');
      const value = serializable(form);
      if (value.person_type === 'existing' && !value.client_id) throw new Error('Select an existing client, or switch to New / Non-client.');
      if (value.person_type === 'new' && !value.person_name.trim()) throw new Error('Enter a name for this appointment.');
      if (!value.start_time) throw new Error('Select an appointment time.');
      const currentDay = parseAppointmentDay(value.event_date);
      if (!currentDay) throw new Error('Choose a valid appointment date.');
      const currentAgent = value.assigned_agent_id || repository.user?.id || '';
      const latest = await repository.listEvents({ start: currentDay, end: currentDay });
      const blocks = latest.filter(row => row.event_date === currentDay && row.assigned_agent_id === currentAgent);
      if (slotIsBooked(value.start_time, 30, blocks, existing?.id || ''))
        throw new Error('That appointment time is unavailable. Choose an open time.');
      // Keep the calendar headline as the person's name. The appointment/
      // activity title describes the purpose and belongs in the details.
      const purpose = String(form.elements.namedItem('title')?.value || '').trim();
      const person = value.person_type === 'new'
        ? String(value.person_name || '').trim()
        : String(form.querySelector('[data-person-search]')?.value || '').trim();
      if (person) value.title = person;
      const originalNotes = String(form.elements.namedItem('notes')?.value || '').trim();
      value.activity_title = purpose && purpose !== person ? purpose : '';
      value.notes = originalNotes;
      // The calendar bridge has no phone column. Persist non-client phone
      // inside appointment notes and show it in the phone detail field.
      if (value.person_type === 'new') {
        const phone = String(form.elements.namedItem('person_phone')?.value || '').trim();
        value.person_phone = phone;
      }
      if (editing) value.event_id = existing.id;
      const saved = await repository.saveEvent(value);
      if (!saved?.id) throw new Error('The calendar did not confirm this appointment. Nothing is marked saved.');
      let idField = form.elements.namedItem('event_id');
      if (!idField) { idField = document.createElement('input'); idField.type = 'hidden'; idField.name = 'event_id'; form.append(idField); }
      idField.value = saved.id;
      if (typeof onSaved === 'function') onSaved(saved);
      drawCalendar();
    } });
    const form = d.node.querySelector('form');
    const parseAppointmentDay = raw => {
      const value = String(raw || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
      if (!m) return '';
      const date = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      return date.getFullYear() === Number(m[3]) && date.getMonth() + 1 === Number(m[1]) && date.getDate() === Number(m[2])
        ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
    };
    const timeSelect = form.elements.start_time;
    const status = form.querySelector('[data-appointment-slot-status]');
    let slotToken = 0, slotLoading = false, slotsReady = false, slotTimer;
    async function refreshAppointmentSlots() {
      clearTimeout(slotTimer);
      const request = ++slotToken;
      const day = parseAppointmentDay(form.elements.event_date.value);
      const agent = form.elements.assigned_agent_id?.value || repository.user?.id || '';
      const previous = timeSelect.value;
      slotsReady = false;
      timeSelect.disabled = true;
      if (!day || !agent) { status.textContent = 'Select an appointment date and agent to see availability.'; return; }
      slotLoading = true; status.textContent = 'Checking available appointment times…';
      try {
        const rows = await repository.listEvents({ start:day, end:day });
        if (request !== slotToken || !d.node.isConnected) return;
        const booked = rows.filter(row => row.event_date === day && row.assigned_agent_id === agent);
        timeSelect.innerHTML = '<option value="">Select an available time</option>' + appointmentSlots().map(t => {
          const unavailable = slotIsBooked(t,30,booked,existing?.id || '');
          return `<option value="${t}"${unavailable ? ' disabled data-booked="true"' : ''}>${timeLabel(t)}${unavailable ? ' — UNAVAILABLE' : ''}</option>`;
        }).join('');
        if (previous && !slotIsBooked(previous,30,booked,existing?.id || '')) timeSelect.value = previous;
        slotsReady = true;
        const count = timeSelect.querySelectorAll('option[data-booked]').length;
        status.textContent = count ? `${count} unavailable times are grayed out. Select an open time.` : 'All listed appointment times are available.';
      } catch(error) {
        if (request === slotToken && d.node.isConnected)
          status.textContent = 'Unable to load calendar availability. Please retry by changing the date.';
      } finally {
        if (request === slotToken) { slotLoading = false; timeSelect.disabled = !slotsReady; }
      }
    }
    form.elements.event_date.addEventListener('input', () => {
      clearTimeout(slotTimer);
      timeSelect.disabled = true;
      slotsReady = false;
      slotTimer = setTimeout(refreshAppointmentSlots,250);
    });
    form.elements.event_date.addEventListener('change', refreshAppointmentSlots);
    form.elements.assigned_agent_id?.addEventListener('change',refreshAppointmentSlots);
    d.node.addEventListener('close', () => { slotToken++; clearTimeout(slotTimer); }, {once:true});
    form.elements.event_date.value = dateText(existing?.event_date || key);
    if (existing) {
      form.elements.assigned_agent_id.value = existing.assigned_agent_id || '';
      form.elements.event_type.value = existing.event_type || 'Appointment';
      form.elements.title.value = existing.activity_title || '';
      form.elements.start_time.value = String(existing.start_time || '').slice(0, 5);
      form.elements.notes.value = existing.notes || '';
      if (!existing.client_id) {
        const phone = String(existing.notes || '').match(/(?:^|\n)Phone:\s*([^\n]+)/i)?.[1]?.trim() || '';
        form.elements.person_name.value = String(existing.title || '').replace(/^Appointment:\s*/i, '');
        form.elements.person_phone.value = existing.person_phone || phone;
        form.querySelector('[data-mode="new"]')?.click();
      }
      if (existing.client_id) {
        form.elements.client_id.value = existing.client_id;
        repository.getClient(existing.client_id).then(client => {
          if (!d.node.isConnected || !client) return;
          const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
          form.querySelector('[data-person-search]').value = name;
          form.querySelector('[data-selected-person]').textContent = `Selected: ${name}${client.phone ? ` • ${client.phone}` : ''}`;
          d.baseline?.();
        }).catch(() => {});
      }
    }
    // From Client at a Glance, automatically select the correct saved client.
    if (!editing && selectedClient?.id) {
      const name=[selectedClient.first_name,selectedClient.last_name].filter(Boolean).join(' ').trim();
      form.elements.person_type.value='existing';
      form.elements.client_id.value=selectedClient.id;
      form.querySelector('[data-person-search]').value=name;
      form.querySelector('[data-selected-person]').textContent='Selected: '+name+(selectedClient.phone?' • '+selectedClient.phone:'');
      const assigned=agents.find(a=>a.id===selectedClient.assigned_agent_id && a.active!==false) ||
        agents.find(a=>a.id===repository.user?.id && a.active!==false);
      if(assigned)form.elements.assigned_agent_id.value=assigned.id;
    }
    let token = 0, timer;
    form.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      form.elements.person_type.value = b.dataset.mode;
      form.querySelectorAll('[data-mode]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      form.querySelector('[data-existing]').hidden = b.dataset.mode !== 'existing';
      form.querySelector('[data-new-person]').hidden = b.dataset.mode !== 'new';
      form.dispatchEvent(new Event('change'));
    });
    form.querySelector('[data-person-search]').oninput = e => {
      clearTimeout(timer); const query = e.target.value.trim(), request = ++token;
      form.elements.client_id.value = '';
      form.querySelector('[data-selected-person]').textContent = 'No client selected';
      form.dispatchEvent(new Event('change'));
      const host = form.querySelector('[data-person-results]'); host.innerHTML = '';
      if (!query) return;
      timer = setTimeout(async () => {
        if (!d.node.isConnected) return;
        try {
          const result = await repository.searchClients({ query, limit: 12 });
          if (!d.node.isConnected || request !== token) return;
          host.innerHTML = result.rows.length ? result.rows.map(c => `<button type="button" data-person-id="${esc(c.id)}">${esc([c.first_name, c.last_name].filter(Boolean).join(' '))}<small>${esc(c.phone || '')}</small></button>`).join('') : '<p>No matches</p>';
          host.querySelectorAll('[data-person-id]').forEach(b => b.onclick = () => {
            const client = result.rows.find(row => String(row.id) === String(b.dataset.personId));
            form.elements.client_id.value = b.dataset.personId;
            form.querySelector('[data-selected-person]').textContent = `Selected: ${b.textContent}`;
            const firstName = String(client?.first_name || '').trim();
            // Purpose is entered separately; the calendar headline uses the client name.
            host.innerHTML = '';
            form.dispatchEvent(new Event('input', { bubbles: true }));
            form.dispatchEvent(new Event('change', { bubbles: true }));
          });
        } catch {
          if (d.node.isConnected && request === token) host.textContent = connected ? 'Client lookup failed. Please retry.' : 'Client lookup is not connected yet.';
        }
      }, 200);
    };
    d.attachForm(form);
    void refreshAppointmentSlots();
    d.baseline?.();
    return d;
  }

  // Call Data -> appointment uses the same scheduler as Overview and Calendar.
  // Resolve the client using normal repository access (not untrusted UI fields).
  async function callReviewAppointment(event) {
    const clientId=String(event?.detail?.clientId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(clientId))return;
    try{
      const client=await repository.getClient(clientId);
      if(!client?.id || String(client.status||'').toLowerCase()==='deceased')
        throw new Error('This client is unavailable for an appointment.');
      if(state.destroyed)return;
      openAppointment(todayKey(),null,null,client);
    }catch(error){window.alert(error?.message||'Unable to open the appointment scheduler.');}
  }
  window.addEventListener('mig:communications-appointment',callReviewAppointment);

  function openNotes() {
    const d = dialogs.open({ title: 'Notes', hint: 'Dashboard notes', icon: icon('notes', true), kind: 'notes-dialog', body: `${info}<div class="panel-heading"><div><h3>Dashboard Notes</h3><p class="subtle">Named notes, kept separate from client notes.</p></div><button type="button" class="btn primary" data-new-note>+ New Note</button></div><div class="mode-picker note-filters" role="group" aria-label="Note owner"><button type="button" class="active" data-owner="all" aria-pressed="true">All Notes</button><button type="button" data-owner="mine" aria-pressed="false">My Notes</button></div><form class="note-editor" autocomplete="off" hidden novalidate>${input('title', 'Note Name', { required: true })}${textArea('body', 'Note', 'Write a note…')}</form><div data-note-list>${empty('No notes loaded', connected ? 'Loading notes…' : 'Note storage is not connected.')}</div>`, footer: saveFooter('Save Note'), onSave: async form => {
      if (form.hidden) throw new Error('Choose New Note first.');
      if (!form.elements.body.value.trim()) throw new Error('Enter a note before saving.');
      const saved = await repository.saveNote(serializable(form));
      if (!saved?.id) throw new Error('Note save was not confirmed. Your text is still open.');
      let idField = form.elements.namedItem('id');
      if (!idField) { idField = document.createElement('input'); idField.type = 'hidden'; idField.name = 'id'; form.append(idField); }
      idField.value = saved.id;
      await loadNotes();
    } });
    const form = d.node.querySelector('form');
    d.attachForm(form);
    d.node.querySelector('[data-save]').disabled = true;
    d.node.querySelector('[data-new-note]').onclick = async () => {
      if (d.isDirty()) { d.error('Save the open note before starting another, or close and discard it.'); return; }
      form.reset(); form.elements.namedItem('id')?.remove(); form.hidden = false;
      d.node.querySelector('[data-save]').disabled = false; d.baseline(); form.elements.title.focus();
    };
    let owner = 'all', noteToken = 0;
    d.node.querySelectorAll('[data-owner]').forEach(b => b.onclick = () => {
      owner = b.dataset.owner;
      d.node.querySelectorAll('[data-owner]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      loadNotes();
    });
    async function loadNotes() {
      if (!connected) return;
      const request = ++noteToken;
      const host = d.node.querySelector('[data-note-list]');
      try {
        const notes = await repository.listNotes({ owner });
        if (request !== noteToken || !d.node.isConnected) return;
        if (!Array.isArray(notes)) throw new Error('Invalid note response');
        host.innerHTML = notes.length ? notes.map(n => `<details class="event-card"><summary><small>${esc(n.created_at ? new Date(n.created_at).toLocaleDateString('en-US') : '')}</small><strong>${esc(n.title)}</strong></summary><div><p class="preserve-lines">${esc(n.body)}</p></div></details>`).join('') : empty('No notes saved');
      } catch { if (host.isConnected && request === noteToken) host.innerHTML = empty('Notes could not load', 'Close and reopen Notes to retry.'); }
    }
    loadNotes();
  }
  function openContacts() {
    const d = dialogs.open({
      title:'Contacts',
      hint:'Original M&M company contact directory',
      icon:icon('contacts',true),kind:'contacts-dialog',
      body:`${info}<div class="panel-card company-contact-directory">
        <div class="panel-heading"><div><h3>Company Contact Directory</h3>
          <p class="subtle">Original M&M insurance company contacts. Search names, phone numbers, fax numbers, email addresses or notes.</p></div></div>
        <label class="field"><span>Find Company or Contact Information</span>
          <input data-contact-query type="search" autocomplete="off" placeholder="Company, phone, fax, or email…"></label>
        <p data-contact-status class="subtle" role="status" aria-live="polite">Loading company contacts…</p>
        <div class="lookup-results contact-directory-results" data-contact-results aria-live="polite"></div>
        <div class="contact-directory-detail" data-contact-details>${empty('Choose a company','Select a contact above to view every phone, fax, email and note.')}</div>
      </div>`
    });
    const search=d.node.querySelector('[data-contact-query]');
    const host=d.node.querySelector('[data-contact-results]');
    const detail=d.node.querySelector('[data-contact-details]');
    const status=d.node.querySelector('[data-contact-status]');
    let timer, request=0;
    const contactPhoneLink=value=>{
      const raw=String(value||'');
      const digits=raw.replace(/\D/g,'');
      return digits.length>=7 && digits.length<=15
        ? `<a href="tel:${digits}">${esc(raw)}</a>`
        : esc(raw);
    };
    const contactEmailLink=value=>{
      const mail=String(value||'').trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)
        ? `<a href="mailto:${esc(mail)}">${esc(mail)}</a>`
        : esc(mail);
    };
    const showDetails=contact=>{
      if(!contact)return;
      search.value=contact.company;
      host.innerHTML='';
      status.textContent='Viewing contact details for '+contact.company+'. Search again to choose another company.';
      const sections=[
        ['phones','Phone Numbers',contactPhoneLink],
        ['faxes','Fax Numbers',value=>esc(value)],
        ['emails','Email Addresses',contactEmailLink]
      ];
      const extra=contact.website && /^https?:\/\//i.test(contact.website)
        ? `<p class="contact-directory-website"><a href="${esc(contact.website)}" target="_blank" rel="noopener noreferrer">Company website ↗</a></p>`
        : '';
      detail.innerHTML=`<h3>${esc(contact.company)}</h3>
        ${contact.department?`<p class="subtle">${esc(contact.department)}</p>`:''}
        <div class="contact-grid">${sections.map(([key,label,link])=>
          `<section><h4>${label}</h4>${contact[key]?.length
            ? contact[key].map(value=>`<p>${link(value)}</p>`).join('')
            : '<p>—</p>'}</section>`).join('')}</div>
        ${contact.notes?.length?`<section class="contact-directory-notes"><h4>Company Notes</h4>${contact.notes.map(note=>`<p class="preserve-lines">${esc(note)}</p>`).join('')}</section>`:''}
        ${extra}`;
    };
    const searchDirectory=async()=>{
      const token=++request;
      const query=search.value.trim();
      status.textContent=query?'Searching original company contacts…':'Loading original company directory…';
      host.innerHTML='';
      try{
        const matches=await repository.searchContacts({query,limit:50});
        if(token!==request || !d.node.isConnected)return;
        const plural=matches.length===1?'contact':'contacts';
        status.textContent=matches.length
          ? `Showing ${matches.length} ${plural}${matches.length===50?' (first 50; type more to narrow results)':''}.`
          : 'No company contacts match that search.';
        host.innerHTML=matches.length
          ? matches.map((c,i)=>`<button type="button" data-contact="${i}">
              <strong>${esc(c.company)}</strong>
              <small>${esc(c.phones?.[0] || c.emails?.[0] || 'Company contact')}</small>
            </button>`).join('')
          : '<p class="contact-directory-no-match">No matching company or contact information.</p>';
        host.querySelectorAll('[data-contact]').forEach(button=>button.onclick=()=>showDetails(matches[Number(button.dataset.contact)]));
      }catch(error){
        if(token===request&&d.node.isConnected){
          status.textContent='Unable to load company contacts.';
          host.innerHTML='';
          detail.innerHTML=empty('Company contacts unavailable',error?.message||'Check your connection and try again.');
        }
      }
    };
    search.addEventListener('input',()=>{
      clearTimeout(timer);
      // A new search should not leave the last company's phone/details onscreen.
      detail.innerHTML=empty('Choose a company','Select a result to view the company’s contact information.');
      timer=setTimeout(searchDirectory,180);
    });
    d.node.addEventListener('close',()=>{request++;clearTimeout(timer);},{once:true});
    void searchDirectory();
  }
  function openBuild() {
    const d = dialogs.open({ title: 'Height & Weight', hint: 'Product-specific carrier underwriting lookup', icon: icon('build', true), kind: 'build-dialog',
      body: `<div class="panel-card"><div class="panel-heading"><div><h3>Height &amp; Weight Underwriting Lookup</h3><p class="subtle">Select the carrier, then its product and applicable age group where needed. All weight values are pounds.</p></div><button type="button" class="btn secondary" data-build-reset>Reset</button></div>
        <div class="form-grid">
          ${select('company','Company',[['','Loading charts…']],true)}
          ${select('plan','American Amicable Product',[['','Choose American Amicable first']],true)}
          ${select('ageGroup','Age Group / Underwriting Chart',[['','Choose product first']],true)}
          ${select('height','Height',[['','Choose company first']],true)}
        </div>
        <div data-build-result aria-live="polite">${empty('Loading underwriting chart references…')}</div>
        <p class="subtle">Reference only. Product-specific guides may vary by state or underwriting revision. Weight limits alone never guarantee approval; confirm eligibility with the carrier.</p></div>` });
    const company=d.node.querySelector('[name="company"]'),
      plan=d.node.querySelector('[name="plan"]'),
      ageGroup=d.node.querySelector('[name="ageGroup"]'),
      height=d.node.querySelector('[name="height"]'),
      result=d.node.querySelector('[data-build-result]');
    let catalogue=[],token=0;
    const planField=plan.closest('label'),groupField=ageGroup.closest('label');
    planField.hidden=true;
    groupField.hidden=true;
    const setHeights=(rows,message='Select height')=>{
      height.innerHTML=options([['',message],...(rows||[]).map(row=>[String(row.value),row.label])]);
      height.value='';
      height.disabled=!rows?.length;
      result.removeAttribute('aria-busy');
      result.innerHTML=empty(rows?.length?'Select a height':'Select the applicable chart');
    };
    company.onchange=()=>{
      token++;
      const selected=catalogue.find(chart=>chart.company===company.value);
      planField.hidden=!selected?.plans?.length;
      groupField.hidden=true;
      plan.disabled=!selected?.plans?.length;
      plan.innerHTML=options([['','Select product'],...(selected?.plans||[]).map(p=>[p.key,p.name+' • ages '+p.ages])]);
      plan.value='';
      ageGroup.innerHTML=options([['','Select age group']]);
      ageGroup.value='';ageGroup.disabled=true;
      if(selected?.plans?.length) setHeights([], 'Choose product first');
      else setHeights(selected?.heights||[], selected?'Select height':'Choose company first');
    };
    plan.onchange=()=>{
      token++;
      const selected=catalogue.find(chart=>chart.company===company.value);
      const product=selected?.plans?.find(item=>item.key===plan.value);
      const groups=product?.ageGroups||[];
      groupField.hidden=groups.length<=1;
      ageGroup.innerHTML=options([['','Select age group / chart'],...groups.map(g=>[g.key,g.label])]);
      ageGroup.disabled=!product||groups.length<=1;
      ageGroup.value=groups.length===1?groups[0].key:'';
      if(groups.length===1) setHeights(groups[0].heights);
      else setHeights([],product?'Select age group first':'Choose product first');
    };
    ageGroup.onchange=()=>{
      token++;
      const selected=catalogue.find(chart=>chart.company===company.value);
      const product=selected?.plans?.find(item=>item.key===plan.value);
      const group=product?.ageGroups?.find(item=>item.key===ageGroup.value);
      setHeights(group?.heights||[]);
    };
    height.onchange=async()=>{
      const request=++token;
      if(!company.value||!height.value){result.innerHTML=empty('Select a height');return;}
      const selectedCompany=company.value,selectedHeight=Number(height.value);
      const selectedPlan=plan.value||undefined,selectedAgeGroup=ageGroup.value||undefined;
      result.setAttribute('aria-busy','true');
      result.innerHTML=empty('Loading chart values…');
      try{
        const chart=await repository.getBuildChart({company:selectedCompany,plan:selectedPlan,ageGroup:selectedAgeGroup,heightInches:selectedHeight});
        if(request!==token||!d.node.isConnected)return;
        if(!chart){result.innerHTML=empty('No chart row available','No exact height matches the selected product and age-group table. Never estimate missing limits.');return;}
        if(!Array.isArray(chart.values)||!chart.values.length||chart.company!==selectedCompany||chart.heightInches!==selectedHeight)throw Error('The underwriting chart response did not match your selection.');
        const heading=[chart.company,chart.plan,chart.ageGroup,chart.height].filter(Boolean).join(' — ');
        result.innerHTML=`<h3>${esc(heading)}</h3>
          <div class="contact-grid">${chart.values.map(value=>`<section><h4>${esc(value.label)}</h4><strong>${esc(value.value)}</strong></section>`).join('')}</div>
          ${(chart.warnings||[]).map(message=>`<p class="notice">${esc(message)}</p>`).join('')}
          <p class="subtle">Source: ${esc(chart.source)}. Carrier underwriting decides eligibility; the chart is a reference.</p>`;
      }catch(error){if(request===token&&d.node.isConnected)result.innerHTML=empty('Height & Weight unavailable',error?.message||'Close and reopen to retry.');}
      finally{if(request===token&&d.node.isConnected)result.removeAttribute('aria-busy');}
    };
    d.node.querySelector('[data-build-reset]').onclick=()=>{company.value='';company.onchange();};
    Promise.resolve().then(()=>repository.listBuildCharts()).then(charts=>{
      if(!d.node.isConnected)return;
      if(!Array.isArray(charts)||!charts.length||charts.some(c=>!c.company||!Array.isArray(c.heights)))throw Error('Saved carrier charts unavailable.');
      catalogue=charts;
      company.innerHTML=options([['','Select company'],...charts.map(c=>c.company)]);
      company.disabled=false;
      company.onchange();
    }).catch(error=>{if(d.node.isConnected)result.innerHTML=empty('Height & Weight unavailable',error?.message||'Close and reopen to retry.');});
  }
  function openCommissions() {
    const d = dialogs.open({ title: 'Commissions', hint: 'Life Insurance and Medicare dashboard data', icon: icon('commissions', true), kind: 'commissions-dialog', body: `${info}<div class="commission-view"><div class="commission-agent">${select('agent', 'Agent', [['', connected ? 'Select agent' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected)}</div><div class="mode-picker commission-types" role="group" aria-label="Commission type"><button type="button" class="active" data-commission="life" aria-pressed="true"><strong>Life Insurance</strong><small>Monthly &amp; yearly</small></button><button type="button" data-commission="medicare" aria-pressed="false"><strong>Medicare</strong><small>Book &amp; enrollment periods</small></button></div><div data-commission-body></div></div>` });
    let type = 'life', token = 0;
    const host = d.node.querySelector('[data-commission-body]');
    function panel(data = null) {
      host.innerHTML = type === 'life' ? `<section class="panel-card"><h3>Life Insurance Commissions</h3><div class="commission-totals"><article><span>Monthly Commission</span><strong>${money(data?.monthly)}</strong></article><article><span>Yearly Commission</span><strong>${money(data?.yearly)}</strong></article></div></section>` : `<section class="panel-card"><h3>Medicare Commissions</h3><div class="contact-grid"><section><h4>Current Medicare Book</h4><strong>${esc(data?.bookCount ?? '—')}</strong></section><section><h4>Monthly Renewals</h4><strong>${money(data?.monthlyRenewals)}</strong></section><section><h4>Annual Renewals</h4><strong>${money(data?.annualRenewals)}</strong></section></div><div class="commission-periods">${['AEP', 'OEP', 'SEP', 'T65 / IEP'].map(period => `<article><h4>${period}</h4><span>Commission</span><strong>${money(data?.periods?.[period])}</strong></article>`).join('')}</div></section>`;
      if (!data) host.insertAdjacentHTML('beforeend', '<p class="subtle">No commission records or rates are configured. Dashes mean unavailable, not zero earnings.</p>');
    }
    async function load() {
      const request = ++token;
      panel();
      if (!connected) return;
      try { const data = await repository.commissions({ type, agent: d.node.querySelector('[name="agent"]').value }); if (request === token && d.node.isConnected) panel(data); }
      catch { if (request === token && d.node.isConnected) host.insertAdjacentHTML('beforeend', '<div class="notice error">Commissions could not load. Select a type to retry.</div>'); }
    }
    d.node.querySelectorAll('[data-commission]').forEach(b => b.onclick = () => {
      type = b.dataset.commission;
      d.node.querySelectorAll('[data-commission]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
    d.node.querySelector('[name="agent"]').onchange = load;
    load();
  }
  function openTool(key) {
    if (key === 'commissions' && ensureQuickFeatures) {
      void ensureQuickFeatures().then(() => {
        root.querySelector('[data-tool="commissions"]')?.click();
      }).catch(error => {
        console.error('Commissions could not load:', error);
        alert('Commission reports could not load. Please retry.');
      });
      return;
    }
    if (key === 'leads') {
      // The Leads extension owns the click handler once loaded; replay only
      // after its capture listener is installed, so there is no competing editor.
      const ready = ensureLeadFeatures ? ensureLeadFeatures() : import('./leads-icon-screen.js?v=arctos-nav-1');
      void ready.then(() => {
        root.querySelector('.nav-section-work [data-tool="leads"]')?.click();
      }).catch(error => {
        console.error('Leads could not open:', error);
        alert('Leads could not load. Please retry.');
      });
      return;
    }
    ({ appointments: openAppointment, notes: openNotes, contacts: openContacts, build: openBuild, commissions: openCommissions })[key]?.();
  }
  let routing = false;
  async function changeRoute() {
    if (routing || state.destroyed) return;
    const requested = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const isLegacyClient = requested === 'client';
    const removedSection = ['medicare', 'life', 'retirement', 'documents'].includes(requested);
    // Retired Medicare Reviews bookmarks now open the Athena workspace. The
    // old database rows are retained; no data is migrated or deleted here.
    const next = ['medicare-intake','medicare-reviews'].includes(requested) ? 'athena-medicare' :
      NAV.some(([id]) => id === requested) ? requested : (isLegacyClient || removedSection ? 'clients' : 'dashboard');
    if (state.route === 'athena-medicare' && next !== 'athena-medicare' && athenaFeature && !athenaFeature.canLeave()) {
      history.replaceState(null, '', '#/athena-medicare');
      return;
    }
    if (dialogs.stack.length) {
      routing = true;
      history.replaceState(null, '', `#/${state.route}`);
      const closed = await dialogs.closeAll();
      routing = false;
      if (!closed) return;
    }
    history.replaceState(null, '', `#/${next}`);
    render(next);
    if (isLegacyClient) openClient();
  }
  const escapeMenu = e => {
    if (e.key === 'Escape' && !dialogs.stack.length) {
      root.querySelector('.sidebar')?.classList.remove('open');
      const shade = root.querySelector('.sidebar-shade'); if (shade) shade.hidden = true;
      root.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
    }
  };
  const refreshVisibleCalendar = () => {
    if (state.destroyed || !root.querySelector('#calendar-host')) return;
    state.calendarLoadedAt = 0;
    drawCalendar({ force: true });
  };
  const applyCalendarRefresh = event => {
    if (state.destroyed || !root.querySelector('#calendar-host')) return;
    const detail = event?.detail;
    const events = detail?.events;
    if (!Array.isArray(events)) return;
    const days = monthDays(state.month.getFullYear(), state.month.getMonth());
    if (detail.start !== isoDate(days[0]) || detail.end !== isoDate(days.at(-1))) return;
    state.events = events;
    state.calendarLoadedKey = calendarMonthKey(state.month);
    state.calendarLoadedAt = Date.now();
    writeCalendarSession(state.calendarLoadedKey, events);
    drawCalendar();
    drawDailyDashboard();
  };

  window.addEventListener('hashchange', changeRoute);
  window.addEventListener('keydown', escapeMenu);
  // Keep other agents' new bookings visible without requiring navigation or reload.
  const calendarPoll = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || state.destroyed) return;
    if (state.route !== 'dashboard' && state.route !== 'appointments') return;
    window.MHCalendarSync?.refresh({ force: true });
  }, 15000);
  window.addEventListener('mig:calendar-refresh-request', refreshVisibleCalendar);
  window.addEventListener('mig:calendar-refreshed', applyCalendarRefresh);
  changeRoute();
  return { destroy() {
    state.destroyed = true;
    workFeature?.destroy();
    campaignFeature?.destroy();
    maPlansFeature?.destroy();
    athenaFeature?.destroy();
    dialogs.destroy();
    window.removeEventListener('mig:communications-appointment',callReviewAppointment);
    window.removeEventListener('hashchange', changeRoute);
    window.removeEventListener('keydown', escapeMenu);
    clearInterval(calendarPoll);
    window.removeEventListener('mig:calendar-refresh-request', refreshVisibleCalendar);
    window.removeEventListener('mig:calendar-refreshed', applyCalendarRefresh);
    root.replaceChildren();
  } };
}
