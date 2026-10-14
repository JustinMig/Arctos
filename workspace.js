import { NAV, CLIENT_TABS, esc, disconnectedRepository, todayKey, parseISO, dateText, isoDate, monthDays, longDate, timeLabel, hydrate, serializable } from './core.js';
import { clientSearchMarkup, clientResultsMarkup, clientResultContent, clientSortDirectionOptions, clientSortDescription } from './client-search.js';
import { Dialogs } from './dialogs.js';
import { shell, TOOLS, icon, empty, note, pending, saveFooter, options, input, dateInput, select, textArea, clientForm, calendarMarkup } from './views.js?v=arctos-clients-1';

/** Repository injection is for the future isolated backend and local tests, never a legacy connection. */
export function createWorkspace(root, repository = disconnectedRepository) {
  if (!(root instanceof HTMLElement)) throw new TypeError('Arctos needs an application root.');
  const dialogs = new Dialogs();
  let campaignFeature = null, campaignModule = null;
  let intakeFeature = null, intakeModule = null;
  async function medicareIntake() {
    if (!intakeModule) intakeModule = import('./medicare-intake.js').then(({ createMedicareIntakeFeature }) => {
      intakeFeature = createMedicareIntakeFeature();
      return intakeFeature;
    }).catch(error => { intakeModule = null; throw error; });
    return intakeModule;
  }
  let athenaFeature = null, athenaModule = null;
  async function athenaMedicare() {
    if (!athenaModule) athenaModule = import('./athena-medicare.js')
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
    if (!campaignModule) campaignModule = import('./campaigns-ui.js').then(({ createCampaignFeature }) => {
      campaignFeature = createCampaignFeature({ repository, dialogs, openClient, onCalendarChange: drawCalendar });
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
    destroyed: false
  };
  const connected = repository.connected === true;
  const agents = Array.isArray(repository.agents) ? repository.agents : [];
  const money = v => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
  const info = connected ? '' : note(pending);

  function pageBody(route) {
    if (route === 'dashboard') return `<div id="calendar-host"></div><div class="metric-grid">${['Clients', 'Appointments', 'Notifications', 'Documents'].map(label => `<div class="metric-card"><span>${label}</span><strong>—</strong><small>${connected ? 'Summary not loaded' : 'Not connected'}</small></div>`).join('')}</div><section class="panel-card dark-card"><h2>Quick Actions</h2><div class="quick-actions"><button type="button" class="btn secondary" data-add-client>Client Information</button><a class="btn secondary" href="#/clients">Search Clients</a><button type="button" class="btn secondary" data-new-appointment>Set Appointment</button><a class="btn secondary" href="#/communications">Communications</a></div></section>`;
    if (route === 'campaigns') return '<div id="campaigns-host"><p class="subtle">Loading campaigns…</p></div>';
    if (route === 'ma-plans') return '<div id="ma-plans-host"><p class="subtle">Loading 2027 Mississippi MA plans…</p></div>';
    if (route === 'medicare-intake') return '<div id="medicare-intake-host"><p class="subtle">Opening Medicare Reviews…</p></div>';
    if (route === 'athena-medicare') return '<div id="athena-medicare-host"><p class="subtle">Opening Athena\'s Medicare…</p></div>';
    if (route === 'clients') return clientSearchMarkup(state.search, agents);
    if (route === 'appointments') return '<div id="calendar-host"></div>';
    if (route === 'communications') return `<div class="panel-card dark-card"><h2>Communications</h2><div class="integration-grid">${['RingCentral Voice', 'Client Text Messages', 'Call Recordings'].map(x => `<div><h3>${x}</h3><span class="tag">Not connected</span></div>`).join('')}</div>${empty('No conversation selected', 'Calls, texts, and recordings are not connected to this framework.')}</div>`;
    if (route === 'notifications') return `<section class="panel-card dark-card">${empty('No notifications loaded', 'Form submissions and activity notifications require the new backend.')}</section>`;
    if (route === 'agents') return `<section class="panel-card dark-card"><h2>Roles &amp; Permissions</h2><p class="muted">Planned roles; no user accounts are created by this framework.</p><div class="integration-grid">${['Owner', 'Admin', 'Agent', 'Assistant'].map(role => `<div><h3>${role}</h3><span class="tag">Not configured</span></div>`).join('')}</div></section>`;
    return `<section class="panel-card dark-card"><h2>Arctos Environment</h2><dl class="settings-list"><dt>Site</dt><dd>mig.mayerig.com</dd><dt>Repository</dt><dd>JustinMig/MayerMig_CRM</dd><dt>Hosting project</dt><dd>mayer-mig-crm</dd><dt>Database / authentication</dt><dd>${connected ? 'Repository connected; review server permissions separately' : 'Not connected'}</dd><dt>Document storage</dt><dd>Not connected</dd><dt>App Store</dt><dd>Native packaging, signing, and submission not configured</dd></dl><p class="muted">Arctos retains the existing CRM records, logins, hosting, and integrations. Technical resource names may still use the original identifiers.</p></section>`;
  }
  function render(route) {
    campaignFeature?.unmount();
    maPlansFeature?.unmount();
    intakeFeature?.unmount();
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
    if (route === 'clients') bindSearch();
    if (route === 'campaigns') {
      const host = root.querySelector('#campaigns-host');
      campaigns().then(feature => { if (host.isConnected && !state.destroyed) feature.mount(host); }).catch(error => { if (host.isConnected) host.innerHTML = empty('Campaigns unavailable', error.message); });
    }
    if (route === 'medicare-intake') {
      const host = root.querySelector('#medicare-intake-host');
      medicareIntake().then(feature => { if (host.isConnected && !state.destroyed) feature.mount(host); })
        .catch(error => { if (host.isConnected) host.innerHTML = empty('Medicare Reviews unavailable', error.message); });
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
    if (root.querySelector('#calendar-host')) drawCalendar();
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
    if (!state.search.rows) return;
    state.search.rows = state.search.rows.map(row => row.id === saved.id ? { ...row, ...saved } : row);
    const record = state.search.rows.find(row => row.id === saved.id);
    const row = root.querySelector(`#client-results [data-client-id="${CSS.escape(saved.id)}"]`);
    if (row && record) row.innerHTML = clientResultContent(record);
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
      const details=[dob?'DOB: '+dob:'',value('phone'),location].filter(Boolean);
      const title=form.querySelector('[data-client-summary-name]');
      const meta=form.querySelector('[data-client-summary-meta]');
      if(title)title.textContent=name;
      if(meta)meta.textContent=details.join('  •  ')||'Contact information not entered yet.';
    };
    form.addEventListener('input',updateSummary);
    form.addEventListener('change',updateSummary);
    updateSummary();
  }
  function openClient(id = null) {
    let record = {};
    const d = dialogs.open({ title: 'Client Information', hint: id ? 'Edit this client without leaving your search results' : 'New client • all sections in one window', icon: icon('client', true), kind: 'client-dialog', clientId: id || null, isNewClient: !id, body: '<p class="subtle">Loading client information…</p>', footer: saveFooter('Save Client'), onSave: async form => {
      const saved = await repository.saveClient({ ...record, ...serializable(form) }, { expectedVersion: record.updated_at || null });
      if (!saved?.id) throw new Error('The save was not confirmed by the database. Your changes remain open.');
      record = saved;
      patchClient(saved);
      const savedName = [saved.first_name, saved.last_name].filter(Boolean).join(' ').trim();
      const titleNode = d.node.querySelector('h2');
      if (titleNode && savedName) titleNode.textContent = savedName;
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

  function drawCalendar({ force = false } = {}) {
    const host = root.querySelector('#calendar-host');
    if (!host) return;
    const key = calendarMonthKey(state.month);
    host.innerHTML = calendarMarkup(state.month, state.events, connected, agents);
    bindCalendarHost(host);
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
        visibleHost.innerHTML = calendarMarkup(state.month, events, connected, agents);
        bindCalendarHost(visibleHost);
      }
    } catch (e) {
      if (!background && token === state.calendarToken && calendarMonthKey(state.month) === key) {
        const status = root.querySelector('#calendar-host .calendar-status');
        if (status) status.textContent = e.message || 'Calendar could not load. Try another month or Today to retry.';
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
    }
  }

  function openDay(mode, key) {
    const title = mode === 'today' ? 'Today’s Appointments' : mode === 'reschedule' ? 'Follow Up / Reassign' : longDate(key);
    const matchesMode = event => mode === 'reschedule'
      ? event.status === 'needs_reschedule'
      : event.event_date === key && event.status !== 'needs_reschedule' && (mode !== 'today' || event.status !== 'completed');

    const d = dialogs.open({
      title,
      hint: mode === 'today' ? longDate(key) : 'Calendar appointments and activities',
      icon: icon('appointments', true),
      kind: 'day-dialog',
      body: `${info}<div class="day-add"><button type="button" class="btn primary" data-day-add>+ ADD APPOINTMENT / ACTIVITY</button></div><div data-day-events></div>`
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
              <section><small>Phone</small><strong>${esc(client?.phone || '—')}</strong></section>
              <section><small>Email</small><strong>${esc(client?.email || '—')}</strong></section>
            </div>
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
      const entries = state.events.filter(matchesMode);
      host.innerHTML = entries.length
        ? entries.map(cardMarkup).join('')
        : empty(connected ? 'Nothing scheduled' : 'No appointments loaded', connected ? 'Use Add Appointment / Activity to schedule this day.' : 'Scheduling and reschedule queues require the standalone backend.');
    };

    const loadClients = async () => {
      const entries = state.events.filter(matchesMode);
      const ids = [...new Set(entries.map(event => event.client_id).filter(Boolean))];
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

    host.addEventListener('click', async event => {
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


  function openAppointment(key = todayKey(), existing = null, onSaved = null) {
    const editing = !!existing?.id;
    const timeOptions = [['', 'Select appointment time'], ...Array.from({ length: 25 }, (_, i) => {
      const totalMinutes = (8 * 60) + (i * 30);
      const t = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      return [t, timeLabel(t)];
    })];
    const body = `${info}<div class="intro"><strong>${editing ? 'Edit Appointment' : 'Set Appointment'}</strong><p>${editing ? 'Update the saved appointment information.' : 'Schedule an existing client or a new/non-client on the calendar.'}</p></div><form class="appointment-form" autocomplete="off" novalidate><div class="form-grid">${select('assigned_agent_id', 'Agent', [['', connected ? 'Select agent' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected)}${select('event_type', 'Type', ['Appointment', 'Activity'])}</div><div class="mode-picker" role="group" aria-label="Appointment person type"><button type="button" class="active" data-mode="existing" aria-pressed="true">EXISTING CLIENT</button><button type="button" data-mode="new" aria-pressed="false">NEW / NON-CLIENT</button></div><input type="hidden" name="person_type" value="existing"><input type="hidden" name="client_id" value=""><div data-existing><label class="field"><span>Client</span><input data-person-search placeholder="Type client name or phone" autocomplete="off"></label><div data-person-results class="lookup-results" aria-live="polite"></div><p data-selected-person class="subtle">No client selected</p></div><div data-new-person hidden><div class="form-grid">${input('person_name', 'New / Non-client Name')}${input('person_phone', 'Phone Number', { type: 'tel' })}</div></div><div class="form-grid">${input('title', 'Appointment / Activity Title', { span: true })}${dateInput('event_date', 'Appointment Date', true)}${select('start_time', 'Appointment Time', timeOptions)}</div>${textArea('notes', 'Notes (optional)', 'Purpose of appointment or anything to remember')}<p class="subtle">${connected ? 'The server must check availability before confirming a save.' : 'Availability cannot be checked until scheduling is connected.'}</p></form>`;
    const d = dialogs.open({ title: editing ? 'Edit Appointment' : 'Appointments', hint: editing ? 'Update appointment details' : 'Set an appointment', icon: icon('appointments', true), kind: 'appointment-dialog', body, footer: saveFooter(editing ? 'Save Changes' : 'Add to Calendar').replace('data-save="stay"', 'data-save="close"'), onSave: async form => {
      const value = serializable(form);
      if (value.person_type === 'existing' && !value.client_id) throw new Error('Select an existing client, or switch to New / Non-client.');
      if (value.person_type === 'new' && !value.person_name.trim()) throw new Error('Enter a name for this appointment.');
      if (!value.start_time) throw new Error('Select an appointment time.');
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
    form.elements.event_date.value = dateText(existing?.event_date || key);
    if (existing) {
      form.elements.assigned_agent_id.value = existing.assigned_agent_id || '';
      form.elements.event_type.value = existing.event_type || 'Appointment';
      form.elements.title.value = existing.title || '';
      form.elements.start_time.value = String(existing.start_time || '').slice(0, 5);
      form.elements.notes.value = existing.notes || '';
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
            if (firstName) form.elements.title.value = firstName;
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
    d.baseline?.();
    return d;
  }

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
    const d = dialogs.open({ title: 'Contacts', hint: 'Company contact directory', icon: icon('contacts', true), kind: 'contacts-dialog', body: `${info}<div class="panel-card"><h3>Company Contact Directory</h3><p class="subtle">Search company name, phone, fax, or email.</p><label class="field"><span>Find company</span><input data-contact-query autocomplete="off" placeholder="Search company contacts…"></label><div class="lookup-results" data-contact-results aria-live="polite"></div><div data-contact-details>${empty('Search for a company', 'No directory records have been imported into this standalone CRM.')}</div></div>` });
    let timer, request = 0;
    d.node.querySelector('[data-contact-query]').oninput = e => {
      clearTimeout(timer); const token = ++request, query = e.target.value.trim();
      const host = d.node.querySelector('[data-contact-results]'), detail = d.node.querySelector('[data-contact-details]');
      host.innerHTML = ''; detail.innerHTML = '';
      if (!query) { detail.innerHTML = empty('Search for a company'); return; }
      timer = setTimeout(async () => {
        if (!d.node.isConnected) return;
        try {
          const matches = await repository.searchContacts({ query, limit: 12 });
          if (token !== request || !d.node.isConnected) return;
          host.innerHTML = matches.length ? matches.map((c, i) => `<button type="button" data-contact="${i}"><strong>${esc(c.company)}</strong><small>${esc(c.phones?.[0] || c.emails?.[0] || '')}</small></button>`).join('') : '<p>No matching company</p>';
          host.querySelectorAll('[data-contact]').forEach(b => b.onclick = () => {
            const contact = matches[Number(b.dataset.contact)];
            d.node.querySelector('[data-contact-query]').value = contact.company;
            host.innerHTML = '';
            detail.innerHTML = `<h3>${esc(contact.company)}</h3><div class="contact-grid">${[['phones', 'Phone'], ['faxes', 'Fax'], ['emails', 'Email']].map(([key, label]) => `<section><h4>${label}</h4>${(contact[key] || []).map(v => `<p>${esc(v)}</p>`).join('') || '<p>—</p>'}</section>`).join('')}</div>${(contact.notes || []).map(text => `<p class="preserve-lines">${esc(text)}</p>`).join('')}`;
          });
        } catch { if (token === request && d.node.isConnected) host.textContent = connected ? 'The directory could not load. Please retry.' : 'The company directory has not been connected or imported yet.'; }
      }, 200);
    };
  }
  function openBuild() {
    const d = dialogs.open({ title: 'Height & Weight', hint: 'Height & weight underwriting lookup', icon: icon('build', true), kind: 'build-dialog', body: `<div class="panel-card"><div class="panel-heading"><div><h3>Height &amp; Weight Underwriting Lookup</h3><p class="subtle">Select an insurance company, then a height. Weights are in pounds.</p></div><button type="button" class="btn secondary" data-build-reset>Reset</button></div><div class="form-grid">${select('company', 'Company', [['', 'Loading charts…']], true)}${select('height', 'Height', [['', 'Choose company first']], true)}</div><div data-build-result aria-live="polite">${empty('Loading saved chart references…')}</div><p class="subtle">Saved M&amp;M chart references, not a live carrier feed or an approval. Confirm the current guide for the product and state before using these limits.</p></div>` });
    const company = d.node.querySelector('[name="company"]');
    const height = d.node.querySelector('[name="height"]');
    const result = d.node.querySelector('[data-build-result]');
    let catalogue = [], token = 0;
    company.onchange = () => {
      token++;
      const selected = catalogue.find(chart => chart.company === company.value);
      height.innerHTML = options([['', selected ? 'Select height' : 'Choose company first'], ...(selected?.heights || []).map(row => [String(row.value), row.label])]);
      height.value = '';
      height.disabled = !selected;
      result.removeAttribute('aria-busy');
      result.innerHTML = empty(selected ? 'Select a height' : 'Choose a company to begin');
    };
    height.onchange = async () => {
      const request = ++token;
      if (!company.value || !height.value) { result.removeAttribute('aria-busy'); result.innerHTML = empty('Select a height'); return; }
      const selectedCompany = company.value, selectedHeight = Number(height.value);
      result.setAttribute('aria-busy', 'true');
      result.innerHTML = empty('Loading chart values…');
      try {
        const chart = await repository.getBuildChart({ company: selectedCompany, heightInches: selectedHeight });
        if (request !== token || !d.node.isConnected) return;
        if (!chart) { result.innerHTML = empty('No chart row available', 'This height is not listed in the saved carrier chart. Do not estimate a weight limit.'); return; }
        if (!Array.isArray(chart.values) || !chart.values.length || chart.company !== selectedCompany || chart.heightInches !== selectedHeight) throw new Error('The chart response did not match the selected company and height.');
        result.innerHTML = `<h3>${esc(chart.company)} — ${esc(chart.height)}</h3><div class="contact-grid">${chart.values.map(v => `<section><h4>${esc(v.label)}</h4><strong>${esc(v.value)}</strong></section>`).join('')}</div>${(chart.warnings || []).map(message => `<p class="notice">${esc(message)}</p>`).join('')}<p class="subtle">Source reference: ${esc(chart.source)}</p>`;
      } catch (error) {
        if (request === token && d.node.isConnected) result.innerHTML = empty('Height & Weight unavailable', error?.message || 'Close this window and reopen it to retry.');
      } finally {
        if (request === token && d.node.isConnected) result.removeAttribute('aria-busy');
      }
    };
    d.node.querySelector('[data-build-reset]').onclick = () => { company.value = ''; company.onchange(); };
    Promise.resolve().then(() => repository.listBuildCharts()).then(charts => {
      if (!d.node.isConnected) return;
      if (!Array.isArray(charts) || !charts.length || charts.some(chart => !chart.company || !Array.isArray(chart.heights) || !chart.heights.length)) throw new Error('No saved carrier charts are available.');
      catalogue = charts;
      company.innerHTML = options([['', 'Select company'], ...charts.map(chart => chart.company)]);
      company.disabled = false;
      company.onchange();
    }).catch(error => {
      if (d.node.isConnected) result.innerHTML = empty('Height & Weight unavailable', error?.message || 'Close this window and reopen it to retry.');
    });
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
    if (key === 'leads') {
      // Work remains usable immediately, even before optional enhancements
      // finish loading after login. Once loaded, the Leads feature handles
      // the same button through its delegated click listener.
      void import('./leads-icon-screen.js?v=arctos-nav-1').then(() => {
        root.querySelector('.nav-section-work [data-tool="leads"]')?.click();
      }).catch(error => console.error('Leads could not open:', error));
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
    const next = NAV.some(([id]) => id === requested) ? requested : (isLegacyClient || removedSection ? 'clients' : 'dashboard');
    if (state.route === 'medicare-intake' && next !== 'medicare-intake' && intakeFeature && !intakeFeature.canLeave()) {
      history.replaceState(null, '', '#/medicare-intake');
      return;
    }
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
  };

  window.addEventListener('hashchange', changeRoute);
  window.addEventListener('keydown', escapeMenu);
  window.addEventListener('mig:calendar-refresh-request', refreshVisibleCalendar);
  window.addEventListener('mig:calendar-refreshed', applyCalendarRefresh);
  changeRoute();
  return { destroy() {
    state.destroyed = true;
    campaignFeature?.destroy();
    maPlansFeature?.destroy();
    intakeFeature?.destroy();
    athenaFeature?.destroy();
    dialogs.destroy();
    window.removeEventListener('hashchange', changeRoute);
    window.removeEventListener('keydown', escapeMenu);
    window.removeEventListener('mig:calendar-refresh-request', refreshVisibleCalendar);
    window.removeEventListener('mig:calendar-refreshed', applyCalendarRefresh);
    root.replaceChildren();
  } };
}
