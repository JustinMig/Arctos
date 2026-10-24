import { mhRepository, supabase } from './supabase-repository.js';

const CALENDAR_CACHE_TTL_MS = 60000;
const calendarCache = new Map();
const calendarInFlight = new Map();

function calendarCacheKey({ start, end, includeToday = false, includeReschedule = false }) {
  return [start || '', end || '', includeToday ? '1' : '0', includeReschedule ? '1' : '0'].join('|');
}

function invalidateCalendarCache() {
  calendarCache.clear();
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your Arctos session expired. Sign in again.');
  return { Authorization: `Bearer ${session.access_token}` };
}

async function calendarRequest(method, params = {}, body) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const headers = await authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/calendar-events${query.size ? `?${query}` : ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Shared Justin calendar request failed.');
  return payload;
}

export function installMayerJustinCalendar() {
  if (mhRepository.__mayerJustinCalendarInstalled) return;
  mhRepository.__mayerJustinCalendarInstalled = true;

  async function fetchEvents(criteria, { background = false } = {}) {
    const key = calendarCacheKey(criteria);
    if (calendarInFlight.has(key)) return calendarInFlight.get(key);

    const request = (async () => {
      const sharedRequest = calendarRequest('GET', {
        start: criteria.start,
        end: criteria.end,
        includeToday: criteria.includeToday ? '1' : '',
        includeReschedule: criteria.includeReschedule ? '1' : ''
      });
      // Campaign bookings live in Arctos's appointments table, not in the
      // upstream Mayer calendar. Show both sources in the same calendar.
      let localQuery = supabase.from('appointments').select('*').gte('event_date', criteria.start).lte('event_date', criteria.end);
      const localRequest = localQuery.order('event_date').order('start_time');
      let extraRequest = Promise.resolve({ data:[], error:null });
      if (criteria.includeToday || criteria.includeReschedule) {
        const centralDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const filters = [];
        if (criteria.includeToday) filters.push(`event_date.eq.${centralDate}`);
        if (criteria.includeReschedule) filters.push('status.eq.needs_reschedule');
        if (filters.length) {
          extraRequest = supabase.from('appointments').select('*').or(filters.join(','));
        }
      }
      const [payload, localResult, extraResult] = await Promise.all([sharedRequest, localRequest, extraRequest]);
      if (localResult.error) throw localResult.error;
      if (extraResult.error) throw extraResult.error;
      const sharedEvents = Array.isArray(payload.events) ? payload.events : [];
      const localEvents = localResult.data || [];
      const extras = extraResult.data || [];
      const seen = new Set(sharedEvents.map(event => event.id));
      const events = [...sharedEvents];
      for (const event of [...(localEvents || []), ...extras]) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        events.push({ ...event, calendar_source: 'arctos_campaign' });
      }
      // Activity and non-client phone are separate appointment fields, not notes.
      if (events.length) {
        const ids = events.map(event => event.id).filter(Boolean);
        const { data: details, error: detailError } = await supabase.from('calendar_event_details')
          .select('event_id,activity_title,person_phone').in('event_id',ids);
        if (detailError) throw detailError;
        const byId = new Map((details || []).map(row => [row.event_id,row]));
        for (const event of events) {
          const detail = byId.get(event.id);
          if (detail) {
            event.activity_title = detail.activity_title || '';
            event.person_phone = detail.person_phone || '';
          }
        }
      }
      events.sort((a, b) => `${a.event_date || ''} ${a.start_time || ''}`.localeCompare(`${b.event_date || ''} ${b.start_time || ''}`));
      const record = { events, loadedAt: Date.now() };
      calendarCache.set(key, record);

      const notify = list => window.dispatchEvent(new CustomEvent('mig:calendar-refreshed', {
        detail: { ...criteria, events: list }
      }));
      if (background) notify(events);

      // Render the calendar as soon as the shared calendar API returns.
      // Enrich the linked client IDs without making the user wait for a
      // second, sequential Supabase request on every cold calendar load.
      const eventIds = [...new Set(events.map(event => event.id).filter(Boolean))];
      if (eventIds.length) {
        void (async () => {
          const { data: links, error } = await supabase
            .from('calendar_event_client_links')
            .select('event_id,client_id')
            .in('event_id', eventIds);
          if (error) throw error;
          if (calendarCache.get(key) !== record) return;
          const byEvent = new Map((links || []).map(link => [link.event_id, link.client_id]));
          const merged = events.map(event => ({
            ...event,
            client_id: event.client_id || byEvent.get(event.id) || null
          }));
          record.events = merged;
          notify(merged);
        })().catch(error => console.warn('Calendar client links could not be refreshed.', error));
      }
      return events;
    })().finally(() => calendarInFlight.delete(key));

    calendarInFlight.set(key, request);
    return request;
  }

  mhRepository.listEvents = async function({ start, end, includeToday = false, includeReschedule = false }) {
    const criteria = { start, end, includeToday, includeReschedule };
    const key = calendarCacheKey(criteria);
    const cached = calendarCache.get(key);
    if (cached) {
      if (Date.now() - cached.loadedAt > CALENDAR_CACHE_TTL_MS) {
        void fetchEvents(criteria, { background: true }).catch(() => {});
      }
      return cached.events;
    }
    return fetchEvents(criteria);
  };

  mhRepository.saveEvent = async function(value) {
    const payload = {
      client_id: value.client_id || null,
      assigned_agent_id: value.assigned_agent_id || this.user?.id || null,
      title: String(value.title || '').trim() || `Appointment: ${value.person_name || 'Client'}`,
      event_type: value.event_type || 'appointment',
      event_date: value.event_date,
      start_time: value.start_time || null,
      end_time: value.end_time || null,
      notes: value.notes || null,
      status: value.status || 'scheduled'
    };
    const eventId = value.event_id || value.id || '';
    const result = eventId
      ? await calendarRequest('PATCH', { id: eventId }, payload)
      : await calendarRequest('POST', {}, payload);
    const saved = result.event;
    if (saved?.id) {
      const { error: detailsError } = await supabase.from('calendar_event_details')
        .upsert({event_id:saved.id,activity_title:String(value.activity_title || '').trim(),
          person_phone:String(value.person_phone || '').trim(),
          updated_by:this.user?.id,updated_at:new Date().toISOString()},{onConflict:'event_id'});
      if (detailsError) throw detailsError;
      saved.activity_title = String(value.activity_title || '').trim();
      saved.person_phone = String(value.person_phone || '').trim();
    }
    invalidateCalendarCache();
    if (!saved?.id) return saved;

    if (payload.client_id) {
      const { error } = await supabase
        .from('calendar_event_client_links')
        .upsert({
          event_id: saved.id,
          client_id: payload.client_id,
          updated_by: this.user?.id || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'event_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('calendar_event_client_links')
        .delete()
        .eq('event_id', saved.id);
      if (error) throw error;
    }

    return { ...saved, client_id: payload.client_id || saved.client_id || null };
  };

  mhRepository.deleteEvent = async function(eventId) {
    if (!eventId) throw new Error('Missing calendar event ID.');
    // Campaign bookings are stored in Arctos appointments, not the separate
    // Mayer/Justin workspace calendar. Delete from the correct source.
    const { data: local, error: lookupError } = await supabase
      .from('appointments').select('id').eq('id', eventId).maybeSingle();
    if (lookupError) throw lookupError;
    if (local) {
      const { error } = await supabase.from('appointments').delete().eq('id', eventId);
      if (error) throw error;
      invalidateCalendarCache();
      window.dispatchEvent(new CustomEvent('mig:calendar-refresh-request'));
      return { deleted: true };
    }
    const result = await calendarRequest('DELETE', { id: eventId });
    invalidateCalendarCache();
    await supabase.from('calendar_event_client_links').delete().eq('event_id', eventId);
    return result;
  };

  mhRepository.completeEvent = async function(eventId) {
    // Campaign appointments are saved locally in Arctos, not in Justin's bridge.
    const { data: local, error: lookupError } = await supabase.from('appointments')
      .select('*').eq('id',eventId).maybeSingle();
    if (lookupError) throw lookupError;
    if (local) {
      const { data, error } = await supabase.from('appointments')
        .update({status:'completed'}).eq('id',eventId).select('*').single();
      if (error) throw error;
      invalidateCalendarCache();
      return { ...data, calendar_source:'arctos_campaign' };
    }
    const result = await calendarRequest('PATCH', { id: eventId }, { action: 'complete' });
    invalidateCalendarCache();
    return result.event;
  };

  mhRepository.rescheduleEvent = async function(eventId, note) {
    const result = await calendarRequest('PATCH', { id: eventId }, { action: 'reschedule', note });
    invalidateCalendarCache();
    return result.event;
  };

  let lastFocusRefresh = 0;
  window.MHCalendarSync = {
    source: 'Mayer CRM · Justin calendar',
    refresh({ force = false } = {}) {
      if (force) invalidateCalendarCache();
      if (!(location.hash.startsWith('#/dashboard') || location.hash.startsWith('#/appointments'))) return;
      window.dispatchEvent(new CustomEvent('mig:calendar-refresh-request'));
    }
  };

  window.addEventListener('focus', () => {
    if (document.querySelector('dialog[open]')) return;
    const now = Date.now();
    if (now - lastFocusRefresh < CALENDAR_CACHE_TTL_MS) return;
    lastFocusRefresh = now;
    window.MHCalendarSync.refresh();
  });
}
