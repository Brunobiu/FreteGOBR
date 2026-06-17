/**
 * Integração — proxy de conexão Evolution contra a API mockada/indisponível
 * (task 7.3).
 *
 * `whatsapp-evolution-proxy` (Edge Function, verify_jwt=true) é a ÚNICA camada
 * que toca a Evolution_Api_Key (lida do Vault, nunca ecoada). Como é um módulo
 * Deno (não importável no Vitest), testamos o contrato REAL invocando a função
 * deployada via `functions.invoke` contra o Supabase de teste:
 *
 *   - RBAC server-side (Req 1.x): um usuário autenticado SEM permissão de admin
 *     não obtém resposta de sucesso — o servidor decide (não basta o gateway).
 *   - Evolution indisponível (Req 3.5): sem chave/base configuradas, o proxy
 *     responde a Canonical_Message `Não foi possível conectar o WhatsApp.` e
 *     mantém a sessão DISCONNECTED. Este é o caminho "mock fora do ar" — o mock
 *     mais simples da Evolution API (endpoint inalcançável) — e nenhum segredo
 *     é ecoado na resposta.
 *   - Anti-enumeração (Req 2.8): instanceId malformado/inexistente ⇒ NOT_FOUND
 *     com a mensagem genérica, sem revelar formato/existência.
 *
 * Os caminhos felizes (connect⇒QR_PENDING / status⇒CONNECTED) exigem um mock da
 * Evolution HOSPEDADO e alcançável pela função deployada (EVOLUTION_API_URL) +
 * a chave por instância no Vault — fora do escopo de um branch efêmero. Ficam
 * como follow-up documentado, atrás de `WHATSAPP_TEST_EVOLUTION_MOCK_URL`.
 *
 * Infra_Dependent: roda só com o branch Supabase efêmero + secrets E a função
 * deployada (`describeIntegration` faz skip caso contrário). As asserções de
 * contrato de admin exigem `WHATSAPP_TEST_ADMIN_TOKEN` (token de um admin com
 * SETTINGS_VIEW); sem ele, esses casos são pulados.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.8, 3.5
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asService,
  asUser,
  cleanupUser,
  describeIntegration,
  seedUser,
  type SeededUser,
} from '../_helpers/supabaseHarness';
import { cleanupTestInstance, seedTestInstance } from '../_helpers/whatsappHarness';
import { expectNoSecrets } from '../../src/__tests__/_helpers/logAssertions';

const HOOK_TIMEOUT = 30_000;
const ADMIN_TOKEN = process.env.WHATSAPP_TEST_ADMIN_TOKEN ?? '';

/** Roda os casos que precisam de um JWT de admin só quando o token foi provido. */
const itAdmin = ADMIN_TOKEN ? it : it.skip;

interface ProxyResponse {
  ok: boolean;
  code?: string;
  message?: string;
  status?: string;
  qr?: string;
}

describeIntegration('Integração 7.3 — proxy Evolution (RBAC + indisponibilidade)', () => {
  const PROXY = 'whatsapp-evolution-proxy';
  let instanceId: string;
  let nonAdmin: SeededUser;

  beforeAll(async () => {
    const inst = await seedTestInstance(asService(), 'proxy', 90040);
    instanceId = inst.id;
    nonAdmin = await seedUser({ tag: 'wa-proxy-driver', userType: 'motorista' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (instanceId) await cleanupTestInstance(asService(), instanceId);
    if (nonAdmin) await cleanupUser(nonAdmin.id);
  }, HOOK_TIMEOUT);

  it('usuário autenticado sem permissão de admin não obtém sucesso (RBAC server-side)', async () => {
    const user = asUser(nonAdmin.accessToken);
    const { data, error } = await user.functions.invoke(PROXY, {
      body: { action: 'status', instanceId },
    });

    // O proxy reconfirma a permissão server-side (PERMISSION_DENIED ⇒ 403, que o
    // supabase-js surfaça como erro). Em nenhum caso há resposta de sucesso.
    const body = data as ProxyResponse | null;
    expect(error !== null || body?.ok !== true).toBe(true);
  });

  itAdmin('admin: Evolution sem chave/base ⇒ Canonical_Message + DISCONNECTED, sem segredos', async () => {
    const admin = asUser(ADMIN_TOKEN);
    const { data, error } = await admin.functions.invoke(PROXY, {
      body: { action: 'status', instanceId },
    });

    // Caminho "mock fora do ar": resposta 200 com a Canonical_Message (Req 3.5).
    expect(error).toBeNull();
    const body = data as ProxyResponse;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('EVOLUTION_UNAVAILABLE');
    expect(body.message).toBe('Não foi possível conectar o WhatsApp.');
    expect(body.status).toBe('DISCONNECTED');
    // Nenhum segredo (chave Evolution etc.) é ecoado na resposta.
    expect(() => expectNoSecrets(body)).not.toThrow();
  });

  itAdmin('admin: instanceId malformado ⇒ NOT_FOUND (anti-enumeração)', async () => {
    const admin = asUser(ADMIN_TOKEN);
    const { data, error } = await admin.functions.invoke(PROXY, {
      body: { action: 'status', instanceId: 'not-a-uuid' },
    });

    // 404 NOT_FOUND ⇒ supabase-js surfaça como erro; não há sucesso.
    const body = data as ProxyResponse | null;
    expect(error !== null || body?.ok !== true).toBe(true);
  });

  itAdmin('admin: ação inválida ⇒ rejeitada (INVALID_ACTION)', async () => {
    const admin = asUser(ADMIN_TOKEN);
    const { data, error } = await admin.functions.invoke(PROXY, {
      body: { action: 'definitely_not_an_action', instanceId },
    });

    const body = data as ProxyResponse | null;
    expect(error !== null || body?.ok !== true).toBe(true);
  });
});
