// Notificações por e-mail do Catraca:
//  - comprador: confirmação do pedido (com os ingressos) e aviso de devolução;
//  - organizador: resumo diário das vendas do dia anterior.
// Cada e-mail é "reservado" no banco antes de sair (colunas *_email_at / tabela organizer_digests),
// para não ser enviado duas vezes mesmo se a função rodar em paralelo.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { sendMail, SITE_URL } from './mail.ts';

const TZ = 'America/Sao_Paulo';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Moldura simples, com as cores do Catraca
const frame = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#121A33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FB;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBFBFD;border:1px solid #D4D9E6;border-radius:16px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #D4D9E6"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#3346F0;vertical-align:middle"></span>
<b style="font-size:18px;vertical-align:middle;margin-left:8px">Catraca</b></td></tr>
<tr><td style="padding:24px 28px"><h1 style="font-size:20px;margin:0 0 16px">${title}</h1>${body}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #D4D9E6;font-size:12px;color:#59627E">Dúvidas? Responda este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
const button = (href: string, label: string) => `<p style="margin:24px 0"><a href="${href}" style="background:#3346F0;color:#FBFBFD;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block">${label}</a></p>`;

async function buyerEmail(db: SupabaseClient, o: { buyer_email: string; buyer_id: string }) {
  if (o.buyer_email && o.buyer_email.includes('@')) return o.buyer_email;
  const { data } = await db.auth.admin.getUserById(o.buyer_id);
  return data?.user?.email ?? '';
}

async function loadOrder(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('orders')
    .select('id, code, status, buyer_id, buyer_name, buyer_email, total, installments, payment_method, events(name, starts_at, venue, city), tickets(code, type_name, kind)')
    .eq('id', id).single();
  if (error) throw error;
  return data as any;
}

function confirmationMail(o: any) {
  const ev = o.events || {};
  const link = `${SITE_URL}#/pedido/${o.id}`;
  const tks = (o.tickets || []).sort((a: any, b: any) => String(a.code).localeCompare(b.code, 'pt-BR', { numeric: true }));
  const list = tks.map((t: any) => `<tr><td style="padding:6px 0;font-family:monospace">${esc(t.code)}</td><td style="padding:6px 0">${esc(t.type_name)}${t.kind === 'meia' ? ' · meia-entrada' : ''}</td></tr>`).join('');
  const parc = o.payment_method === 'card' && o.installments > 1 ? ` (em ${o.installments}× no cartão)` : '';
  const html = frame(`Seus ingressos para ${esc(ev.name)}`, `
    <p style="margin:0 0 12px">Olá, ${esc(o.buyer_name)}! Seu pedido <b>${esc(o.code)}</b> está confirmado.</p>
    <p style="margin:0 0 4px"><b>${esc(ev.name)}</b></p>
    <p style="margin:0 0 4px">${esc(when(ev.starts_at))}</p>
    <p style="margin:0 0 16px">${esc(ev.venue)}${ev.city ? ' · ' + esc(ev.city) : ''}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #D4D9E6;border-bottom:1px solid #D4D9E6;margin:0 0 12px">${list}</table>
    <p style="margin:0">${Number(o.total) > 0 ? `Total pago: <b>${money(o.total)}</b>${esc(parc)}` : '<b>Evento gratuito</b> · sem nenhuma cobrança'}</p>
    ${button(link, 'Ver meus ingressos com QR Code')}
    <p style="margin:0 0 8px;font-size:14px;color:#454E6B">Na entrada, mostre o QR Code de cada ingresso. Cada código vale uma entrada. Quem comprou meia-entrada precisa levar o documento que comprova o direito.</p>
    ${Number(o.total) > 0 ? '' : '<p style="margin:0;font-size:13px;color:#59627E">Não vai poder ir? Avise a organização para liberar a vaga para outra pessoa.</p>'}
    <p style="margin:0;font-size:13px;color:#59627E;${Number(o.total) > 0 ? '' : 'display:none'}">Cancelamento: devolução integral em até 7 dias da compra; depois, desconta as taxas. Pedidos até 48 horas antes do evento. <a href="${SITE_URL}#/ajuda" style="color:#3346F0">Saiba mais</a>.</p>`);
  const text = `Olá, ${o.buyer_name}! Seu pedido ${o.code} está confirmado.

${ev.name}
${when(ev.starts_at)}
${ev.venue}${ev.city ? ' · ' + ev.city : ''}

Ingressos:
${tks.map((t: any) => `- ${t.code}: ${t.type_name}${t.kind === 'meia' ? ' (meia-entrada)' : ''}`).join('\n')}

${Number(o.total) > 0 ? `Total pago: ${money(o.total)}${parc}` : 'Evento gratuito, sem nenhuma cobrança.'}

Ver meus ingressos com QR Code: ${link}

Na entrada, mostre o QR Code de cada ingresso. ${Number(o.total) > 0 ? 'Cancelamento: devolução integral em até 7 dias da compra; depois, desconta as taxas. Pedidos até 48 horas antes do evento.' : 'Não vai poder ir? Avise a organização para liberar a vaga.'} Mais em ${SITE_URL}#/ajuda`;
  return { subject: `${Number(o.total) > 0 ? 'Seus ingressos' : 'Inscrição confirmada'} para ${ev.name} · pedido ${o.code}`, html, text };
}

function refundMail(o: any) {
  const ev = o.events || {};
  const html = frame('Pagamento devolvido', `
    <p style="margin:0 0 12px">Olá, ${esc(o.buyer_name)}. O pagamento do pedido <b>${esc(o.code)}</b> para <b>${esc(ev.name)}</b> foi devolvido, e os ingressos desse pedido foram cancelados.</p>
    <p style="margin:0;font-size:14px;color:#454E6B">O dinheiro volta pelo mesmo meio de pagamento. No cartão, o prazo para aparecer na fatura depende do banco emissor.</p>`);
  const text = `Olá, ${o.buyer_name}. O pagamento do pedido ${o.code} para ${ev.name} foi devolvido, e os ingressos desse pedido foram cancelados. O dinheiro volta pelo mesmo meio de pagamento; no cartão, o prazo depende do banco emissor.`;
  return { subject: `Devolução do pedido ${o.code} · ${ev.name}`, html, text };
}

/** Envia (uma vez só) o e-mail devido a este pedido: confirmação ou devolução. */
export async function notifyOrder(db: SupabaseClient, orderId: string): Promise<string> {
  const { data: st } = await db.from('orders').select('status').eq('id', orderId).single();
  const col = st?.status === 'confirmed' ? 'confirmation_email_at' : st?.status === 'refunded' ? 'refund_email_at' : null;
  if (!col) return 'nada a enviar';
  // Reserva o envio: só um processo consegue marcar a coluna
  const { data: claimed } = await db.from('orders').update({ [col]: new Date().toISOString() })
    .eq('id', orderId).is(col, null).select('id');
  if (!claimed?.length) return 'já enviado';
  try {
    const o = await loadOrder(db, orderId);
    const to = await buyerEmail(db, o);
    const m = col === 'confirmation_email_at' ? confirmationMail(o) : refundMail(o);
    if (await sendMail({ to, ...m })) return 'enviado';
  } catch (e) { console.error('notifyOrder', orderId, e); }
  await db.from('orders').update({ [col]: null }).eq('id', orderId);   // libera para tentar de novo
  return 'falhou';
}

/** Procura pedidos com e-mail pendente (rede de segurança para todos os caminhos de confirmação). */
export async function sweepOrders(db: SupabaseClient, limit = 30) {
  const out: Record<string, number> = {};
  for (const [status, col] of [['confirmed', 'confirmation_email_at'], ['refunded', 'refund_email_at']] as const) {
    const { data } = await db.from('orders').select('id').eq('status', status).is(col, null).order('created_at').limit(limit);
    for (const r of data ?? []) { const res = await notifyOrder(db, r.id); out[res] = (out[res] ?? 0) + 1; }
  }
  return out;
}

/** Resumo do dia anterior (horário de Brasília) para cada organizador que vendeu. */
export async function sendDailyDigests(db: SupabaseClient, now = new Date()) {
  // "Hoje" em Brasília (UTC-3, sem horário de verão)
  const br = new Date(now.getTime() - 3 * 3600e3);
  const today = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()));
  const day = new Date(today.getTime() - 864e5);                       // ontem, 00:00 em Brasília (como data UTC)
  const from = new Date(day.getTime() + 3 * 3600e3), to = new Date(today.getTime() + 3 * 3600e3);
  const dayStr = day.toISOString().slice(0, 10);
  const dayLabel = `${dayStr.slice(8, 10)}/${dayStr.slice(5, 7)}`;

  const { data: rows, error } = await db.rpc('digest_rows', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw error;
  const byOrg = new Map<string, any[]>();
  for (const r of rows ?? []) { const a = byOrg.get(r.organizer_id) ?? []; a.push(r); byOrg.set(r.organizer_id, a); }

  const out = { dia: dayStr, organizadores: byOrg.size, enviados: 0, ja_enviados: 0, falhas: 0 };
  for (const [orgId, evs] of byOrg) {
    const { data: claimed } = await db.from('organizer_digests').upsert({ organizer_id: orgId, day: dayStr }, { onConflict: 'organizer_id,day', ignoreDuplicates: true }).select('organizer_id');
    if (!claimed?.length) { out.ja_enviados++; continue; }
    const tot = evs.reduce((a, r) => ({ o: a.o + r.orders, t: a.t + r.tickets, s: a.s + Number(r.sales), p: a.p + Number(r.organizer_amount) }), { o: 0, t: 0, s: 0, p: 0 });
    // Só eventos gratuitos no dia: fala em inscrições e não mostra valores
    if (tot.s === 0 && tot.p === 0) {
      const ins = (n: number) => `${n} inscriç${n === 1 ? 'ão' : 'ões'}`;
      const rowsFree = evs.map(r => `<tr><td style="padding:8px 6px;border-top:1px solid #D4D9E6">${esc(r.event_name)}</td><td align="right" style="padding:8px 6px;border-top:1px solid #D4D9E6">${r.tickets}</td></tr>`).join('');
      const htmlFree = frame(`Inscrições de ${dayLabel}`, `
        <p style="margin:0 0 16px">Olá, ${esc(evs[0].organizer_name)}! Ontem (${dayLabel}) seus eventos receberam <b>${ins(tot.t)}</b>.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
          <tr style="color:#59627E"><td style="padding:6px">Evento</td><td align="right" style="padding:6px">Inscrições</td></tr>
          ${rowsFree}
        </table>
        ${button(`${SITE_URL}#/painel`, 'Ver a lista de inscritos')}`);
      const textFree = `Olá, ${evs[0].organizer_name}! Inscrições de ${dayLabel}:\n\n${evs.map(r => `- ${r.event_name}: ${ins(r.tickets)}`).join('\n')}\n\nTotal: ${ins(tot.t)}.\n\nPainel: ${SITE_URL}#/painel`;
      if (await sendMail({ to: evs[0].organizer_email, subject: `Inscrições de ${dayLabel} · ${ins(tot.t)} · Catraca`, html: htmlFree, text: textFree })) out.enviados++;
      else { out.falhas++; await db.from('organizer_digests').delete().eq('organizer_id', orgId).eq('day', dayStr); }
      continue;
    }
    const rowsHtml = evs.map(r => `<tr><td style="padding:8px 6px;border-top:1px solid #D4D9E6">${esc(r.event_name)}</td><td align="right" style="padding:8px 6px;border-top:1px solid #D4D9E6">${r.orders}</td><td align="right" style="padding:8px 6px;border-top:1px solid #D4D9E6">${r.tickets}</td><td align="right" style="padding:8px 6px;border-top:1px solid #D4D9E6">${money(Number(r.sales))}</td><td align="right" style="padding:8px 6px;border-top:1px solid #D4D9E6">${money(Number(r.organizer_amount))}</td></tr>`).join('');
    const html = frame(`Vendas de ${dayLabel}`, `
      <p style="margin:0 0 16px">Olá, ${esc(evs[0].organizer_name)}! Ontem (${dayLabel}) você vendeu <b>${tot.t} ingresso${tot.t === 1 ? '' : 's'}</b> em ${tot.o} pedido${tot.o === 1 ? '' : 's'}.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
        <tr style="color:#59627E"><td style="padding:6px">Evento</td><td align="right" style="padding:6px">Pedidos</td><td align="right" style="padding:6px">Ingressos</td><td align="right" style="padding:6px">Vendas</td><td align="right" style="padding:6px">Sua parte</td></tr>
        ${rowsHtml}
        <tr><td style="padding:8px 6px;border-top:2px solid #121A33"><b>Total</b></td><td align="right" style="padding:8px 6px;border-top:2px solid #121A33"><b>${tot.o}</b></td><td align="right" style="padding:8px 6px;border-top:2px solid #121A33"><b>${tot.t}</b></td><td align="right" style="padding:8px 6px;border-top:2px solid #121A33"><b>${money(tot.s)}</b></td><td align="right" style="padding:8px 6px;border-top:2px solid #121A33"><b>${money(tot.p)}</b></td></tr>
      </table>
      <p style="margin:12px 0 0;font-size:13px;color:#59627E">Vendas = valor dos ingressos com descontos de cupom. Sua parte = o que vai para a sua conta, já sem a comissão.</p>
      ${button(`${SITE_URL}#/painel`, 'Abrir o painel')}`);
    const text = `Olá, ${evs[0].organizer_name}! Vendas de ${dayLabel}:\n\n${evs.map(r => `- ${r.event_name}: ${r.orders} pedido(s), ${r.tickets} ingresso(s), vendas ${money(Number(r.sales))}, sua parte ${money(Number(r.organizer_amount))}`).join('\n')}\n\nTotal: ${tot.t} ingresso(s), vendas ${money(tot.s)}, sua parte ${money(tot.p)}.\n\nPainel: ${SITE_URL}#/painel`;
    const ok = await sendMail({ to: evs[0].organizer_email, subject: `Vendas de ${dayLabel} · ${tot.t} ingresso${tot.t === 1 ? '' : 's'} · Catraca`, html, text });
    if (ok) out.enviados++;
    else { out.falhas++; await db.from('organizer_digests').delete().eq('organizer_id', orgId).eq('day', dayStr); }
  }
  return out;
}
