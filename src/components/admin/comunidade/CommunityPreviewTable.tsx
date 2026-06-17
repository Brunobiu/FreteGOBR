/**
 * CommunityPreviewTable — Preview_Import editável célula a célula.
 *
 * Cada linha tem status (válida / erro / duplicada / cidade pendente). Cidades
 * de origem/destino usam City_Autocomplete (resolve coords). Botão Publicar
 * fica desabilitado enquanto não houver ao menos uma linha elegível
 * (válida + cidades resolvidas + não excluída). Duplicados internos podem ser
 * excluídos. spec frete-comunidade (Fase 5 / Req 6.x, 7.x, 8.x, 15.x).
 */

import { useMemo, useState } from 'react';
import {
  validateImportRow,
  isRowPublishable,
  normalizeCommunityPhone,
  type ImportRow,
} from '../../../utils/communitySheet';
import { computeDedupKey, type DedupFields } from '../../../utils/communityDedup';
import {
  publishCommunityFretes,
  CommunityError,
  type PublishRowInput,
  type PublishResult,
} from '../../../services/admin/comunidade';
import CommunityCityAutocomplete from './CommunityCityAutocomplete';

/** Estado editável de cada linha do preview (estende a ImportRow do parser). */
export interface PreviewRow extends ImportRow {
  originResolved: boolean;
  originLat: number | null;
  originLng: number | null;
  destinationResolved: boolean;
  destinationLat: number | null;
  destinationLng: number | null;
  excluded: boolean;
}

interface Props {
  initialRows: ImportRow[];
  onPublished: (result: PublishResult) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export function toPreviewRows(rows: ImportRow[]): PreviewRow[] {
  return rows.map((r) => ({
    ...r,
    originResolved: false,
    originLat: null,
    originLng: null,
    destinationResolved: false,
    destinationLat: null,
    destinationLng: null,
    excluded: false,
  }));
}

function dedupFieldsOf(r: PreviewRow): DedupFields {
  return {
    origin: r.origin,
    destination: r.destination,
    originDetail: r.originDetail,
    destinationDetail: r.destinationDetail,
    value: r.value ?? 0,
    product: r.product,
    carrierName: r.carrierName,
    contactPhone: r.phoneNormalized,
  };
}

export default function CommunityPreviewTable({ initialRows, onPublished }: Props) {
  const [rows, setRows] = useState<PreviewRow[]>(() => toPreviewRows(initialRows));
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (idx: number, patch: Partial<PreviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // Marca duplicados internos (mesma Dedup_Key aparecendo mais de uma vez).
  const dupKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = computeDedupKey(dedupFieldsOf(r));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const stats = useMemo(() => {
    let valid = 0;
    let publishable = 0;
    let pendingCity = 0;
    let duplicates = 0;
    for (const r of rows) {
      const v = validateImportRow(r);
      if (v.ok) valid += 1;
      if (!r.originResolved || !r.destinationResolved) pendingCity += 1;
      if ((dupKeys.get(computeDedupKey(dedupFieldsOf(r))) ?? 0) > 1) duplicates += 1;
      if (
        isRowPublishable(r, {
          originResolved: r.originResolved,
          destinationResolved: r.destinationResolved,
          excluded: r.excluded,
        })
      ) {
        publishable += 1;
      }
    }
    return { valid, publishable, pendingCity, duplicates, total: rows.length };
  }, [rows, dupKeys]);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const payload: PublishRowInput[] = rows
        .filter((r) =>
          isRowPublishable(r, {
            originResolved: r.originResolved,
            destinationResolved: r.destinationResolved,
            excluded: r.excluded,
          })
        )
        .map((r) => ({
          carrierName: r.carrierName,
          origin: r.origin,
          destination: r.destination,
          originDetail: r.originDetail,
          destinationDetail: r.destinationDetail,
          value: r.value ?? 0,
          product: r.product,
          contactPhone: r.phoneNormalized,
          originLat: r.originLat as number,
          originLng: r.originLng as number,
          destinationLat: r.destinationLat as number,
          destinationLng: r.destinationLng as number,
          distanceKm: 0,
          dedupAction: 'insert',
        }));
      const result = await publishCommunityFretes(payload);
      onPublished(result);
    } catch (err) {
      setError(err instanceof CommunityError ? err.message : 'Falha ao publicar.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        <span>Total: {stats.total}</span>
        <span className="text-green-700">Elegíveis: {stats.publishable}</span>
        <span className="text-amber-700">Cidade pendente: {stats.pendingCity}</span>
        <span className="text-red-700">Duplicadas: {stats.duplicates}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-2 py-1">#</th>
              <th className="px-2 py-1">Transportadora</th>
              <th className="px-2 py-1">Origem</th>
              <th className="px-2 py-1">Destino</th>
              <th className="px-2 py-1">Valor</th>
              <th className="px-2 py-1">Produto</th>
              <th className="px-2 py-1">Telefone</th>
              <th className="px-2 py-1">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const v = validateImportRow(r);
              const isDup = (dupKeys.get(computeDedupKey(dedupFieldsOf(r))) ?? 0) > 1;
              return (
                <tr
                  key={idx}
                  className={`border-t border-gray-100 ${r.excluded ? 'opacity-40' : ''} ${
                    isDup ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-gray-400">{r.rowNumber}</td>
                  <td className="px-2 py-1">
                    <input
                      value={r.carrierName}
                      onChange={(e) => update(idx, { carrierName: e.target.value })}
                      className="w-28 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <CommunityCityAutocomplete
                      value={r.origin}
                      resolved={r.originResolved}
                      onChange={(t) => update(idx, { origin: t, originResolved: false })}
                      onResolved={(c, lat, lng) =>
                        update(idx, {
                          origin: c,
                          originResolved: true,
                          originLat: lat,
                          originLng: lng,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <CommunityCityAutocomplete
                      value={r.destination}
                      resolved={r.destinationResolved}
                      onChange={(t) => update(idx, { destination: t, destinationResolved: false })}
                      onResolved={(c, lat, lng) =>
                        update(idx, {
                          destination: c,
                          destinationResolved: true,
                          destinationLat: lat,
                          destinationLng: lng,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={r.value ?? ''}
                      onChange={(e) =>
                        update(idx, {
                          value: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-20 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={r.product}
                      onChange={(e) => update(idx, { product: e.target.value })}
                      className="w-24 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={r.phoneRaw}
                      onChange={(e) =>
                        update(idx, {
                          phoneRaw: e.target.value,
                          phoneNormalized: normalizeCommunityPhone(e.target.value),
                        })
                      }
                      className="w-28 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => update(idx, { excluded: !r.excluded })}
                      className="rounded bg-gray-100 px-2 py-0.5 text-[11px] hover:bg-gray-200"
                    >
                      {r.excluded ? 'Incluir' : 'Excluir'}
                    </button>
                    {!v.ok && !r.excluded && (
                      <span className="ml-1 text-[10px] text-red-600">erro</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => void handlePublish()}
        disabled={publishing || stats.publishable === 0}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {publishing ? 'Publicando...' : `Publicar ${stats.publishable} frete(s)`}
      </button>
    </div>
  );
}
