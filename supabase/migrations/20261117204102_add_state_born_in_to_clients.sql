-- State of birth is a distinct demographic field, not the client's residence state.
alter table public.clients add column if not exists state_born_in text;
comment on column public.clients.state_born_in is 'Two-letter U.S. state abbreviation for the client''s state of birth; shown in forms as State Name (XX).';
