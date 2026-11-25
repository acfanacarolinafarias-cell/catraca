import { ChargeInput, ChargeResult, HttpError, PaymentProvider, WebhookOutcome } from './types.ts';

// Variáveis (Supabase > Edge Functions > Secrets):
//   ASAAS_API_KEY        chave de API da conta da plataforma
//   ASAAS_ENV            "sandbox" (testes) ou "production"
//   ASAAS_WEBHOOK_TOKEN  código secreto cadastrado no webhook do Asaas
const env = (k: string) => Deno.env.get(k) ?? '';

function baseUrl() {
  return env('ASAAS_ENV') === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

async function api(path: string, init: RequestInit = {}) {
  const key = env('ASAAS_API_KEY');
  if (!key) throw new HttpError(500, 'Pagamento online não configurado (falta ASAAS_API_KEY).');
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: { 'access_token': key, 'Content-Type': 'application/json', 'User-Agent': 'catraca-ingressos', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.errors?.map((e: any) => e.description).join(' ') || `Asaas respondeu ${res.status}`;
    throw new HttpError(res.status >= 500 ? 502 : 400, msg);
  }
  return body;
}

// Data de hoje no horário de Brasília (vencimento da cobrança)
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function findOrCreateCustomer(b: ChargeInput['buyer']) {
  const found = await api(`/customers?cpfCnpj=${encodeURIComponent(b.document)}&limit=1`);
  if (found?.data?.length) return found.data[0].id as string;
  const created = await api('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: b.name, cpfCnpj: b.document, email: b.email || undefined, externalReference: b.userId, notificationDisabled: true }),
  });
  return created.id as string;
}

export const asaas: PaymentProvider = {
  name: 'asaas',

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const customer = await findOrCreateCustomer(input.buyer);
    const payment = await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer,
        billingType: input.method === 'pix' ? 'PIX' : 'CREDIT_CARD',
        value: Number(input.total.toFixed(2)),
        dueDate: todayBR(),
        description: input.description.slice(0, 500),
        externalReference: input.orderId,
        split: input.split.length
          ? input.split.map(s => ({ walletId: s.account, fixedValue: Number(s.amount.toFixed(2)) }))
          : undefined,
      }),
    });
    const out: ChargeResult = { paymentId: payment.id, checkoutUrl: payment.invoiceUrl };
    if (input.method === 'pix') {
      const qr = await api(`/payments/${payment.id}/pixQrCode`);
      out.pix = { qrImage: qr.encodedImage, payload: qr.payload, expiresAt: qr.expirationDate };
    }
    return out;
  },

  async cancelCharge(paymentId: string) {
    try {
      await api(`/payments/${paymentId}`, { method: 'DELETE' });
      return true;
    } catch (e) {
      // Já removida no Asaas: considera cancelada. Outros erros (ex.: já foi paga) ficam para a próxima rodada.
      if (e instanceof HttpError && /não encontrad|not found/i.test(e.message)) return true;
      console.error('cancelCharge', paymentId, e);
      return false;
    }
  },

  async parseWebhook(req: Request): Promise<WebhookOutcome> {
    const expected = env('ASAAS_WEBHOOK_TOKEN');
    if (!expected || req.headers.get('asaas-access-token') !== expected) {
      throw new HttpError(401, 'Aviso de pagamento com código inválido.');
    }
    const body = await req.json().catch(() => null);
    const id = body?.payment?.id as string | undefined;
    if (!id) return { kind: 'ignore' };
    switch (body.event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        return { kind: 'paid', paymentId: id };
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_DELETED':
        return { kind: 'failed', paymentId: id, reason: 'canceled' };
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
        return { kind: 'failed', paymentId: id, reason: 'refunded' };
      default:
        return { kind: 'ignore' };
    }
  },
};
