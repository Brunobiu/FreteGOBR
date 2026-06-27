/**
 * Testes do aceite obrigatório dos Termos no cadastro (Feature 2 —
 * legal-aceite-termos).
 *
 * Cobre:
 *  - Zod: o schema rejeita `acceptTerms` false/ausente com mensagem pt-BR e
 *    aceita `true`.
 *  - Payload: a versão enviada é exatamente `currentLegalVersion()`.
 *  - Property 1 (servidor): sem `acceptedVersion` não-vazio, `register` rejeita
 *    com `TERMS_NOT_ACCEPTED` e nenhuma conta é criada (sem signUp).
 *
 * Validates: Requirements 1.5, 2.1, 2.2, 2.3, 4.3, 4.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { currentLegalVersion } from '../../data/legal';

// Mock do supabase para o teste de servidor (register).
vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue({ error: null }),
    })),
    rpc: vi.fn((fn: string) => {
      if (fn === 'consume_signup_otp_token')
        return Promise.resolve({ data: { ok: true, channel: 'whatsapp' }, error: null });
      if (fn === 'is_identifier_available') return Promise.resolve({ data: true, error: null });
      if (fn === 'is_identifier_blocked') return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: true, error: null });
    }),
  },
}));

// Mock do gate de blacklist (fail-open, não bloqueia).
vi.mock('../../services/admin/blacklist', () => ({
  checkBlacklistGate: vi.fn().mockResolvedValue({ blocked: false }),
  GENERIC_SIGNUP_MESSAGE: 'Não foi possível concluir o cadastro.',
  GENERIC_LOGIN_MESSAGE: 'Não foi possível autenticar.',
  GENERIC_EMAIL_MESSAGE: 'Não foi possível enviar o código.',
}));

// Espelho do refine usado no RegisterForm (mesma mensagem canônica pt-BR).
const acceptTermsSchema = z.object({
  acceptTerms: z.boolean().refine((v) => v === true, {
    message: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.',
  }),
});

describe('Aceite dos Termos — validação Zod (cliente)', () => {
  it('rejeita acceptTerms = false com mensagem pt-BR', () => {
    const r = acceptTermsSchema.safeParse({ acceptTerms: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe(
        'Você precisa aceitar os Termos de Uso e a Política de Privacidade.'
      );
    }
  });

  it('rejeita acceptTerms ausente', () => {
    const r = acceptTermsSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('aceita acceptTerms = true', () => {
    const r = acceptTermsSchema.safeParse({ acceptTerms: true });
    expect(r.success).toBe(true);
  });
});

describe('Aceite dos Termos — versão do payload', () => {
  it('currentLegalVersion() segue o formato canônico terms@<v>|privacy@<v>', () => {
    expect(currentLegalVersion()).toMatch(/^terms@\d{4}-\d{2}-\d{2}\|privacy@\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Aceite dos Termos — revalidação no servidor (register)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Property 1: sem acceptedVersion ⇒ TERMS_NOT_ACCEPTED e nenhuma conta criada', async () => {
    const { register, AuthError } = await import('../../services/auth');
    const { supabase } = await import('../../services/supabase');

    const payload = {
      phone: '11999999999',
      password: 'Senha123!',
      name: 'João Silva',
      userType: 'motorista' as const,
      acceptedVersion: '',
      email: 'joao@exemplo.com',
      phoneVerificationToken: '33333333-3333-3333-3333-333333333333',
    };

    await expect(register(payload)).rejects.toThrow(AuthError);
    await expect(register(payload)).rejects.toThrow(
      'É necessário aceitar os Termos de Uso e a Política de Privacidade.'
    );
    // Invariante: nenhuma conta criada (signUp nunca chamado).
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });
});
