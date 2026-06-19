// Feature: admin-cliente-360, Property 8: Privacidade por bloco (omissao sem PII parcial).
//
// O bloco financeiro so compoe o bundle com FINANCEIRO_VIEW, suporte so com
// SUPORTE_VIEW e notas so com USER_NOTE_VIEW; na ausencia, a chave e OMITIDA
// (undefined, sem PII parcial). O grant de USER_NOTE_VIEW/EDIT e verdadeiro
// SOMENTE para SUPER_ADMIN e ADMIN.
//
// Validates: Requirements 8.4, 8.5, 9.4, 10.3, 13.2, 13.3, 13.7, 15.1, 15.2

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
import { hasPermission, type AdminRole } from '../../../services/admin/permissions';
import type { UserDetailBundle } from '../../../services/admin/users';

function makeBase(): UserDetailBundle {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      user_type: 'embarcador',
      name: 'Cliente',
      phone: '11987654321',
      email: null,
      cpf: null,
      cnpj: null,
      company_name: 'Empresa',
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
    chat: [],
    errors: {},
  };
}

const ok = <T>(value: T): Settled<T> => ({ status: 'fulfilled', value });
const PLANO: PlanoLabel = { subscription_status: 'trial', is_subscribed: false, trial_ends_at: null };
const FIN: FinancialHistory = { plan: null, charges: [], repasses: [] };
const SUP: SupportHistory = { tickets: [] };
const FRETE: ConversationMeta[] = [];
const LOGIN: LoginHistory = { attempts: [], retentionDays: 30, hasPhone: false };
const NOTAS: InternalNote[] = [];

const ALL_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];

describe('CP-8 visao 360: privacidade por bloco e grant de notas', () => {
  it('presenca do bloco <=> permissao (sem PII na ausencia)', () => {
    const capsArb = fc.record({
      financeiro: fc.boolean(),
      suporte: fc.boolean(),
      notas: fc.boolean(),
      suporteReply: fc.boolean(),
    });

    fc.assert(
      fc.property(capsArb, (caps: Cliente360Caps) => {
        const bundle = assembleCliente360Bundle(makeBase(), caps, {
          plano: ok(PLANO),
          financeiro: caps.financeiro ? ok<FinancialHistory | undefined>(FIN) : ok<FinancialHistory | undefined>(undefined),
          suporte: caps.suporte ? ok<SupportHistory | undefined>(SUP) : ok<SupportHistory | undefined>(undefined),
          mensagensFrete: ok(FRETE),
          login: ok(LOGIN),
          notas: caps.notas ? ok<InternalNote[] | undefined>(NOTAS) : ok<InternalNote[] | undefined>(undefined),
        });

        // presenca <=> permissao
        expect('financeiro' in bundle).toBe(caps.financeiro);
        expect('suporte' in bundle).toBe(caps.suporte);
        expect('notas' in bundle).toBe(caps.notas);
        // ausencia => chave undefined (sem PII parcial)
        if (!caps.financeiro) expect(bundle.financeiro).toBeUndefined();
        if (!caps.suporte) expect(bundle.suporte).toBeUndefined();
        if (!caps.notas) expect(bundle.notas).toBeUndefined();
        // blocos sob USER_VIEW sempre presentes
        expect(bundle.plano).not.toBeNull();
        expect(bundle.mensagens).not.toBeNull();
        expect(bundle.login).not.toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it('USER_NOTE_VIEW/EDIT concedido SOMENTE a SUPER_ADMIN e ADMIN', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ROLES), (role) => {
        const granted = role === 'SUPER_ADMIN' || role === 'ADMIN';
        expect(hasPermission(role, 'USER_NOTE_VIEW')).toBe(granted);
        expect(hasPermission(role, 'USER_NOTE_EDIT')).toBe(granted);
      }),
      { numRuns: 100 }
    );
  });
});
