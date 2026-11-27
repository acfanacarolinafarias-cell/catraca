// E-mails do Catraca, chamada pelo agendamento do banco (supabase/cron.sql):
//   {"task":"orders"} a cada 2 minutos → confirmações e devoluções pendentes
//   {"task":"digest"} uma vez por dia   → resumo de vendas do dia anterior para os organizadores
// Não precisa de senha: só envia e-mails que estão devidos, e cada um sai uma vez só.
import { serviceClient } from '../_shared/db.ts';
import { json } from '../_shared/http.ts';
import { sendDailyDigests, sweepOrders } from '../_shared/notify.ts';

export async function handle(req: Request, db = serviceClient()): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.task === 'digest') return json(await sendDailyDigests(db));
    return json(await sweepOrders(db));
  } catch (e) {
    console.error('notify', e);
    return json({ error: e instanceof Error ? e.message : 'Erro ao enviar notificações.' }, 500);
  }
}

if (import.meta.main) Deno.serve(req => handle(req));
