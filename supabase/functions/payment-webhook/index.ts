// Recebe os avisos do meio de pagamento e confirma ou cancela pedidos.
// URL a cadastrar no Asaas: https://<projeto>.supabase.co/functions/v1/payment-webhook?provider=asaas
import { serviceClient } from '../_shared/db.ts';
import { getProvider } from '../_shared/providers/index.ts';
import { HttpError } from '../_shared/providers/types.ts';
import { notifyOrder } from '../_shared/notify.ts';

// Manda o e-mail ao comprador logo após a mudança de status. Se falhar, a função "notify" tenta de novo em até 2 minutos.
async function mailBuyer(db: ReturnType<typeof serviceClient>, provider: string, paymentId: string) {
  try {
    const { data } = await db.from('orders').select('id').eq('provider', provider).eq('provider_payment_id', paymentId).maybeSingle();
    if (data) console.log('e-mail', data.id, await notifyOrder(db, data.id));
  } catch (e) { console.error('e-mail', e); }
}

export async function handle(req: Request, db = serviceClient()): Promise<Response> {
  if (req.method !== 'POST') return new Response('ok');
  try {
    const provider = getProvider(new URL(req.url).searchParams.get('provider') || 'asaas');
    const out = await provider.parseWebhook(req);
    if (out.kind === 'paid') {
      const { data, error } = await db.rpc('confirm_payment', { p_provider: provider.name, p_payment_id: out.paymentId });
      if (error) throw error;
      console.log('pagamento', out.paymentId, data);
      if (data === 'confirmed') await mailBuyer(db, provider.name, out.paymentId);
    } else if (out.kind === 'failed') {
      const { data, error } = await db.rpc('fail_payment', { p_provider: provider.name, p_payment_id: out.paymentId, p_reason: out.reason });
      if (error) throw error;
      console.log('pagamento', out.paymentId, out.reason, data);
      if (data === 'refunded') await mailBuyer(db, provider.name, out.paymentId);
    }
    return new Response('ok');
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return new Response('unauthorized', { status: 401 });
    console.error('payment-webhook', e);
    // 500 faz o meio de pagamento tentar de novo mais tarde
    return new Response('error', { status: 500 });
  }
}

if (import.meta.main) Deno.serve(req => handle(req));
