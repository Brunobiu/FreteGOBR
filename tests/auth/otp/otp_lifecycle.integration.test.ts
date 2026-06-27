/**
 * Integração 125 — ciclo de vida do OTP de cadastro (signup_otp_verifications).
 *
 * Feature: auth-otp-whatsapp
 * Validates: CP3 (expiração), CP4 (tentativas), CP5 (uso único do token),
 *            CP6 (binding token↔telefone), CP7 (rate limit), INVALID.
 *
 * Infra_Dependent: roda só quando o branch Supabase efêmero está provisionado
 * (describeIntegration). Pré-requisito: migration 125 aplicada no branch.
 *
 * Estratégia: inserimos códigos conhecidos via service role (a tabela é RLS
 * deny-all; só service role/RPC acessam) com `code_hash` calculado igual ao SQL
 * (`encode(digest(code,'sha256'),'base64')`), e exercitamos as RPCs via anon.
 */
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { describeIntegration, asAnon, asService } from '../../_helpers/supabaseHarness';

/** Espelha o hash do SQL: sha256(base64) sobre o código só-dígitos. */
function hashCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/\D/g, ''))
    .digest('base64');
}

describeIntegration('Integração 125 — ciclo de vida do OTP de cadastro', () => {
  // Clientes criados em beforeAll (asService/asAnon lançam sem env; quando a
  // suíte é skip, o corpo é coletado mas beforeAll/it não rodam).
  let svc: SupabaseClient;
  let anon: SupabaseClient;
  const phone = '5511990000125'; // E.164 determinístico para a suíte

  beforeAll(() => {
    svc = asService();
    anon = asAnon();
  });

  afterAll(async () => {
    await svc.from('signup_otp_verifications').delete().eq('phone', phone);
  });

  /** Insere um único código pendente conhecido para o telefone da suíte. */
  async function seedCode(opts: {
    code: string;
    expiresInMin?: number;
    attempts?: number;
  }): Promise<void> {
    await svc.from('signup_otp_verifications').delete().eq('phone', phone);
    const { error } = await svc.from('signup_otp_verifications').insert({
      channel: 'whatsapp',
      phone,
      code_hash: hashCode(opts.code),
      expires_at: new Date(Date.now() + (opts.expiresInMin ?? 10) * 60_000).toISOString(),
      attempts: opts.attempts ?? 0,
      consumed: false,
    });
    if (error) throw error;
  }

  it('CP3 — código expirado ⇒ EXPIRED e nenhum token emitido', async () => {
    await seedCode({ code: '123456', expiresInMin: -1 });
    const { data, error } = await anon.rpc('confirm_signup_otp', {
      p_phone: phone,
      p_code: '123456',
    });
    expect(error).toBeNull();
    expect(data.status).toBe('EXPIRED');
    expect(data.token).toBeUndefined();
  });

  it('CP4 — 5 tentativas atingidas ⇒ BLOCKED', async () => {
    await seedCode({ code: '123456', attempts: 5 });
    const { data } = await anon.rpc('confirm_signup_otp', { p_phone: phone, p_code: '000000' });
    expect(data.status).toBe('BLOCKED');
  });

  it('INVALID — código incorreto não emite token', async () => {
    await seedCode({ code: '111111' });
    const { data } = await anon.rpc('confirm_signup_otp', { p_phone: phone, p_code: '222222' });
    expect(data.status).toBe('INVALID');
    expect(data.token).toBeUndefined();
  });

  it('CP5 — sucesso emite token; consumo é uso único', async () => {
    await seedCode({ code: '424242' });
    const { data: conf } = await anon.rpc('confirm_signup_otp', {
      p_phone: phone,
      p_code: '424242',
    });
    expect(conf.status).toBe('OK');
    expect(conf.token).toBeTruthy();

    const first = await anon.rpc('consume_signup_otp_token', {
      p_phone: phone,
      p_token: conf.token,
    });
    expect(first.data.ok).toBe(true);

    const second = await anon.rpc('consume_signup_otp_token', {
      p_phone: phone,
      p_token: conf.token,
    });
    expect(second.data.ok).toBe(false); // uso único
  });

  it('CP6 — token só vale para o mesmo telefone que o gerou', async () => {
    await seedCode({ code: '555555' });
    const { data: conf } = await anon.rpc('confirm_signup_otp', {
      p_phone: phone,
      p_code: '555555',
    });
    const otherPhone = '5511990000999';
    const cross = await anon.rpc('consume_signup_otp_token', {
      p_phone: otherPhone,
      p_token: conf.token,
    });
    expect(cross.data.ok).toBe(false);
  });

  it('CP7 — rate limit 5/h por telefone', async () => {
    const rlPhone = '5511990000777';
    await svc.from('signup_otp_verifications').delete().eq('phone', rlPhone);
    try {
      for (let i = 0; i < 5; i++) {
        const { error } = await anon.rpc('request_signup_otp', {
          p_phone: rlPhone,
          p_email: '',
          p_force_email: false,
        });
        expect(error).toBeNull();
      }
      const sixth = await anon.rpc('request_signup_otp', {
        p_phone: rlPhone,
        p_email: '',
        p_force_email: false,
      });
      expect(sixth.error?.message ?? '').toMatch(/rate_limited/);
    } finally {
      await svc.from('signup_otp_verifications').delete().eq('phone', rlPhone);
    }
  });
});
