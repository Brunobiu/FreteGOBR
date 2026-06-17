/**
 * Testes unitários da camada de serviço da Contact_Extraction
 * (`src/services/admin/whatsapp/extraction.ts`) — task 18.1.
 *
 * Mockam-se (hoisted, conforme convenção do projeto — spies expostos via
 * `globalThis`):
 *  - `supabase`: `functions.invoke` (proxy Evolution `listParticipants`) e
 *    `rpc` (RPC `whatsapp_record_extraction`, `SECURITY DEFINER` no SQL).
 *  - `executeAdminMutation` (audit-by-construction, admin-patterns §1): executa
 *    a `fn` interna (para exercitar a RPC) e registra o `input` de auditoria,
 *    permitindo asserir o `instance_id` e o nº de grupos analisados (Req 17.16).
 *
 * Cobertura (Req 17.4, 17.11, 17.12, 17.13, 17.16):
 *  - Seleção vazia ⇒ bloqueio + Canonical_Message pt-BR `Selecione ao menos um
 *    grupo.` ANTES de qualquer I/O (Req 17.11).
 *  - Degradação parcial ⇒ alguns grupos falham, a extração NÃO aborta e os
 *    grupos falhos são sinalizados (Req 17.12).
 *  - Indisponibilidade total ⇒ Canonical_Message anti-enumeração `Não foi
 *    possível concluir a operação.` (Req 17.13), indistinguível de instância
 *    inexistente/cruzada.
 *  - Happy path ⇒ extrai, persiste via RPC e audita com `instance_id` e nº de
 *    grupos (Req 17.4, 17.16).
 *
 * Convenções fast-check: telefones via `fc.constantFrom` (nunca `fc.stringOf`).
 *
 * Validates: Requirements 17.4, 17.11, 17.12, 17.13, 17.16
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mock hoisted do supabase: rpc + functions.invoke via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  const invokeSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waExtractionRpcSpy = rpcSpy;
  (globalThis as Record<string, unknown>).__waExtractionInvokeSpy = invokeSpy;
  return {
    supabase: {
      rpc: (...args: unknown[]) => rpcSpy(...args),
      functions: { invoke: (...args: unknown[]) => invokeSpy(...args) },
    },
  };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waExtractionAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  extractContacts,
  WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
} from '../../../services/admin/whatsapp/extraction';
import { WHATSAPP_CANONICAL_OPERATION_FAILED } from '../../../services/admin/whatsapp/guards';
import { expectIndistinguishable } from '../../_helpers/antiEnumeration';

const rpcSpy = (globalThis as Record<string, unknown>).__waExtractionRpcSpy as ReturnType<
  typeof vi.fn
>;
const invokeSpy = (globalThis as Record<string, unknown>).__waExtractionInvokeSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waExtractionAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const OTHER_INSTANCE = '33333333-3333-3333-3333-333333333333';

const GROUP_A = '120363000000000001@g.us';
const GROUP_B = '120363000000000002@g.us';
const GROUP_C = '120363000000000003@g.us';

/** Telefones BR válidos em dígitos (E.164 sem `+`) via templates fixos. */
function phoneArb(): fc.Arbitrary<string> {
  return fc.constantFrom(
    '5562999998888',
    '5511987654321',
    '5521991234567',
    '5548988887777',
    '5531999990000'
  );
}

/** Resposta de sucesso do proxy `listParticipants` para um grupo. */
function proxyOk(participants: string[]) {
  return {
    data: { ok: true, status: 'CONNECTED', participants, failedGroups: [] },
    error: null,
  };
}

/** Resposta estruturada de falha do proxy (sessão/Evolution/anti-enum). */
function proxyFail(code: string) {
  return {
    data: { ok: false, code, message: 'irrelevante para o serviço' },
    error: null,
  };
}

/** Resposta crua da RPC `whatsapp_record_extraction`. */
function recordOk(totalCount: number) {
  return {
    data: {
      extraction_id: 'extraction-uuid-0001',
      instance_id: INSTANCE,
      total_count: totalCount,
      recorded_at: '2026-01-01T00:00:00.000Z',
    },
    error: null,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  invokeSpy.mockReset();
  auditSpy.mockClear();
});

describe('seleção vazia (Req 17.11)', () => {
  it('bloqueia com a Canonical_Message pt-BR antes de qualquer I/O', async () => {
    await expect(extractContacts(INSTANCE, [])).rejects.toThrow(
      WHATSAPP_NO_GROUPS_SELECTED_MESSAGE
    );
    expect(WHATSAPP_NO_GROUPS_SELECTED_MESSAGE).toBe('Selecione ao menos um grupo.');

    // Nenhum I/O nem auditoria: o bloqueio é puramente client-side.
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('trata seleção só com lixo (strings vazias/whitespace) como vazia', async () => {
    await expect(extractContacts(INSTANCE, ['', '   '])).rejects.toThrow(
      WHATSAPP_NO_GROUPS_SELECTED_MESSAGE
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe('degradação parcial (Req 17.12)', () => {
  it('conclui com os grupos bem-sucedidos e sinaliza os que falharam, sem abortar', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(phoneArb(), { minLength: 1, maxLength: 4 }),
        fc.array(phoneArb(), { minLength: 1, maxLength: 4 }),
        async (phonesA, phonesC) => {
          rpcSpy.mockReset();
          invokeSpy.mockReset();

          // GROUP_A e GROUP_C sucedem; GROUP_B falha (Evolution indisponível
          // para aquele grupo) — não deve abortar a extração inteira.
          invokeSpy.mockImplementation(async (_fn: string, opts: { body: { groupJids: string[] } }) => {
            const jid = opts.body.groupJids[0];
            if (jid === GROUP_A) return proxyOk(phonesA);
            if (jid === GROUP_C) return proxyOk(phonesC);
            return proxyFail('EVOLUTION_UNAVAILABLE');
          });
          rpcSpy.mockResolvedValue({
            data: {
              extraction_id: 'extraction-uuid-0001',
              instance_id: INSTANCE,
              total_count: phonesA.length + phonesC.length,
              recorded_at: '2026-01-01T00:00:00.000Z',
            },
            error: null,
          });

          const result = await extractContacts(INSTANCE, [GROUP_A, GROUP_B, GROUP_C]);

          // Não abortou: os grupos bem-sucedidos foram preservados.
          expect(result.succeededGroups.sort()).toEqual([GROUP_A, GROUP_C].sort());
          // O grupo falho foi sinalizado (degradação parcial).
          expect(result.failedGroups).toEqual([GROUP_B]);
          expect(result.analyzedGroups).toBe(3);

          // Apenas os contatos dos grupos bem-sucedidos entram no resultado.
          expect(result.contacts).toHaveLength(phonesA.length + phonesC.length);
          for (const c of result.contacts) {
            expect([GROUP_A, GROUP_C]).toContain(c.sourceGroupJid);
          }

          // A RPC só recebe os contatos dos grupos bem-sucedidos, escopados.
          const [rpcName, rpcArgs] = rpcSpy.mock.calls[0] as [
            string,
            { p_instance_id: string; p_contacts: unknown[] },
          ];
          expect(rpcName).toBe('whatsapp_record_extraction');
          expect(rpcArgs.p_instance_id).toBe(INSTANCE);
          expect(rpcArgs.p_contacts).toHaveLength(phonesA.length + phonesC.length);
        }
      ),
      { numRuns: 25 }
    );
  });
});

describe('indisponibilidade total (Req 17.13 — anti-enumeração)', () => {
  it('lança a Canonical_Message quando TODOS os grupos falham, sem persistir', async () => {
    invokeSpy.mockResolvedValue(proxyFail('EVOLUTION_UNAVAILABLE'));

    await expect(extractContacts(INSTANCE, [GROUP_A, GROUP_B])).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
    expect(WHATSAPP_CANONICAL_OPERATION_FAILED).toBe('Não foi possível concluir a operação.');

    // Nada é persistido nem auditado em indisponibilidade total.
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('também lança quando a invocação do proxy rejeita em todos os grupos', async () => {
    invokeSpy.mockResolvedValue({ data: null, error: { message: 'network down' } });

    await expect(extractContacts(INSTANCE, [GROUP_A])).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('resposta indistinguível entre instância inexistente e cruzada (anti-enum)', async () => {
    // Ambos os casos: o proxy responde NOT_FOUND para o(s) grupo(s) ⇒ falha
    // total ⇒ a mesma Canonical_Message, sem revelar existência.
    invokeSpy.mockResolvedValue(proxyFail('NOT_FOUND'));
    let nonExistingMsg = '';
    try {
      await extractContacts(NON_EXISTENT, [GROUP_A]);
    } catch (err) {
      nonExistingMsg = (err as Error).message;
    }

    invokeSpy.mockResolvedValue(proxyFail('NOT_FOUND'));
    let crossMsg = '';
    try {
      await extractContacts(OTHER_INSTANCE, [GROUP_A]);
    } catch (err) {
      crossMsg = (err as Error).message;
    }

    expectIndistinguishable({ message: nonExistingMsg }, { message: crossMsg });
    expect(nonExistingMsg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
  });

  it('mapeia WHATSAPP_NOT_FOUND da RPC de persistência para a Canonical_Message', async () => {
    // Grupo sucede na extração, mas a RPC revalida a instância e lança o marker
    // anti-enumeração (instância cruzada/inexistente) — Req 2.8/17.15.
    invokeSpy.mockResolvedValue(proxyOk(['5562999998888']));
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'WHATSAPP_NOT_FOUND', code: 'P0001' },
    });

    await expect(extractContacts(INSTANCE, [GROUP_A])).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
  });
});

describe('happy path (Req 17.4, 17.16)', () => {
  it('extrai, persiste via RPC e audita com instance_id e nº de grupos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(phoneArb(), { minLength: 1, maxLength: 5 }),
        fc.array(phoneArb(), { minLength: 1, maxLength: 5 }),
        async (phonesA, phonesB) => {
          rpcSpy.mockReset();
          invokeSpy.mockReset();
          auditSpy.mockClear();

          invokeSpy.mockImplementation(
            async (_fn: string, opts: { body: { groupJids: string[] } }) => {
              const jid = opts.body.groupJids[0];
              return proxyOk(jid === GROUP_A ? phonesA : phonesB);
            }
          );
          const total = phonesA.length + phonesB.length;
          rpcSpy.mockResolvedValue({
            data: {
              extraction_id: 'extraction-uuid-0042',
              instance_id: INSTANCE,
              total_count: total,
              recorded_at: '2026-01-01T00:00:00.000Z',
            },
            error: null,
          });

          const result = await extractContacts(INSTANCE, [GROUP_A, GROUP_B]);

          expect(result.extractionId).toBe('extraction-uuid-0042');
          expect(result.instanceId).toBe(INSTANCE);
          expect(result.totalCount).toBe(total);
          expect(result.analyzedGroups).toBe(2);
          expect(result.failedGroups).toEqual([]);
          expect(result.succeededGroups.sort()).toEqual([GROUP_A, GROUP_B].sort());
          expect(result.contacts).toHaveLength(total);

          // Auditoria (Req 17.16): action, targetId=instance_id e after com o
          // instance_id + nº de grupos analisados.
          expect(auditSpy).toHaveBeenCalledTimes(1);
          const [input] = auditSpy.mock.calls[0];
          expect(input).toMatchObject({
            action: 'WHATSAPP_EXTRACTION_RECORD',
            targetType: 'whatsapp_extracted_contacts',
            targetId: INSTANCE,
          });
          const after = (input as { after: Record<string, unknown> }).after;
          expect(after.instance_id).toBe(INSTANCE);
          expect(after.analyzed_groups).toBe(2);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('opera apenas sobre a Active_Instance: invoke e RPC recebem o mesmo instance_id', async () => {
    invokeSpy.mockResolvedValue(proxyOk(['5562999998888', '5511987654321']));
    rpcSpy.mockResolvedValue(recordOk(2));

    await extractContacts(INSTANCE, [GROUP_A]);

    // O proxy recebe o instanceId e o JID do grupo da Active_Instance.
    expect(invokeSpy).toHaveBeenCalledWith('whatsapp-evolution-proxy', {
      body: { action: 'listParticipants', instanceId: INSTANCE, groupJids: [GROUP_A] },
    });
    // A RPC é escopada ao mesmo instance_id.
    const [, rpcArgs] = rpcSpy.mock.calls[0] as [string, { p_instance_id: string }];
    expect(rpcArgs.p_instance_id).toBe(INSTANCE);
  });

  it('deduplica JIDs repetidos na seleção antes de extrair', async () => {
    invokeSpy.mockResolvedValue(proxyOk(['5562999998888']));
    rpcSpy.mockResolvedValue(recordOk(1));

    const result = await extractContacts(INSTANCE, [GROUP_A, GROUP_A, GROUP_A]);

    // Um único grupo distinto ⇒ uma única chamada ao proxy.
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(result.analyzedGroups).toBe(1);
  });
});
