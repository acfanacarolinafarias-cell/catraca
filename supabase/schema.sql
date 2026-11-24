-- =====================================================================
-- Catraca · esquema do banco de dados (Supabase / PostgreSQL)
--
-- Como usar: no painel do Supabase, abra "SQL Editor", cole este arquivo
-- inteiro e clique em "Run". Pode rodar de novo sem perder dados: ele só
-- cria o que ainda não existe e recria funções e regras de acesso.
--
-- Papéis:
--   admin       -> profiles.role = 'admin'. Vê e altera tudo.
--   organizador -> pessoa (PF ou PJ) cadastrada em "organizers" pela admin.
--                  Quando cria a conta com o mesmo e-mail (e confirma),
--                  fica vinculada e administra os eventos ligados a ela.
--   portaria    -> pessoa da equipe cadastrada por um organizador ("staff").
--                  Só lê/valida ingressos dos eventos daquele organizador
--                  que forem liberados para ela. Não vê financeiro nem altera nada.
--   comprador   -> qualquer conta. Compra e vê os próprios ingressos.
-- =====================================================================

-- ---------- Tabelas ----------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'buyer' check (role in ('admin', 'buyer')),
  created_at  timestamptz not null default now()
);

create table if not exists public.organizers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  person_type   text not null check (person_type in ('PF', 'PJ')),
  legal_name    text not null,              -- nome completo (PF) ou razão social (PJ)
  trade_name    text not null default '',   -- nome artístico / nome fantasia
  document      text not null,              -- CPF (11) ou CNPJ (14), só dígitos
  phone         text not null default '',
  pix_key       text not null default '',
  bank_name     text not null default '',
  bank_agency   text not null default '',
  bank_account  text not null default '',
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint organizers_document_len check (
    (person_type = 'PF' and document ~ '^[0-9]{11}$') or
    (person_type = 'PJ' and document ~ '^[0-9]{14}$')
  )
);
create unique index if not exists organizers_email_key on public.organizers (lower(email));
create unique index if not exists organizers_document_key on public.organizers (document);
create index if not exists organizers_user_idx on public.organizers (user_id);

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid references public.organizers(id) on delete set null,
  name          text not null,
  starts_at     timestamptz not null,
  venue         text not null default '',
  city          text not null default '',
  description   text not null default '',
  fee_pct       numeric(5,2) not null default 10 check (fee_pct between 0 and 30),   -- taxa de serviço cobrada do comprador
  platform_pct  numeric(5,2) not null default 0 check (platform_pct between 0 and 100), -- comissão da plataforma sobre as vendas
  published     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists events_organizer_idx on public.events (organizer_id);

-- Cobrança da plataforma: percentual sobre as vendas (padrão) ou valor fixo por ingresso
alter table public.events add column if not exists platform_fee_type text not null default 'percent';
alter table public.events add column if not exists platform_fee_fixed numeric(10,2) not null default 0;
do $$ begin
  alter table public.events add constraint events_platform_fee_type_check check (platform_fee_type in ('percent', 'fixed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint events_platform_fee_fixed_check check (platform_fee_fixed >= 0);
exception when duplicate_object then null; end $$;

-- Configurações da plataforma (uma linha só). Valores padrão para eventos novos.
create table if not exists public.settings (
  id                    integer primary key default 1 check (id = 1),
  default_fee_pct       numeric(5,2) not null default 10 check (default_fee_pct between 0 and 30),
  default_platform_type text not null default 'percent' check (default_platform_type in ('percent', 'fixed')),
  default_platform_pct  numeric(5,2) not null default 5 check (default_platform_pct between 0 and 100),
  default_platform_fixed numeric(10,2) not null default 0 check (default_platform_fixed >= 0),
  updated_at            timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.ticket_types (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null check (price >= 0),
  capacity     integer not null check (capacity >= 0),
  allows_half  boolean not null default false,  -- aceita meia-entrada
  sort         integer not null default 0,
  sold         integer not null default 0,      -- mantido pela função buy_tickets
  constraint ticket_types_sold_le_capacity check (sold <= capacity)
);
create index if not exists ticket_types_event_idx on public.ticket_types (event_id);

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  event_id     uuid not null references public.events(id) on delete restrict,
  buyer_id     uuid not null references auth.users(id) on delete restrict,
  buyer_name   text not null,
  buyer_email  text not null default '',
  subtotal     numeric(10,2) not null default 0,
  fee          numeric(10,2) not null default 0,
  total        numeric(10,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists orders_event_idx on public.orders (event_id);
create index if not exists orders_buyer_idx on public.orders (buyer_id);

create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  order_id        uuid not null references public.orders(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete restrict,
  ticket_type_id  uuid not null references public.ticket_types(id) on delete restrict,
  type_name       text not null,
  kind            text not null check (kind in ('inteira', 'meia')),
  unit_price      numeric(10,2) not null,
  checked_in_at   timestamptz,
  checked_in_by   uuid references auth.users(id) on delete set null
);
create index if not exists tickets_order_idx on public.tickets (order_id);
create index if not exists tickets_event_idx on public.tickets (event_id);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  description  text not null,
  amount       numeric(10,2) not null check (amount >= 0),
  due_date     date,
  paid         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists expenses_event_idx on public.expenses (event_id);

-- Equipe de portaria: cadastrada pelo organizador, só lê/valida ingressos
create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null references public.organizers(id) on delete cascade,
  name          text not null,
  email         text not null,
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists staff_org_email_key on public.staff (organizer_id, lower(email));
create index if not exists staff_user_idx on public.staff (user_id);

create table if not exists public.staff_events (
  staff_id  uuid not null references public.staff(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  primary key (staff_id, event_id)
);
create index if not exists staff_events_event_idx on public.staff_events (event_id);

-- ---------- Funções auxiliares de permissão ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    join public.organizers o on o.id = e.organizer_id
    where e.id = p_event and o.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.owns_event(p_event);
$$;

-- O usuário logado é o organizador dono deste cadastro?
create or replace function public.owns_organizer(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizers where id = p_org and user_id = auth.uid());
$$;

-- O usuário logado é da portaria deste evento (e o evento ainda é do mesmo organizador)?
create or replace function public.is_event_staff(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_events se
    join public.staff s on s.id = se.staff_id
    join public.events e on e.id = se.event_id
    where se.event_id = p_event and s.user_id = auth.uid() and e.organizer_id = s.organizer_id
  );
$$;

-- Pode ligar este membro da portaria a este evento? Só eventos do mesmo organizador.
create or replace function public.can_assign_staff(p_staff uuid, p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    join public.events e on e.id = p_event and e.organizer_id = s.organizer_id
    where s.id = p_staff and (public.is_admin() or public.owns_organizer(s.organizer_id))
  );
$$;

-- Código curto sem caracteres ambíguos (sem 0/O, 1/I)
create or replace function public.gen_code(n integer) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  s text := '';
begin
  for i in 0 .. least(n, 16) - 1 loop
    s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return s;
end $$;

-- ---------- Vínculo automático conta <-> organizador ----------

-- Nova conta: cria o perfil e, se o e-mail já estiver confirmado,
-- vincula ao cadastro de organizador com o mesmo e-mail.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null then
    update public.organizers set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
    update public.staff set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
  end if;
  return new;
end $$;

-- Confirmou o e-mail depois: vincula nesse momento.
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.organizers set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
    update public.staff set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
  end if;
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update on auth.users
  for each row execute function public.handle_user_confirmed();

-- Organizador cadastrado (ou e-mail trocado) pela admin: procura a conta.
-- Quem não é admin só altera contato e dados bancários.
create or replace function public.organizers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() nulo = operação interna (confirmação de conta, SQL Editor).
  -- Pelo site, toda alteração vem de alguém logado.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    if new.email is distinct from old.email
       or new.person_type is distinct from old.person_type
       or new.document is distinct from old.document
       or new.legal_name is distinct from old.legal_name
       or new.user_id is distinct from old.user_id then
      raise exception 'Somente a administração altera e-mail, tipo de pessoa, documento e nome/razão social.';
    end if;
  end if;
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.user_id := (
      select u.id from auth.users u
      where lower(u.email) = new.email and u.email_confirmed_at is not null
      limit 1
    );
  end if;
  return new;
end $$;

drop trigger if exists organizers_guard on public.organizers;
create trigger organizers_guard before insert or update on public.organizers
  for each row execute function public.organizers_guard();

-- Cobranças da plataforma (taxa de serviço e comissão) e o dono do evento:
-- só a administração define. Evento criado por organizador recebe os padrões.
create or replace function public.events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg public.settings%rowtype;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into cfg from public.settings where id = 1;
    new.fee_pct            := coalesce(cfg.default_fee_pct, 10);
    new.platform_fee_type  := coalesce(cfg.default_platform_type, 'percent');
    new.platform_pct       := coalesce(cfg.default_platform_pct, 0);
    new.platform_fee_fixed := coalesce(cfg.default_platform_fixed, 0);
    return new;
  end if;
  if new.organizer_id is distinct from old.organizer_id
     or new.platform_pct is distinct from old.platform_pct
     or new.platform_fee_type is distinct from old.platform_fee_type
     or new.platform_fee_fixed is distinct from old.platform_fee_fixed
     or new.fee_pct is distinct from old.fee_pct then
    raise exception 'Somente a administração altera o organizador, a taxa de serviço e a cobrança da plataforma.';
  end if;
  return new;
end $$;

drop trigger if exists events_guard on public.events;
create trigger events_guard before insert or update on public.events
  for each row execute function public.events_guard();

-- Portaria: e-mail normalizado; a conta é vinculada só pelo sistema.
create or replace function public.staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.user_id := (
      select u.id from auth.users u
      where lower(u.email) = new.email and u.email_confirmed_at is not null
      limit 1
    );
    if tg_op = 'UPDATE' then
      -- trocou o e-mail: a pessoa antiga perde o acesso aos eventos
      delete from public.staff_events where staff_id = new.id;
    end if;
  elsif auth.uid() is not null then
    new.user_id := old.user_id;
  end if;
  return new;
end $$;

drop trigger if exists staff_guard on public.staff;
create trigger staff_guard before insert or update on public.staff
  for each row execute function public.staff_guard();

-- Evento mudou de organizador: a portaria do organizador anterior perde o acesso.
create or replace function public.events_staff_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.organizer_id is distinct from old.organizer_id then
    delete from public.staff_events se using public.staff s
    where se.staff_id = s.id and se.event_id = new.id
      and s.organizer_id is distinct from new.organizer_id;
  end if;
  return new;
end $$;

drop trigger if exists events_staff_cleanup on public.events;
create trigger events_staff_cleanup after update on public.events
  for each row execute function public.events_staff_cleanup();

-- ---------- Compra (atômica, com trava de lotação) ----------

create or replace function public.buy_tickets(
  p_event uuid, p_items jsonb, p_buyer_name text, p_buyer_email text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_event    public.events%rowtype;
  v_type     public.ticket_types%rowtype;
  r          record;
  v_order    uuid;
  v_code     text;
  v_unit     numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_fee      numeric(10,2);
  v_n        integer := 0;
begin
  if v_uid is null then
    raise exception 'Entre na sua conta para comprar.';
  end if;
  if coalesce(trim(p_buyer_name), '') = '' then
    raise exception 'Informe o nome que vai no ingresso.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um ingresso.';
  end if;

  select * into v_event from public.events where id = p_event and published;
  if not found then
    raise exception 'Este evento não está à venda.';
  end if;
  if v_event.starts_at < now() - interval '6 hours' then
    raise exception 'As vendas deste evento foram encerradas.';
  end if;

  -- Trava e confere cada lote (inteira + meia somadas)
  for r in
    select (e ->> 'type_id')::uuid as type_id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    select * into v_type from public.ticket_types
      where id = r.type_id and event_id = p_event for update;
    if not found then
      raise exception 'Lote inválido para este evento.';
    end if;
    if r.qty is null or r.qty < 1 or r.qty > 10 then
      raise exception 'Escolha entre 1 e 10 ingressos por lote.';
    end if;
    if v_type.sold + r.qty > v_type.capacity then
      raise exception 'Não há ingressos suficientes em "%". Restam %.', v_type.name, v_type.capacity - v_type.sold;
    end if;
    update public.ticket_types set sold = sold + r.qty where id = v_type.id;
  end loop;

  loop
    v_code := public.gen_code(6);
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (code, event_id, buyer_id, buyer_name, buyer_email)
  values (v_code, p_event, v_uid, trim(p_buyer_name), coalesce(trim(p_buyer_email), ''))
  returning id into v_order;

  for r in
    select (e ->> 'type_id')::uuid as type_id,
           coalesce(e ->> 'kind', 'inteira') as kind,
           sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1, 2 order by 1, 2
  loop
    select * into v_type from public.ticket_types where id = r.type_id;
    if r.kind not in ('inteira', 'meia') then
      raise exception 'Tipo de ingresso inválido.';
    end if;
    if r.kind = 'meia' and not v_type.allows_half then
      raise exception 'O lote "%" não aceita meia-entrada.', v_type.name;
    end if;
    v_unit := case when r.kind = 'meia' then round(v_type.price / 2, 2) else v_type.price end;
    for i in 1 .. r.qty loop
      v_n := v_n + 1;
      insert into public.tickets (code, order_id, event_id, ticket_type_id, type_name, kind, unit_price)
      values (v_code || '-' || v_n, v_order, p_event, v_type.id, v_type.name, r.kind, v_unit);
    end loop;
    v_subtotal := v_subtotal + v_unit * r.qty;
  end loop;

  v_fee := round(v_subtotal * v_event.fee_pct / 100, 2);
  update public.orders set subtotal = v_subtotal, fee = v_fee, total = v_subtotal + v_fee
  where id = v_order;

  return v_order;
end $$;

-- ---------- Validação na entrada ----------

create or replace function public.check_in(p_code text, p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets%rowtype;
  o public.orders%rowtype;
begin
  if not (public.can_manage_event(p_event) or public.is_event_staff(p_event)) then
    raise exception 'Você não tem permissão para validar ingressos deste evento.';
  end if;
  select * into t from public.tickets where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if t.event_id <> p_event then
    return jsonb_build_object('status', 'other_event');
  end if;
  select * into o from public.orders where id = t.order_id;
  if t.checked_in_at is not null then
    return jsonb_build_object('status', 'used', 'at', t.checked_in_at, 'buyer', o.buyer_name,
                              'type', t.type_name, 'kind', t.kind, 'code', t.code);
  end if;
  update public.tickets set checked_in_at = now(), checked_in_by = auth.uid() where id = t.id;
  return jsonb_build_object('status', 'ok', 'buyer', o.buyer_name, 'type', t.type_name,
                            'kind', t.kind, 'code', t.code);
end $$;

-- Contagem da entrada e últimas validações (sem e-mails nem valores)
create or replace function public.checkin_stats(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.can_manage_event(p_event) or public.is_event_staff(p_event)) then
    raise exception 'Você não tem permissão para ver a entrada deste evento.';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.tickets where event_id = p_event),
    'used',  (select count(*) from public.tickets where event_id = p_event and checked_in_at is not null),
    'recent', coalesce((
      select jsonb_agg(r order by r.at desc) from (
        select t.code, o.buyer_name as buyer, t.type_name as type, t.kind, t.checked_in_at as at
        from public.tickets t join public.orders o on o.id = t.order_id
        where t.event_id = p_event and t.checked_in_at is not null
        order by t.checked_in_at desc limit 30
      ) r), '[]'::jsonb)
  );
end $$;

-- ---------- Regras de acesso (RLS) ----------

alter table public.profiles     enable row level security;
alter table public.organizers   enable row level security;
alter table public.events       enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders       enable row level security;
alter table public.tickets      enable row level security;
alter table public.expenses     enable row level security;
alter table public.staff        enable row level security;
alter table public.staff_events enable row level security;
alter table public.settings     enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists organizers_select on public.organizers;
create policy organizers_select on public.organizers for select
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists organizers_insert on public.organizers;
create policy organizers_insert on public.organizers for insert
  with check (public.is_admin());
drop policy if exists organizers_update on public.organizers;
create policy organizers_update on public.organizers for update
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists organizers_delete on public.organizers;
create policy organizers_delete on public.organizers for delete
  using (public.is_admin());

drop policy if exists events_select on public.events;
create policy events_select on public.events for select
  using (published or public.is_admin() or public.owns_organizer(organizer_id) or public.is_event_staff(id));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert
  with check (public.is_admin() or (organizer_id is not null and public.owns_organizer(organizer_id)));
drop policy if exists events_update on public.events;
create policy events_update on public.events for update
  using (public.is_admin() or public.owns_organizer(organizer_id));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete
  using (public.is_admin() or public.owns_organizer(organizer_id));

drop policy if exists ticket_types_select on public.ticket_types;
create policy ticket_types_select on public.ticket_types for select
  using (exists (select 1 from public.events e where e.id = event_id));
drop policy if exists ticket_types_write on public.ticket_types;
create policy ticket_types_write on public.ticket_types for all
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select
  using (buyer_id = auth.uid() or public.can_manage_event(event_id));

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
    or public.can_manage_event(event_id)
  );

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses for all
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select
  using (public.is_admin() or user_id = auth.uid() or public.owns_organizer(organizer_id));
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff for all
  using (public.is_admin() or public.owns_organizer(organizer_id))
  with check (public.is_admin() or public.owns_organizer(organizer_id));

drop policy if exists staff_events_select on public.staff_events;
create policy staff_events_select on public.staff_events for select
  using (exists (
    select 1 from public.staff s where s.id = staff_id
      and (public.is_admin() or s.user_id = auth.uid() or public.owns_organizer(s.organizer_id))
  ));
drop policy if exists staff_events_insert on public.staff_events;
create policy staff_events_insert on public.staff_events for insert
  with check (public.can_assign_staff(staff_id, event_id));
drop policy if exists staff_events_delete on public.staff_events;
create policy staff_events_delete on public.staff_events for delete
  using (exists (
    select 1 from public.staff s where s.id = staff_id
      and (public.is_admin() or public.owns_organizer(s.organizer_id))
  ));

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (true);
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Privilégios por coluna ----------
-- Pedidos e ingressos só são criados pelas funções acima; "sold" e "role"
-- não podem ser alterados direto pelo navegador.

revoke all on public.profiles, public.organizers, public.events, public.ticket_types,
              public.orders, public.tickets, public.expenses,
              public.staff, public.staff_events, public.settings from anon, authenticated;

grant select on public.events, public.ticket_types to anon, authenticated;
grant select, update (full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.organizers to authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.settings to authenticated;
grant update (default_fee_pct, default_platform_type, default_platform_pct, default_platform_fixed, updated_at)
  on public.settings to authenticated;
grant insert (id, event_id, name, price, capacity, allows_half, sort),
      update (name, price, capacity, allows_half, sort),
      delete on public.ticket_types to authenticated;
grant select on public.orders, public.tickets to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert (id, organizer_id, name, email), update (name, email), delete on public.staff to authenticated;
grant select, insert, delete on public.staff_events to authenticated;

revoke execute on function public.buy_tickets(uuid, jsonb, text, text) from public, anon;
grant execute on function public.buy_tickets(uuid, jsonb, text, text) to authenticated;
revoke execute on function public.check_in(text, uuid) from public, anon;
grant execute on function public.check_in(text, uuid) to authenticated;
revoke execute on function public.checkin_stats(uuid) from public, anon;
grant execute on function public.checkin_stats(uuid) to authenticated;

-- ---------- Depois de criar a sua conta no site ----------
-- Torne-se administradora rodando (troque pelo seu e-mail):
--
--   update public.profiles set role = 'admin' where email = 'seu-email@exemplo.com';
