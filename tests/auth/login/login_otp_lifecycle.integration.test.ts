/**
 * Integração 126 — login sem senha (login_otp_codes + RPCs).
 *
 * Feature: login-sem-senha
 * Validates: anti-enumeração (CP1), uso único (CP2), expiração/tentativas (CP3),
 *            resolução por telefone E e-mail.
 *
 * Infra_Dependent: roda só com branch Supabase efêmero (describeIntegration).
 * Pré-requisito: migrations 125 + 126 aplicadas no branch.
 */
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  describeIntegration,
  asAnon,
  asService,
  seedUser,
  cleanupUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';

function hashCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/\D/g, ''))
    .digest('base64');
}

describeIntegration('Integração 126 — login sem senha (login_otp_codes)', () => {
  let svc: ReturnType<typeof asService>;
  let anon: ReturnType<typeof asAnon>;
  let user: SeededUser;
  const phone = '11990000126';

  beforeAll(async () => {
    svc = asService();
    anon = asAnon();
    user = await seedUser({ tag: 'login-otp-126', userType: 'motorista' });
    // Linha em public.users (FK de login_otp_codes + resolução por telefone/e-mail).
    await svc.from('users').upsert({
      id: user.id,
      phone,
      user_type: 'motorista',
      name: 'Login OTP Test',
      email: user.email,
      email_verified: true,
    });
  });

  afterAll(async () => {
    await svc.from('login_otp_codes').delete().eq('user_id', user.id);
    await svc.from('users').delete().eq('id', user.id);
    await cleanupUser(user.id);
  });

  async function seedLoginCode(opts: { code: string; expiresInMin?: number; attempts?: number }) {
    await svc.from('login_otp_codes').delete().eq('user_id', user.id);
    const { error } = await svc.from('login_otp_codes').insert({
      user_id: user.id,
      channel: 'whatsapp',
      code_hash: hashCode(opts.code),
      expires_at: new Date(Date.now() + (opts.expiresInMin ?? 10) * 60_000).toISOString(),
      attempts: opts.attempts ?? 0,
      consumed: false,
    });
    if (error) throw error;
  }

  it('CP1 — anti-enumeração: identificador inexistente ⇒ ok neutro', async () => {
    const { data, error } = await anon.rpc('request_login_otp', {
      p_identifier: 'naoexiste-126@exemplo.com',
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(true);
  });

  it('request para conta existente ⇒ ok e cria 1 código pendente', async () => {
    await svc.from('login_otp_codes').delete().eq('user_id', user.id);
    const { error } = await anon.rpc('request_login_otp', { p_identifier: phone });
    expect(error).toBeNull();
    const { count } = await svc
      .from('login_otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('consumed', false);
    expect(count).toBe(1);
  });

  it('CP2/CP3 — errado⇒INVALID; correto⇒OK+email; reuso⇒EXPIRED', async () => {
    await seedLoginCode({ code: '424242' });
    const wrong = await anon.rpc('verify_login_otp', { p_identifier: phone, p_code: '000000' });
    expect(wrong.data.status).toBe('INVALID');

    await seedLoginCode({ code: '424242' });
    const ok = await anon.rpc('verify_login_otp', { p_identifier: phone, p_code: '424242' });
    expect(ok.data.status).toBe('OK');
    expect(ok.data.email).toBeTruthy();

    // Uso único: consumido ⇒ não há mais código pendente.
    const again = await anon.rpc('verify_login_otp', { p_identifier: phone, p_code: '424242' });
    expect(again.data.status).toBe('EXPIRED');
  });

  it('CP3 — código expirado ⇒ EXPIRED', async () => {
    await seedLoginCode({ code: '111111', expiresInMin: -1 });
    const { data } = await anon.rpc('verify_login_otp', { p_identifier: phone, p_code: '111111' });
    expect(data.status).toBe('EXPIRED');
  });

  it('resolve a conta também por e-mail', async () => {
    await seedLoginCode({ code: '555555' });
    const { data } = await anon.rpc('verify_login_otp', {
      p_identifier: user.email,
      p_code: '555555',
    });
    expect(data.status).toBe('OK');
  });
});
