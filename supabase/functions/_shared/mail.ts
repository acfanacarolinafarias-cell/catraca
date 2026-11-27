// Envio de e-mails pelo Resend (https://resend.com/docs/api-reference/emails/send-email).
// Segredos: RESEND_API_KEY (obrigatório para enviar) e MAIL_FROM (opcional).
const FROM = Deno.env.get('MAIL_FROM') || 'Catraca <catraca@aefetech.com.br>';
export const SITE_URL = (Deno.env.get('SITE_URL') || 'https://acfanacarolinafarias-cell.github.io/catraca/').replace(/\/?$/, '/');

export type Mail = { to: string; subject: string; html: string; text: string };

/** Envia um e-mail. Devolve true se o Resend aceitou; false (sem lançar erro) se faltou chave ou o envio falhou. */
export async function sendMail(m: Mail): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { console.warn('sendMail: RESEND_API_KEY não configurada; e-mail não enviado.'); return false; }
  if (!m.to || !m.to.includes('@')) { console.warn('sendMail: destinatário inválido'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    });
    if (!r.ok) { console.error('sendMail', r.status, (await r.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error('sendMail', e);
    return false;
  }
}
