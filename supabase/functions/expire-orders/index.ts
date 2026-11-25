// Vence as reservas sem pagamento e cancela a cobrança delas no meio de pagamento,
// para o comprador não conseguir pagar depois de a vaga ter voltado para a venda.
// Chamada a cada poucos minutos pelo agendamento do banco (supabase/cron.sql).
// Não precisa de senha: só mexe em pedidos que já venceram, e repetir não muda nada.
import { serviceClient } from '../_shared/db.ts';
import { json } from '../_shared/http.ts';
import { getProvider } from '../_shared/providers/index.ts';

const LOTE = 50; // pedidos por rodada

export async function handle(_req: Request, db = serviceClient()): Promise<Response> {
  try {
    // 1) Reservas vencidas viram "expired" e as vagas voltam para a venda
    const { data: liberados, error: e1 } = await db.rpc('release_expired', { p_event: null });
    if (e1) throw e1;

    // 2) Cobranças de pedidos vencidos ou cancelados que ainda estão abertas no meio de pagamento
    const { data: abertos, error: e2 } = await db.from('orders')
      .select('id, code, provider, provider_payment_id')
      .in('status', ['expired', 'canceled'])
      .not('provider_payment_id', 'is', null)
      .is('provider_canceled_at', null)
      .limit(LOTE);
    if (e2) throw e2;

    let cancelados = 0;
    for (const o of abertos ?? []) {
      const ok = await getProvider(o.provider).cancelCharge(o.provider_payment_id);
      if (!ok) continue;
      await db.from('orders').update({ provider_canceled_at: new Date().toISOString() })
        .eq('id', o.id).in('status', ['expired', 'canceled']);
      cancelados++;
      console.log('cobrança cancelada', o.code, o.provider_payment_id);
    }
    return json({ liberados, cancelados, pendentes: (abertos?.length ?? 0) - cancelados });
  } catch (e) {
    console.error('expire-orders', e);
    return json({ error: e instanceof Error ? e.message : 'Erro ao vencer pedidos.' }, 500);
  }
}

if (import.meta.main) Deno.serve(req => handle(req));
