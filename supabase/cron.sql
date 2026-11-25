-- =====================================================================
-- Catraca · agendamento: vence reservas e cancela cobranças abertas
--
-- Rode UMA VEZ no SQL Editor do Supabase, depois que a função
-- "expire-orders" estiver publicada. Pode rodar de novo: ele substitui
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

-- Para conferir:  select * from cron.job;
-- Últimas rodadas: select * from cron.job_run_details order by start_time desc limit 10;
-- Para desligar:  select cron.unschedule('catraca-expire-orders');
