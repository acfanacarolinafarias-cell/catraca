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
-- Período de vendas do lote (opcional) e se o comprador vê quantos ingressos restam (padrão: não vê).
-- O lote para de vender no que vier primeiro: acabar a quantidade ou passar o fim do período.
alter table public.ticket_types add column if not exists sales_start    timestamptz;
alter table public.ticket_types add column if not exists sales_end      timestamptz;
alter table public.ticket_types add column if not exists show_remaining boolean not null default false;
do $$ begin
  alter table public.ticket_types add constraint ticket_types_sales_window_check
    check (sales_start is null or sales_end is null or sales_end > sales_start);
exception when duplicate_object then null; end $$;

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

-- ---------- Pagamento online: colunas ----------

-- Configurações de pagamento (só a administração altera)
alter table public.settings add column if not exists payments_enabled    boolean not null default false;
alter table public.settings add column if not exists payment_provider    text not null default 'asaas';
alter table public.settings add column if not exists reservation_minutes integer not null default 15;
alter table public.settings add column if not exists pix_fee_fixed       numeric(10,2) not null default 1.99;
alter table public.settings add column if not exists pix_fee_pct         numeric(5,2) not null default 0;
alter table public.settings add column if not exists card_fee_fixed      numeric(10,2) not null default 0.49;
alter table public.settings add column if not exists card_fee_pct        numeric(5,2) not null default 2.99;
alter table public.settings add column if not exists split_fee_fixed     numeric(10,2) not null default 0;
-- Cartão parcelado: tarifa percentual do Asaas por faixa de parcelas (a fixa é a mesma do à vista)
alter table public.settings add column if not exists card_fee_pct_2_6    numeric(5,2) not null default 3.49;
alter table public.settings add column if not exists card_fee_pct_7_12   numeric(5,2) not null default 3.99;
do $$ begin
  alter table public.settings add constraint settings_installment_fees_check check (
    card_fee_pct_2_6 between 0 and 50 and card_fee_pct_7_12 between 0 and 50);
exception when duplicate_object then null; end $$;

-- Parcelamento máximo no cartão, definido pelo organizador em cada evento (1 = só à vista)
alter table public.events add column if not exists max_installments integer not null default 1;
do $$ begin
  alter table public.events add constraint events_max_installments_check check (max_installments between 1 and 12);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.settings add constraint settings_payment_values_check check (
    reservation_minutes between 5 and 120 and pix_fee_fixed >= 0 and card_fee_fixed >= 0
    and split_fee_fixed >= 0 and pix_fee_pct between 0 and 50 and card_fee_pct between 0 and 50);
exception when duplicate_object then null; end $$;

-- Conta de recebimento do organizador no meio de pagamento (ex.: Wallet ID do Asaas)
alter table public.organizers add column if not exists payout_provider text not null default 'asaas';
alter table public.organizers add column if not exists payout_account  text not null default '';

-- Situação e valores do pedido
alter table public.orders add column if not exists status              text not null default 'confirmed';
alter table public.orders add column if not exists expires_at          timestamptz;
alter table public.orders add column if not exists payment_method      text not null default 'manual';
alter table public.orders add column if not exists payment_fee         numeric(10,2) not null default 0;
alter table public.orders add column if not exists commission          numeric(10,2) not null default 0;
alter table public.orders add column if not exists split_fee           numeric(10,2) not null default 0;
alter table public.orders add column if not exists organizer_amount    numeric(10,2) not null default 0;
alter table public.orders add column if not exists provider            text;
alter table public.orders add column if not exists provider_payment_id text;
alter table public.orders add column if not exists provider_data       jsonb;
-- Quando a cobrança de um pedido vencido foi cancelada no meio de pagamento (função expire-orders)
alter table public.orders add column if not exists provider_canceled_at timestamptz;
alter table public.orders add column if not exists paid_at             timestamptz;
alter table public.orders add column if not exists installments        integer not null default 1;
do $$ begin
  alter table public.orders add constraint orders_status_check
    check (status in ('pending', 'confirmed', 'expired', 'canceled', 'refunded', 'refund_needed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_payment_method_check check (payment_method in ('manual', 'pix', 'card', 'free'));
exception when duplicate_object then null; end $$;
create unique index if not exists orders_provider_payment_key on public.orders (provider, provider_payment_id) where provider_payment_id is not null;
create index if not exists orders_pending_idx on public.orders (expires_at) where status = 'pending';

-- Cupons de desconto (criados pelo organizador do evento ou pela administração).
-- O desconto sai só da parte do organizador: taxa de serviço e cobrança da plataforma
-- continuam calculadas sobre o preço cheio.
create table if not exists public.coupons (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  code             text not null,
  discount_type    text not null check (discount_type in ('percent', 'fixed')),
  discount_value   numeric(10,2) not null check (discount_value > 0),
  ticket_type_ids  uuid[],                       -- null = todos os lotes
  include_half     boolean not null default true, -- vale também para meia-entrada
  max_uses         integer check (max_uses is null or max_uses > 0),
  once_per_buyer   boolean not null default false,
  valid_until      timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint coupons_percent_max check (discount_type <> 'percent' or discount_value <= 100)
);
create unique index if not exists coupons_event_code_key on public.coupons (event_id, upper(code));

alter table public.orders  add column if not exists coupon_id   uuid references public.coupons(id) on delete set null;
alter table public.orders  add column if not exists coupon_code text;
alter table public.orders  add column if not exists discount    numeric(10,2) not null default 0;
alter table public.tickets add column if not exists discount    numeric(10,2) not null default 0;

-- ---------- Compra (atômica, com trava de lotação) ----------

-- Taxa do meio de pagamento repassada ao comprador: o total é calculado para que,
-- depois da tarifa (fixo + %), sobre exatamente o valor base.
drop function if exists public.payment_fee_for(numeric, text);
create or replace function public.payment_fee_for(p_base numeric, p_method text, p_installments integer default 1) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  cfg public.settings%rowtype;
  f numeric; p numeric;
begin
  if p_base <= 0 or p_method not in ('pix', 'card') then return 0; end if;
  select * into cfg from public.settings where id = 1;
  f := case p_method when 'pix' then cfg.pix_fee_fixed else cfg.card_fee_fixed end;
  p := case when p_method = 'pix' then cfg.pix_fee_pct
            when coalesce(p_installments, 1) >= 7 then cfg.card_fee_pct_7_12
            when coalesce(p_installments, 1) >= 2 then cfg.card_fee_pct_2_6
            else cfg.card_fee_pct end;
  return ceil(((p_base + f) / (1 - p / 100) - p_base) * 100) / 100;
end $$;

-- Devolve as vagas de um pedido ao estoque
create or replace function public.release_order_seats(p_order uuid) returns void
language sql security definer set search_path = public as $$
  update public.ticket_types tt set sold = greatest(tt.sold - x.qty, 0)
  from (select ticket_type_id, count(*)::int as qty from public.tickets where order_id = p_order group by 1) x
  where tt.id = x.ticket_type_id;
$$;

-- Reservas vencidas sem pagamento: libera as vagas
create or replace function public.release_expired(p_event uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record; n integer := 0;
begin
  for o in
    select id from public.orders
    where status = 'pending' and expires_at < now() and (p_event is null or event_id = p_event)
    for update skip locked
  loop
    perform public.release_order_seats(o.id);
    update public.orders set status = 'expired' where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Confere um cupom sem usá-lo (para mostrar o desconto antes da compra)
create or replace function public.check_coupon(p_event uuid, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.coupons%rowtype;
  v_used integer;
begin
  select * into c from public.coupons
    where event_id = p_event and upper(code) = upper(trim(p_code)) and active;
  if not found then raise exception 'Cupom não encontrado para este evento.'; end if;
  if c.valid_until is not null and c.valid_until < now() then raise exception 'Este cupom expirou.'; end if;
  select count(*) into v_used from public.orders where coupon_id = c.id and status in ('pending', 'confirmed');
  if c.max_uses is not null and v_used >= c.max_uses then raise exception 'Este cupom já atingiu o limite de usos.'; end if;
  if c.once_per_buyer and auth.uid() is not null and exists (
       select 1 from public.orders where coupon_id = c.id and buyer_id = auth.uid() and status in ('pending', 'confirmed')) then
    raise exception 'Você já usou este cupom.';
  end if;
  return jsonb_build_object('code', upper(c.code), 'type', c.discount_type, 'value', c.discount_value,
    'ticket_type_ids', to_jsonb(c.ticket_type_ids), 'include_half', c.include_half);
end $$;

-- Desconto de um ingresso pelo cupom
create or replace function public.coupon_ticket_discount(c public.coupons, p_type uuid, p_kind text, p_unit numeric) returns numeric
language sql immutable as $$
  select case
    when c.id is null then 0
    when c.ticket_type_ids is not null and not (p_type = any (c.ticket_type_ids)) then 0
    when p_kind = 'meia' and not c.include_half then 0
    when c.discount_type = 'percent' then round(p_unit * c.discount_value / 100, 2)
    else least(c.discount_value, p_unit)
  end;
$$;

drop function if exists public.buy_tickets(uuid, jsonb, text, text);
drop function if exists public.buy_tickets(uuid, jsonb, text, text, text);
drop function if exists public.buy_tickets(uuid, jsonb, text, text, text, text);
create or replace function public.buy_tickets(
  p_event uuid, p_items jsonb, p_buyer_name text, p_buyer_email text default '',
  p_method text default null, p_coupon text default null, p_installments integer default 1
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  cfg        public.settings%rowtype;
  v_event    public.events%rowtype;
  v_type     public.ticket_types%rowtype;
  v_coupon   public.coupons%rowtype;
  v_wallet   text := '';
  r          record;
  v_order    uuid;
  v_code     text;
  v_unit     numeric(10,2);
  v_disc     numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_fee      numeric(10,2);
  v_payfee   numeric(10,2) := 0;
  v_comm     numeric(10,2);
  v_split    numeric(10,2) := 0;
  v_orgamt   numeric(10,2) := 0;
  v_charge   numeric(10,2);
  v_n        integer := 0;
  v_used     integer;
  v_online   boolean;
  v_inst     integer := 1;
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

  select * into cfg from public.settings where id = 1;
  v_online := coalesce(cfg.payments_enabled, false);

  select * into v_event from public.events where id = p_event and published;
  if not found then
    raise exception 'Este evento não está à venda.';
  end if;
  if v_event.starts_at < now() - interval '6 hours' then
    raise exception 'As vendas deste evento foram encerradas.';
  end if;
  if v_online then
    if coalesce(p_method, '') not in ('pix', 'card') then
      raise exception 'Escolha a forma de pagamento: Pix ou cartão.';
    end if;
    if p_method = 'card' then
      v_inst := coalesce(p_installments, 1);
      if v_inst < 1 or v_inst > v_event.max_installments then
        raise exception 'Este evento aceita no máximo % parcela(s) no cartão.', v_event.max_installments;
      end if;
    end if;
    if v_event.organizer_id is not null then
      select coalesce(payout_account, '') into v_wallet from public.organizers where id = v_event.organizer_id;
      if v_wallet = '' then
        raise exception 'Este evento ainda não está habilitado para pagamento online. Avise quem organiza.';
      end if;
    end if;
  end if;

  -- Reservas vencidas deste evento voltam para a venda (e liberam usos de cupom)
  perform public.release_expired(p_event);

  -- Cupom: travado para o limite de usos valer mesmo com compras simultâneas
  if coalesce(trim(p_coupon), '') <> '' then
    select * into v_coupon from public.coupons
      where event_id = p_event and upper(code) = upper(trim(p_coupon)) and active for update;
    if not found then raise exception 'Cupom não encontrado para este evento.'; end if;
    if v_coupon.valid_until is not null and v_coupon.valid_until < now() then raise exception 'Este cupom expirou.'; end if;
    select count(*) into v_used from public.orders where coupon_id = v_coupon.id and status in ('pending', 'confirmed');
    if v_coupon.max_uses is not null and v_used >= v_coupon.max_uses then raise exception 'Este cupom já atingiu o limite de usos.'; end if;
    if v_coupon.once_per_buyer and exists (
         select 1 from public.orders where coupon_id = v_coupon.id and buyer_id = v_uid and status in ('pending', 'confirmed')) then
      raise exception 'Você já usou este cupom.';
    end if;
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
    if v_type.sales_start is not null and now() < v_type.sales_start then
      raise exception 'As vendas de "%" começam em %.', v_type.name,
        to_char(v_type.sales_start at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
    end if;
    if v_type.sales_end is not null and now() > v_type.sales_end then
      raise exception 'As vendas de "%" foram encerradas.', v_type.name;
    end if;
    if v_type.sold + r.qty > v_type.capacity then
      if v_type.sold >= v_type.capacity then
        raise exception '"%" esgotou.', v_type.name;
      elsif v_type.show_remaining then
        raise exception 'Não há ingressos suficientes em "%". Restam %.', v_type.name, v_type.capacity - v_type.sold;
      else
        raise exception 'Não há ingressos suficientes em "%" para essa quantidade.', v_type.name;
      end if;
    end if;
    update public.ticket_types set sold = sold + r.qty where id = v_type.id;
  end loop;

  loop
    v_code := public.gen_code(6);
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (code, event_id, buyer_id, buyer_name, buyer_email, coupon_id, coupon_code)
  values (v_code, p_event, v_uid, trim(p_buyer_name), coalesce(trim(p_buyer_email), ''),
          v_coupon.id, case when v_coupon.id is not null then upper(v_coupon.code) end)
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
    v_disc := public.coupon_ticket_discount(v_coupon, v_type.id, r.kind, v_unit);
    for i in 1 .. r.qty loop
      v_n := v_n + 1;
      insert into public.tickets (code, order_id, event_id, ticket_type_id, type_name, kind, unit_price, discount)
      values (v_code || '-' || v_n, v_order, p_event, v_type.id, v_type.name, r.kind, v_unit, v_disc);
    end loop;
    v_subtotal := v_subtotal + v_unit * r.qty;
    v_discount := v_discount + v_disc * r.qty;
  end loop;

  if v_coupon.id is not null and v_discount = 0 then
    raise exception 'O cupom % não vale para os ingressos escolhidos.', upper(v_coupon.code);
  end if;

  -- Taxa de serviço e cobrança da plataforma: sobre o preço cheio
  v_fee  := round(v_subtotal * v_event.fee_pct / 100, 2);
  v_comm := case when v_event.platform_fee_type = 'fixed'
                 then round(v_n * v_event.platform_fee_fixed, 2)
                 else round(v_subtotal * v_event.platform_pct / 100, 2) end;
  if v_event.organizer_id is not null then
    v_split  := case when v_online then cfg.split_fee_fixed else 0 end;
    if v_discount > 0 and v_subtotal - v_discount < v_comm + v_split then
      raise exception 'O desconto do cupom é maior do que o permitido para estes ingressos.';
    end if;
    v_orgamt := greatest(v_subtotal - v_discount - v_comm - v_split, 0);
  end if;
  v_charge := v_subtotal - v_discount + v_fee;   -- valor antes da taxa do meio de pagamento

  if v_online and v_charge > 0 then
    v_payfee := public.payment_fee_for(v_charge, p_method, v_inst);
    update public.orders set
      subtotal = v_subtotal, discount = v_discount, fee = v_fee, payment_fee = v_payfee, total = v_charge + v_payfee,
      commission = v_comm, split_fee = v_split, organizer_amount = v_orgamt,
      payment_method = p_method, installments = v_inst, status = 'pending',
      expires_at = now() + make_interval(mins => coalesce(cfg.reservation_minutes, 15))
    where id = v_order;
  else
    update public.orders set
      subtotal = v_subtotal, discount = v_discount, fee = v_fee, total = v_charge,
      commission = v_comm, split_fee = 0, organizer_amount = v_orgamt,
      payment_method = case when v_online then 'free' else 'manual' end,
      status = 'confirmed', paid_at = now()
    where id = v_order;
  end if;

  return v_order;
end $$;

-- ---------- Retorno do meio de pagamento (chamado só pelo servidor) ----------

-- Pagamento aprovado. Idempotente: avisos repetidos não fazem nada.
create or replace function public.confirm_payment(p_provider text, p_payment_id text) returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  r record;
begin
  select * into o from public.orders
    where provider = p_provider and provider_payment_id = p_payment_id for update;
  if not found then return 'unknown'; end if;
  if o.status in ('confirmed', 'refund_needed', 'refunded') then return o.status; end if;

  if o.status in ('expired', 'canceled') then
    -- Pagou depois de a reserva vencer: tenta reservar de novo
    for r in
      select t.ticket_type_id, count(*)::int as qty from public.tickets t
      where t.order_id = o.id group by 1 order by 1
    loop
      if not exists (select 1 from public.ticket_types
                     where id = r.ticket_type_id and sold + r.qty <= capacity) then
        update public.orders set status = 'refund_needed', paid_at = now() where id = o.id;
        return 'refund_needed';
      end if;
    end loop;
    for r in
      select t.ticket_type_id, count(*)::int as qty from public.tickets t
      where t.order_id = o.id group by 1 order by 1
    loop
      update public.ticket_types set sold = sold + r.qty where id = r.ticket_type_id;
    end loop;
  end if;

  update public.orders set status = 'confirmed', paid_at = now() where id = o.id;
  return 'confirmed';
end $$;

-- Cobrança cancelada, vencida ou estornada
create or replace function public.fail_payment(p_provider text, p_payment_id text, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders
    where provider = p_provider and provider_payment_id = p_payment_id for update;
  if not found then return 'unknown'; end if;
  if p_reason = 'refunded' and o.status in ('confirmed', 'refund_needed') then
    if o.status = 'confirmed' then perform public.release_order_seats(o.id); end if;
    update public.orders set status = 'refunded' where id = o.id;
    return 'refunded';
  end if;
  if o.status = 'pending' then
    perform public.release_order_seats(o.id);
    update public.orders set status = 'canceled' where id = o.id;
    return 'canceled';
  end if;
  return o.status;
end $$;

-- Administração marca que devolveu o dinheiro de um pedido pago fora do prazo
create or replace function public.mark_refunded(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a administração registra devoluções.';
  end if;
  update public.orders set status = 'refunded' where id = p_order and status = 'refund_needed';
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
  if o.status <> 'confirmed' then
    return jsonb_build_object('status', 'not_paid', 'code', t.code, 'order_status', o.status);
  end if;
  if t.checked_in_at is not null then
    return jsonb_build_object('status', 'used', 'at', t.checked_in_at, 'buyer', o.buyer_name,
                              'type', t.type_name, 'kind', t.kind, 'code', t.code);
  end if;
  update public.tickets set checked_in_at = now(), checked_in_by = auth.uid() where id = t.id;
  return jsonb_build_object('status', 'ok', 'buyer', o.buyer_name, 'type', t.type_name,
                            'kind', t.kind, 'code', t.code);
end $$;

-- Contagem da entrada e últimas validações (sem e-mails nem valores; só pedidos pagos)
create or replace function public.checkin_stats(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.can_manage_event(p_event) or public.is_event_staff(p_event)) then
    raise exception 'Você não tem permissão para ver a entrada deste evento.';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.tickets t join public.orders o on o.id = t.order_id
              where t.event_id = p_event and o.status = 'confirmed'),
    'used',  (select count(*) from public.tickets t join public.orders o on o.id = t.order_id
              where t.event_id = p_event and o.status = 'confirmed' and t.checked_in_at is not null),
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
alter table public.coupons      enable row level security;

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
  using (public.can_manage_event(event_id) or public.is_event_staff(event_id));

-- Lotes para o público: sem quantidade e vendidos, a não ser que o organizador escolha mostrar.
-- A visão roda com as permissões do dono (por isso repete aqui a regra de evento publicado).
create or replace view public.ticket_types_public with (security_barrier = true) as
  select t.id, t.event_id, t.name, t.price, t.allows_half, t.sort,
         t.sales_start, t.sales_end, t.show_remaining,
         case when t.show_remaining then t.capacity end as capacity,
         case when t.show_remaining then t.sold end     as sold,
         (t.sold >= t.capacity)                         as sold_out
  from public.ticket_types t
  join public.events e on e.id = t.event_id
  where e.published or public.can_manage_event(e.id) or public.is_event_staff(e.id);
drop policy if exists ticket_types_write on public.ticket_types;
create policy ticket_types_write on public.ticket_types for all
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select
  using (buyer_id = auth.uid() or public.can_manage_event(event_id));

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
  using (
    exists (select 1 from public.orders o
            where o.id = order_id and o.buyer_id = auth.uid() and o.status = 'confirmed')
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

drop policy if exists coupons_manage on public.coupons;
create policy coupons_manage on public.coupons for all
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

-- ---------- Privilégios por coluna ----------
-- Pedidos e ingressos só são criados pelas funções acima; "sold" e "role"
-- não podem ser alterados direto pelo navegador.

revoke all on public.profiles, public.organizers, public.events, public.ticket_types,
              public.orders, public.tickets, public.expenses,
              public.staff, public.staff_events, public.settings, public.coupons from anon, authenticated;

grant select on public.events, public.ticket_types to anon, authenticated;
grant select on public.ticket_types_public to anon, authenticated;
grant select, update (full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.organizers to authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.settings to anon, authenticated;
grant update (default_fee_pct, default_platform_type, default_platform_pct, default_platform_fixed, updated_at,
              payments_enabled, reservation_minutes, pix_fee_fixed, pix_fee_pct, card_fee_fixed, card_fee_pct,
              split_fee_fixed, card_fee_pct_2_6, card_fee_pct_7_12)
  on public.settings to authenticated;
grant insert (id, event_id, name, price, capacity, allows_half, sort, sales_start, sales_end, show_remaining),
      update (name, price, capacity, allows_half, sort, sales_start, sales_end, show_remaining),
      delete on public.ticket_types to authenticated;
grant select on public.orders, public.tickets to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert (id, organizer_id, name, email), update (name, email), delete on public.staff to authenticated;
grant select, insert, delete on public.staff_events to authenticated;
grant select, insert, update, delete on public.coupons to authenticated;

revoke execute on function public.buy_tickets(uuid, jsonb, text, text, text, text, integer) from public, anon;
grant execute on function public.buy_tickets(uuid, jsonb, text, text, text, text, integer) to authenticated;
revoke execute on function public.check_coupon(uuid, text) from public, anon;
grant execute on function public.check_coupon(uuid, text) to authenticated;
revoke execute on function public.release_expired(uuid) from public, anon;
grant execute on function public.release_expired(uuid) to authenticated;
revoke execute on function public.mark_refunded(uuid) from public, anon;
grant execute on function public.mark_refunded(uuid) to authenticated;
-- Só o servidor (Edge Functions, com a chave secreta) confirma ou cancela pagamentos
revoke execute on function public.confirm_payment(text, text) from public, anon, authenticated;
revoke execute on function public.fail_payment(text, text, text) from public, anon, authenticated;
revoke execute on function public.release_order_seats(uuid) from public, anon, authenticated;
revoke execute on function public.payment_fee_for(numeric, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text) to service_role;
grant execute on function public.fail_payment(text, text, text) to service_role;
-- O que as Edge Functions (checkout e payment-webhook) leem e gravam com a chave de servidor.
-- Projetos novos do Supabase não dão acesso automático às tabelas para service_role.
grant select, update on public.orders to service_role;
grant select on public.events, public.organizers, public.settings to service_role;
grant execute on function public.release_expired(uuid) to service_role;

-- ---------- Notificações por e-mail (função "notify") ----------
-- Quando o e-mail de confirmação / devolução foi enviado ao comprador
-- Na primeira vez, os pedidos que já existiam ficam marcados como avisados (não recebem e-mail atrasado)
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'orders' and column_name = 'confirmation_email_at') then
    alter table public.orders add column confirmation_email_at timestamptz;
    alter table public.orders add column if not exists refund_email_at timestamptz;
    update public.orders set confirmation_email_at = now() where status = 'confirmed';
    update public.orders set refund_email_at = now()       where status = 'refunded';
  end if;
end $$;
alter table public.orders add column if not exists refund_email_at timestamptz;
create index if not exists orders_mail_pending_idx on public.orders (status)
  where confirmation_email_at is null or refund_email_at is null;

-- Resumos diários já enviados aos organizadores (um por organizador e dia)
create table if not exists public.organizer_digests (
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  day          date not null,
  sent_at      timestamptz not null default now(),
  primary key (organizer_id, day)
);
alter table public.organizer_digests enable row level security;   -- sem políticas: só o servidor acessa
revoke all on public.organizer_digests from public, anon, authenticated;
grant select, insert, delete on public.organizer_digests to service_role;

-- Vendas confirmadas no intervalo, por organizador e evento
create or replace function public.digest_rows(p_from timestamptz, p_to timestamptz)
returns table (organizer_id uuid, organizer_name text, organizer_email text, event_name text,
               orders integer, tickets integer, sales numeric, organizer_amount numeric)
language sql stable security definer set search_path = public as $$
  select g.id, coalesce(nullif(g.trade_name, ''), g.legal_name), g.email, e.name,
         count(*)::int,
         coalesce(sum((select count(*) from public.tickets t where t.order_id = o.id)), 0)::int,
         sum(o.subtotal - o.discount), sum(o.organizer_amount)
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.organizers g on g.id = e.organizer_id
  where o.status = 'confirmed'
    and coalesce(o.paid_at, o.created_at) >= p_from and coalesce(o.paid_at, o.created_at) < p_to
  group by g.id, g.trade_name, g.legal_name, g.email, e.id, e.name, e.starts_at
  order by g.id, e.starts_at
$$;
revoke execute on function public.digest_rows(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.digest_rows(timestamptz, timestamptz) to service_role;
grant select on public.tickets to service_role;

revoke execute on function public.check_in(text, uuid) from public, anon;
grant execute on function public.check_in(text, uuid) to authenticated;
revoke execute on function public.checkin_stats(uuid) from public, anon;
grant execute on function public.checkin_stats(uuid) to authenticated;

-- ---------- Depois de criar a sua conta no site ----------
-- Torne-se administradora rodando (troque pelo seu e-mail):
--
--   update public.profiles set role = 'admin' where email = 'seu-email@exemplo.com';
