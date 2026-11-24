// Cria (ou devolve) a cobrança de um pedido reservado.
// Chamado pelo site com a sessão do comprador: supabase.functions.invoke('checkout', { body: { order_id, document } })
import { serviceClient } from '../_shared/db.ts';
import { cors, json } from '../_shared/http.ts';
import { getProvider } from '../_shared/providers/index.ts';
import { HttpError, Method } from '../_shared/providers/types.ts';

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export async function handle(req: Request, db = serviceClient()): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    const user = auth?.user;
    if (!user) throw new HttpError(401, 'Entre na sua conta para pagar.');

    const { order_id, document } = await req.json().catch(() => ({}));
    if (!order_id) throw new HttpError(400, 'Pedido não informado.');

    const { data: o, error } = await db.from('orders')
      .select('id, code, buyer_id, buyer_name, buyer_email, status, expires_at, total, payment_method, organizer_amount, provider, provider_payment_id, provider_data, events(name, organizer_id, organizers(payout_provider, payout_account))')
      .eq('id', order_id).maybeSingle();
    if (error) throw error;
    if (!o || o.buyer_id !== user.id) throw new HttpError(404, 'Pedido não encontrado.');

    if (o.status === 'pending' && o.expires_at && new Date(o.expires_at) < new Date()) {
      await db.rpc('release_expired', { p_event: null });
      return json({ status: 'expired' });
    }
    if (o.status !== 'pending') return json({ status: o.status });
    if (o.provider_payment_id) return json({ status: 'pending', payment: o.provider_data });

    const doc = digits(document);
    if (doc.length !== 11 && doc.length !== 14) throw new HttpError(400, 'Informe um CPF ou CNPJ válido para pagar.');

    const { data: cfg } = await db.from('settings').select('payment_provider').eq('id', 1).maybeSingle();
    const provider = getProvider(cfg?.payment_provider || 'asaas');
    const org = (o as any).events?.organizers;
    const split = Number(o.organizer_amount) > 0 && org?.payout_account && (org.payout_provider || 'asaas') === provider.name
      ? [{ account: org.payout_account, amount: Number(o.organizer_amount) }] : [];
    if (Number(o.organizer_amount) > 0 && !split.length) {
      throw new HttpError(400, 'Este evento ainda não está habilitado para pagamento online. Avise quem organiza.');
    }

    const result = await provider.createCharge({
      orderId: o.id, orderCode: o.code, method: o.payment_method as Method, total: Number(o.total),
      description: `Ingressos ${(o as any).events?.name ?? ''} · pedido ${o.code}`,
      buyer: { userId: user.id, name: o.buyer_name, email: o.buyer_email || user.email || '', document: doc },
      split,
    });
    const payment = { method: o.payment_method, pix: result.pix ?? null, checkout_url: result.checkoutUrl ?? null };

    // Grava só se ninguém gravou antes (duas abas abertas ao mesmo tempo)
    const { data: saved } = await db.from('orders')
      .update({ provider: provider.name, provider_payment_id: result.paymentId, provider_data: payment })
      .eq('id', o.id).eq('status', 'pending').is('provider_payment_id', null).select('id');
    if (!saved?.length) {
      await provider.cancelCharge(result.paymentId);
      const { data: again } = await db.from('orders').select('status, provider_data').eq('id', o.id).single();
      return json({ status: again?.status, payment: again?.provider_data });
    }
    return json({ status: 'pending', payment });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error('checkout', e);
    return json({ error: e instanceof Error ? e.message : 'Erro ao criar o pagamento.' }, status);
  }
}

if (import.meta.main) Deno.serve(req => handle(req));
