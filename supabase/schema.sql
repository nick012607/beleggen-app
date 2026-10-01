-- =====================================================================
-- Beleggingsdashboard – Supabase-schema
-- Draai dit volledige script één keer in Supabase: SQL Editor -> New query -> Run.
-- Het script is herhaalbaar (idempotent) waar dat kan.
--
-- Principes:
--  * Elke tabel heeft user_id (standaard auth.uid()) en Row Level Security.
--  * De frontend gebruikt alleen de publieke anon key; RLS zorgt dat je
--    uitsluitend je eigen rijen ziet. De Worker gebruikt de service key
--    (omzeilt RLS) en staat alleen als Worker-secret opgeslagen.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Hulpfunctie: updated_at bijwerken
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Instellingen (één rij per gebruiker)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  user_id             uuid primary key default auth.uid() references auth.users on delete cascade,
  base_currency       text    not null default 'EUR',
  move_threshold_pct  numeric not null default 2,      -- drempel "opvallende beweging"
  large_position_pct  numeric not null default 15,     -- vanaf welk gewicht een positie "groot" is
  concentration_pct   numeric not null default 25,     -- waarschuwing bij concentratie
  monthly_budget_usd  numeric not null default 8,
  benchmark_symbol    text    default 'IWDA.AS',        -- MSCI World-ETF als benchmark
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Instrumenten: alles wat je bezit of volgt (aandeel, ETF, cash)
-- ---------------------------------------------------------------------
create table if not exists public.instruments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  isin        text not null,                 -- ISIN, of synthetisch (bv. CASH-EUR)
  name        text not null,
  symbol      text,                          -- ticker bij de koersbron, bv. VUSA.AS
  exchange    text,                          -- beurs volgens DEGIRO, bv. EAM / TDG
  currency    text not null default 'EUR',   -- noteringsvaluta
  kind        text not null default 'other' check (kind in ('etf','stock','fund','cash','other')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, isin)
);

-- ---------------------------------------------------------------------
-- Posities: wat je nu bezit
-- ---------------------------------------------------------------------
create table if not exists public.positions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  instrument_id     uuid not null references public.instruments on delete cascade,
  quantity          numeric not null default 0,
  avg_price         numeric,          -- gemiddelde aankoopkoers in noteringsvaluta (excl. kosten)
  cost_basis_eur    numeric,          -- totale aankoopwaarde in EUR (incl. kosten)
  last_price        numeric,          -- laatst bekende koers (uit import of koersbron)
  last_value_eur    numeric,
  last_price_at     timestamptz,
  source            text not null default 'manual' check (source in ('manual','portfolio_csv','transactions')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, instrument_id)
);

-- ---------------------------------------------------------------------
-- Transacties (DEGIRO-export). dedup_key voorkomt dubbelingen;
-- let op: DEGIRO geeft deeluitvoeringen van één order hetzelfde Order ID.
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  instrument_id     uuid not null references public.instruments on delete cascade,
  executed_at       timestamptz not null,
  quantity          numeric not null,          -- positief = koop, negatief = verkoop
  price             numeric not null,          -- in noteringsvaluta
  currency          text not null,
  local_value       numeric,
  value_eur         numeric,
  fx_rate           numeric,
  autofx_fee_eur    numeric default 0,
  fees_eur          numeric default 0,
  total_eur         numeric,                   -- incl. kosten (negatief bij koop)
  exchange          text,
  venue             text,
  order_id          text,
  dedup_key         text not null,
  created_at        timestamptz not null default now(),
  unique (user_id, dedup_key)
);
create index if not exists transactions_instrument_idx on public.transactions (instrument_id, executed_at);

-- ---------------------------------------------------------------------
-- Beleggingsdagboek: waarom kocht ik dit?
-- ---------------------------------------------------------------------
create table if not exists public.journal_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  instrument_id  uuid not null references public.instruments on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists journal_instrument_idx on public.journal_entries (instrument_id, created_at desc);

-- ---------------------------------------------------------------------
-- ETF-context: thema en belangrijkste onderliggende bedrijven
-- ---------------------------------------------------------------------
create table if not exists public.etf_profiles (
  instrument_id  uuid primary key references public.instruments on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  theme          text,
  holdings       jsonb not null default '[]'::jsonb,  -- [{name, ticker, weight_pct}]
  sectors        jsonb not null default '{}'::jsonb,  -- {"Technologie": 32.1, ...}
  regions        jsonb not null default '{}'::jsonb,
  currencies     jsonb not null default '{}'::jsonb,
  source         text not null default 'manual' check (source in ('manual','claude')),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Watchlist (fase 2)
-- ---------------------------------------------------------------------
create table if not exists public.watchlist (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  instrument_id  uuid not null references public.instruments on delete cascade,
  alert_above    numeric,
  alert_below    numeric,
  note           text,
  last_alert_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, instrument_id)
);

-- ---------------------------------------------------------------------
-- Koershistorie (fase 2) – slotkoersen per instrument per dag
-- ---------------------------------------------------------------------
create table if not exists public.prices (
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  instrument_id  uuid not null references public.instruments on delete cascade,
  date           date not null,
  close          numeric not null,
  currency       text not null,
  close_eur      numeric,
  primary key (instrument_id, date)
);

-- ---------------------------------------------------------------------
-- Krantedities (fase 3) – JSON-inhoud die de frontend rendert
-- ---------------------------------------------------------------------
create table if not exists public.editions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  edition_date date not null,
  kind         text not null default 'daily' check (kind in ('daily','weekly')),
  status       text not null default 'ready' check (status in ('pending','ready','failed')),
  content      jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  unique (user_id, edition_date, kind)
);

-- ---------------------------------------------------------------------
-- Tokenverbruik en kosten per run (fase 3)
-- ---------------------------------------------------------------------
create table if not exists public.usage_log (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users on delete cascade,
  edition_id            uuid references public.editions on delete set null,
  run_at                timestamptz not null default now(),
  model                 text,
  input_tokens          integer default 0,
  output_tokens         integer default 0,
  cache_read_tokens     integer default 0,
  cache_write_tokens    integer default 0,
  web_search_requests   integer default 0,
  cost_usd              numeric(10,4) default 0,
  attempt               smallint default 1,
  success               boolean default true,
  note                  text
);

-- ---------------------------------------------------------------------
-- Push-abonnementen (fase 4)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- ---------------------------------------------------------------------
-- updated_at-triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','instruments','positions','journal_entries','etf_profiles'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: aan op ALLE tabellen, alleen eigen rijen
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','instruments','positions','transactions','journal_entries',
                           'etf_profiles','watchlist','prices','editions','usage_log','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Edities en kostenlog worden alleen door de Worker geschreven: frontend mag lezen, niet schrijven.
drop policy if exists own_rows on public.usage_log;
drop policy if exists own_rows_read on public.usage_log;
create policy own_rows_read on public.usage_log for select to authenticated using (user_id = auth.uid());
drop policy if exists own_rows on public.editions;
drop policy if exists own_rows_read on public.editions;
create policy own_rows_read on public.editions for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- apply_import: past een CSV-import in één transactie toe (alles of niets).
-- De frontend berekent de eindtoestand; deze functie schrijft die weg.
-- SECURITY INVOKER: RLS blijft gelden.
--
-- p_instruments  : [{isin, name, exchange, currency, kind}]
-- p_transactions : [{isin, executed_at, quantity, price, currency, local_value, value_eur,
--                    fx_rate, autofx_fee_eur, fees_eur, total_eur, exchange, venue, order_id, dedup_key}]
-- p_positions    : [{isin, quantity, avg_price, cost_basis_eur, last_price, last_value_eur, last_price_at, source}]
-- p_remove_isins : ISIN's waarvan de positie verwijderd moet worden
-- Retourneert aantallen.
-- ---------------------------------------------------------------------
create or replace function public.apply_import(
  p_instruments  jsonb,
  p_transactions jsonb default '[]'::jsonb,
  p_positions    jsonb default '[]'::jsonb,
  p_remove_isins text[] default '{}'
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tx_inserted int := 0;
  v_pos int := 0;
  v_removed int := 0;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd';
  end if;

  -- 1. instrumenten aanmaken of bijwerken (naam alleen overschrijven als de nieuwe niet afgekapt is)
  insert into instruments (user_id, isin, name, exchange, currency, kind)
  select v_uid, i->>'isin', i->>'name', i->>'exchange', coalesce(i->>'currency','EUR'), coalesce(i->>'kind','other')
  from jsonb_array_elements(p_instruments) i
  on conflict (user_id, isin) do update set
    name     = case when excluded.name like '%...' and length(instruments.name) >= length(excluded.name) - 3
                    then instruments.name else excluded.name end,
    exchange = coalesce(excluded.exchange, instruments.exchange),
    currency = excluded.currency,
    kind     = case when instruments.kind = 'other' then excluded.kind else instruments.kind end;

  -- 2. transacties toevoegen, dubbelingen negeren
  with ins as (
    insert into transactions (user_id, instrument_id, executed_at, quantity, price, currency, local_value,
                              value_eur, fx_rate, autofx_fee_eur, fees_eur, total_eur, exchange, venue,
                              order_id, dedup_key)
    select v_uid, ins_i.id, (t->>'executed_at')::timestamptz, (t->>'quantity')::numeric, (t->>'price')::numeric,
           t->>'currency', (t->>'local_value')::numeric, (t->>'value_eur')::numeric, (t->>'fx_rate')::numeric,
           coalesce((t->>'autofx_fee_eur')::numeric, 0), coalesce((t->>'fees_eur')::numeric, 0),
           (t->>'total_eur')::numeric, t->>'exchange', t->>'venue', t->>'order_id', t->>'dedup_key'
    from jsonb_array_elements(p_transactions) t
    join instruments ins_i on ins_i.user_id = v_uid and ins_i.isin = t->>'isin'
    on conflict (user_id, dedup_key) do nothing
    returning 1
  )
  select count(*) into v_tx_inserted from ins;

  -- 3. posities verwijderen
  delete from positions p
  using instruments i
  where p.instrument_id = i.id and p.user_id = v_uid and i.isin = any(p_remove_isins);
  get diagnostics v_removed = row_count;

  -- 4. posities zetten
  insert into positions (user_id, instrument_id, quantity, avg_price, cost_basis_eur, last_price,
                         last_value_eur, last_price_at, source)
  select v_uid, i.id, (p->>'quantity')::numeric, (p->>'avg_price')::numeric, (p->>'cost_basis_eur')::numeric,
         (p->>'last_price')::numeric, (p->>'last_value_eur')::numeric, (p->>'last_price_at')::timestamptz,
         coalesce(p->>'source','manual')
  from jsonb_array_elements(p_positions) p
  join instruments i on i.user_id = v_uid and i.isin = p->>'isin'
  on conflict (user_id, instrument_id) do update set
    quantity       = excluded.quantity,
    avg_price      = excluded.avg_price,
    cost_basis_eur = excluded.cost_basis_eur,
    last_price     = excluded.last_price,
    last_value_eur = excluded.last_value_eur,
    last_price_at  = excluded.last_price_at,
    source         = excluded.source;
  get diagnostics v_pos = row_count;

  return jsonb_build_object('transactions_inserted', v_tx_inserted, 'positions_set', v_pos, 'positions_removed', v_removed);
end $$;

grant execute on function public.apply_import(jsonb, jsonb, jsonb, text[]) to authenticated;
revoke execute on function public.apply_import(jsonb, jsonb, jsonb, text[]) from anon, public;
