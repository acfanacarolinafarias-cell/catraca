// Recebe os avisos do meio de pagamento e confirma ou cancela pedidos.
// URL a cadastrar no Asaas: https://<projeto>.supabase.co/functions/v1/payment-webhook?provider=asaas
import { serviceClient } from '../_shared/db.ts';
import { getProvider } from '../_shared/providers/index.ts';
import { HttpError } from '../_shared/providers/types.ts';

export async function handle(req: Request, db = serviceClient()): Promise<Response> {
  if (req.method !== 'POST') return new Response('ok');
  try {
    const provider = getProvider(new URL(req.url).searchParams.get('provider') || 'asaas');
    const out = await provider.parseWebhook(req);
    if (out.kind === 'paid') {
      const { data, error } = await db.rpc('confirm_payment', { p_provider: provider.name, p_payment_id: out.paymentId });
      if (error) throw error;
      console.log('pagamento', out.paymentId, data);
    } else if (out.kind === 'failed') {
      const { data, error } = await db.rpc('fail_payment', { p_provider: provider.name, p_payment_id: out.paymentId, p_reason: out.reason });
      if (error) throw error;
      console.log('pagamento', out.paymentId, out.reason, data);
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
