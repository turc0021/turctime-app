-- Turc Time Training — v1 schema. Run once in Supabase Dashboard > SQL Editor.
-- Safe to re-run (idempotent where practical).
-- >>> Set the coach/admin email in the INSERT near the bottom. <<<

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.admins (
  email text primary key
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                -- family_id from the old roster CSV
  parent1 text not null,
  parent2 text,
  phone text,
  email text,                           -- login email for guardian 1
  email2 text,                          -- optional login email for guardian 2
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists families_email_idx  on public.families (lower(email));
create index if not exists families_email2_idx on public.families (lower(email2));

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id text unique,
  name text not null,
  age text,
  position text,
  school text,
  notes text,                           -- coach-only notes (hidden from families in UI)
  created_at timestamptz not null default now()
);
create index if not exists players_family_idx on public.players (family_id);

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null default 1 check (capacity >= 1),
  booked_count int not null default 0 check (booked_count >= 0),
  location text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists slots_start_idx on public.slots (starts_at);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  price_cents int not null default 5000,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index if not exists bookings_one_per_player_slot
  on public.bookings (slot_id, player_id) where status = 'booked';
create index if not exists bookings_family_idx on public.bookings (family_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  sender text not null check (sender in ('family','coach')),
  sender_email text,
  body text not null check (length(body) between 1 and 4000),
  broadcast_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_family_idx on public.messages (family_id, created_at);

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  tag text,                             -- null = everyone
  body text not null,
  recipients int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Helper functions ----------
create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = public.current_email())
$$;

create or replace function public.my_family_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select f.id from public.families f
  where public.current_email() <> ''
    and (lower(f.email) = public.current_email() or lower(f.email2) = public.current_email())
$$;

-- ---------- RLS ----------
alter table public.admins     enable row level security;
alter table public.families   enable row level security;
alter table public.players    enable row level security;
alter table public.slots      enable row level security;
alter table public.bookings   enable row level security;
alter table public.messages   enable row level security;
alter table public.broadcasts enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated
  using (lower(email) = public.current_email());

drop policy if exists families_read on public.families;
create policy families_read on public.families for select to authenticated
  using (public.is_admin() or id in (select public.my_family_ids()));
drop policy if exists families_admin on public.families;
create policy families_admin on public.families for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists players_read on public.players;
create policy players_read on public.players for select to authenticated
  using (public.is_admin() or family_id in (select public.my_family_ids()));
drop policy if exists players_admin on public.players;
create policy players_admin on public.players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Any signed-in user can see slots (times + whether full); only admin edits.
drop policy if exists slots_read on public.slots;
create policy slots_read on public.slots for select to authenticated using (true);
drop policy if exists slots_admin on public.slots;
create policy slots_admin on public.slots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Bookings: read own family / admin. Writes only via RPCs below (admin may also edit directly).
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using (public.is_admin() or family_id in (select public.my_family_ids()));
drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (public.is_admin() or family_id in (select public.my_family_ids()));
drop policy if exists messages_family_insert on public.messages;
create policy messages_family_insert on public.messages for insert to authenticated
  with check (sender = 'family' and family_id in (select public.my_family_ids())
              and sender_email = public.current_email() and read_at is null);
drop policy if exists messages_admin on public.messages;
create policy messages_admin on public.messages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists broadcasts_admin on public.broadcasts;
create policy broadcasts_admin on public.broadcasts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Atomic RPCs ----------
create or replace function public.book_slot(p_slot uuid, p_player uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
  v_slot public.slots;
  v_row public.bookings;
begin
  select family_id into v_family from public.players where id = p_player;
  if v_family is null then raise exception 'Player not found'; end if;
  if not (public.is_admin() or v_family in (select public.my_family_ids())) then
    raise exception 'Not allowed to book for this player';
  end if;

  select * into v_slot from public.slots where id = p_slot for update;  -- row lock
  if not found then raise exception 'Slot not found'; end if;
  if v_slot.starts_at <= now() then raise exception 'That time has already passed'; end if;
  if v_slot.booked_count >= v_slot.capacity then raise exception 'Sorry, that time was just taken'; end if;
  if exists (select 1 from public.bookings where slot_id = p_slot and player_id = p_player and status = 'booked') then
    raise exception 'Already booked';
  end if;

  insert into public.bookings (slot_id, player_id, family_id)
  values (p_slot, p_player, v_family) returning * into v_row;
  update public.slots set booked_count = booked_count + 1 where id = p_slot;
  return v_row;
end $$;

create or replace function public.cancel_booking(p_booking uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found'; end if;
  if not (public.is_admin() or v_row.family_id in (select public.my_family_ids())) then
    raise exception 'Not allowed';
  end if;
  if v_row.status <> 'booked' then return v_row; end if;
  perform 1 from public.slots where id = v_row.slot_id for update;
  update public.bookings set status = 'cancelled', cancelled_at = now()
    where id = p_booking returning * into v_row;
  update public.slots set booked_count = greatest(booked_count - 1, 0) where id = v_row.slot_id;
  return v_row;
end $$;

-- Broadcast: drops the message into each matching family's thread.
create or replace function public.send_broadcast(p_tag text, p_body text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Message is empty'; end if;
  insert into public.broadcasts (tag, body) values (nullif(trim(p_tag), ''), p_body) returning id into v_id;
  insert into public.messages (family_id, sender, sender_email, body, broadcast_id)
    select f.id, 'coach', public.current_email(), p_body, v_id
    from public.families f
    where nullif(trim(p_tag), '') is null
       or exists (select 1 from unnest(f.tags) t where lower(t) = lower(trim(p_tag)));
  get diagnostics v_n = row_count;
  update public.broadcasts set recipients = v_n where id = v_id;
  return v_n;
end $$;

-- Who am I? Used by the app after login.
create or replace function public.whoami()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'email', public.current_email(),
    'is_admin', public.is_admin(),
    'family_ids', coalesce((select json_agg(x) from public.my_family_ids() x), '[]'::json))
$$;

revoke all on function public.book_slot(uuid, uuid), public.cancel_booking(uuid),
  public.send_broadcast(text, text), public.whoami() from public, anon;
grant execute on function public.book_slot(uuid, uuid), public.cancel_booking(uuid),
  public.send_broadcast(text, text), public.whoami(), public.is_admin(),
  public.my_family_ids(), public.current_email() to authenticated;

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.slots;    exception when duplicate_object then null; end;
end $$;

-- ---------- Admin ----------
insert into public.admins (email) values ('michaelturconi@gmail.com') on conflict do nothing;
