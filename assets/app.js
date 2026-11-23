import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } }) : null;
const BASE_URL = location.origin + location.pathname;

/* ================= utilidades ================= */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = n => BRL.format(Number(n) || 0);
const num = n => new Intl.NumberFormat('pt-BR').format(Number(n) || 0);
const pad = n => String(n).padStart(2, '0');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = v => { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const fmtLong = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const fmtShort = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const fmtDate = s => s ? new Date(s + 'T12:00').toLocaleDateString('pt-BR') : '—';
const isPast = ev => new Date(ev.starts_at).getTime() < Date.now() - 6 * 3600e3;
const digits = s => String(s || '').replace(/\D/g, '');
const sortTypes = ts => [...(ts || [])].sort((a, b) => (a.sort - b.sort) || String(a.name).localeCompare(b.name));
const half = p => Math.round(Number(p) * 50) / 100;

function validCPF(v) {
  const c = digits(v); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i); if (((s * 10) % 11) % 10 !== Number(c[t])) return false; }
  return true;
}
function validCNPJ(v) {
  const c = digits(v); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = n => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
function fmtDoc(type, v) {
  const c = digits(v);
  if (type === 'PF' && c.length === 11) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (type === 'PJ' && c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return c;
}
const orgName = o => o ? (o.trade_name || o.legal_name) : '';

/* ---------- QR Code ---------- */
const loadScript = (src, name) => window[name] ? Promise.resolve(window[name]) : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src;
  s.onload = () => res(window[name]); s.onerror = () => rej(new Error('Não foi possível carregar o leitor de QR Code. Verifique a conexão.'));
  document.head.append(s);
});
const CODE_RE = /[A-HJ-NP-Z2-9]{6}-\d{1,3}/;
const normCode = raw => { const s = String(raw || '').toUpperCase().replace(/\s+/g, ''); const m = s.match(CODE_RE); return m ? m[0] : s; };
function qrSvg(qrcode, text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
async function drawQRs() {
  const els = $app.querySelectorAll('[data-qr]'); if (!els.length) return;
  try { const qrcode = await loadScript('assets/vendor/qrcode.js', 'qrcode'); els.forEach(el => { el.innerHTML = qrSvg(qrcode, el.dataset.qr); }); }
  catch (_) { els.forEach(el => { el.hidden = true; }); }
}
// Toque no QR: abre ampliado (ajuda na leitura na porta)
document.addEventListener('click', async e => {
  const z = e.target.closest('[data-zoom]');
  if (z) {
    const qrcode = await loadScript('assets/vendor/qrcode.js', 'qrcode').catch(() => null); if (!qrcode) return;
    const ov = document.createElement('div'); ov.className = 'qr-zoom'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'QR Code ampliado');
    ov.innerHTML = `<div class="qr-zoom-card"><div class="qr-big">${qrSvg(qrcode, z.dataset.zoom)}</div><div class="code">${esc(z.dataset.zoom)}</div><p class="note">Toque em qualquer lugar para fechar</p></div>`;
    ov.addEventListener('click', () => ov.remove()); document.body.append(ov);
  }
});
let audioCtx = null;
function beep(ok) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = ok ? 'sine' : 'square'; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + (ok ? 0.15 : 0.45));
  } catch (_) {}
}

function toast(msg, kind = 'ok') {
  const box = document.getElementById('toast');
  const el = document.createElement('div'); el.className = 't ' + kind; el.textContent = msg;
  box.append(el); setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || '';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/User already registered/i.test(m)) return 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci a senha".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
  if (/JWT|session.*(expired|missing)/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
  if (/organizers_email_key/.test(m)) return 'Já existe um organizador com este e-mail.';
  if (/organizers_document_key/.test(m)) return 'Já existe um organizador com este CPF/CNPJ.';
  if (/organizers_document_len/.test(m)) return 'CPF precisa de 11 dígitos e CNPJ de 14.';
  if (/sold_le_capacity/.test(m)) return 'A quantidade não pode ficar abaixo do que já foi vendido.';
  if (/violates foreign key constraint/i.test(m)) return 'Não é possível excluir: já existem ingressos emitidos.';
  if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para esta ação.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique sua internet.';
  return m || 'Algo deu errado. Tente de novo.';
}
const must = ({ data, error }) => { if (error) throw error; return data; };

/* ================= sessão ================= */
const me = { user: null, profile: null, organizers: [], staff: [] };
const isAdmin = () => me.profile?.role === 'admin';
const isOrganizer = () => me.organizers.length > 0;
const isStaff = () => me.staff.length > 0;
const staffEventIds = () => [...new Set(me.staff.flatMap(s => (s.staff_events || []).map(x => x.event_id)))];
const managesEvent = ev => isAdmin() || me.organizers.some(o => o.id === ev.organizer_id);

async function loadMe(session) {
  me.user = session?.user || null; me.profile = null; me.organizers = []; me.staff = [];
  if (!me.user) return;
  const [p, o, s] = await Promise.all([
    sb.from('profiles').select('*').eq('id', me.user.id).maybeSingle(),
    sb.from('organizers').select('*').eq('user_id', me.user.id),
    sb.from('staff').select('id,organizer_id,name,staff_events(event_id)').eq('user_id', me.user.id)
  ]);
  me.profile = p.data || null; me.organizers = o.data || []; me.staff = s.data || [];
}
function homeFor() { return isAdmin() ? '#/admin' : isOrganizer() ? '#/painel' : isStaff() ? '#/portaria' : '#/'; }

/* ================= roteamento ================= */
let actions = {}, forms = {}, teardown = null;
function mount(html, a = {}, f = {}) { $app.innerHTML = html; actions = a; forms = f; }
const loading = () => mount('<p class="note">Carregando…</p>');
const go = h => { if (location.hash === h) route(); else location.hash = h; };

$app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const fn = actions[b.dataset.act]; if (fn) { e.preventDefault(); fn(b, e); }
});
$app.addEventListener('change', e => { const fn = actions['change:' + (e.target.dataset.change || '')]; if (fn) fn(e.target, e); });
$app.addEventListener('input', e => { const fn = actions['input:' + (e.target.dataset.input || '')]; if (fn) fn(e.target, e); });
$app.addEventListener('submit', async e => {
  const f = e.target, fn = forms[f.dataset.form]; if (!fn) return;
  e.preventDefault();
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try { await fn(new FormData(f), f); }
  catch (err) { toast(errMsg(err), 'bad'); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
});

function requireLogin() {
  if (me.user) return true;
  try { sessionStorage.setItem('next', location.hash); } catch (_) {}
  go('#/entrar'); return false;
}

function renderNav() {
  const h = location.hash || '#/';
  const links = [['#/', 'Eventos']];
  if (me.user) links.push(['#/meus-ingressos', 'Meus ingressos']);
  if (isOrganizer()) links.push(['#/painel', 'Meus eventos']);
  if (isStaff()) links.push(['#/portaria', 'Portaria']);
  if (isAdmin()) links.push(['#/admin', 'Administração']);
  const active = l => l === '#/' ? (h === '#/' || h === '#' || h.startsWith('#/evento')) : h.startsWith(l);
  $nav.innerHTML = links.map(([l, t]) => `<a class="tab" href="${l}" ${active(l) ? 'aria-current="page"' : ''}>${t}</a>`).join('') +
    (me.user ? `<span class="who" title="${esc(me.user.email)}">${esc(me.profile?.full_name || me.user.email)}</span><button class="tab" id="logout">Sair</button>`
             : `<a class="tab" href="#/entrar" ${h.startsWith('#/entrar') ? 'aria-current="page"' : ''}>Entrar</a>`);
}
$nav.addEventListener('click', async e => {
  if (e.target.id !== 'logout') return;
  await sb.auth.signOut(); toast('Você saiu da sua conta.'); go('#/');
});

async function route() {
  if (teardown) { try { teardown(); } catch (_) {} teardown = null; }
  renderNav();
  if (!configured) return vSetup();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  window.scrollTo(0, 0);
  try {
    switch (a) {
      case undefined: return await vHome();
      case 'evento': return await vEvent(b);
      case 'pedido': return requireLogin() && await vOrder(b);
      case 'entrar': return me.user ? go(homeFor()) : vLogin(b || 'entrar');
      case 'nova-senha': return vNewPassword();
      case 'meus-ingressos': return requireLogin() && await vMyTickets();
      case 'painel':
        if (!requireLogin()) return;
        if (b === 'evento') return await vManage(c, d || 'info');
        if (b === 'dados') return await vOrgData();
        if (b === 'equipe') return await vTeam(c);
        return await vPanel();
      case 'portaria':
        if (!requireLogin()) return;
        return b ? await vDoor(b) : await vDoorList();
      case 'admin':
        if (!requireLogin()) return;
        if (!isAdmin()) return vMessage('Acesso restrito', 'Esta área é só da administração.');
        if (b === 'organizador') return await vAdminOrganizer(c);
        return await vAdmin(b || 'eventos');
      default: return vMessage('Página não encontrada', 'O endereço não existe ou mudou.');
    }
  } catch (err) {
    mount(`<div class="msg bad">${esc(errMsg(err))}</div><div><a class="btn" href="#/">Voltar ao início</a></div>`);
  }
}

function vMessage(title, text) {
  mount(`<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><a class="btn" href="#/">Voltar ao início</a></div>`);
}

function vSetup() {
  mount(`<div class="panel medium"><h2>Falta conectar o banco de dados</h2>
    <p>Este site usa o Supabase para login e dados. Para ativar:</p>
    <ol>
      <li>Crie um projeto em <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
      <li>No <b>SQL Editor</b>, rode o arquivo <code>supabase/schema.sql</code> deste repositório.</li>
      <li>Em <b>Project Settings → API</b>, copie a URL e a chave <i>anon</i> para <code>assets/config.js</code>.</li>
    </ol>
    <p class="note">O passo a passo completo está no README do repositório.</p></div>`);
}

/* ================= vitrine ================= */
const EV_PUBLIC = 'id,name,starts_at,venue,city,description,fee_pct,published,ticket_types(id,name,price,capacity,allows_half,sort,sold)';

function evStats(ev) {
  const ts = ev.ticket_types || [];
  const cap = ts.reduce((a, t) => a + t.capacity, 0), sold = ts.reduce((a, t) => a + t.sold, 0);
  const prices = ts.map(t => t.allows_half ? half(t.price) : Number(t.price));
  return { cap, sold, left: Math.max(0, cap - sold), pct: cap ? Math.min(100, Math.round(sold / cap * 100)) : 0, min: prices.length ? Math.min(...prices) : 0 };
}

function ticketCard(ev, href) {
  const d = new Date(ev.starts_at), s = evStats(ev);
  const chips = [];
  if (!ev.published) chips.push('<span class="chip">Rascunho</span>');
  if (isPast(ev)) chips.push('<span class="chip">Encerrado</span>');
  else if (s.cap && s.left === 0) chips.push('<span class="chip bad">Esgotado</span>');
  else if (s.pct >= 80) chips.push('<span class="chip bad">Últimos ingressos</span>');
  if ((ev.ticket_types || []).some(t => t.allows_half)) chips.push('<span class="chip">Meia-entrada</span>');
  return `<a class="ticket" href="${href}">
    <div class="stub">
      <span class="dow">${esc(d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''))}</span>
      <span class="day">${pad(d.getDate())}</span>
      <span class="mon">${esc(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''))}</span>
      <span class="hr">${esc(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</span>
    </div>
    <div class="tbody">
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
      <h3>${esc(ev.name)}</h3>
      <div class="meta">${esc(ev.venue)}${ev.city ? ' · ' + esc(ev.city) : ''}</div>
      <div class="tfoot">
        <div class="from">a partir de<strong>${money(s.min)}</strong></div>
        <div style="display:grid;gap:4px;flex:1;max-width:180px">
          <div class="bar ${s.pct >= 80 ? 'hot' : ''}"><i style="width:${s.pct}%"></i></div>
          <div class="cap">${num(s.left)} de ${num(s.cap)} disponíveis</div>
        </div>
      </div>
    </div>
  </a>`;
}

async function vHome() {
  loading();
  const evs = must(await sb.from('events').select(EV_PUBLIC).eq('published', true).gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('starts_at'));
  mount(`<div class="page-head"><div><div class="eyebrow">Programação</div><h1>Próximos eventos</h1>
      <p>Escolha o evento, os lotes e a quantidade. Seus ingressos ficam guardados em “Meus ingressos”.</p></div></div>
    ${evs.length ? `<div class="grid">${evs.map(ev => ticketCard(ev, '#/evento/' + ev.id)).join('')}</div>`
      : `<div class="empty"><h2>Nenhum evento à venda agora</h2><p>Volte em breve para ver a programação.</p></div>`}`);
}

/* ================= evento + compra ================= */
async function vEvent(id) {
  loading();
  const ev = must(await sb.from('events').select(EV_PUBLIC).eq('id', id).maybeSingle());
  if (!ev) return vMessage('Evento não encontrado', 'Ele pode ter sido removido ou ainda não foi publicado.');
  const types = sortTypes(ev.ticket_types);
  const cart = {};
  const past = isPast(ev);
  const inCart = tid => (cart[tid + '|inteira'] || 0) + (cart[tid + '|meia'] || 0);
  const lines = () => {
    const out = [];
    for (const t of types) for (const kind of ['inteira', 'meia']) {
      const q = cart[t.id + '|' + kind] || 0;
      if (q) out.push({ t, kind, qty: q, unit: kind === 'meia' ? half(t.price) : Number(t.price) });
    }
    const subtotal = out.reduce((a, l) => a + l.unit * l.qty, 0);
    const fee = Math.round(subtotal * Number(ev.fee_pct)) / 100;
    return { out, subtotal, fee, total: subtotal + fee, count: out.reduce((a, l) => a + l.qty, 0) };
  };

  const drawLots = () => {
    document.getElementById('lots').innerHTML = types.length ? types.map(t => {
      const left = Math.max(0, t.capacity - t.sold);
      return [['inteira', Number(t.price)], ...(t.allows_half ? [['meia', half(t.price)]] : [])].map(([kind, price]) => {
        const k = t.id + '|' + kind, q = cart[k] || 0;
        const full = inCart(t.id) >= Math.min(left, 10);
        return `<div class="lot"><div><div class="name">${esc(t.name)}${kind === 'meia' ? ' · Meia-entrada' : ''}</div>
          <div class="price">${money(price)}${left === 0 ? ' · <span style="color:var(--bad)">esgotado</span>' : left <= 20 ? ` · restam ${num(left)}` : ''}</div></div>
          ${past ? '' : `<div class="stepper"><button data-act="dec" data-k="${esc(k)}" ${q ? '' : 'disabled'} aria-label="Remover um">−</button><span>${q}</span><button data-act="inc" data-k="${esc(k)}" ${full ? 'disabled' : ''} aria-label="Adicionar um">+</button></div>`}</div>`;
      }).join('');
    }).join('') : '<p class="note">Os lotes ainda não foram cadastrados.</p>';
  };
  const drawSummary = () => {
    const c = lines();
    document.getElementById('summary').innerHTML = c.count
      ? `<div class="sum">${c.out.map(l => `<div><span>${l.qty}× ${esc(l.t.name)}${l.kind === 'meia' ? ' (meia)' : ''}</span><span>${money(l.unit * l.qty)}</span></div>`).join('')}
        <div class="note"><span>Taxa de serviço (${num(ev.fee_pct)}%)</span><span>${money(c.fee)}</span></div>
        <div class="total"><span>Total</span><span>${money(c.total)}</span></div></div>`
      : '<p class="note">Adicione ingressos para ver o total.</p>';
    const btn = document.getElementById('buy-btn');
    if (btn) { btn.disabled = !c.count; btn.textContent = c.count ? `Confirmar ${c.count} ingresso${c.count > 1 ? 's' : ''}` : 'Confirmar pedido'; }
  };

  const hasHalf = types.some(t => t.allows_half);
  mount(`<div><a class="linkbtn" href="#/">← Todos os eventos</a></div>
  <div class="detail">
    <div class="panel">
      <div class="hero-ev">
        <div class="chips">${!ev.published ? '<span class="chip">Rascunho · só você vê</span>' : ''}${past ? '<span class="chip">Encerrado</span>' : ''}</div>
        <h1>${esc(ev.name)}</h1>
        <div class="facts"><span><b>Quando</b> ${esc(fmtLong(ev.starts_at))}</span><span><b>Onde</b> ${esc(ev.venue)}${ev.city ? ', ' + esc(ev.city) : ''}</span></div>
        ${ev.description ? `<p>${esc(ev.description)}</p>` : ''}
      </div>
      <div><h2>Ingressos</h2><div id="lots"></div></div>
      ${hasHalf ? '<p class="note">Meia-entrada (Lei 12.933/2013): estudantes, pessoas com deficiência e acompanhante, jovens de baixa renda e pessoas idosas. Apresente o documento na entrada.</p>' : ''}
    </div>
    <div class="panel sticky">
      <h2>Seu pedido</h2>
      <div id="summary"></div>
      ${past ? '<div class="msg info">As vendas deste evento foram encerradas.</div>'
        : me.user ? `<form data-form="buy" class="panel" style="padding:0;border:0">
          <div class="field"><label for="buyer-name">Nome no ingresso</label><input id="buyer-name" name="name" required autocomplete="name" value="${esc(me.profile?.full_name || '')}"></div>
          <div class="field"><label for="buyer-email">E-mail para contato</label><input id="buyer-email" name="email" type="email" autocomplete="email" value="${esc(me.user.email)}"></div>
          <button class="btn primary" id="buy-btn" type="submit" disabled>Confirmar pedido</button>
          <p class="note">A reserva fica registrada e os códigos de entrada são emitidos na hora. O pagamento é combinado com quem organiza o evento.</p>
        </form>`
        : `<div class="msg info">Entre na sua conta ou crie uma para comprar.</div><button class="btn primary" data-act="login">Entrar para comprar</button>`}
    </div>
  </div>`, {
    inc: b => { cart[b.dataset.k] = (cart[b.dataset.k] || 0) + 1; drawLots(); drawSummary(); },
    dec: b => { cart[b.dataset.k] = Math.max(0, (cart[b.dataset.k] || 0) - 1); drawLots(); drawSummary(); },
    login: () => requireLogin()
  }, {
    buy: async fd => {
      const c = lines(); if (!c.count) return;
      const items = c.out.map(l => ({ type_id: l.t.id, kind: l.kind, qty: l.qty }));
      const { data, error } = await sb.rpc('buy_tickets', { p_event: ev.id, p_items: items, p_buyer_name: String(fd.get('name') || '').trim(), p_buyer_email: String(fd.get('email') || '').trim() });
      if (error) { toast(errMsg(error), 'bad'); return vEvent(id); }
      go('#/pedido/' + data);
    }
  });
  drawLots(); drawSummary();
}

function passList(tickets) {
  return `<div class="passes">${[...(tickets || [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map(t => `
    <div class="pass ${t.checked_in_at ? 'used' : ''}">
      <button class="qr" type="button" data-zoom="${esc(t.code)}" aria-label="Ampliar QR Code do ingresso ${esc(t.code)}"><span data-qr="${esc(t.code)}"></span></button>
      <div class="pass-info"><div class="code">${esc(t.code)}</div><div class="note">${esc(t.type_name)}${t.kind === 'meia' ? ' · Meia-entrada (leve documento)' : ''}</div>
      ${t.checked_in_at ? `<span class="chip">Utilizado ${esc(fmtShort(t.checked_in_at))}</span>` : '<span class="chip ok">Válido · toque no QR para ampliar</span>'}</div>
    </div>`).join('')}</div>`;
}

const ORDER_FIELDS = 'id,code,subtotal,fee,total,created_at,buyer_name,events(id,name,starts_at,venue,city),tickets(code,type_name,kind,checked_in_at)';

async function vOrder(id) {
  loading();
  const o = must(await sb.from('orders').select(ORDER_FIELDS).eq('id', id).maybeSingle());
  if (!o) return vMessage('Pedido não encontrado', 'Confira em “Meus ingressos”.');
  mount(`<div class="panel medium" style="width:100%">
    <div class="msg ok">Pedido ${esc(o.code)} confirmado. Mostre os códigos abaixo na entrada.</div>
    <div class="row between"><h2>${esc(o.events?.name)}</h2><span class="note">${esc(fmtLong(o.events?.starts_at))}</span></div>
    <p class="note">Em nome de <b>${esc(o.buyer_name)}</b> · ${esc(o.events?.venue || '')} · Total ${money(o.total)}</p>
    ${passList(o.tickets)}
    <div class="row"><a class="btn" href="#/meus-ingressos">Ver todos os meus ingressos</a><a class="btn" href="#/evento/${esc(o.events?.id)}">Comprar mais</a></div>
  </div>`);
  drawQRs();
}

async function vMyTickets() {
  loading();
  const orders = must(await sb.from('orders').select(ORDER_FIELDS).eq('buyer_id', me.user.id).order('created_at', { ascending: false }));
  const head = `<div class="page-head"><div><div class="eyebrow">Carteira</div><h1>Meus ingressos</h1><p>Cada código vale uma entrada. Depois de validado na porta, o ingresso aparece como utilizado.</p></div></div>`;
  if (!orders.length) return mount(head + `<div class="empty"><h2>Você ainda não tem ingressos</h2><p>Escolha um evento na programação.</p><a class="btn primary" href="#/">Ver eventos</a></div>`);
  mount(head + orders.map(o => `<div class="panel">
    <div class="row between"><h2>${esc(o.events?.name)}</h2><span class="note mono">Pedido ${esc(o.code)}</span></div>
    <p class="note">${esc(fmtLong(o.events?.starts_at))} · ${esc(o.events?.venue || '')} · ${money(o.total)}</p>
    ${passList(o.tickets)}</div>`).join(''));
  drawQRs();
}

/* ================= login ================= */
function vLogin(mode) {
  const tabs = [['entrar', 'Entrar'], ['criar-conta', 'Criar conta'], ['esqueci', 'Esqueci a senha']];
  const body = {
    'entrar': `<form data-form="login" class="panel" style="padding:0;border:0">
        <div class="field"><label for="l-email">E-mail</label><input id="l-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="l-pass">Senha</label><input id="l-pass" name="password" type="password" required autocomplete="current-password"></div>
        <button class="btn primary" type="submit">Entrar</button></form>`,
    'criar-conta': `<form data-form="signup" class="panel" style="padding:0;border:0">
        <div class="field"><label for="s-name">Nome completo</label><input id="s-name" name="name" required autocomplete="name"></div>
        <div class="field"><label for="s-email">E-mail</label><input id="s-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="s-pass">Senha (mínimo 8 caracteres)</label><input id="s-pass" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="btn primary" type="submit">Criar conta</button>
        <p class="note">Organiza eventos com a gente? Use o mesmo e-mail que a administração cadastrou. Depois de confirmar o e-mail, seus eventos aparecem em “Meus eventos”.</p></form>`,
    'esqueci': `<form data-form="reset" class="panel" style="padding:0;border:0">
        <div class="field"><label for="r-email">E-mail da conta</label><input id="r-email" name="email" type="email" required autocomplete="email"></div>
        <button class="btn primary" type="submit">Enviar link para nova senha</button>
        <p class="note">Abra o link no mesmo navegador em que você pediu.</p></form>`
  }[mode] || '';
  mount(`<div class="panel narrow">
    <div><div class="eyebrow">Sua conta</div><h1 style="font-size:1.8rem">Acesse a Catraca</h1>
    <p class="note">A mesma conta serve para comprar ingressos e, se você organiza eventos, para gerenciá-los.</p></div>
    <nav class="subtabs">${tabs.map(([k, t]) => `<a href="#/entrar/${k}" ${k === mode ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div id="auth-msg"></div>
    ${body}
  </div>`, {}, {
    login: async fd => {
      const { error } = await sb.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
      if (error) throw error;
      // onAuthStateChange cuida do redirecionamento
    },
    signup: async fd => {
      const { data, error } = await sb.auth.signUp({ email: fd.get('email'), password: fd.get('password'), options: { data: { full_name: String(fd.get('name')).trim() }, emailRedirectTo: BASE_URL } });
      if (error) throw error;
      if (!data.session) document.getElementById('auth-msg').innerHTML = `<div class="msg ok">Conta criada. Enviamos um link de confirmação para ${esc(fd.get('email'))}. Abra o e-mail e clique no link para entrar.</div>`;
    },
    reset: async fd => {
      const { error } = await sb.auth.resetPasswordForEmail(fd.get('email'), { redirectTo: BASE_URL + '?recovery=1' });
      if (error) throw error;
      document.getElementById('auth-msg').innerHTML = `<div class="msg ok">Se existir uma conta com este e-mail, você vai receber um link para criar uma nova senha.</div>`;
    }
  });
}

function vNewPassword() {
  if (!me.user) return vMessage('Link expirado', 'Peça um novo link em “Esqueci a senha”.');
  mount(`<div class="panel narrow"><h2>Criar nova senha</h2>
    <form data-form="newpass" class="panel" style="padding:0;border:0">
      <div class="field"><label for="n-pass">Nova senha (mínimo 8 caracteres)</label><input id="n-pass" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label for="n-pass2">Repita a nova senha</label><input id="n-pass2" name="password2" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Salvar senha</button></form></div>`, {}, {
    newpass: async fd => {
      if (fd.get('password') !== fd.get('password2')) return toast('As senhas não são iguais.', 'bad');
      const { error } = await sb.auth.updateUser({ password: fd.get('password') });
      if (error) throw error;
      toast('Senha atualizada.'); go(homeFor());
    }
  });
}

/* ================= painel do organizador ================= */
async function vPanel() {
  loading();
  const ids = me.organizers.map(o => o.id);
  if (!ids.length) {
    if (isAdmin()) return go('#/admin');
    return vMessage('Nenhum evento vinculado', 'Quando a administração vincular um evento ao seu e-mail, ele aparece aqui.');
  }
  const evs = must(await sb.from('events').select(EV_PUBLIC + ',organizer_id').in('organizer_id', ids).order('starts_at', { ascending: false }));
  mount(`<div class="page-head"><div><div class="eyebrow">${esc(me.organizers.map(orgName).join(' · '))}</div><h1>Meus eventos</h1>
      <p>Edite as informações, os lotes e acompanhe vendas, despesas e entradas de cada evento.</p></div>
      <div class="row"><a class="btn" href="#/painel/equipe">Equipe de portaria</a><a class="btn" href="#/painel/dados">Dados cadastrais e de recebimento</a></div></div>
    ${evs.length ? `<div class="grid">${evs.map(ev => ticketCard(ev, `#/painel/evento/${ev.id}/info`)).join('')}</div>`
      : '<div class="empty"><h2>Nenhum evento vinculado ainda</h2><p>A administração cria o evento e o vincula a você.</p></div>'}`);
}

async function vOrgData() {
  loading();
  const list = isAdmin() && !isOrganizer() ? [] : must(await sb.from('organizers').select('*').eq('user_id', me.user.id));
  if (!list.length) return vMessage('Sem cadastro de organizador', 'Sua conta não está vinculada a um organizador.');
  mount(`<div><a class="linkbtn" href="#/painel">← Meus eventos</a></div>
  <div class="page-head"><div><div class="eyebrow">Organizador</div><h1>Dados cadastrais e de recebimento</h1>
    <p>Nome, documento e e-mail são alterados pela administração. Contato e dados bancários você mesmo atualiza.</p></div></div>
  ${list.map(o => `<form class="panel medium" data-form="org" data-id="${esc(o.id)}">
    <div class="row between"><h2>${esc(o.legal_name)}</h2><span class="chip">${o.person_type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}</span></div>
    <p class="note">${o.person_type === 'PJ' ? 'CNPJ' : 'CPF'} ${esc(fmtDoc(o.person_type, o.document))} · ${esc(o.email)}</p>
    ${orgEditableFields(o)}
    <div><button class="btn primary" type="submit">Salvar dados</button></div>
  </form>`).join('')}`, {}, {
    org: async (fd, f) => {
      must(await sb.from('organizers').update(orgEditablePayload(fd)).eq('id', f.dataset.id));
      await loadMe((await sb.auth.getSession()).data.session);
      toast('Dados salvos.');
    }
  });
}

function orgEditableFields(o = {}) {
  const pj = o.person_type === 'PJ';
  return `<div class="formgrid">
    <div class="field"><label for="o-trade-${esc(o.id || 'n')}" data-trade-label>${pj ? 'Nome fantasia' : 'Nome artístico / como aparece'}</label><input id="o-trade-${esc(o.id || 'n')}" name="trade_name" value="${esc(o.trade_name || '')}"></div>
    <div class="field"><label for="o-phone-${esc(o.id || 'n')}">Telefone / WhatsApp</label><input id="o-phone-${esc(o.id || 'n')}" name="phone" inputmode="tel" value="${esc(o.phone || '')}"></div>
    <div class="field full"><label for="o-pix-${esc(o.id || 'n')}">Chave PIX para repasse</label><input id="o-pix-${esc(o.id || 'n')}" name="pix_key" value="${esc(o.pix_key || '')}"></div>
    <div class="field"><label for="o-bank-${esc(o.id || 'n')}">Banco</label><input id="o-bank-${esc(o.id || 'n')}" name="bank_name" value="${esc(o.bank_name || '')}"></div>
    <div class="formgrid" style="gap:12px">
      <div class="field"><label for="o-ag-${esc(o.id || 'n')}">Agência</label><input id="o-ag-${esc(o.id || 'n')}" name="bank_agency" inputmode="numeric" value="${esc(o.bank_agency || '')}"></div>
      <div class="field"><label for="o-acc-${esc(o.id || 'n')}">Conta</label><input id="o-acc-${esc(o.id || 'n')}" name="bank_account" value="${esc(o.bank_account || '')}"></div>
    </div>
  </div>`;
}
const orgEditablePayload = fd => Object.fromEntries(['trade_name', 'phone', 'pix_key', 'bank_name', 'bank_agency', 'bank_account'].map(k => [k, String(fd.get(k) || '').trim()]));

/* ================= gestão de um evento (organizador e admin) ================= */
const MANAGE_TABS = [['info', 'Informações'], ['lotes', 'Lotes'], ['financeiro', 'Financeiro'], ['pedidos', 'Pedidos'], ['entrada', 'Entrada']];

async function vManage(id, tab) {
  loading();
  const ev = must(await sb.from('events').select('*, organizers(id,legal_name,trade_name,person_type,document,email,pix_key,bank_name,bank_agency,bank_account), ticket_types(*)').eq('id', id).maybeSingle());
  if (!ev) return vMessage('Evento não encontrado', 'Ele não existe ou não está vinculado à sua conta.');
  if (!managesEvent(ev)) return go(staffEventIds().includes(ev.id) ? '#/portaria/' + ev.id : '#/');
  const admin = isAdmin();
  const back = admin ? '#/admin/eventos' : '#/painel';
  const header = `<div><a class="linkbtn" href="${back}">← ${admin ? 'Administração' : 'Meus eventos'}</a></div>
    <div class="page-head"><div><div class="chips">${ev.published ? '<span class="chip ok">Publicado</span>' : '<span class="chip">Rascunho</span>'}${ev.organizers ? `<span class="chip accent">${esc(orgName(ev.organizers))}</span>` : '<span class="chip bad">Sem organizador</span>'}</div>
      <h1 style="margin-top:8px">${esc(ev.name)}</h1><p>${esc(fmtLong(ev.starts_at))} · ${esc(ev.venue)}${ev.city ? ', ' + esc(ev.city) : ''}</p></div>
      <a class="btn" href="#/evento/${esc(ev.id)}">Ver página pública</a></div>
    <nav class="subtabs">${MANAGE_TABS.map(([k, t]) => `<a href="#/painel/evento/${esc(ev.id)}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  const reload = () => vManage(id, tab);
  if (tab === 'lotes') return mLotes(ev, header, reload);
  if (tab === 'financeiro') return mFinance(ev, header, reload);
  if (tab === 'pedidos') return mOrders(ev, header);
  if (tab === 'entrada') return mCheckin(ev, header);
  return mInfo(ev, header, reload, admin);
}

async function mInfo(ev, header, reload, admin) {
  const orgs = admin ? must(await sb.from('organizers').select('id,legal_name,trade_name,person_type').order('legal_name')) : [];
  let armed = false;
  mount(header + `<form class="panel medium" data-form="info">
    <div class="formgrid">
      <div class="field full"><label for="e-name">Nome do evento</label><input id="e-name" name="name" required value="${esc(ev.name)}"></div>
      <div class="field"><label for="e-date">Data e hora</label><input id="e-date" name="starts_at" type="datetime-local" required value="${esc(toLocalInput(ev.starts_at))}"></div>
      <div class="field"><label for="e-fee">Taxa de serviço cobrada do comprador (%)</label><input id="e-fee" name="fee_pct" type="number" min="0" max="30" step="0.5" value="${esc(ev.fee_pct)}"></div>
      <div class="field"><label for="e-venue">Local</label><input id="e-venue" name="venue" value="${esc(ev.venue)}"></div>
      <div class="field"><label for="e-city">Cidade / UF</label><input id="e-city" name="city" value="${esc(ev.city)}"></div>
      <div class="field full"><label for="e-desc">Descrição</label><textarea id="e-desc" name="description" rows="5">${esc(ev.description)}</textarea></div>
      ${admin ? `
      <div class="field"><label for="e-org">Organizador responsável</label><select id="e-org" name="organizer_id"><option value="">Sem organizador</option>${orgs.map(o => `<option value="${esc(o.id)}" ${o.id === ev.organizer_id ? 'selected' : ''}>${esc(orgName(o))} (${o.person_type})</option>`).join('')}</select></div>
      <div class="field"><label for="e-plat">Comissão da plataforma sobre as vendas (%)</label><input id="e-plat" name="platform_pct" type="number" min="0" max="100" step="0.5" value="${esc(ev.platform_pct)}"></div>`
      : `<p class="note full">Comissão da plataforma: ${num(ev.platform_pct)}% sobre as vendas (definida pela administração).</p>`}
      <label class="check full"><input type="checkbox" name="published" ${ev.published ? 'checked' : ''}> Publicado: aparece na vitrine e aceita compras</label>
    </div>
    <div class="row between"><button class="btn primary" type="submit">Salvar informações</button>
      ${admin ? '<button class="btn danger" type="button" data-act="del">Excluir evento</button>' : ''}</div>
  </form>`, {
    del: async b => {
      if (!armed) { armed = true; b.classList.add('armed'); b.textContent = 'Clique de novo para excluir'; return; }
      const { error } = await sb.from('events').delete().eq('id', ev.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('Evento excluído.'); go('#/admin/eventos');
    }
  }, {
    info: async fd => {
      const starts = fromLocalInput(fd.get('starts_at'));
      if (!starts) return toast('Informe a data e a hora.', 'bad');
      const body = { name: String(fd.get('name')).trim(), starts_at: starts, venue: String(fd.get('venue')).trim(), city: String(fd.get('city')).trim(), description: String(fd.get('description')).trim(), fee_pct: Number(fd.get('fee_pct')) || 0, published: fd.get('published') === 'on' };
      if (admin) { body.organizer_id = fd.get('organizer_id') || null; body.platform_pct = Number(fd.get('platform_pct')) || 0; }
      if (body.published && !(ev.ticket_types || []).length) toast('Lembre de cadastrar os lotes na aba “Lotes”.');
      must(await sb.from('events').update(body).eq('id', ev.id));
      toast('Informações salvas.'); reload();
    }
  });
}

function mLotes(ev, header, reload) {
  const types = sortTypes(ev.ticket_types);
  const row = (t, i) => `<form class="typerow" data-form="type" data-id="${esc(t.id)}">
    <div class="field"><label for="t-name-${i}">Nome do lote / setor</label><input id="t-name-${i}" name="name" required value="${esc(t.name)}"></div>
    <div class="field"><label for="t-price-${i}">Preço inteira (R$)</label><input id="t-price-${i}" name="price" type="number" min="0" step="0.01" required value="${esc(t.price)}"></div>
    <div class="field"><label for="t-cap-${i}">Quantidade (vendidos: ${num(t.sold)})</label><input id="t-cap-${i}" name="capacity" type="number" min="${t.sold}" step="1" required value="${esc(t.capacity)}"></div>
    <label class="check" style="padding-bottom:9px"><input type="checkbox" name="allows_half" ${t.allows_half ? 'checked' : ''}> Meia</label>
    <div class="row" style="padding-bottom:2px"><button class="btn small" type="submit">Salvar</button>${t.sold ? '' : `<button class="btn small danger" type="button" data-act="del" data-id="${esc(t.id)}" aria-label="Excluir lote">Excluir</button>`}</div>
  </form>`;
  const read = fd => ({ name: String(fd.get('name')).trim(), price: Number(fd.get('price')) || 0, capacity: Math.max(0, Math.floor(Number(fd.get('capacity')) || 0)), allows_half: fd.get('allows_half') === 'on' });
  mount(header + `<div class="panel">
    <div><h2>Lotes e setores</h2><p class="note">A meia-entrada custa metade da inteira e usa a mesma quantidade do lote. Lotes com vendas não podem ser excluídos; diminua a quantidade até o total vendido para encerrar.</p></div>
    <div>${types.length ? types.map(row).join('') : '<p class="note">Nenhum lote ainda.</p>'}</div>
  </div>
  <form class="panel" data-form="new"><h2>Novo lote</h2>
    <div class="typerow" style="border:0;padding:0">
      <div class="field"><label for="nt-name">Nome</label><input id="nt-name" name="name" required placeholder="Pista · 1º lote"></div>
      <div class="field"><label for="nt-price">Preço inteira (R$)</label><input id="nt-price" name="price" type="number" min="0" step="0.01" required></div>
      <div class="field"><label for="nt-cap">Quantidade</label><input id="nt-cap" name="capacity" type="number" min="1" step="1" required></div>
      <label class="check" style="padding-bottom:9px"><input type="checkbox" name="allows_half" checked> Meia</label>
      <div style="padding-bottom:2px"><button class="btn primary small" type="submit">Adicionar</button></div>
    </div>
  </form>`, {
    del: async b => {
      const { error } = await sb.from('ticket_types').delete().eq('id', b.dataset.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('Lote excluído.'); reload();
    }
  }, {
    type: async (fd, f) => { must(await sb.from('ticket_types').update(read(fd)).eq('id', f.dataset.id)); toast('Lote salvo.'); reload(); },
    new: async fd => { must(await sb.from('ticket_types').insert({ ...read(fd), event_id: ev.id, sort: types.length })); toast('Lote adicionado.'); reload(); }
  });
}

async function mFinance(ev, header, reload) {
  const [orders, tickets, expenses] = await Promise.all([
    sb.from('orders').select('subtotal,fee,total').eq('event_id', ev.id).then(must),
    sb.from('tickets').select('ticket_type_id,kind,unit_price').eq('event_id', ev.id).then(must),
    sb.from('expenses').select('*').eq('event_id', ev.id).order('due_date', { ascending: true, nullsFirst: false }).then(must)
  ]);
  const sales = orders.reduce((a, o) => a + Number(o.subtotal), 0);
  const fees = orders.reduce((a, o) => a + Number(o.fee), 0);
  const commission = Math.round(sales * Number(ev.platform_pct)) / 100;
  const payout = sales - commission;
  const expTotal = expenses.reduce((a, x) => a + Number(x.amount), 0);
  const expOpen = expenses.filter(x => !x.paid).reduce((a, x) => a + Number(x.amount), 0);
  const result = payout - expTotal;
  const byType = sortTypes(ev.ticket_types).map(t => {
    const ts = tickets.filter(x => x.ticket_type_id === t.id);
    return { t, full: ts.filter(x => x.kind === 'inteira').length, half: ts.filter(x => x.kind === 'meia').length, rev: ts.reduce((a, x) => a + Number(x.unit_price), 0) };
  });
  const org = ev.organizers;
  mount(header + `
  <div class="kpis">
    <div class="kpi"><div class="v">${money(sales)}</div><div class="l">vendas de ingressos (${num(tickets.length)} emitidos)</div></div>
    <div class="kpi"><div class="v">${money(commission)}</div><div class="l">comissão da plataforma (${num(ev.platform_pct)}%)</div></div>
    <div class="kpi strong"><div class="v">${money(payout)}</div><div class="l">repasse previsto ao organizador</div></div>
    <div class="kpi"><div class="v">${money(expTotal)}</div><div class="l">despesas lançadas (${money(expOpen)} a pagar)</div></div>
    <div class="kpi strong"><div class="v" style="color:${result < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(result)}</div><div class="l">resultado (repasse − despesas)</div></div>
  </div>
  <p class="note">Taxas de serviço pagas pelos compradores: ${money(fees)}. Elas ficam com a plataforma e não entram no repasse.</p>
  <div class="two">
    <div class="panel"><h2>Vendas por lote</h2>
      <div class="tablewrap"><table><thead><tr><th>Lote</th><th class="num">Inteira</th><th class="num">Meia</th><th class="num">Ocupação</th><th class="num">Receita</th></tr></thead><tbody>
      ${byType.map(r => `<tr><td>${esc(r.t.name)}</td><td class="num">${num(r.full)}</td><td class="num">${num(r.half)}</td><td class="num">${num(r.t.sold)}/${num(r.t.capacity)}</td><td class="num">${money(r.rev)}</td></tr>`).join('') || '<tr><td colspan="5" class="note">Sem lotes.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="panel"><h2>Dados para repasse</h2>
      ${org ? `<p style="margin:0"><b>${esc(org.legal_name)}</b><br><span class="note">${org.person_type === 'PJ' ? 'CNPJ' : 'CPF'} ${esc(fmtDoc(org.person_type, org.document))}</span></p>
        <p style="margin:0">PIX: ${org.pix_key ? `<span class="mono">${esc(org.pix_key)}</span>` : '<span class="note">não informado</span>'}<br>
        Banco: ${esc([org.bank_name, org.bank_agency && 'ag. ' + org.bank_agency, org.bank_account && 'c/c ' + org.bank_account].filter(Boolean).join(' · ') || '—')}</p>
        ${isOrganizer() && me.organizers.some(o => o.id === org.id) ? '<a class="linkbtn" href="#/painel/dados">Atualizar dados de recebimento</a>' : ''}`
      : '<p class="note">Nenhum organizador vinculado a este evento.</p>'}
    </div>
  </div>
  <div class="panel"><h2>Despesas do evento</h2>
    ${expenses.length ? `<div class="tablewrap"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${expenses.map(x => `<tr><td>${esc(x.description)}</td><td>${esc(fmtDate(x.due_date))}</td><td class="num">${money(x.amount)}</td>
        <td><button class="btn small" data-act="toggle" data-id="${esc(x.id)}" data-paid="${x.paid ? '1' : ''}">${x.paid ? '✓ Pago' : 'A pagar'}</button></td>
        <td class="num"><button class="btn small danger" data-act="del" data-id="${esc(x.id)}">Excluir</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="note">Nenhuma despesa lançada. Registre cachês, som, aluguel do espaço, divulgação e o que mais tiver custo.</p>'}
    <form data-form="exp" class="formgrid" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end">
      <div class="field"><label for="x-desc">Descrição</label><input id="x-desc" name="description" required placeholder="Aluguel do som"></div>
      <div class="field"><label for="x-amt">Valor (R$)</label><input id="x-amt" name="amount" type="number" min="0" step="0.01" required></div>
      <div class="field"><label for="x-due">Vencimento</label><input id="x-due" name="due_date" type="date"></div>
      <button class="btn primary" type="submit">Lançar</button>
    </form>
  </div>`, {
    toggle: async b => { const { error } = await sb.from('expenses').update({ paid: !b.dataset.paid }).eq('id', b.dataset.id); if (error) return toast(errMsg(error), 'bad'); reload(); },
    del: async b => { const { error } = await sb.from('expenses').delete().eq('id', b.dataset.id); if (error) return toast(errMsg(error), 'bad'); toast('Despesa excluída.'); reload(); }
  }, {
    exp: async fd => {
      must(await sb.from('expenses').insert({ event_id: ev.id, description: String(fd.get('description')).trim(), amount: Number(fd.get('amount')) || 0, due_date: fd.get('due_date') || null }));
      toast('Despesa lançada.'); reload();
    }
  });
}

async function mOrders(ev, header) {
  const orders = must(await sb.from('orders').select('id,code,buyer_name,buyer_email,subtotal,fee,total,created_at,tickets(code,type_name,kind,checked_in_at)').eq('event_id', ev.id).order('created_at', { ascending: false }));
  const rows = q => orders.filter(o => !q || [o.code, o.buyer_name, o.buyer_email].some(v => String(v).toLowerCase().includes(q))).map(o => `<tr>
    <td class="mono">${esc(o.code)}</td><td>${esc(o.buyer_name)}${o.buyer_email ? `<div class="note">${esc(o.buyer_email)}</div>` : ''}</td>
    <td>${esc(Object.entries((o.tickets || []).reduce((m, t) => { const k = t.type_name + (t.kind === 'meia' ? ' (meia)' : ''); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => v + '× ' + k).join(', '))}</td>
    <td class="num">${num((o.tickets || []).filter(t => t.checked_in_at).length)}/${num((o.tickets || []).length)}</td>
    <td class="num">${money(o.total)}</td><td>${esc(fmtShort(o.created_at))}</td></tr>`).join('');
  mount(header + `<div class="panel">
    <div class="row between"><h2>${num(orders.length)} pedido${orders.length === 1 ? '' : 's'}</h2>
      <div class="row"><input class="input" style="width:240px;max-width:100%" placeholder="Buscar nome, e-mail ou pedido" data-input="q" aria-label="Buscar pedidos"><button class="btn small" data-act="csv" ${orders.length ? '' : 'disabled'}>Exportar planilha (CSV)</button></div></div>
    ${orders.length ? `<div class="tablewrap"><table><thead><tr><th>Pedido</th><th>Comprador</th><th>Ingressos</th><th class="num">Entradas</th><th class="num">Total</th><th>Data</th></tr></thead><tbody id="order-rows">${rows('')}</tbody></table></div>`
      : '<p class="note">Os pedidos aparecem aqui conforme o público compra.</p>'}
  </div>`, {
    'input:q': el => { document.getElementById('order-rows').innerHTML = rows(el.value.trim().toLowerCase()); },
    csv: () => {
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['pedido', 'ingresso', 'lote', 'tipo', 'comprador', 'email', 'data_compra', 'utilizado_em'].join(';')];
      for (const o of orders) for (const t of o.tickets || []) lines.push([o.code, t.code, t.type_name, t.kind, o.buyer_name, o.buyer_email, fmtShort(o.created_at), t.checked_in_at ? fmtShort(t.checked_in_at) : ''].map(q).join(';'));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `pedidos-${ev.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });
}

async function mCheckin(ev, header) {
  let stats = must(await sb.rpc('checkin_stats', { p_event: ev.id }));
  let stream = null, timer = null, busy = false, last = '', lastAt = 0, detector = null, jsqr = null;
  const show = html => { const el = document.getElementById('ci-result'); if (el) el.innerHTML = html; };
  const bad = (title, text) => `<div class="result bad"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
  const drawStats = () => {
    const el = document.getElementById('ci-stats'); if (!el) return;
    const recent = stats.recent || [];
    el.innerHTML = `<h2>${num(stats.used)} de ${num(stats.total)} entradas</h2>
      <div class="bar"><i style="width:${stats.total ? Math.round(stats.used / stats.total * 100) : 0}%"></i></div>
      ${recent.length ? `<div class="tablewrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Hora</th></tr></thead><tbody>
        ${recent.map(t => `<tr><td class="mono">${esc(t.code)}</td><td>${esc(t.buyer)}</td><td>${esc(fmtShort(t.at))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="note">Ninguém entrou ainda.</p>'}`;
  };
  const refreshStats = async () => { const { data } = await sb.rpc('checkin_stats', { p_event: ev.id }); if (data) { stats = data; drawStats(); } };

  async function validate(raw) {
    const code = normCode(raw); if (!code) return;
    show(`<div class="result wait"><strong>Validando ${esc(code)}…</strong></div>`);
    const { data, error } = await sb.rpc('check_in', { p_code: code, p_event: ev.id });
    if (error) { beep(false); return show(bad('Não foi possível validar', errMsg(error))); }
    const ok = data?.status === 'ok';
    try { navigator.vibrate?.(ok ? 120 : [90, 60, 90, 60, 90]); } catch (_) {}
    beep(ok);
    if (ok) {
      refreshStats();
      return show(`<div class="result ok"><strong>Entrada liberada</strong><span>${esc(data.buyer)} · ${esc(data.type)} · ${esc(data.code)}</span>${data.kind === 'meia' ? '<span><b>Meia-entrada: confira o documento.</b></span>' : ''}</div>`);
    }
    if (data?.status === 'used') return show(`<div class="result bad"><strong>Ingresso já utilizado</strong><span>${esc(data.code)} entrou em ${esc(fmtShort(data.at))} · ${esc(data.buyer)}</span></div>`);
    if (data?.status === 'other_event') return show(bad('Ingresso de outro evento', `${code} não vale para ${ev.name}.`));
    show(bad('Código não encontrado', `Confira os caracteres de ${code}. Os códigos não usam 0, O, 1 nem I.`));
  }

  function stopCam() {
    clearTimeout(timer); timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const sc = document.getElementById('scanner'); if (sc) sc.hidden = true;
    const b = document.getElementById('cam-btn'); if (b) b.textContent = 'Escanear QR Code';
  }
  async function startCam() {
    beep(true); // libera o som no navegador a partir deste toque
    if (!navigator.mediaDevices?.getUserMedia) return show(bad('Câmera indisponível', 'Este navegador não permite usar a câmera. Use Chrome ou Safari atualizados, ou digite o código.'));
    try {
      if (!detector && 'BarcodeDetector' in window) {
        try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) {}
      }
      if (!detector && !jsqr) { const g = await loadScript('assets/vendor/jsQR.js', 'jsQR'); jsqr = g.default || g; }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      const msg = e?.name === 'NotAllowedError' ? 'Permita o acesso à câmera no navegador (ícone de cadeado ao lado do endereço) e tente de novo.'
        : e?.name === 'NotFoundError' ? 'Nenhuma câmera encontrada neste aparelho.' : errMsg(e);
      return show(bad('Não foi possível abrir a câmera', msg));
    }
    const video = document.getElementById('cam');
    if (!video) return stopCam();
    video.srcObject = stream;
    await video.play().catch(() => {});
    document.getElementById('scanner').hidden = false;
    document.getElementById('cam-btn').textContent = 'Fechar câmera';
    show('<div class="result wait"><strong>Aponte para o QR Code do ingresso</strong></div>');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!stream) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        let text = '';
        try {
          if (detector) text = (await detector.detect(video))[0]?.rawValue || '';
          else {
            const s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * s); canvas.height = Math.round(video.videoHeight * s);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsqr(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || '';
          }
        } catch (_) {}
        const code = text && normCode(text);
        if (code && !(code === last && Date.now() - lastAt < 4000)) {
          last = code; lastAt = Date.now(); busy = true;
          await validate(code);
          setTimeout(() => { busy = false; }, 1500);
        }
      }
      timer = setTimeout(tick, 160);
    };
    tick();
  }

  mount(header + `<div class="two">
    <div class="panel"><h2>Validar ingresso</h2>
      <div class="scanner" id="scanner" hidden><video id="cam" playsinline muted></video><div class="aim" aria-hidden="true"></div></div>
      <button class="btn primary" type="button" data-act="cam" id="cam-btn">Escanear QR Code</button>
      <div id="ci-result"></div>
      <form data-form="check" class="row">
        <input id="code" name="code" class="input big-input" style="flex:1;min-width:0" placeholder="ABC234-1" autocomplete="off" autocapitalize="characters" aria-label="Código do ingresso" required>
        <button class="btn" type="submit">Validar código</button>
      </form>
      <p class="note">Sem câmera? Digite o código que aparece embaixo do QR. Cada ingresso só entra uma vez.</p>
    </div>
    <div class="panel" id="ci-stats"></div>
  </div>`, {
    cam: () => (stream ? stopCam() : startCam())
  }, {
    check: async (fd, f) => { await validate(fd.get('code')); f.reset(); }
  });
  drawStats();
  teardown = stopCam;
}

/* ================= portaria ================= */
async function vDoorList() {
  loading();
  const ids = staffEventIds();
  if (!isStaff()) return vMessage('Sem acesso à portaria', 'Sua conta não faz parte de nenhuma equipe de portaria.');
  const evs = ids.length ? must(await sb.from('events').select(EV_PUBLIC).in('id', ids).order('starts_at')) : [];
  mount(`<div class="page-head"><div><div class="eyebrow">Equipe de portaria</div><h1>Portaria</h1>
      <p>Escolha o evento e leia os QR Codes dos ingressos na entrada.</p></div></div>
    ${evs.length ? `<div class="grid">${evs.map(ev => ticketCard(ev, '#/portaria/' + ev.id)).join('')}</div>`
      : '<div class="empty"><h2>Nenhum evento liberado</h2><p>Quem organiza o evento precisa liberar você para ele.</p></div>'}`);
}

async function vDoor(id) {
  loading();
  const ev = must(await sb.from('events').select('id,name,starts_at,venue,city,organizer_id').eq('id', id).maybeSingle());
  if (!ev || !(staffEventIds().includes(ev.id) || managesEvent(ev))) return vMessage('Evento não liberado', 'Você não está na portaria deste evento.');
  const header = `<div><a class="linkbtn" href="#/portaria">← Portaria</a></div>
    <div class="page-head"><div><div class="chips"><span class="chip accent">Portaria</span></div>
      <h1 style="margin-top:8px">${esc(ev.name)}</h1><p>${esc(fmtLong(ev.starts_at))} · ${esc(ev.venue)}${ev.city ? ', ' + esc(ev.city) : ''}</p></div></div>`;
  return mCheckin(ev, header);
}

/* ================= equipe de portaria (organizador / admin) ================= */
async function vTeam(orgId) {
  loading();
  let org;
  if (isAdmin() && orgId) org = must(await sb.from('organizers').select('*').eq('id', orgId).maybeSingle());
  else org = me.organizers.find(o => !orgId || o.id === orgId);
  if (!org) return vMessage('Sem acesso', 'Só o organizador e a administração gerenciam a equipe de portaria.');
  const [evs, staff] = await Promise.all([
    sb.from('events').select('id,name,starts_at').eq('organizer_id', org.id).order('starts_at', { ascending: false }).then(must),
    sb.from('staff').select('id,name,email,user_id,staff_events(event_id)').eq('organizer_id', org.id).order('name').then(must)
  ]);
  const armed = new Set();
  const back = isAdmin() && orgId ? `#/admin/organizador/${esc(org.id)}` : '#/painel';
  const others = me.organizers.filter(o => o.id !== org.id);
  mount(`<div><a class="linkbtn" href="${back}">← Voltar</a></div>
  <div class="page-head"><div><div class="eyebrow">${esc(orgName(org))}</div><h1>Equipe de portaria</h1>
    <p>Pessoas que só leem e validam ingressos nos eventos que você liberar. Elas não veem vendas, valores, e-mails de compradores nem alteram nada.</p></div>
    ${others.length && !(isAdmin() && orgId) ? `<div class="row">${others.map(o => `<a class="btn small" href="#/painel/equipe/${esc(o.id)}">${esc(orgName(o))}</a>`).join('')}</div>` : ''}</div>
  <form class="panel medium" data-form="add"><h2>Adicionar pessoa</h2>
    <div class="formgrid">
      <div class="field"><label for="st-name">Nome</label><input id="st-name" name="name" required autocomplete="off"></div>
      <div class="field"><label for="st-email">E-mail de acesso</label><input id="st-email" name="email" type="email" required autocomplete="off"></div>
    </div>
    <div class="row"><button class="btn primary" type="submit">Adicionar à equipe</button>
      <span class="note">A pessoa cria a conta no site com este mesmo e-mail. Depois de confirmar, vê só a tela de portaria.</span></div>
  </form>
  <div class="panel"><h2>${num(staff.length)} pessoa${staff.length === 1 ? '' : 's'} na equipe</h2>
    ${staff.length ? staff.map(s => {
      const on = new Set((s.staff_events || []).map(x => x.event_id));
      return `<div class="evrow" style="display:grid;gap:10px;padding:14px 0;border-top:1px solid var(--line)">
        <div class="row between"><div><b>${esc(s.name)}</b> ${s.user_id ? '<span class="chip ok">Conta ativa</span>' : '<span class="chip">Aguardando cadastro</span>'}<div class="note">${esc(s.email)}</div></div>
          <button class="btn small danger" data-act="del" data-id="${esc(s.id)}">Remover da equipe</button></div>
        ${evs.length ? `<div class="row" style="gap:6px 18px">${evs.map(e => `<label class="check"><input type="checkbox" data-change="ev" data-staff="${esc(s.id)}" data-event="${esc(e.id)}" ${on.has(e.id) ? 'checked' : ''}> ${esc(e.name)} <span class="note">${esc(fmtShort(e.starts_at))}</span></label>`).join('')}</div>`
          : '<p class="note">Você ainda não tem eventos para liberar.</p>'}
      </div>`;
    }).join('') : '<p class="note">Ninguém na equipe ainda.</p>'}
  </div>`, {
    'change:ev': async el => {
      el.disabled = true;
      const { error } = el.checked
        ? await sb.from('staff_events').insert({ staff_id: el.dataset.staff, event_id: el.dataset.event })
        : await sb.from('staff_events').delete().eq('staff_id', el.dataset.staff).eq('event_id', el.dataset.event);
      el.disabled = false;
      if (error) { el.checked = !el.checked; return toast(errMsg(error), 'bad'); }
      toast(el.checked ? 'Acesso liberado para este evento.' : 'Acesso removido deste evento.');
    },
    del: async b => {
      if (!armed.has(b.dataset.id)) { armed.add(b.dataset.id); b.classList.add('armed'); b.textContent = 'Clique de novo para remover'; return; }
      const { error } = await sb.from('staff').delete().eq('id', b.dataset.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('Pessoa removida da equipe.'); vTeam(orgId);
    }
  }, {
    add: async fd => {
      const { data, error } = await sb.from('staff').insert({ organizer_id: org.id, name: String(fd.get('name')).trim(), email: String(fd.get('email')).trim().toLowerCase() }).select('user_id').single();
      if (error) throw (/staff_org_email_key/.test(error.message) ? new Error('Esta pessoa já está na equipe.') : error);
      toast(data.user_id ? 'Adicionada. Ela já tem conta: marque os eventos liberados.' : 'Adicionada. Ela terá acesso ao criar a conta com este e-mail.');
      vTeam(orgId);
    }
  });
}

/* ================= administração ================= */
async function vAdmin(tab) {
  loading();
  const head = `<div class="page-head"><div><div class="eyebrow">Administração geral</div><h1>Administração</h1>
    <p>Crie eventos, cadastre organizadores (pessoa física ou jurídica) e vincule cada evento a quem vai gerenciá-lo.</p></div></div>
    <nav class="subtabs"><a href="#/admin/eventos" ${tab === 'eventos' ? 'aria-current="page"' : ''}>Eventos</a><a href="#/admin/organizadores" ${tab === 'organizadores' ? 'aria-current="page"' : ''}>Organizadores</a></nav>`;
  const orgs = must(await sb.from('organizers').select('*').order('legal_name'));
  if (tab === 'organizadores') {
    const counts = must(await sb.from('events').select('organizer_id')).reduce((m, e) => { if (e.organizer_id) m[e.organizer_id] = (m[e.organizer_id] || 0) + 1; return m; }, {});
    return mount(head + `<div class="panel"><div class="row between"><h2>${num(orgs.length)} organizador${orgs.length === 1 ? '' : 'es'}</h2><a class="btn primary" href="#/admin/organizador/novo">+ Novo organizador</a></div>
      ${orgs.length ? `<div class="tablewrap"><table><thead><tr><th>Nome / razão social</th><th>Tipo</th><th>Documento</th><th>E-mail</th><th>Conta</th><th class="num">Eventos</th><th></th></tr></thead><tbody>
        ${orgs.map(o => `<tr><td><b>${esc(o.legal_name)}</b>${o.trade_name ? `<div class="note">${esc(o.trade_name)}</div>` : ''}</td><td>${o.person_type}</td><td class="mono">${esc(fmtDoc(o.person_type, o.document))}</td><td>${esc(o.email)}</td>
          <td>${o.user_id ? '<span class="chip ok">Ativa</span>' : '<span class="chip">Aguardando cadastro</span>'}</td><td class="num">${num(counts[o.id] || 0)}</td>
          <td class="num"><a class="btn small" href="#/admin/organizador/${esc(o.id)}">Abrir</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="note">Cadastre o primeiro organizador para poder vincular eventos.</p>'}</div>`);
  }
  const evs = must(await sb.from('events').select('id,name,starts_at,published,organizer_id,platform_pct,ticket_types(capacity,sold)').order('starts_at', { ascending: false }));
  const totalSold = evs.reduce((a, e) => a + (e.ticket_types || []).reduce((b, t) => b + t.sold, 0), 0);
  const orgOptions = sel => `<option value="">Sem organizador</option>` + orgs.map(o => `<option value="${esc(o.id)}" ${o.id === sel ? 'selected' : ''}>${esc(orgName(o))} (${o.person_type})</option>`).join('');
  mount(head + `
  <div class="kpis">
    <div class="kpi"><div class="v">${num(evs.length)}</div><div class="l">eventos cadastrados</div></div>
    <div class="kpi"><div class="v">${num(evs.filter(e => e.published && !isPast(e)).length)}</div><div class="l">à venda agora</div></div>
    <div class="kpi"><div class="v">${num(totalSold)}</div><div class="l">ingressos emitidos</div></div>
    <div class="kpi"><div class="v">${num(evs.filter(e => !e.organizer_id).length)}</div><div class="l">eventos sem organizador</div></div>
  </div>
  <details class="panel" ${evs.length ? '' : 'open'}><summary>+ Criar evento</summary>
    <form data-form="new" class="formgrid">
      <div class="field full"><label for="n-name">Nome do evento</label><input id="n-name" name="name" required></div>
      <div class="field"><label for="n-date">Data e hora</label><input id="n-date" name="starts_at" type="datetime-local" required></div>
      <div class="field"><label for="n-org">Vincular ao organizador</label><select id="n-org" name="organizer_id">${orgOptions('')}</select></div>
      <div class="field"><label for="n-venue">Local</label><input id="n-venue" name="venue"></div>
      <div class="field"><label for="n-city">Cidade / UF</label><input id="n-city" name="city"></div>
      <div class="field"><label for="n-fee">Taxa de serviço (%)</label><input id="n-fee" name="fee_pct" type="number" min="0" max="30" step="0.5" value="10"></div>
      <div class="field"><label for="n-plat">Comissão da plataforma (%)</label><input id="n-plat" name="platform_pct" type="number" min="0" max="100" step="0.5" value="5"></div>
      <div class="full row"><button class="btn primary" type="submit">Criar e configurar lotes</button><span class="note">O evento nasce como rascunho. Publique depois de cadastrar os lotes.</span></div>
    </form>
  </details>
  <div class="panel"><h2>Eventos</h2>
    ${evs.length ? `<div class="tablewrap"><table><thead><tr><th>Evento</th><th>Data</th><th>Organizador</th><th>Situação</th><th class="num">Vendidos</th><th></th></tr></thead><tbody>
      ${evs.map(e => { const cap = (e.ticket_types || []).reduce((a, t) => a + t.capacity, 0), sold = (e.ticket_types || []).reduce((a, t) => a + t.sold, 0); return `<tr>
        <td><b>${esc(e.name)}</b></td><td>${esc(fmtShort(e.starts_at))}</td>
        <td><select class="input" style="min-width:180px" data-change="link" data-id="${esc(e.id)}" aria-label="Organizador de ${esc(e.name)}">${orgOptions(e.organizer_id)}</select></td>
        <td>${isPast(e) ? '<span class="chip">Encerrado</span>' : e.published ? '<span class="chip ok">Publicado</span>' : '<span class="chip">Rascunho</span>'}</td>
        <td class="num">${num(sold)}/${num(cap)}</td><td class="num"><a class="btn small" href="#/painel/evento/${esc(e.id)}/info">Gerenciar</a></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="note">Nenhum evento ainda.</p>'}
  </div>`, {
    'change:link': async el => {
      const { error } = await sb.from('events').update({ organizer_id: el.value || null }).eq('id', el.dataset.id);
      if (error) { toast(errMsg(error), 'bad'); return vAdmin(tab); }
      toast(el.value ? 'Evento vinculado ao organizador.' : 'Organizador removido do evento.');
    }
  }, {
    new: async fd => {
      const starts = fromLocalInput(fd.get('starts_at'));
      if (!starts) return toast('Informe a data e a hora.', 'bad');
      const ev = must(await sb.from('events').insert({ name: String(fd.get('name')).trim(), starts_at: starts, organizer_id: fd.get('organizer_id') || null, venue: String(fd.get('venue')).trim(), city: String(fd.get('city')).trim(), fee_pct: Number(fd.get('fee_pct')) || 0, platform_pct: Number(fd.get('platform_pct')) || 0 }).select('id').single());
      toast('Evento criado. Agora cadastre os lotes.'); go(`#/painel/evento/${ev.id}/lotes`);
    }
  });
}

async function vAdminOrganizer(id) {
  loading();
  const isNew = id === 'novo';
  const o = isNew ? { person_type: 'PJ' } : must(await sb.from('organizers').select('*').eq('id', id).maybeSingle());
  if (!o) return vMessage('Organizador não encontrado', 'Ele pode ter sido excluído.');
  const evs = isNew ? [] : must(await sb.from('events').select('id,name,starts_at,organizer_id,published').order('starts_at', { ascending: false }));
  const mine = evs.filter(e => e.organizer_id === o.id), others = evs.filter(e => e.organizer_id !== o.id);
  let armed = false;
  const labels = t => t === 'PJ' ? ['Razão social', 'CNPJ', 'Nome fantasia'] : ['Nome completo', 'CPF', 'Nome artístico / como aparece'];
  const [l1, l2] = labels(o.person_type);
  mount(`<div><a class="linkbtn" href="#/admin/organizadores">← Organizadores</a></div>
  <div class="page-head"><div><div class="eyebrow">Organizador</div><h1>${isNew ? 'Novo organizador' : esc(o.legal_name)}</h1>
    ${isNew ? '<p>A pessoa recebe acesso quando criar a conta no site com este mesmo e-mail e confirmar.</p>'
      : `<p>${o.user_id ? '<span class="chip ok">Conta ativa</span>' : '<span class="chip">Aguardando a pessoa criar a conta com ' + esc(o.email) + '</span>'}</p>`}</div></div>
  <form class="panel medium" data-form="org">
    <div class="field"><span class="label">Tipo de pessoa</span>
      <div class="seg" role="radiogroup"><label><input type="radio" name="person_type" value="PJ" data-change="ptype" ${o.person_type === 'PJ' ? 'checked' : ''}>Pessoa jurídica</label><label><input type="radio" name="person_type" value="PF" data-change="ptype" ${o.person_type === 'PF' ? 'checked' : ''}>Pessoa física</label></div></div>
    <div class="formgrid">
      <div class="field full"><label for="a-legal" id="lbl-legal">${l1}</label><input id="a-legal" name="legal_name" required value="${esc(o.legal_name || '')}"></div>
      <div class="field"><label for="a-doc" id="lbl-doc">${l2}</label><input id="a-doc" name="document" required inputmode="numeric" value="${esc(fmtDoc(o.person_type, o.document || ''))}"></div>
      <div class="field"><label for="a-email">E-mail de acesso</label><input id="a-email" name="email" type="email" required value="${esc(o.email || '')}"></div>
    </div>
    ${orgEditableFields(o)}
    <div class="row between"><button class="btn primary" type="submit">${isNew ? 'Cadastrar organizador' : 'Salvar alterações'}</button>
      ${isNew ? '' : '<button class="btn danger" type="button" data-act="del">Excluir organizador</button>'}</div>
  </form>
  ${isNew ? '' : `<div class="row"><a class="btn" href="#/painel/equipe/${esc(o.id)}">Equipe de portaria deste organizador</a></div>`}
  ${isNew ? '' : `<div class="panel medium"><h2>Eventos vinculados</h2>
    ${mine.length ? `<div class="tablewrap"><table><tbody>${mine.map(e => `<tr><td><b>${esc(e.name)}</b><div class="note">${esc(fmtShort(e.starts_at))}</div></td><td>${e.published ? '<span class="chip ok">Publicado</span>' : '<span class="chip">Rascunho</span>'}</td>
      <td class="num"><a class="btn small" href="#/painel/evento/${esc(e.id)}/info">Gerenciar</a> <button class="btn small danger" data-act="unlink" data-id="${esc(e.id)}">Desvincular</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="note">Nenhum evento vinculado.</p>'}
    ${others.length ? `<form data-form="link" class="row"><select name="event_id" class="input" style="flex:1;min-width:200px" aria-label="Evento para vincular">${others.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(fmtShort(e.starts_at))}${e.organizer_id ? ' (troca de organizador)' : ''}</option>`).join('')}</select><button class="btn primary" type="submit">Vincular evento</button></form>` : ''}
  </div>`}`, {
    'change:ptype': el => {
      const [a, b, c] = labels(el.value);
      document.getElementById('lbl-legal').textContent = a; document.getElementById('lbl-doc').textContent = b;
      const t = document.querySelector('[data-trade-label]'); if (t) t.textContent = c;
    },
    unlink: async b => { const { error } = await sb.from('events').update({ organizer_id: null }).eq('id', b.dataset.id); if (error) return toast(errMsg(error), 'bad'); toast('Evento desvinculado.'); vAdminOrganizer(id); },
    del: async b => {
      if (!armed) { armed = true; b.classList.add('armed'); b.textContent = 'Clique de novo para excluir'; return; }
      const { error } = await sb.from('organizers').delete().eq('id', o.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('Organizador excluído. Os eventos dele ficaram sem organizador.'); go('#/admin/organizadores');
    }
  }, {
    org: async fd => {
      const type = fd.get('person_type'), doc = digits(fd.get('document'));
      if (type === 'PF' ? !validCPF(doc) : !validCNPJ(doc)) return toast(type === 'PF' ? 'CPF inválido. Confira os números.' : 'CNPJ inválido. Confira os números.', 'bad');
      const body = { person_type: type, legal_name: String(fd.get('legal_name')).trim(), document: doc, email: String(fd.get('email')).trim().toLowerCase(), ...orgEditablePayload(fd) };
      if (isNew) {
        const row = must(await sb.from('organizers').insert(body).select('id,user_id').single());
        toast(row.user_id ? 'Organizador cadastrado e já vinculado à conta existente.' : 'Organizador cadastrado. Ele terá acesso ao criar a conta com este e-mail.');
        go('#/admin/organizador/' + row.id);
      } else {
        must(await sb.from('organizers').update(body).eq('id', o.id));
        toast('Alterações salvas.'); vAdminOrganizer(id);
      }
    },
    link: async fd => {
      must(await sb.from('events').update({ organizer_id: o.id }).eq('id', fd.get('event_id')));
      toast('Evento vinculado.'); vAdminOrganizer(id);
    }
  });
}

/* ================= início ================= */
async function start() {
  if (!configured) { renderNav(); return vSetup(); }
  const qs = new URLSearchParams(location.search);
  if (qs.get('error_description')) toast(qs.get('error_description'), 'bad');
  let booted = false, recovery = qs.has('recovery');
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (!booted) return;
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') { await loadMe(session); return go('#/nova-senha'); }
      if (event === 'SIGNED_IN' && session?.user?.id !== me.user?.id) {
        await loadMe(session);
        let next = ''; try { next = sessionStorage.getItem('next') || ''; sessionStorage.removeItem('next'); } catch (_) {}
        return go(next || homeFor());
      }
      if (event === 'SIGNED_OUT') { await loadMe(null); return route(); }
      if (event === 'USER_UPDATED') { await loadMe(session); renderNav(); }
    }, 0);
  });
  const { data } = await sb.auth.getSession();
  await loadMe(data.session);
  booted = true;
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  if (recovery && me.user) location.hash = '#/nova-senha';
  window.addEventListener('hashchange', route);
  route();
}
start();
