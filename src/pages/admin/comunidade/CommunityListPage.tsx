/**
 * CommunityListPage — /admin/frete-comunidade
 *
 * Página principal do módulo Frete Comunidade (spec frete-comunidade, Fase 5).
 * Gate `useAdminPermission('FINANCEIRO_VIEW')` ⇒ `<Stealth404 />` (a RPC
 * reaplica o gating no servidor com audit negativo COMMUNITY_VIEW_DENIED).
 * Compact_Layout_Pattern: sem `<h1>`. Três blocos: Perfil + Importação + Lista.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import {
  getCommunityProfile,
  listCommunityFretes,
  parseCommunityFilters,
  serializeCommunityFilters,
  CommunityError,
  type CommunityProfile,
  type CommunityFretesListResult,
} from '../../../services/admin/comunidade';
import CommunityProfileForm from '../../../components/admin/comunidade/CommunityProfileForm';
import CommunityImportPanel from '../../../components/admin/comunidade/CommunityImportPanel';
import CommunityFretesTable from '../../../components/admin/comunidade/CommunityFretesTable';

export default function CommunityListPage() {
  const { allowed: canView } = useAdminPermission('FINANCEIRO_VIEW');
  const { allowed: canEdit } = useAdminPermission('FINANCEIRO_EDIT');

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseCommunityFilters(searchParams), [searchParams]);

  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [list, setList] = useState<CommunityFretesListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [prof, fretes] = await Promise.all([
          getCommunityProfile(),
          listCommunityFretes(filters),
        ]);
        if (cancelled) return;
        setProfile(prof);
        setList(fretes);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof CommunityError ? err.message : (err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, filters, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const updateFilters = useCallback(
    (patch: Partial<typeof filters>) => {
      setSearchParams(serializeCommunityFilters({ ...filters, ...patch }));
    },
    [filters, setSearchParams]
  );

  if (!canView) return <Stealth404 />;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {profile && (
        <CommunityProfileForm profile={profile} canEdit={canEdit} onSaved={reload} />
      )}

      <CommunityImportPanel canEdit={canEdit} onPublished={reload} />

      <CommunityFretesTable
        rows={list?.rows ?? []}
        total={list?.total ?? 0}
        limit={filters.limit ?? 10}
        offset={filters.offset ?? 0}
        loading={loading}
        onPageChange={(offset) => updateFilters({ offset })}
        onLimitChange={(limit) => updateFilters({ limit, offset: 0 })}
      />
    </div>
  );
}
