/**
 * Integração — isolamento RLS + RPCs do Marketplace (migration 122).
 *
 * Prova de forma honesta (semeia via service_role, que contorna RLS) que:
 *   - SELECT de marketplace_posts é só para autenticados: anon recebe 0 linhas
 *     embora o anúncio ativo exista.
 *   - um usuário comum vê os anúncios ativos de outros no feed.
 *   - um usuário NÃO consegue inserir um anúncio com author_id de outro
 *     (RLS WITH CHECK author_id = auth.uid()), mas consegue como ele mesmo.
 *   - um usuário NÃO consegue editar/remover o anúncio de outro (0 linhas).
 *   - marketplace_get_post / marketplace_list_posts expõem o anúncio ativo.
 *   - marketplace_remove_post nega caller sem permissão com permission_denied
 *     (42501) E grava MARKETPLACE_VIEW_DENIED em admin_audit_logs (precedência +
 *     log negativo persistido — testing-governance).
 *
 * Infra_Dependent: roda só com branch Supabase efêmero + secrets
 * (describeIntegration faz skip caso contrário).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.6, 11.2, 11.5
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asService,
  asUser,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../_helpers/supabaseHarness';

const HOOK_TIMEOUT = 30_000;
const POINT_A = 'POINT(-49.5 -16.3)';

/** Garante uma linha em public.users para satisfazer o FK author_id. */
async function ensurePublicUser(user: SeededUser, userType: 'motorista' | 'embarcador') {
  const svc = asService();
  await svc
    .from('users')
    .upsert(
      {
        id: user.id,
        phone: `tst-${user.id.slice(0, 8)}`,
        password_hash: 'x',
        user_type: userType,
        name: `Teste ${userType}`,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    .catch(() => undefined);
}

describeIntegration('Integração 122 — RLS + RPCs do Marketplace', () => {
  let userA: SeededUser;
  let userB: SeededUser;
  let postAId: string;

  beforeAll(async () => {
    userA = await seedUser({ tag: 'mp-rls-a', userType: 'motorista' });
    userB = await seedUser({ tag: 'mp-rls-b', userType: 'embarcador' });
    await ensurePublicUser(userA, 'motorista');
    await ensurePublicUser(userB, 'embarcador');

    const svc = asService();
    const { data, error } = await svc
      .from('marketplace_posts')
      .insert({
        author_id: userA.id,
        post_type: 'venda',
        title: 'Caminhão de teste RLS',
        description: 'Anúncio semeado para teste de isolamento.',
        price: 65000,
        photo_paths: [`${userA.id}/seed.jpg`],
        location: POINT_A,
        location_label: 'Indiara, GO',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed post falhou: ${error?.message}`);
    postAId = (data as { id: string }).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (postAId) await svc.from('marketplace_posts').delete().eq('id', postAId);
    if (userA) {
      await svc.from('marketplace_posts').delete().eq('author_id', userA.id);
      await cleanupUser(userA.id);
    }
    if (userB) {
      await svc.from('marketplace_posts').delete().eq('author_id', userB.id);
      await cleanupUser(userB.id);
    }
  }, HOOK_TIMEOUT);

  it('anônimo não lê marketplace_posts, embora o anúncio ativo exista', async () => {
    const { data } = await asAnon().from('marketplace_posts').select('id').eq('id', postAId);
    expect((data ?? []).length).toBe(0);
  });

  it('usuário comum (B) vê o anúncio ativo de A no feed', async () => {
    const { data } = await asUser(userB.accessToken)
      .from('marketplace_posts')
      .select('id')
      .eq('id', postAId);
    expect((data ?? []).length).toBe(1);
  });

  it('B não cria anúncio com author_id de A (RLS WITH CHECK)', async () => {
    const { error } = await asUser(userB.accessToken).from('marketplace_posts').insert({
      author_id: userA.id, // tentativa de personificar A
      post_type: 'venda',
      title: 'Intruso',
      description: '',
      photo_paths: [`${userB.id}/x.jpg`],
      location: POINT_A,
      location_label: 'X',
    });
    expect(error).not.toBeNull();
  });

  it('B cria anúncio como ele mesmo (RLS permite)', async () => {
    const { data, error } = await asUser(userB.accessToken)
      .from('marketplace_posts')
      .insert({
        author_id: userB.id,
        post_type: 'noticia',
        title: 'Notícia do B',
        description: 'recado',
        photo_paths: [`${userB.id}/y.jpg`],
        location: POINT_A,
        location_label: 'Y',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it('B não consegue editar/remover o anúncio de A (0 linhas afetadas)', async () => {
    const { data } = await asUser(userB.accessToken)
      .from('marketplace_posts')
      .update({ status: 'removido' })
      .eq('id', postAId)
      .select('id');
    expect((data ?? []).length).toBe(0);

    // confirma que A ainda está ativo
    const { data: still } = await asService()
      .from('marketplace_posts')
      .select('status')
      .eq('id', postAId)
      .single();
    expect((still as { status: string }).status).toBe('ativo');
  });

  it('marketplace_get_post e _list_posts expõem o anúncio ativo a um autenticado', async () => {
    const user = asUser(userB.accessToken);
    const { data: one, error: e1 } = await user.rpc('marketplace_get_post', { p_id: postAId });
    expect(e1).toBeNull();
    expect((one ?? []).length).toBe(1);

    const { data: list, error: e2 } = await user.rpc('marketplace_list_posts', {
      p_limit: 50,
      p_offset: 0,
    });
    expect(e2).toBeNull();
    expect((list ?? []).some((r: { id: string }) => r.id === postAId)).toBe(true);
  });

  it('marketplace_remove_post nega não-admin com 42501 e grava MARKETPLACE_VIEW_DENIED', async () => {
    const { error } = await asUser(userB.accessToken).rpc('marketplace_remove_post', {
      p_id: postAId,
    });
    expect(error).not.toBeNull();
    expect(`${error?.code ?? ''}${error?.message ?? ''}`).toContain('42501');

    const { data: logs } = await asService()
      .from('admin_audit_logs')
      .select('action')
      .eq('action', 'MARKETPLACE_VIEW_DENIED')
      .eq('admin_id', userB.id);
    expect((logs ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
