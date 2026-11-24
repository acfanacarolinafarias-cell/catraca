import { PaymentProvider } from './types.ts';
import { asaas } from './asaas.ts';

// Registro dos meios de pagamento disponíveis. Para adicionar outro,
// importe o arquivo dele aqui e inclua na lista.
const providers: Record<string, PaymentProvider> = { asaas };

export function getProvider(name: string): PaymentProvider {
  const p = providers[name];
  if (!p) throw new Error(`Meio de pagamento desconhecido: ${name}`);
  return p;
}
