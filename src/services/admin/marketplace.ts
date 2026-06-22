/**
 * admin/marketplace.ts
 *
 * Moderação admin do Marketplace: ocultar (remover) um anúncio abusivo.
 * Envolve a RPC `marketplace_remove_post` (gated server-side por USER_EDIT) em
 * `executeAdminMutation` (audit-by-construction, action MARKETPLACE_POST_REMOVED),
 * conforme admin-patterns.md.
 *
 * Validates: Requirements 11.3, 11.4, 11.5
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

/** Remove (soft-delete) um anúncio como moderação administrativa. */
export async function removeMarketplacePost(postId: string): Promise<void> {
  await executeAdminMutation(
    {
      action: 'MARKETPLACE_POST_REMOVED',
      targetType: 'marketplace_posts',
      targetId: postId,
      before: { status: 'ativo' },
      after: { status: 'removido' },
    },
    async () => {
      const { error } = await supabase.rpc('marketplace_remove_post', { p_id: postId });
      if (error) throw error;
    }
  );
}
