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
const instField = (v, idp) => `<div class="field"><label for="${idp}-inst">Parcelamento máximo no cartão</label><select id="${idp}-inst" name="max_installments">${Array.from({ length: 12 }, (_, i) => i + 1).map(n => `<option value="${n}" ${n === (Number(v) || 1) ? 'selected' : ''}>${n === 1 ? 'Só à vista' : `Até ${n}×`}</option>`).join('')}</select><span class="note">O comprador paga a tarifa maior do parcelado. Você recebe sua parte ao longo das parcelas.</span></div>`;
// Valor de cada parcela como o Asaas calcula: iguais, arredondadas para baixo; os centavos que sobram vão na última
const parcela = (total, n) => n > 1 ? Math.floor(Math.round(total * 100) / n) / 100 : total;
const fmtParcelas = (total, n) => {
  const p = parcela(total, n), last = Math.round((total - p * (n - 1)) * 100) / 100;
  return Math.abs(last - p) < 0.005 ? `${n}× de ${money(p)}` : `${n - 1}× de ${money(p)} + 1× de ${money(last)}`;
};
const readInst = fd => Math.max(1, Math.min(12, Number(fd.get('max_installments')) || 1));
const orgName = o => o ? (o.trade_name || o.legal_name) : '';
const fmtCharge = ev => ev.platform_fee_type === 'fixed' ? `${money(ev.platform_fee_fixed)} por ingresso vendido` : `${num(ev.platform_pct)}% sobre as vendas`;
const getSettings = async () => (await sb.from('settings').select('*').eq('id', 1).maybeSingle()).data
  || { default_fee_pct: 10, default_platform_type: 'percent', default_platform_pct: 5, default_platform_fixed: 0 };
// Campos de cobrança da plataforma (só a administração vê e edita)
function chargeFields(v, idp) {
  const fixed = v.type === 'fixed';
  return `<div class="field"><label for="${idp}-ptype">Cobrança da plataforma</label>
      <select id="${idp}-ptype" name="platform_fee_type" data-change="ptype-fee">
        <option value="percent" ${fixed ? '' : 'selected'}>Percentual sobre as vendas</option>
        <option value="fixed" ${fixed ? 'selected' : ''}>Valor fixo por ingresso vendido</option></select></div>
    <div class="field" data-fee="percent" ${fixed ? 'hidden' : ''}><label for="${idp}-ppct">Percentual da plataforma (%)</label><input id="${idp}-ppct" name="platform_pct" type="number" min="0" max="100" step="0.5" value="${esc(v.pct)}"></div>
    <div class="field" data-fee="fixed" ${fixed ? '' : 'hidden'}><label for="${idp}-pfix">Valor por ingresso (R$)</label><input id="${idp}-pfix" name="platform_fee_fixed" type="number" min="0" step="0.01" value="${esc(v.fixed)}"></div>`;
}
const chargeToggle = el => { const f = el.closest('form'); f.querySelectorAll('[data-fee]').forEach(x => { x.hidden = x.dataset.fee !== el.value; }); };
const readCharge = fd => ({ platform_fee_type: fd.get('platform_fee_type') === 'fixed' ? 'fixed' : 'percent', platform_pct: Number(fd.get('platform_pct')) || 0, platform_fee_fixed: Number(fd.get('platform_fee_fixed')) || 0 });

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
  links.push(['#/ajuda', 'Dúvidas']);
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
      case 'pagamento': return requireLogin() && await vPay(b);
      case 'entrar': return me.user ? go(homeFor()) : vLogin(b || 'entrar');
      case 'nova-senha': return vNewPassword();
      case 'meus-ingressos': return requireLogin() && await vMyTickets();
      case 'ajuda': return vHelp();
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
// Público lê os lotes pela visão ticket_types_public (quantidade só aparece se o organizador escolheu mostrar)
const LOT_FIELDS = 'id,name,price,capacity,allows_half,sort,sold,sales_start,sales_end,show_remaining';
const EV_PUBLIC = `id,name,starts_at,venue,city,description,fee_pct,max_installments,published,ticket_types:ticket_types_public(${LOT_FIELDS},sold_out)`;
const EV_OWNER = `id,name,starts_at,venue,city,description,fee_pct,max_installments,published,ticket_types(${LOT_FIELDS})`;
// Situação de venda de um lote agora: 'soon' (ainda não começou), 'ended' (período acabou), 'soldout' ou 'on'
const lotState = t => {
  const now = Date.now();
  if (t.sold_out || (t.capacity != null && t.sold != null && t.sold >= t.capacity)) return 'soldout';
  if (t.sales_start && now < new Date(t.sales_start).getTime()) return 'soon';
  if (t.sales_end && now > new Date(t.sales_end).getTime()) return 'ended';
  return 'on';
};
const fmtDT = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');

function evStats(ev) {
  const ts = ev.ticket_types || [];
  // Quantidades só entram na conta se todos os lotes mostram (ou se quem vê é o organizador)
  const known = ts.length > 0 && ts.every(t => t.capacity != null && t.sold != null);
  const cap = known ? ts.reduce((a, t) => a + t.capacity, 0) : 0, sold = known ? ts.reduce((a, t) => a + t.sold, 0) : 0;
  const open = ts.filter(t => lotState(t) === 'on');
  const prices = (open.length ? open : ts).map(t => t.allows_half ? half(t.price) : Number(t.price));
  const soldOut = ts.length > 0 && ts.every(t => lotState(t) === 'soldout');
  return { known, cap, sold, left: Math.max(0, cap - sold), pct: cap ? Math.min(100, Math.round(sold / cap * 100)) : 0, min: prices.length ? Math.min(...prices) : 0, soldOut };
}

function ticketCard(ev, href) {
  const d = new Date(ev.starts_at), s = evStats(ev);
  const chips = [];
  if (!ev.published) chips.push('<span class="chip">Rascunho</span>');
  if (isPast(ev)) chips.push('<span class="chip">Encerrado</span>');
  else if (s.soldOut || (s.cap && s.left === 0)) chips.push('<span class="chip bad">Esgotado</span>');
  else if (s.known && s.pct >= 80) chips.push('<span class="chip bad">Últimos ingressos</span>');
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
        ${s.known ? `<div style="display:grid;gap:4px;flex:1;max-width:180px">
          <div class="bar ${s.pct >= 80 ? 'hot' : ''}"><i style="width:${s.pct}%"></i></div>
          <div class="cap">${num(s.left)} de ${num(s.cap)} disponíveis</div>
        </div>` : ''}
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
// Taxa do meio de pagamento repassada ao comprador (mesma conta do banco: payment_fee_for)
function payFee(base, method, cfg, inst = 1) {
  if (!(base > 0) || !cfg?.payments_enabled) return 0;
  const f = Number(method === 'pix' ? cfg.pix_fee_fixed : cfg.card_fee_fixed) || 0;
  const p = Number(method === 'pix' ? cfg.pix_fee_pct
    : inst >= 7 ? cfg.card_fee_pct_7_12 : inst >= 2 ? cfg.card_fee_pct_2_6 : cfg.card_fee_pct) || 0;
  return Math.ceil(((base + f) / (1 - p / 100) - base) * 100 - 1e-6) / 100;
}

async function vEvent(id) {
  loading();
  const [ev, cfg] = await Promise.all([
    sb.from('events').select(EV_PUBLIC).eq('id', id).maybeSingle().then(must),
    getSettings()
  ]);
  if (!ev) return vMessage('Evento não encontrado', 'Ele pode ter sido removido ou ainda não foi publicado.');
  const online = !!cfg.payments_enabled;
  const types = sortTypes(ev.ticket_types);
  const cart = {};
  let method = 'pix';
  let inst = 1;
  const maxInst = Math.max(1, Math.min(12, Number(ev.max_installments) || 1));
  let coupon = null;
  const past = isPast(ev);
  // Desconto de um ingresso (mesma regra do banco: coupon_ticket_discount)
  const ticketDiscount = (t, kind, unit) => {
    if (!coupon) return 0;
    if (coupon.ticket_type_ids && !coupon.ticket_type_ids.includes(t.id)) return 0;
    if (kind === 'meia' && !coupon.include_half) return 0;
    return coupon.type === 'percent' ? Math.round(unit * Number(coupon.value)) / 100 : Math.min(Number(coupon.value), unit);
  };
  const inCart = tid => (cart[tid + '|inteira'] || 0) + (cart[tid + '|meia'] || 0);
  const lines = () => {
    const out = [];
    for (const t of types) for (const kind of ['inteira', 'meia']) {
      const q = cart[t.id + '|' + kind] || 0;
      if (q) { const unit = kind === 'meia' ? half(t.price) : Number(t.price); out.push({ t, kind, qty: q, unit, disc: ticketDiscount(t, kind, unit) }); }
    }
    const subtotal = out.reduce((a, l) => a + l.unit * l.qty, 0);
    const discount = Math.round(out.reduce((a, l) => a + l.disc * l.qty, 0) * 100) / 100;
    const fee = Math.round(subtotal * Number(ev.fee_pct)) / 100;   // taxa de serviço sobre o preço cheio
    const pfee = payFee(subtotal - discount + fee, method, cfg, method === 'card' ? inst : 1);
    return { out, subtotal, discount, fee, pfee, total: subtotal - discount + fee + pfee, count: out.reduce((a, l) => a + l.qty, 0) };
  };

  const drawLots = () => {
    document.getElementById('lots').innerHTML = types.length ? types.map(t => {
      const st = lotState(t);
      const left = t.capacity != null && t.sold != null ? Math.max(0, t.capacity - t.sold) : null;
      const status = st === 'soldout' ? ' · <span style="color:var(--bad)">esgotado</span>'
        : st === 'soon' ? ` · vendas a partir de ${esc(fmtDT(t.sales_start))}`
        : st === 'ended' ? ' · vendas encerradas'
        : (left != null ? ` · restam ${num(left)}` : '') + (t.sales_end ? ` · até ${esc(fmtDT(t.sales_end))}` : '');
      return [['inteira', Number(t.price)], ...(t.allows_half ? [['meia', half(t.price)]] : [])].map(([kind, price]) => {
        const k = t.id + '|' + kind, q = cart[k] || 0;
        const full = st !== 'on' || inCart(t.id) >= Math.min(left ?? 10, 10);
        return `<div class="lot"><div><div class="name">${esc(t.name)}${kind === 'meia' ? ' · Meia-entrada' : ''}</div>
          <div class="price">${money(price)}${status}</div></div>
          ${past ? '' : `<div class="stepper"><button data-act="dec" data-k="${esc(k)}" ${q ? '' : 'disabled'} aria-label="Remover um">−</button><span>${q}</span><button data-act="inc" data-k="${esc(k)}" ${full ? 'disabled' : ''} aria-label="Adicionar um">+</button></div>`}</div>`;
      }).join('');
    }).join('') : '<p class="note">Os lotes ainda não foram cadastrados.</p>';
  };
  const drawSummary = () => {
    const c = lines();
    document.getElementById('summary').innerHTML = c.count
      ? `<div class="sum">${c.out.map(l => `<div><span>${l.qty}× ${esc(l.t.name)}${l.kind === 'meia' ? ' (meia)' : ''}</span><span>${money(l.unit * l.qty)}</span></div>`).join('')}
        ${coupon ? `<div style="color:var(--ok)"><span>Cupom ${esc(coupon.code)}</span><span>${c.discount ? '−' + money(c.discount) : 'não vale para estes ingressos'}</span></div>` : ''}
        <div class="note"><span>Taxa de serviço (${num(ev.fee_pct)}%)</span><span>${money(c.fee)}</span></div>
        ${online && c.pfee ? `<div class="note"><span>Taxa do ${method === 'pix' ? 'Pix' : 'cartão'}</span><span>${money(c.pfee)}</span></div>` : ''}
        <div class="total"><span>Total</span><span>${money(c.total)}</span></div>
        ${online && method === 'card' && inst > 1 ? `<div class="note"><span>Em ${inst}× no cartão</span><span>${fmtParcelas(c.total, inst)}</span></div>` : ''}</div>`
      : '<p class="note">Adicione ingressos para ver o total.</p>';
    if (online) {
      const base = c.subtotal - c.discount + c.fee;
      document.querySelectorAll('[data-method-total]').forEach(el => {
        el.textContent = c.count ? money(base + payFee(base, el.dataset.methodTotal, cfg)) + (el.dataset.methodTotal === 'card' && maxInst > 1 ? ` · até ${maxInst}×` : '') : '';
      });
      // Parcelas: valor de cada opção, com a tarifa da faixa
      const box = document.getElementById('inst-box');
      if (box) {
        box.hidden = !(method === 'card' && maxInst > 1);
        const sel = document.getElementById('buyer-inst');
        if (sel && c.count) sel.innerHTML = Array.from({ length: maxInst }, (_, i) => i + 1).map(n => {
          const t = base + payFee(base, 'card', cfg, n);
          return `<option value="${n}" ${n === inst ? 'selected' : ''}>${n === 1 ? `À vista · ${money(t)}` : `${fmtParcelas(t, n)} · total ${money(t)}`}</option>`;
        }).join('');
      }
    }
    const btn = document.getElementById('buy-btn');
    if (btn) { btn.disabled = !c.count; btn.textContent = !c.count ? (online ? 'Ir para o pagamento' : 'Confirmar pedido') : online ? `Pagar ${money(c.total)}` : `Confirmar ${c.count} ingresso${c.count > 1 ? 's' : ''}`; }
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
          <div class="field"><label for="coupon-code">Cupom de desconto</label>
            <div class="row" id="coupon-box"><input id="coupon-code" class="input" autocomplete="off" autocapitalize="characters" placeholder="Se tiver, digite aqui" style="flex:1;min-width:0"><button class="btn" type="button" data-act="coupon">Aplicar</button></div></div>
          ${online ? `
          <div class="field"><span class="label">Forma de pagamento</span>
            <div class="paychoice">
              <label><input type="radio" name="method" value="pix" data-change="method" checked><span><b>Pix</b><small data-method-total="pix"></small></span></label>
              <label><input type="radio" name="method" value="card" data-change="method"><span><b>Cartão de crédito</b><small data-method-total="card"></small></span></label>
            </div></div>
          ${maxInst > 1 ? `<div class="field" id="inst-box" hidden><label for="buyer-inst">Parcelas no cartão</label><select id="buyer-inst" name="installments" data-change="inst"><option value="1">À vista</option></select></div>` : ''}
          <div class="field"><label for="buyer-doc">CPF de quem paga</label><input id="buyer-doc" name="document" inputmode="numeric" autocomplete="off" required placeholder="000.000.000-00" data-input="doc"></div>
          <button class="btn primary" id="buy-btn" type="submit" disabled>Ir para o pagamento</button>
          <p class="note">As vagas ficam reservadas por ${num(cfg.reservation_minutes || 15)} minutos enquanto você paga. Os ingressos com QR Code aparecem assim que o pagamento for aprovado.</p>
          <p class="note">Cancelamento: devolução integral em até 7 dias da compra; depois, desconta as taxas. Pedidos até 48 horas antes do evento. Evento cancelado pela organização: devolução integral. <a href="#/ajuda">Saiba mais</a>.</p>`
          : `<button class="btn primary" id="buy-btn" type="submit" disabled>Confirmar pedido</button>
          <p class="note">A reserva fica registrada e os códigos de entrada são emitidos na hora. O pagamento é combinado com quem organiza o evento.</p>`}
        </form>`
        : `<div class="msg info">Entre na sua conta ou crie uma para comprar.</div><button class="btn primary" data-act="login">Entrar para comprar</button>`}
    </div>
  </div>`, {
    inc: b => { cart[b.dataset.k] = (cart[b.dataset.k] || 0) + 1; drawLots(); drawSummary(); },
    dec: b => { cart[b.dataset.k] = Math.max(0, (cart[b.dataset.k] || 0) - 1); drawLots(); drawSummary(); },
    login: () => requireLogin(),
    'change:method': el => { method = el.value; if (method !== 'card') inst = 1; drawSummary(); },
    'change:inst': el => { inst = Math.max(1, Math.min(maxInst, Number(el.value) || 1)); drawSummary(); },
    coupon: async () => {
      const box = document.getElementById('coupon-box');
      if (coupon) { coupon = null; box.innerHTML = '<input id="coupon-code" class="input" autocomplete="off" autocapitalize="characters" placeholder="Se tiver, digite aqui" style="flex:1;min-width:0"><button class="btn" type="button" data-act="coupon">Aplicar</button>'; return drawSummary(); }
      const code = document.getElementById('coupon-code').value.trim();
      if (!code) return;
      const { data, error } = await sb.rpc('check_coupon', { p_event: ev.id, p_code: code });
      if (error) return toast(errMsg(error), 'bad');
      coupon = data;
      box.innerHTML = `<span class="chip ok" style="align-self:center">Cupom ${esc(data.code)}: ${data.type === 'percent' ? num(data.value) + '%' : money(data.value) + ' por ingresso'}</span><button class="btn small" type="button" data-act="coupon">Remover</button>`;
      drawSummary();
      if (!lines().discount && lines().count) toast('O cupom foi aplicado, mas não vale para os ingressos escolhidos.', 'bad');
    },
    'input:doc': el => { const d = digits(el.value).slice(0, 14); el.value = d.length === 11 ? fmtDoc('PF', d) : d.length === 14 ? fmtDoc('PJ', d) : d; }
  }, {
    buy: async fd => {
      const c = lines(); if (!c.count) return;
      const doc = digits(fd.get('document'));
      if (online && !(doc.length === 11 ? validCPF(doc) : doc.length === 14 ? validCNPJ(doc) : false)) return toast('CPF inválido. Confira os números.', 'bad');
      const items = c.out.map(l => ({ type_id: l.t.id, kind: l.kind, qty: l.qty }));
      const { data, error } = await sb.rpc('buy_tickets', { p_event: ev.id, p_items: items, p_buyer_name: String(fd.get('name') || '').trim(), p_buyer_email: String(fd.get('email') || '').trim(), p_method: online ? method : null, p_coupon: coupon ? coupon.code : null, p_installments: online && method === 'card' ? inst : 1 });
      if (error) { toast(errMsg(error), 'bad'); return vEvent(id); }
      if (online) { try { sessionStorage.setItem('doc:' + data, doc); } catch (_) {} }
      go((online ? '#/pagamento/' : '#/pedido/') + data);
    }
  });
  drawLots(); drawSummary();
}

/* ================= dúvidas frequentes ================= */
const FAQ = [
  ['Como compro um ingresso?', 'Escolha o evento, os lotes e a quantidade, entre na sua conta e pague com Pix ou cartão. As vagas ficam reservadas enquanto você paga.'],
  ['Quais são as formas de pagamento?', 'Pix e cartão de crédito. Alguns eventos aceitam parcelar no cartão; o número máximo de parcelas é definido por quem organiza e aparece na hora de pagar, com o valor de cada parcela.'],
  ['O que é a taxa de serviço?', 'É o valor cobrado pela plataforma pela venda online, mostrado no resumo do pedido antes de pagar. A tarifa do Pix ou do cartão também aparece separada no resumo.'],
  ['Posso desistir da compra?', 'Sim, até 48 horas antes do início do evento. Dentro de 7 dias corridos após a compra, a devolução é integral, com todas as taxas, conforme o art. 49 do Código de Defesa do Consumidor. Depois desse prazo, o reembolso desconta a taxa de serviço e a tarifa do Pix ou do cartão. Com menos de 48 horas para o evento, não há cancelamento pelo comprador.'],
  ['E se o evento for cancelado?', 'Se a organização cancelar o evento, você recebe de volta o valor pago integralmente, incluindo todas as taxas.'],
  ['E se o evento for adiado?', 'A organização avisa a nova data. Se você não puder ir, pode pedir o cancelamento nas mesmas condições de desistência.'],
  ['Onde ficam meus ingressos?', 'Em “Meus ingressos”, assim que o pagamento é aprovado. Cada ingresso tem um QR Code, que é lido na entrada. Cada código vale uma entrada.'],
  ['Comprei meia-entrada. O que preciso levar?', 'O documento que comprova o direito à meia-entrada (Lei 12.933/2013). Ele é conferido na entrada.'],
  ['O prazo para pagar acabou. E agora?', 'As vagas voltam para a venda e a cobrança é cancelada. Se ainda houver ingressos, faça um novo pedido.'],
];
function vHelp() {
  mount(`<div class="page-head"><div><div class="eyebrow">Ajuda</div><h1>Dúvidas frequentes</h1>
      <p>Compras, pagamentos, cancelamentos e ingressos.</p></div></div>
    <div class="panel medium" style="width:100%">${FAQ.map(([q, a]) => `<details><summary><b>${esc(q)}</b></summary><p>${esc(a)}</p></details>`).join('')}</div>`);
}

function passList(tickets) {
  return `<div class="passes">${[...(tickets || [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map(t => `
    <div class="pass ${t.checked_in_at ? 'used' : ''}">
      <button class="qr" type="button" data-zoom="${esc(t.code)}" aria-label="Ampliar QR Code do ingresso ${esc(t.code)}"><span data-qr="${esc(t.code)}"></span></button>
      <div class="pass-info"><div class="code">${esc(t.code)}</div><div class="note">${esc(t.type_name)}${t.kind === 'meia' ? ' · Meia-entrada (leve documento)' : ''}</div>
      ${t.checked_in_at ? `<span class="chip">Utilizado ${esc(fmtShort(t.checked_in_at))}</span>` : '<span class="chip ok">Válido · toque no QR para ampliar</span>'}</div>
    </div>`).join('')}</div>`;
}

const ORDER_FIELDS = 'id,code,status,expires_at,payment_method,subtotal,fee,payment_fee,total,created_at,buyer_name,events(id,name,starts_at,venue,city),tickets(code,type_name,kind,checked_in_at)';
const ORDER_STATUS = {
  pending: ['Aguardando pagamento', ''], confirmed: ['Pago', 'ok'], expired: ['Reserva expirada', 'bad'], canceled: ['Cancelado', 'bad'],
  refunded: ['Estornado', 'bad'], refund_needed: ['Pago fora do prazo · devolução pendente', 'bad']
};
const statusChip = s => { const [t, k] = ORDER_STATUS[s] || [s, '']; return `<span class="chip ${k}">${esc(t)}</span>`; };

async function vOrder(id) {
  loading();
  const o = must(await sb.from('orders').select(ORDER_FIELDS).eq('id', id).maybeSingle());
  if (!o) return vMessage('Pedido não encontrado', 'Confira em “Meus ingressos”.');
  if (o.status !== 'confirmed') return go('#/pagamento/' + id);
  mount(`<div class="panel medium" style="width:100%">
    <div class="msg ok">Pedido ${esc(o.code)} confirmado. Mostre os códigos abaixo na entrada.</div>
    <div class="row between"><h2>${esc(o.events?.name)}</h2><span class="note">${esc(fmtLong(o.events?.starts_at))}</span></div>
    <p class="note">Em nome de <b>${esc(o.buyer_name)}</b> · ${esc(o.events?.venue || '')} · Total ${money(o.total)}</p>
    ${passList(o.tickets)}
    <div class="row"><a class="btn" href="#/meus-ingressos">Ver todos os meus ingressos</a><a class="btn" href="#/evento/${esc(o.events?.id)}">Comprar mais</a></div>
  </div>`);
  drawQRs();
}

async function invokeFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  let msg = '';
  try { msg = (await error.context?.json())?.error || ''; } catch (_) {}
  throw new Error(msg || 'Não foi possível falar com o serviço de pagamento. Tente de novo em instantes.');
}

async function vPay(id) {
  loading();
  const FIELDS = 'id,code,status,expires_at,payment_method,installments,subtotal,discount,coupon_code,fee,payment_fee,total,provider_data,events(id,name,starts_at)';
  let o = must(await sb.from('orders').select(FIELDS).eq('id', id).maybeSingle());
  if (!o) return vMessage('Pedido não encontrado', 'Confira em “Meus ingressos”.');
  if (o.status === 'confirmed') return go('#/pedido/' + id);
  let timer = null, poll = null;
  teardown = () => { clearInterval(timer); clearInterval(poll); };
  const head = `<div><a class="linkbtn" href="#/evento/${esc(o.events?.id)}">← ${esc(o.events?.name)}</a></div>`;
  if (o.status !== 'pending') {
    return mount(head + `<div class="panel medium" style="width:100%">${statusChip(o.status)}
      <h2>${o.status === 'expired' ? 'O prazo para pagar acabou' : o.status === 'refund_needed' ? 'Pagamento recebido depois do prazo' : 'Pedido sem pagamento'}</h2>
      <p class="note">${o.status === 'expired' ? 'As vagas voltaram para a venda. Faça um novo pedido se ainda houver ingressos.' : o.status === 'refund_needed' ? 'Os ingressos esgotaram antes de o pagamento chegar. A organização vai devolver o valor.' : 'Este pedido foi cancelado ou estornado.'}</p>
      <a class="btn primary" href="#/evento/${esc(o.events?.id)}">Voltar ao evento</a></div>`);
  }
  const card = o.payment_method === 'card';
  const summary = `<div class="sum"><div><span>Ingressos</span><span>${money(o.subtotal)}</span></div>${Number(o.discount) ? `<div style="color:var(--ok)"><span>Cupom ${esc(o.coupon_code)}</span><span>−${money(o.discount)}</span></div>` : ''}<div class="note"><span>Taxa de serviço</span><span>${money(o.fee)}</span></div>
    ${Number(o.payment_fee) ? `<div class="note"><span>Taxa do ${card ? 'cartão' : 'Pix'}</span><span>${money(o.payment_fee)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${money(o.total)}</span></div>
    ${card && o.installments > 1 ? `<div class="note"><span>Em ${o.installments}× no cartão</span><span>${fmtParcelas(Number(o.total), o.installments)}</span></div>` : ''}</div>`;
  const tick = () => {
    const el = document.getElementById('countdown'); if (!el) return;
    const ms = new Date(o.expires_at).getTime() - Date.now();
    if (ms <= 0) { el.textContent = 'Prazo encerrado'; clearInterval(timer); return; }
    el.textContent = `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
  };
  const drawPayment = p => {
    const box = document.getElementById('paybox');
    if (!p) return;
    if (p.pix) {
      box.innerHTML = `<div class="pixbox"><img alt="QR Code Pix para pagamento" src="data:image/png;base64,${esc(p.pix.qrImage)}"></div>
        <p class="note">Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou use o código "copia e cola":</p>
        <div class="row"><input class="input mono" id="pix-code" readonly value="${esc(p.pix.payload)}" aria-label="Código Pix copia e cola" style="flex:1;min-width:0"><button class="btn" type="button" data-act="copy">Copiar código</button></div>`;
    } else if (p.checkout_url && /^https:\/\//.test(p.checkout_url)) {
      box.innerHTML = `<p>O pagamento com cartão acontece na página segura do meio de pagamento.</p>
        <a class="btn primary" href="${esc(p.checkout_url)}" target="_blank" rel="noopener">Pagar com cartão</a>
        <p class="note">Depois de pagar, volte para esta aba. Os ingressos aparecem aqui sozinhos.</p>`;
    }
  };
  const start = async doc => {
    document.getElementById('paybox').innerHTML = '<p class="note">Gerando a cobrança…</p>';
    try {
      const r = await invokeFn('checkout', { order_id: id, document: doc });
      if (r.status && r.status !== 'pending') return vPay(id);
      drawPayment(r.payment);
    } catch (e) { document.getElementById('paybox').innerHTML = `<div class="msg bad">${esc(e.message)}</div>${docForm}`; }
  };
  const docForm = `<form data-form="doc" class="row"><input class="input" name="document" inputmode="numeric" placeholder="CPF de quem paga" aria-label="CPF de quem paga" required style="flex:1;min-width:0"><button class="btn primary" type="submit">Gerar pagamento</button></form>`;
  mount(head + `<div class="detail">
    <div class="panel"><div class="row between"><h2>${card ? 'Pagamento com cartão' : 'Pague com Pix'}</h2><span class="chip">Pedido ${esc(o.code)}</span></div>
      <div class="msg info">Reserva válida por <b id="countdown">--:--</b>. Depois disso as vagas voltam para a venda.</div>
      <div id="paybox"></div>
      <p class="note" id="wait">Aguardando a confirmação do pagamento… esta página atualiza sozinha.</p>
    </div>
    <div class="panel"><h2>${esc(o.events?.name)}</h2><p class="note">${esc(fmtLong(o.events?.starts_at))}</p>${summary}</div>
  </div>`, {
    copy: async () => {
      const el = document.getElementById('pix-code');
      try { await navigator.clipboard.writeText(el.value); toast('Código Pix copiado.'); } catch (_) { el.select(); toast('Selecione e copie o código.'); }
    }
  }, {
    doc: async fd => {
      const d = digits(fd.get('document'));
      if (!(d.length === 11 ? validCPF(d) : d.length === 14 ? validCNPJ(d) : false)) return toast('CPF inválido. Confira os números.', 'bad');
      await start(d);
    }
  });
  tick(); timer = setInterval(tick, 1000);
  if (o.provider_data) drawPayment(o.provider_data);
  else {
    let doc = ''; try { doc = sessionStorage.getItem('doc:' + id) || ''; } catch (_) {}
    if (doc) start(doc); else document.getElementById('paybox').innerHTML = docForm;
  }
  poll = setInterval(async () => {
    const { data } = await sb.from('orders').select('status').eq('id', id).maybeSingle();
    if (data && data.status !== 'pending') { clearInterval(poll); clearInterval(timer); if (data.status === 'confirmed') toast('Pagamento aprovado!'); vPay(id); }
    else if (new Date(o.expires_at).getTime() < Date.now() - 5000) { await sb.rpc('release_expired', { p_event: null }); }
  }, 4000);
}

async function vMyTickets() {
  loading();
  const orders = must(await sb.from('orders').select(ORDER_FIELDS).eq('buyer_id', me.user.id).neq('status', 'canceled').order('created_at', { ascending: false }));
  const head = `<div class="page-head"><div><div class="eyebrow">Carteira</div><h1>Meus ingressos</h1><p>Cada código vale uma entrada. Depois de validado na porta, o ingresso aparece como utilizado.</p></div></div>`;
  if (!orders.length) return mount(head + `<div class="empty"><h2>Você ainda não tem ingressos</h2><p>Escolha um evento na programação.</p><a class="btn primary" href="#/">Ver eventos</a></div>`);
  mount(head + orders.map(o => `<div class="panel">
    <div class="row between"><h2>${esc(o.events?.name)}</h2><span class="row">${o.status !== 'confirmed' ? statusChip(o.status) : ''}<span class="note mono">Pedido ${esc(o.code)}</span></span></div>
    <p class="note">${esc(fmtLong(o.events?.starts_at))} · ${esc(o.events?.venue || '')} · ${money(o.total)}</p>
    ${o.status === 'confirmed' ? passList(o.tickets)
      : o.status === 'pending' && new Date(o.expires_at) > new Date() ? `<a class="btn primary" href="#/pagamento/${esc(o.id)}">Concluir pagamento</a>`
      : `<p class="note">${o.status === 'refund_needed' ? 'O pagamento chegou depois de os ingressos esgotarem. A organização vai devolver o valor.' : 'Este pedido não gerou ingressos.'}</p>`}</div>`).join(''));
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
  const [evs, cfg] = await Promise.all([
    sb.from('events').select(EV_OWNER + ',organizer_id').in('organizer_id', ids).order('starts_at', { ascending: false }).then(must),
    getSettings()
  ]);
  const charge = fmtCharge({ platform_fee_type: cfg.default_platform_type, platform_pct: cfg.default_platform_pct, platform_fee_fixed: cfg.default_platform_fixed });
  mount(`<div class="page-head"><div><div class="eyebrow">${esc(me.organizers.map(orgName).join(' · '))}</div><h1>Meus eventos</h1>
      <p>Crie eventos, edite informações e lotes, e acompanhe vendas, despesas e entradas.</p></div>
      <div class="row"><a class="btn" href="#/painel/equipe">Equipe de portaria</a><a class="btn" href="#/painel/dados">Dados cadastrais e de recebimento</a></div></div>
    <details class="panel" ${evs.length ? '' : 'open'}><summary>+ Criar evento</summary>
      <form data-form="new" class="formgrid">
        <div class="field full"><label for="pn-name">Nome do evento</label><input id="pn-name" name="name" required></div>
        <div class="field"><label for="pn-date">Data e hora</label><input id="pn-date" name="starts_at" type="datetime-local" required></div>
        ${me.organizers.length > 1 ? `<div class="field"><label for="pn-org">Organizador</label><select id="pn-org" name="organizer_id">${me.organizers.map(o => `<option value="${esc(o.id)}">${esc(orgName(o))}</option>`).join('')}</select></div>` : `<input type="hidden" name="organizer_id" value="${esc(ids[0])}">`}
        <div class="field"><label for="pn-venue">Local</label><input id="pn-venue" name="venue"></div>
        <div class="field"><label for="pn-city">Cidade / UF</label><input id="pn-city" name="city"></div>
        ${instField(1, 'pn')}
        <p class="note full">Cobranças definidas pela plataforma: taxa de serviço de ${num(cfg.default_fee_pct)}% paga pelo comprador e ${esc(charge)}.</p>
        <div class="full row"><button class="btn primary" type="submit">Criar e configurar lotes</button><span class="note">O evento nasce como rascunho. Publique depois de cadastrar os lotes.</span></div>
      </form>
    </details>
    ${evs.length ? `<div class="grid">${evs.map(ev => ticketCard(ev, `#/painel/evento/${ev.id}/info`)).join('')}</div>`
      : '<div class="empty"><h2>Nenhum evento ainda</h2><p>Crie o primeiro evento acima.</p></div>'}`, {}, {
    new: async fd => {
      const starts = fromLocalInput(fd.get('starts_at'));
      if (!starts) return toast('Informe a data e a hora.', 'bad');
      const ev = must(await sb.from('events').insert({ name: String(fd.get('name')).trim(), starts_at: starts, organizer_id: fd.get('organizer_id'), venue: String(fd.get('venue')).trim(), city: String(fd.get('city')).trim(), max_installments: readInst(fd) }).select('id').single());
      toast('Evento criado. Agora cadastre os lotes.'); go(`#/painel/evento/${ev.id}/lotes`);
    }
  });
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
    <div class="field full"><label for="o-wallet-${esc(o.id || 'n')}">Recebimento online: Wallet ID da conta Asaas</label><input id="o-wallet-${esc(o.id || 'n')}" name="payout_account" class="mono" autocomplete="off" placeholder="ex.: 0b3a1c2d-…" value="${esc(o.payout_account || '')}">
      <span class="note">É para onde vai a sua parte das vendas online, automaticamente. Fica no Asaas, em Integrações → Wallet ID. Sem ele, os eventos não vendem online.</span></div>
  </div>`;
}
const orgEditablePayload = fd => ({ ...Object.fromEntries(['trade_name', 'phone', 'pix_key', 'bank_name', 'bank_agency', 'bank_account', 'payout_account'].map(k => [k, String(fd.get(k) || '').trim()])), payout_provider: 'asaas' });

/* ================= gestão de um evento (organizador e admin) ================= */
const MANAGE_TABS = [['info', 'Informações'], ['lotes', 'Lotes'], ['cupons', 'Cupons'], ['financeiro', 'Financeiro'], ['pedidos', 'Pedidos'], ['entrada', 'Entrada']];

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
  if (tab === 'cupons') return mCoupons(ev, header, reload);
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
      ${admin ? `<div class="field"><label for="e-fee">Taxa de serviço cobrada do comprador (%)</label><input id="e-fee" name="fee_pct" type="number" min="0" max="30" step="0.5" value="${esc(ev.fee_pct)}"></div>` : ''}
      <div class="field"><label for="e-venue">Local</label><input id="e-venue" name="venue" value="${esc(ev.venue)}"></div>
      <div class="field"><label for="e-city">Cidade / UF</label><input id="e-city" name="city" value="${esc(ev.city)}"></div>
      ${instField(ev.max_installments, 'e')}
      <div class="field full"><label for="e-desc">Descrição</label><textarea id="e-desc" name="description" rows="5">${esc(ev.description)}</textarea></div>
      ${admin ? `
      <div class="field"><label for="e-org">Organizador responsável</label><select id="e-org" name="organizer_id"><option value="">Sem organizador</option>${orgs.map(o => `<option value="${esc(o.id)}" ${o.id === ev.organizer_id ? 'selected' : ''}>${esc(orgName(o))} (${o.person_type})</option>`).join('')}</select></div>
      ${chargeFields({ type: ev.platform_fee_type, pct: ev.platform_pct, fixed: ev.platform_fee_fixed }, 'e')}`
      : `<p class="note full">Cobranças definidas pela plataforma: taxa de serviço de ${num(ev.fee_pct)}% paga pelo comprador e ${esc(fmtCharge(ev))}. Só a administração altera.</p>`}
      <label class="check full"><input type="checkbox" name="published" ${ev.published ? 'checked' : ''}> Publicado: aparece na vitrine e aceita compras</label>
    </div>
    <div class="row between"><button class="btn primary" type="submit">Salvar informações</button>
      <button class="btn danger" type="button" data-act="del">Excluir evento</button></div>
  </form>`, {
    'change:ptype-fee': chargeToggle,
    del: async b => {
      if (!armed) { armed = true; b.classList.add('armed'); b.textContent = 'Clique de novo para excluir'; return; }
      const { error } = await sb.from('events').delete().eq('id', ev.id);
      if (error) return toast(/foreign key/i.test(error.message) ? 'Este evento já tem ingressos vendidos e não pode ser excluído. Despublique para encerrar as vendas.' : errMsg(error), 'bad');
      toast('Evento excluído.'); go(admin ? '#/admin/eventos' : '#/painel');
    }
  }, {
    info: async fd => {
      const starts = fromLocalInput(fd.get('starts_at'));
      if (!starts) return toast('Informe a data e a hora.', 'bad');
      const body = { name: String(fd.get('name')).trim(), starts_at: starts, venue: String(fd.get('venue')).trim(), city: String(fd.get('city')).trim(), description: String(fd.get('description')).trim(), published: fd.get('published') === 'on', max_installments: readInst(fd) };
      if (admin) Object.assign(body, { organizer_id: fd.get('organizer_id') || null, fee_pct: Number(fd.get('fee_pct')) || 0 }, readCharge(fd));
      if (body.published && !(ev.ticket_types || []).length) toast('Lembre de cadastrar os lotes na aba “Lotes”.');
      must(await sb.from('events').update(body).eq('id', ev.id));
      toast('Informações salvas.'); reload();
    }
  });
}

function mLotes(ev, header, reload) {
  const types = sortTypes(ev.ticket_types);
  const stLabel = { on: 'à venda', soon: 'ainda não começou', ended: 'período encerrado', soldout: 'esgotado' };
  // Segunda linha do lote: período de vendas e se o comprador vê a quantidade
  const extra = (t, p) => `<div class="typerow lotextra">
    <div class="field"><label for="${p}-start">Início das vendas (opcional)</label><input id="${p}-start" name="sales_start" type="datetime-local" value="${esc(toLocalInput(t?.sales_start))}"></div>
    <div class="field"><label for="${p}-end">Fim das vendas (opcional)</label><input id="${p}-end" name="sales_end" type="datetime-local" value="${esc(toLocalInput(t?.sales_end))}"></div>
    <label class="check" style="grid-column:span 3;padding-bottom:9px"><input type="checkbox" name="show_remaining" ${t?.show_remaining ? 'checked' : ''}> Mostrar ao comprador quantos ingressos restam</label>
  </div>`;
  const row = (t, i) => `<form class="lotbox" data-form="type" data-id="${esc(t.id)}">
    <div class="typerow">
    <div class="field"><label for="t-name-${i}">Nome do lote / setor <span class="note">(${stLabel[lotState(t)]})</span></label><input id="t-name-${i}" name="name" required value="${esc(t.name)}"></div>
    <div class="field"><label for="t-price-${i}">Preço inteira (R$)</label><input id="t-price-${i}" name="price" type="number" min="0" step="0.01" required value="${esc(t.price)}"></div>
    <div class="field"><label for="t-cap-${i}">Quantidade (vendidos: ${num(t.sold)})</label><input id="t-cap-${i}" name="capacity" type="number" min="${t.sold}" step="1" required value="${esc(t.capacity)}"></div>
    <label class="check" style="padding-bottom:9px"><input type="checkbox" name="allows_half" ${t.allows_half ? 'checked' : ''}> Meia</label>
    <div class="row" style="padding-bottom:2px"><button class="btn small" type="submit">Salvar</button>${t.sold ? '' : `<button class="btn small danger" type="button" data-act="del" data-id="${esc(t.id)}" aria-label="Excluir lote">Excluir</button>`}</div>
    </div>${extra(t, 't' + i)}
  </form>`;
  const read = fd => {
    const start = fromLocalInput(String(fd.get('sales_start') || '')), end = fromLocalInput(String(fd.get('sales_end') || ''));
    if (start && end && new Date(end) <= new Date(start)) throw new Error('O fim das vendas precisa ser depois do início.');
    return { name: String(fd.get('name')).trim(), price: Number(fd.get('price')) || 0, capacity: Math.max(0, Math.floor(Number(fd.get('capacity')) || 0)),
             allows_half: fd.get('allows_half') === 'on', sales_start: start, sales_end: end, show_remaining: fd.get('show_remaining') === 'on' };
  };
  mount(header + `<div class="panel">
    <div><h2>Lotes e setores</h2><p class="note">A meia-entrada custa metade da inteira e usa a mesma quantidade do lote. Cada lote para de vender no que vier primeiro: acabar a quantidade ou passar o fim do período. Por padrão, o comprador não vê quantos ingressos restam. Lotes com vendas não podem ser excluídos; diminua a quantidade até o total vendido para encerrar.</p></div>
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
    ${extra(null, 'nt')}
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

async function mCoupons(ev, header, reload) {
  const [coupons, orders] = await Promise.all([
    sb.from('coupons').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }).then(must),
    sb.from('orders').select('coupon_id,status,discount').eq('event_id', ev.id).not('coupon_id', 'is', null).then(must)
  ]);
  const types = sortTypes(ev.ticket_types);
  const typeName = id => types.find(t => t.id === id)?.name || 'lote removido';
  const uses = id => orders.filter(o => o.coupon_id === id && (o.status === 'confirmed' || o.status === 'pending')).length;
  const given = id => orders.filter(o => o.coupon_id === id && o.status === 'confirmed').reduce((a, o) => a + Number(o.discount), 0);
  const armed = new Set();
  const state = c => !c.active ? ['Desativado', ''] : c.valid_until && new Date(c.valid_until) < new Date() ? ['Expirado', 'bad'] : c.max_uses && uses(c.id) >= c.max_uses ? ['Esgotado', 'bad'] : ['Ativo', 'ok'];
  mount(header + `
  <form class="panel medium" data-form="new"><div><h2>Novo cupom</h2>
    <p class="note">O desconto sai da parte de quem organiza: a taxa de serviço e a cobrança da plataforma continuam calculadas sobre o preço cheio.</p></div>
    <div class="formgrid">
      <div class="field"><label for="cp-code">Código</label><input id="cp-code" name="code" required maxlength="30" autocomplete="off" autocapitalize="characters" placeholder="AMIGOS20" data-input="cpcode"></div>
      <div class="field"><label for="cp-type">Tipo de desconto</label><select id="cp-type" name="discount_type"><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo por ingresso (R$)</option></select></div>
      <div class="field"><label for="cp-value">Desconto</label><input id="cp-value" name="discount_value" type="number" min="0.01" step="0.01" required placeholder="20"></div>
      <div class="field"><label for="cp-until">Válido até (opcional)</label><input id="cp-until" name="valid_until" type="datetime-local"></div>
      <div class="field"><label for="cp-max">Limite de usos (opcional)</label><input id="cp-max" name="max_uses" type="number" min="1" step="1" placeholder="Sem limite"></div>
      <div class="field" style="align-content:end"><label class="check"><input type="checkbox" name="once_per_buyer"> Cada pessoa usa só uma vez</label></div>
      <div class="field full"><span class="label">Vale para quais lotes (nenhum marcado = todos)</span>
        <div class="row" style="gap:6px 18px">${types.map(t => `<label class="check"><input type="checkbox" name="types" value="${esc(t.id)}"> ${esc(t.name)}</label>`).join('') || '<span class="note">Cadastre os lotes primeiro.</span>'}</div></div>
      <label class="check full"><input type="checkbox" name="include_half" checked> Vale também para meia-entrada</label>
    </div>
    <div><button class="btn primary" type="submit">Criar cupom</button></div>
  </form>
  <div class="panel"><h2>${num(coupons.length)} cupo${coupons.length === 1 ? 'm' : 'ns'}</h2>
    ${coupons.length ? `<div class="tablewrap"><table><thead><tr><th>Código</th><th>Desconto</th><th>Vale para</th><th class="num">Usos</th><th class="num">Descontado</th><th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>
      ${coupons.map(c => { const [st, k] = state(c), u = uses(c.id); return `<tr>
        <td class="mono"><b>${esc(c.code.toUpperCase())}</b></td>
        <td>${c.discount_type === 'percent' ? num(c.discount_value) + '%' : money(c.discount_value) + ' / ingresso'}</td>
        <td>${esc(c.ticket_type_ids ? c.ticket_type_ids.map(typeName).join(', ') : 'Todos os lotes')}<div class="note">${c.include_half ? 'inclui meia' : 'sem meia'}${c.once_per_buyer ? ' · 1 por pessoa' : ''}</div></td>
        <td class="num">${num(u)}${c.max_uses ? ' / ' + num(c.max_uses) : ''}</td>
        <td class="num">${money(given(c.id))}</td>
        <td>${c.valid_until ? esc(fmtShort(c.valid_until)) : '<span class="note">sem prazo</span>'}</td>
        <td><span class="chip ${k}">${st}</span></td>
        <td class="num" style="white-space:nowrap"><button class="btn small" data-act="toggle" data-id="${esc(c.id)}" data-on="${c.active ? '1' : ''}">${c.active ? 'Desativar' : 'Ativar'}</button>
          ${u ? '' : `<button class="btn small danger" data-act="del" data-id="${esc(c.id)}">Excluir</button>`}</td></tr>`; }).join('')}
    </tbody></table></div><p class="note">Usos contam pedidos pagos e reservas em andamento. Cupom já usado não pode ser excluído; desative para encerrar.</p>`
    : '<p class="note">Nenhum cupom ainda.</p>'}
  </div>`, {
    'input:cpcode': el => { el.value = el.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); },
    toggle: async b => { const { error } = await sb.from('coupons').update({ active: !b.dataset.on }).eq('id', b.dataset.id); if (error) return toast(errMsg(error), 'bad'); toast(b.dataset.on ? 'Cupom desativado.' : 'Cupom ativado.'); reload(); },
    del: async b => {
      if (!armed.has(b.dataset.id)) { armed.add(b.dataset.id); b.classList.add('armed'); b.textContent = 'Confirmar'; return; }
      const { error } = await sb.from('coupons').delete().eq('id', b.dataset.id);
      if (error) return toast(errMsg(error), 'bad'); toast('Cupom excluído.'); reload();
    }
  }, {
    new: async fd => {
      const type = fd.get('discount_type'), value = Number(fd.get('discount_value'));
      if (!(value > 0)) return toast('Informe o valor do desconto.', 'bad');
      if (type === 'percent' && value > 100) return toast('O percentual vai até 100%.', 'bad');
      const ids = fd.getAll('types');
      const body = { event_id: ev.id, code: String(fd.get('code')).trim().toUpperCase(), discount_type: type, discount_value: value,
        ticket_type_ids: ids.length ? ids : null, include_half: fd.get('include_half') === 'on', once_per_buyer: fd.get('once_per_buyer') === 'on',
        max_uses: fd.get('max_uses') ? Math.max(1, Math.round(Number(fd.get('max_uses')))) : null,
        valid_until: fd.get('valid_until') ? fromLocalInput(fd.get('valid_until')) : null };
      const { error } = await sb.from('coupons').insert(body);
      if (error) return toast(/coupons_event_code_key/.test(error.message) ? 'Já existe um cupom com este código neste evento.' : errMsg(error), 'bad');
      toast('Cupom criado.'); reload();
    }
  });
}

async function mFinance(ev, header, reload) {
  const [orders, tickets, expenses] = await Promise.all([
    sb.from('orders').select('id,subtotal,discount,fee,total,payment_method,payment_fee,commission,split_fee,organizer_amount,status').eq('event_id', ev.id).eq('status', 'confirmed').then(must),
    sb.from('tickets').select('order_id,ticket_type_id,kind,unit_price,discount,orders!inner(status)').eq('event_id', ev.id).eq('orders.status', 'confirmed').then(must),
    sb.from('expenses').select('*').eq('event_id', ev.id).order('due_date', { ascending: true, nullsFirst: false }).then(must)
  ]);
  const discounts = orders.reduce((a, o) => a + Number(o.discount || 0), 0);
  const sales = orders.reduce((a, o) => a + Number(o.subtotal), 0) - discounts;
  const fees = orders.reduce((a, o) => a + Number(o.fee), 0);
  // Pedidos online guardam a cobrança calculada na compra; pedidos antigos/manuais são calculados aqui
  const manualCommission = o => ev.platform_fee_type === 'fixed'
    ? tickets.filter(t => t.order_id === o.id).length * Number(ev.platform_fee_fixed)
    : Number(o.subtotal) * Number(ev.platform_pct) / 100;
  const online = orders.filter(o => o.payment_method === 'pix' || o.payment_method === 'card');
  const commission = Math.round(orders.reduce((a, o) => a + (o.payment_method === 'manual' ? manualCommission(o) : Number(o.commission)), 0) * 100) / 100;
  const splitFees = orders.reduce((a, o) => a + Number(o.split_fee), 0);
  const payFees = orders.reduce((a, o) => a + Number(o.payment_fee), 0);
  const autoPaid = online.reduce((a, o) => a + Number(o.organizer_amount), 0);
  const payout = sales - commission - splitFees;
  const expTotal = expenses.reduce((a, x) => a + Number(x.amount), 0);
  const expOpen = expenses.filter(x => !x.paid).reduce((a, x) => a + Number(x.amount), 0);
  const result = payout - expTotal;
  const byType = sortTypes(ev.ticket_types).map(t => {
    const ts = tickets.filter(x => x.ticket_type_id === t.id);
    return { t, full: ts.filter(x => x.kind === 'inteira').length, half: ts.filter(x => x.kind === 'meia').length, rev: ts.reduce((a, x) => a + Number(x.unit_price) - Number(x.discount || 0), 0) };
  });
  const org = ev.organizers;
  mount(header + `
  <div class="kpis">
    <div class="kpi"><div class="v">${money(sales)}</div><div class="l">vendas de ingressos (${num(tickets.length)} emitidos)${discounts ? `, já descontados ${money(discounts)} de cupons` : ''}</div></div>
    <div class="kpi"><div class="v">${money(commission)}</div><div class="l">cobrança da plataforma (${esc(fmtCharge(ev))})</div></div>
    <div class="kpi strong"><div class="v">${money(payout)}</div><div class="l">repasse ao organizador${splitFees ? ` (já descontados ${money(splitFees)} de taxa de split)` : ''}</div></div>
    <div class="kpi"><div class="v">${money(expTotal)}</div><div class="l">despesas lançadas (${money(expOpen)} a pagar)</div></div>
    <div class="kpi strong"><div class="v" style="color:${result < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(result)}</div><div class="l">resultado (repasse − despesas)</div></div>
  </div>
  <p class="note">Taxas de serviço pagas pelos compradores: ${money(fees)}. Elas ficam com a plataforma e não entram no repasse.${payFees ? ` Taxas de Pix e cartão pagas pelos compradores: ${money(payFees)} (cobrem a tarifa do meio de pagamento).` : ''}</p>
  ${online.length ? `<div class="msg ok">${money(autoPaid)} de ${num(online.length)} pagamento${online.length > 1 ? 's' : ''} online já foram enviados automaticamente para a conta do organizador no meio de pagamento (split). Só pedidos pagos entram nestes números.</div>` : ''}
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
  const orders = must(await sb.from('orders').select('id,code,status,payment_method,coupon_code,discount,buyer_name,buyer_email,subtotal,fee,total,created_at,tickets(code,type_name,kind,checked_in_at)').eq('event_id', ev.id).order('created_at', { ascending: false }));
  const rows = q => orders.filter(o => !q || [o.code, o.buyer_name, o.buyer_email].some(v => String(v).toLowerCase().includes(q))).map(o => `<tr>
    <td class="mono">${esc(o.code)}</td><td>${esc(o.buyer_name)}${o.buyer_email ? `<div class="note">${esc(o.buyer_email)}</div>` : ''}</td>
    <td>${esc(Object.entries((o.tickets || []).reduce((m, t) => { const k = t.type_name + (t.kind === 'meia' ? ' (meia)' : ''); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => v + '× ' + k).join(', '))}</td>
    <td class="num">${num((o.tickets || []).filter(t => t.checked_in_at).length)}/${num((o.tickets || []).length)}</td>
    <td class="num">${money(o.total)}${o.coupon_code ? `<div class="note">cupom ${esc(o.coupon_code)} −${money(o.discount)}</div>` : ''}</td><td>${statusChip(o.status)}<div class="note">${esc({ pix: 'Pix', card: 'Cartão', manual: 'Combinado', free: 'Gratuito' }[o.payment_method] || '')}</div></td><td>${esc(fmtShort(o.created_at))}</td></tr>`).join('');
  mount(header + `<div class="panel">
    <div class="row between"><h2>${num(orders.length)} pedido${orders.length === 1 ? '' : 's'}</h2>
      <div class="row"><input class="input" style="width:240px;max-width:100%" placeholder="Buscar nome, e-mail ou pedido" data-input="q" aria-label="Buscar pedidos"><button class="btn small" data-act="csv" ${orders.length ? '' : 'disabled'}>Exportar planilha (CSV)</button></div></div>
    ${orders.length ? `<div class="tablewrap"><table><thead><tr><th>Pedido</th><th>Comprador</th><th>Ingressos</th><th class="num">Entradas</th><th class="num">Total</th><th>Situação</th><th>Data</th></tr></thead><tbody id="order-rows">${rows('')}</tbody></table></div>`
      : '<p class="note">Os pedidos aparecem aqui conforme o público compra.</p>'}
  </div>`, {
    'input:q': el => { document.getElementById('order-rows').innerHTML = rows(el.value.trim().toLowerCase()); },
    csv: () => {
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['pedido', 'situacao', 'pagamento', 'cupom', 'ingresso', 'lote', 'tipo', 'comprador', 'email', 'data_compra', 'utilizado_em'].join(';')];
      for (const o of orders) for (const t of o.tickets || []) lines.push([o.code, (ORDER_STATUS[o.status] || [o.status])[0], o.payment_method, o.coupon_code || '', t.code, t.type_name, t.kind, o.buyer_name, o.buyer_email, fmtShort(o.created_at), t.checked_in_at ? fmtShort(t.checked_in_at) : ''].map(q).join(';'));
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
    <nav class="subtabs"><a href="#/admin/eventos" ${tab === 'eventos' ? 'aria-current="page"' : ''}>Eventos</a><a href="#/admin/organizadores" ${tab === 'organizadores' ? 'aria-current="page"' : ''}>Organizadores</a><a href="#/admin/configuracoes" ${tab === 'configuracoes' ? 'aria-current="page"' : ''}>Configurações</a></nav>`;
  const cfg = await getSettings();
  if (tab === 'configuracoes') {
    return mount(head + `<form class="panel medium" data-form="cfg">
      <div><h2>Cobrança padrão da plataforma</h2><p class="note">Vale para os eventos que os organizadores criarem e vem preenchida quando você cria um evento. Eventos que já existem não mudam; ajuste cada um em Gerenciar → Informações. Só a administração altera esses valores.</p></div>
      <div class="formgrid">
        <div class="field full"><label for="c-fee">Taxa de serviço paga pelo comprador (%)</label><input id="c-fee" name="default_fee_pct" type="number" min="0" max="30" step="0.5" value="${esc(cfg.default_fee_pct)}"></div>
        ${chargeFields({ type: cfg.default_platform_type, pct: cfg.default_platform_pct, fixed: cfg.default_platform_fixed }, 'c')}
      </div>
      <div><h2>Pagamento online (Asaas)</h2><p class="note">As taxas abaixo são acrescentadas ao total do comprador conforme ele escolhe Pix ou cartão, para cobrir a tarifa do Asaas. Confira os valores do seu plano no Asaas. A taxa de split é descontada da parte do organizador.</p></div>
      <label class="check"><input type="checkbox" name="payments_enabled" ${cfg.payments_enabled ? 'checked' : ''}> Vender com pagamento online (Pix e cartão). Desligado: o pedido é confirmado na hora e o pagamento é combinado por fora.</label>
      <div class="formgrid">
        <div class="field"><label for="c-pixf">Pix: tarifa fixa (R$)</label><input id="c-pixf" name="pix_fee_fixed" type="number" min="0" step="0.01" value="${esc(cfg.pix_fee_fixed ?? 0)}"></div>
        <div class="field"><label for="c-pixp">Pix: tarifa percentual (%)</label><input id="c-pixp" name="pix_fee_pct" type="number" min="0" max="50" step="0.01" value="${esc(cfg.pix_fee_pct ?? 0)}"></div>
        <div class="field"><label for="c-cardf">Cartão: tarifa fixa (R$)</label><input id="c-cardf" name="card_fee_fixed" type="number" min="0" step="0.01" value="${esc(cfg.card_fee_fixed ?? 0)}"></div>
        <div class="field"><label for="c-cardp">Cartão à vista: tarifa percentual (%)</label><input id="c-cardp" name="card_fee_pct" type="number" min="0" max="50" step="0.01" value="${esc(cfg.card_fee_pct ?? 0)}"></div>
        <div class="field"><label for="c-card26">Cartão de 2 a 6 parcelas: tarifa percentual (%)</label><input id="c-card26" name="card_fee_pct_2_6" type="number" min="0" max="50" step="0.01" value="${esc(cfg.card_fee_pct_2_6 ?? 0)}"></div>
        <div class="field"><label for="c-card712">Cartão de 7 a 12 parcelas: tarifa percentual (%)</label><input id="c-card712" name="card_fee_pct_7_12" type="number" min="0" max="50" step="0.01" value="${esc(cfg.card_fee_pct_7_12 ?? 0)}"></div>
        <div class="field"><label for="c-split">Taxa de split por pedido (R$, paga pelo organizador)</label><input id="c-split" name="split_fee_fixed" type="number" min="0" step="0.01" value="${esc(cfg.split_fee_fixed ?? 0)}"></div>
        <div class="field"><label for="c-res">Tempo para pagar (minutos)</label><input id="c-res" name="reservation_minutes" type="number" min="5" max="120" step="1" value="${esc(cfg.reservation_minutes ?? 15)}"></div>
      </div>
      <div><button class="btn primary" type="submit">Salvar configurações</button></div>
    </form>`, { 'change:ptype-fee': chargeToggle }, {
      cfg: async fd => {
        const c = readCharge(fd);
        const n = k => Number(fd.get(k)) || 0;
        must(await sb.from('settings').update({ default_fee_pct: n('default_fee_pct'), default_platform_type: c.platform_fee_type, default_platform_pct: c.platform_pct, default_platform_fixed: c.platform_fee_fixed,
          payments_enabled: fd.get('payments_enabled') === 'on', pix_fee_fixed: n('pix_fee_fixed'), pix_fee_pct: n('pix_fee_pct'), card_fee_fixed: n('card_fee_fixed'), card_fee_pct: n('card_fee_pct'), card_fee_pct_2_6: n('card_fee_pct_2_6'), card_fee_pct_7_12: n('card_fee_pct_7_12'),
          split_fee_fixed: n('split_fee_fixed'), reservation_minutes: Math.min(120, Math.max(5, Math.round(n('reservation_minutes')) || 15)), updated_at: new Date().toISOString() }).eq('id', 1));
        toast('Configurações salvas.');
      }
    });
  }
  const orgs = must(await sb.from('organizers').select('*').order('legal_name'));
  if (tab === 'organizadores') {
    const counts = must(await sb.from('events').select('organizer_id')).reduce((m, e) => { if (e.organizer_id) m[e.organizer_id] = (m[e.organizer_id] || 0) + 1; return m; }, {});
    return mount(head + `<div class="panel"><div class="row between"><h2>${num(orgs.length)} organizador${orgs.length === 1 ? '' : 'es'}</h2><a class="btn primary" href="#/admin/organizador/novo">+ Novo organizador</a></div>
      ${orgs.length ? `<div class="tablewrap"><table><thead><tr><th>Nome / razão social</th><th>Tipo</th><th>Documento</th><th>E-mail</th><th>Conta</th><th>Recebimento online</th><th class="num">Eventos</th><th></th></tr></thead><tbody>
        ${orgs.map(o => `<tr><td><b>${esc(o.legal_name)}</b>${o.trade_name ? `<div class="note">${esc(o.trade_name)}</div>` : ''}</td><td>${o.person_type}</td><td class="mono">${esc(fmtDoc(o.person_type, o.document))}</td><td>${esc(o.email)}</td>
          <td>${o.user_id ? '<span class="chip ok">Ativa</span>' : '<span class="chip">Aguardando cadastro</span>'}</td>
          <td>${o.payout_account ? '<span class="chip ok">Carteira Asaas</span>' : `<span class="chip ${cfg.payments_enabled ? 'bad' : ''}">Sem carteira</span>`}</td><td class="num">${num(counts[o.id] || 0)}</td>
          <td class="num"><a class="btn small" href="#/admin/organizador/${esc(o.id)}">Abrir</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="note">Cadastre o primeiro organizador para poder vincular eventos.</p>'}</div>`);
  }
  const evs = must(await sb.from('events').select('id,name,starts_at,published,organizer_id,platform_pct,platform_fee_type,platform_fee_fixed,ticket_types(capacity,sold)').order('starts_at', { ascending: false }));
  const totalSold = evs.reduce((a, e) => a + (e.ticket_types || []).reduce((b, t) => b + t.sold, 0), 0);
  const refunds = must(await sb.from('orders').select('id,code,buyer_name,buyer_email,total,paid_at,events(name)').eq('status', 'refund_needed').order('paid_at'));
  const refundPanel = refunds.length ? `<div class="panel" style="border-color:var(--bad)"><h2>${num(refunds.length)} pagamento${refunds.length > 1 ? 's' : ''} para devolver</h2>
    <p class="note">Estas pessoas pagaram depois de a reserva vencer e os ingressos já tinham esgotado. Faça o estorno no Asaas (Cobranças → a cobrança → Estornar) e marque aqui.</p>
    <div class="tablewrap"><table><thead><tr><th>Pedido</th><th>Comprador</th><th>Evento</th><th class="num">Valor</th><th></th></tr></thead><tbody>
    ${refunds.map(o => `<tr><td class="mono">${esc(o.code)}</td><td>${esc(o.buyer_name)}<div class="note">${esc(o.buyer_email)}</div></td><td>${esc(o.events?.name)}</td><td class="num">${money(o.total)}</td>
      <td class="num"><button class="btn small" data-act="refunded" data-id="${esc(o.id)}">Marcar como devolvido</button></td></tr>`).join('')}</tbody></table></div></div>` : '';
  const orgOptions = sel => `<option value="">Sem organizador</option>` + orgs.map(o => `<option value="${esc(o.id)}" ${o.id === sel ? 'selected' : ''}>${esc(orgName(o))} (${o.person_type})</option>`).join('');
  mount(head + `
  <div class="kpis">
    <div class="kpi"><div class="v">${num(evs.length)}</div><div class="l">eventos cadastrados</div></div>
    <div class="kpi"><div class="v">${num(evs.filter(e => e.published && !isPast(e)).length)}</div><div class="l">à venda agora</div></div>
    <div class="kpi"><div class="v">${num(totalSold)}</div><div class="l">ingressos emitidos</div></div>
    <div class="kpi"><div class="v">${num(evs.filter(e => !e.organizer_id).length)}</div><div class="l">eventos sem organizador</div></div>
  </div>
  ${refundPanel}
  <details class="panel" ${evs.length ? '' : 'open'}><summary>+ Criar evento</summary>
    <form data-form="new" class="formgrid">
      <div class="field full"><label for="n-name">Nome do evento</label><input id="n-name" name="name" required></div>
      <div class="field"><label for="n-date">Data e hora</label><input id="n-date" name="starts_at" type="datetime-local" required></div>
      <div class="field"><label for="n-org">Vincular ao organizador</label><select id="n-org" name="organizer_id">${orgOptions('')}</select></div>
      <div class="field"><label for="n-venue">Local</label><input id="n-venue" name="venue"></div>
      <div class="field"><label for="n-city">Cidade / UF</label><input id="n-city" name="city"></div>
      ${instField(1, 'n')}
      <div class="field"><label for="n-fee">Taxa de serviço paga pelo comprador (%)</label><input id="n-fee" name="fee_pct" type="number" min="0" max="30" step="0.5" value="${esc(cfg.default_fee_pct)}"></div>
      ${chargeFields({ type: cfg.default_platform_type, pct: cfg.default_platform_pct, fixed: cfg.default_platform_fixed }, 'n')}
      <div class="full row"><button class="btn primary" type="submit">Criar e configurar lotes</button><span class="note">O evento nasce como rascunho. Publique depois de cadastrar os lotes.</span></div>
    </form>
  </details>
  <div class="panel"><h2>Eventos</h2>
    ${evs.length ? `<div class="tablewrap"><table><thead><tr><th>Evento</th><th>Data</th><th>Organizador</th><th>Cobrança</th><th>Situação</th><th class="num">Vendidos</th><th></th></tr></thead><tbody>
      ${evs.map(e => { const cap = (e.ticket_types || []).reduce((a, t) => a + t.capacity, 0), sold = (e.ticket_types || []).reduce((a, t) => a + t.sold, 0); return `<tr>
        <td><b>${esc(e.name)}</b></td><td>${esc(fmtShort(e.starts_at))}</td>
        <td><select class="input" style="min-width:180px" data-change="link" data-id="${esc(e.id)}" aria-label="Organizador de ${esc(e.name)}">${orgOptions(e.organizer_id)}</select></td>
        <td style="white-space:nowrap">${e.platform_fee_type === 'fixed' ? `${money(e.platform_fee_fixed)}/ingr.` : `${num(e.platform_pct)}%`}</td>
        <td>${isPast(e) ? '<span class="chip">Encerrado</span>' : e.published ? '<span class="chip ok">Publicado</span>' : '<span class="chip">Rascunho</span>'}</td>
        <td class="num">${num(sold)}/${num(cap)}</td><td class="num"><a class="btn small" href="#/painel/evento/${esc(e.id)}/info">Gerenciar</a></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="note">Nenhum evento ainda.</p>'}
  </div>`, {
    'change:ptype-fee': chargeToggle,
    refunded: async b => { const { error } = await sb.rpc('mark_refunded', { p_order: b.dataset.id }); if (error) return toast(errMsg(error), 'bad'); toast('Devolução registrada.'); vAdmin(tab); },
    'change:link': async el => {
      const { error } = await sb.from('events').update({ organizer_id: el.value || null }).eq('id', el.dataset.id);
      if (error) { toast(errMsg(error), 'bad'); return vAdmin(tab); }
      toast(el.value ? 'Evento vinculado ao organizador.' : 'Organizador removido do evento.');
    }
  }, {
    new: async fd => {
      const starts = fromLocalInput(fd.get('starts_at'));
      if (!starts) return toast('Informe a data e a hora.', 'bad');
      const ev = must(await sb.from('events').insert({ name: String(fd.get('name')).trim(), starts_at: starts, organizer_id: fd.get('organizer_id') || null, venue: String(fd.get('venue')).trim(), city: String(fd.get('city')).trim(), fee_pct: Number(fd.get('fee_pct')) || 0, max_installments: readInst(fd), ...readCharge(fd) }).select('id').single());
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
