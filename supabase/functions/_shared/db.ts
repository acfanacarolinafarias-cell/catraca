import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Cliente com a chave de servidor (nunca vai para o navegador).
// O Supabase fornece SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY automaticamente.
export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('CATRACA_SERVICE_KEY') ?? '';
  if (!url || !key) throw new Error('Função sem acesso ao banco (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
