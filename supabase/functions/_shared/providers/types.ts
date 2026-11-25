// Contrato comum a todos os meios de pagamento.
// Para trocar o Asaas por outro (Mercado Pago, Pagar.me...), crie um arquivo
// nesta pasta que implemente PaymentProvider e registre-o em index.ts.

export type Method = 'pix' | 'card';

export interface ChargeInput {
  orderId: string;
  orderCode: string;
  method: Method;
  total: number;            // valor total pago pelo comprador (R$)
  description: string;
  buyer: { userId: string; name: string; email: string; document: string };
  split: { account: string; amount: number }[]; // repasses automáticos (ex.: organizador)
}

export interface ChargeResult {
  paymentId: string;
  pix?: { qrImage: string; payload: string; expiresAt?: string };
  checkoutUrl?: string;     // página segura do meio de pagamento (cartão)
}

export type WebhookOutcome =
  | { kind: 'paid'; paymentId: string }
  | { kind: 'failed'; paymentId: string; reason: 'canceled' | 'refunded' }
  | { kind: 'ignore' };

export interface PaymentProvider {
  name: string;
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  /** Cancela uma cobrança ainda não paga. Devolve true se cancelou (ou se ela já não existia). */
  cancelCharge(paymentId: string): Promise<boolean>;
  /** Valida a origem do aviso e o traduz. Lança HttpError(401) se a origem for inválida. */
  parseWebhook(req: Request): Promise<WebhookOutcome>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
