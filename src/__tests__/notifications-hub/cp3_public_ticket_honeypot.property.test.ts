/**
 * CP-3: Property test do honeypot do `submitPublicTicket`.
 *
 * Spec: .kiro/specs/notifications-hub/requirements.md Requirement 9.3.
 *
 * Propriedades testadas:
 *
 *  P1. Para qualquer `websiteUrl` não-vazio, o helper TS chama o RPC
 *      `submit_public_ticket` passando exatamente o `p_website_url`
 *      recebido. O servidor (RPC SQL) é responsável por reconhecer o
 *      honeypot e gravar `bot_detected=true` em `support_ticket_attempts`
 *      sem criar ticket. Esta property test valida o contrato do client:
 *      o helper SEMPRE delega ao RPC (não filtra honeypot localmente, o
 *      que daria pista para bots inspecionarem o JS).
 *
 *  P2. Para qualquer payload válido sem `websiteUrl`, o RPC é chamado
 *      sem `p_website_url=null`.
 *
 *  P3. Em sucesso, o helper retorna `{ submitted: true }` (resposta opaca).
 *
 *  P4. Em erro `PUBLIC_TICKET_RATE_LIMITED`, o helper lança `TicketError`
 *      com `code='PUBLIC_TICKET_RATE_LIMITED'`.
 *
 *  P5. Em erro `INVALID_INPUT`, o helper lança `TicketError` com
 *      `code='INVALID_INPUT'`.
 *
 *  P6. Em erros desconhecidos, o helper "desclassifica" para `INVALID_INPUT`
 *      genérico (anti-enumeration).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mocks hoisted -----
vi.mock('../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp3RpcSpy = rpcSpy;
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        const mockResult = (globalThis as Record<string, unknown>).__cp3MockResult as {
          data?: unknown;
          error?: { message: string; code?: string } | null;
        };
        return Promise.resolve(mockResult ?? { data: { submitted: true }, error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => ({}),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock('../../services/admin/audit', () => ({
  executeAdminMutation: async <T>(_input: unknown, fn: () => Promise<T>) => fn(),
}));

import { submitPublicTicket } from '../../services/admin/tickets';

const rpcSpy = (globalThis as Record<string, unknown>).__cp3RpcSpy as ReturnType<typeof vi.fn>;

function setMockResult(result: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}) {
  (globalThis as Record<string, unknown>).__cp3MockResult = result;
}

const NAME_GEN = fc.constantFrom('Visitante', 'Maria Silva', 'Joao Pereira', 'Ana');
const EMAIL_GEN = fc.constantFrom(
  'foo@example.com',
  'usuario@gmail.com',
  'teste.bot@dominio.com.br'
);
const SUBJECT_GEN = fc
  .string({ minLength: 3, maxLength: 100 })
  .filter((s) => s.trim().length >= 3 && s.trim().length <= 120);
const BODY_GEN = fc
  .string({ minLength: 10, maxLength: 500 })
  .filter((s) => s.trim().length >= 10 && s.trim().length <= 5000);
const HONEYPOT_GEN = fc.string({ minLength: 1, maxLength: 200 });

describe('CP-3: submitPublicTicket — honeypot e contratos de erro', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    setMockResult({ data: { submitted: true }, error: null });
  });

  // P1: honeypot é sempre passado ao RPC sem filtragem local
  it('quando websiteUrl não-vazio, helper sempre delega ao RPC com p_website_url', async () => {
    await fc.assert(
      fc.asyncProperty(
        NAME_GEN,
        EMAIL_GEN,
        SUBJECT_GEN,
        BODY_GEN,
        HONEYPOT_GEN,
        async (name, email, subject, body, honeypot) => {
          rpcSpy.mockClear();
          setMockResult({ data: { submitted: true }, error: null });

          await submitPublicTicket({
            guestName: name,
            guestEmail: email,
            subject,
            body,
            websiteUrl: honeypot,
          });

          expect(rpcSpy).toHaveBeenCalledTimes(1);
          const [rpcName, args] = rpcSpy.mock.calls[0];
          expect(rpcName).toBe('submit_public_ticket');
          expect((args as Record<string, unknown>).p_website_url).toBe(honeypot);
        }
      ),
      { numRuns: 100 }
    );
  });

  // P2: sem honeypot, RPC recebe null
  it('quando websiteUrl ausente, RPC recebe p_website_url=null', async () => {
    await fc.assert(
      fc.asyncProperty(
        NAME_GEN,
        EMAIL_GEN,
        SUBJECT_GEN,
        BODY_GEN,
        async (name, email, subject, body) => {
          rpcSpy.mockClear();
          setMockResult({ data: { submitted: true }, error: null });

          await submitPublicTicket({
            guestName: name,
            guestEmail: email,
            subject,
            body,
          });

          const [, args] = rpcSpy.mock.calls[0];
          expect((args as Record<string, unknown>).p_website_url).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  // P3: sucesso retorna { submitted: true } (opaco)
  it('em sucesso, retorna { submitted: true } sem expor mais detalhes', async () => {
    setMockResult({ data: { submitted: true }, error: null });
    const result = await submitPublicTicket({
      guestName: 'Foo',
      guestEmail: 'foo@bar.com',
      subject: 'Teste',
      body: 'Mensagem de teste com 10+ chars',
    });
    expect(result).toEqual({ submitted: true });
  });

  // P4: rate-limit é propagado como TicketError tipado
  it('rate-limit do RPC vira TicketError(PUBLIC_TICKET_RATE_LIMITED)', async () => {
    setMockResult({
      error: { message: 'PUBLIC_TICKET_RATE_LIMITED', code: 'P0001' },
    });
    await expect(
      submitPublicTicket({
        guestName: 'Foo',
        guestEmail: 'foo@bar.com',
        subject: 'Teste',
        body: 'Mensagem com 10+ chars',
      })
    ).rejects.toMatchObject({
      name: 'TicketError',
      code: 'PUBLIC_TICKET_RATE_LIMITED',
    });
  });

  // P5: invalid input é propagado tipado
  it('INVALID_INPUT do RPC vira TicketError(INVALID_INPUT)', async () => {
    setMockResult({
      error: { message: 'INVALID_INPUT', code: 'P0001' },
    });
    await expect(
      submitPublicTicket({
        guestName: 'Foo',
        guestEmail: 'foo@bar.com',
        subject: 'Teste',
        body: 'Mensagem com 10+ chars',
      })
    ).rejects.toMatchObject({
      name: 'TicketError',
      code: 'INVALID_INPUT',
    });
  });

  // P6: erro desconhecido vira INVALID_INPUT genérico (anti-enumeration)
  it('erro desconhecido do RPC eh desclassificado para INVALID_INPUT', async () => {
    setMockResult({
      error: { message: 'database connection lost', code: '08006' },
    });
    await expect(
      submitPublicTicket({
        guestName: 'Foo',
        guestEmail: 'foo@bar.com',
        subject: 'Teste',
        body: 'Mensagem com 10+ chars',
      })
    ).rejects.toMatchObject({
      name: 'TicketError',
      code: 'INVALID_INPUT',
    });
  });

  // P7: helper NUNCA filtra honeypot localmente (defesa anti-bot)
  it('helper passa honeypot string vazia como passada (não null)', async () => {
    rpcSpy.mockClear();
    setMockResult({ data: { submitted: true }, error: null });

    await submitPublicTicket({
      guestName: 'Foo',
      guestEmail: 'foo@bar.com',
      subject: 'Teste',
      body: 'Mensagem com 10+ chars',
      websiteUrl: '', // string vazia explícita
    });

    const [, args] = rpcSpy.mock.calls[0];
    expect((args as Record<string, unknown>).p_website_url).toBe('');
  });
});
