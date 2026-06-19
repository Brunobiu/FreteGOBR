// Feature: admin-cliente-360, Property 4: Degradacao parcial por bloco.
//
// A falha de qualquer Detail_Block != Source_Block (a) nao derruba os demais,
// (b) registra errors[bloco] exatamente para os que falharam, (c) blocos gated
// sem permissao sao OMITIDOS (sem entrada em errors); o assembler NUNCA lanca.
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 9.7, 10.6, 11.6, 12.7, 17.3, 17.4

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  assembleCliente360Bundle,
  type Cliente360Caps,
  type Settled,
  type PlanoLabel,
  type FinancialHistory,
  type SupportHistory,
  type ConversationMeta,
  type LoginHistory,
  type InternalNote,
} from '../../../services/admin/cliente360';
import type { UserDetailBundle } from '../../../services/admin/users';

function makeBase(): UserDetailBundle {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      user_type: 'motorista',
      name: 'Cliente Teste',
      phone: '62999998888',
      email: null,
      cpf: null,
      cnpj: null,
      company_name: null,
      is_active: true,
      ban_reason: null,
      banned_at: null,
      banned_by: null,
      profile_photo_url: null,
      admin_username: null,
      created_at: '2024-01-01T00:00:00Z',
      last_activity_at: null,
      updated_at: '2024-01-01T00:00:00Z',
    },
    bannedByName: null,
    location: null,
    documents: [],
    fretes: [],
    fretesTotal: 0,
    ratings: [],
    chat: [{ conversation_id: 'c1', total_messages: 2, last_message_at: null, last_admin_reply_at: null }],
    errors: {},
  };
}

const PLANO: PlanoLabel = { subscription_status: 'active', is_subscribed: true, trial_ends_at: null };
const FIN: FinancialHistory = {
  plan: { plan: 'mensal', payment_method: 'pix', status: 'active', started_at: null, next_charge_at: null, grace_ends_at: null },
  charges: [],
  repasses: [],
};
const SUP: SupportHistory = { tickets: [] };
const FRETE: ConversationMeta[] = [];
const LOGIN: LoginHistory = { attempts: [], retentionDays: 30, hasPhone: false };
const NOTAS: InternalNote[] = [];

function settled<T>(ok: boolean, value: T): Settled<T> {
  return ok ? { status: 'fulfilled', value } : { status: 'rejected', reason: new Error('falha') };
}

describe('CP-4 visao 360: degradacao parcial por bloco', () => {
  it('falha de um bloco isola o erro; gated sem permissao e omitido; nunca lanca', () => {
    const scenario = fc.record({
      caps: fc.record({
        financeiro: fc.boolean(),
        suporte: fc.boolean(),
        notas: fc.boolean(),
        suporteReply: fc.boolean(),
      }),
      planoOk: fc.boolean(),
      finOk: fc.boolean(),
      supOk: fc.boolean(),
      msgOk: fc.boolean(),
      loginOk: fc.boolean(),
      notasOk: fc.boolean(),
    });

    fc.assert(
      fc.property(scenario, (s) => {
        const caps = s.caps as Cliente360Caps;
        const bundle = assembleCliente360Bundle(makeBase(), caps, {
          plano: settled(s.planoOk, PLANO),
          financeiro: caps.financeiro ? settled(s.finOk, FIN) : { status: 'fulfilled', value: undefined },
          suporte: caps.suporte ? settled(s.supOk, SUP) : { status: 'fulfilled', value: undefined },
          mensagensFrete: settled(s.msgOk, FRETE),
          login: settled(s.loginOk, LOGIN),
          notas: caps.notas ? settled(s.notasOk, NOTAS) : { status: 'fulfilled', value: undefined },
        });

        // plano: sempre solicitado
        if (s.planoOk) {
          expect(bundle.plano).not.toBeNull();
          expect(bundle.errors.plano).toBeUndefined();
        } else {
          expect(bundle.plano).toBeNull();
          expect(bundle.errors.plano).toBeDefined();
        }

        // financeiro: gated
        if (caps.financeiro) {
          expect('financeiro' in bundle && bundle.financeiro !== undefined).toBe(s.finOk);
          expect(bundle.errors.financeiro !== undefined).toBe(!s.finOk);
        } else {
          expect(bundle.financeiro).toBeUndefined();
          expect(bundle.errors.financeiro).toBeUndefined(); // omitido != erro
        }

        // suporte: gated
        if (caps.suporte) {
          expect(bundle.suporte !== undefined).toBe(s.supOk);
          expect(bundle.errors.suporte !== undefined).toBe(!s.supOk);
        } else {
          expect(bundle.suporte).toBeUndefined();
          expect(bundle.errors.suporte).toBeUndefined();
        }

        // notas: gated
        if (caps.notas) {
          expect(bundle.notas !== undefined).toBe(s.notasOk);
          expect(bundle.errors.notas !== undefined).toBe(!s.notasOk);
        } else {
          expect(bundle.notas).toBeUndefined();
          expect(bundle.errors.notas).toBeUndefined();
        }

        // mensagens: SEMPRE presente; suporteChat preservado do base
        expect(bundle.mensagens).not.toBeNull();
        expect(bundle.mensagens?.suporteChat).toEqual(makeBase().chat);
        expect(bundle.errors.mensagens !== undefined).toBe(!s.msgOk);

        // login: sempre solicitado
        expect(bundle.login !== null).toBe(s.loginOk);
        expect(bundle.errors.login !== undefined).toBe(!s.loginOk);
      }),
      { numRuns: 200 }
    );
  });
});
