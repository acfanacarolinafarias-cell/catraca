-- =====================================================================
-- Catraca · agendamentos: reservas vencidas e e-mails
--
-- Rode UMA VEZ no SQL Editor do Supabase, depois que as funções
-- "expire-orders" e "notify" estiverem publicadas. Pode rodar de novo: ele substitui
-- o agendamento anterior.
--
-- Se o seu projeto não for o xfrbybveoschauaaxmbk, troque a URL abaixo.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- A cada 2 minutos
select cron.schedule(
  'catraca-expire-orders',
  '*/2 * * * *',
  $$ select net.http_post(
       url     := 'https://xfrbybveoschauaaxmbk.supabase.co/functions/v1/expire-orders',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body    := '{}'::jsonb
     ) $$
);

-- E-mails aos compradores (confirmação e devolução), a cada 2 minutos.
-- Rede de segurança: o webhook já envia na hora; aqui saem os que faltaram
-- (pedidos gratuitos, confirmados manualmente, ou se o envio falhou).
select cron.schedule(
  'catraca-notify-orders',
  '1-59/2 * * * *',
  $$ select net.http_post(
       url     := 'https://xfrbybveoschauaaxmbk.supabase.co/functions/v1/notify',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body    := '{"task":"orders"}'::jsonb
     ) $$
);

-- Resumo das vendas do dia anterior para cada organizador que vendeu.
-- Todo dia às 8h07 de Brasília (11h07 UTC). Só sai e-mail se houve venda.
select cron.schedule(
  'catraca-daily-digest',
  '7 11 * * *',
  $$ select net.http_post(
       url     := 'https://xfrbybveoschauaaxmbk.supabase.co/functions/v1/notify',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body    := '{"task":"digest"}'::jsonb
     ) $$
);

-- Para conferir:  select * from cron.job;
-- Últimas rodadas: select * from cron.job_run_details order by start_time desc limit 10;
-- Para desligar:  select cron.unschedule('catraca-expire-orders');  (idem 'catraca-notify-orders', 'catraca-daily-digest')
