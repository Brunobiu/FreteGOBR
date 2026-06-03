/**
 * FreteRetornoModal — busca de fretes de retorno a partir do
 * destino do frete atualmente em visualização.
 *
 * Objetivo: permitir que o motorista veja, de dentro do detalhe do
 * frete original, quais cargas estão disponíveis ao chegar no destino,
 * evitando voltar vazio.
 *
 * Lógica:
 *   - Recebe `origemFrete` (o frete que o motorista estava
 *     visualizando).
 *   - Usa `findNearbyFretes(destino.lat, destino.lng, radiusKm)` —
 *     a função SQL `find_nearby_fretes` aceita ponto arbitrário, então
 *     basta passar as coordenadas do destino do frete original.
 *   - Filtra o próprio frete original da lista (não faz sentido
 *     sugerir ele mesmo como retorno).
 *   - Permite trocar entre 50 km (default) e 100 km.
 *   - Cancela request anterior ao trocar de raio (flag em ref).
 *
 * Estados visuais:
 *   - Loading: 3 skeletons.
 *   - Erro: card vermelho com botão "Tentar novamente".
 *   - Vazio: sugestão de aumentar raio.
 *   - Lista: cards compactos com origem→destino, valor, distância
 *     e botão "Ver detalhes".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { findNearbyFretes, type Frete } from '../services/fretes';
import { haversineDistanceKm } from '../utils/geoDistance';

type RetornoRadius = 50 | 100;

interface FreteRetornoModalProps {
  open: boolean;
  onClose: () => void;
  /** Frete cujo destino é a nova origem da busca de retornos. */
  origemFrete: Frete;
  /** Disparado quando o motorista escolhe um frete de retorno. */
  onSelectRetorno: (frete: Frete) => void;
}

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const formatKm = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function FreteRetornoModal({
  open,
  onClose,
  origemFrete,
  onSelectRetorno,
}: FreteRetornoModalProps) {
  const [radiusKm, setRadiusKm] = useState<RetornoRadius>(50);
  const [fretes, setFretes] = useState<Frete[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<{ cancelled: boolean } | null>(null);

  const dest = origemFrete.destinationLocation;
  const validDest =
    Number.isFinite(dest.latitude) &&
    Number.isFinite(dest.longitude) &&
    !(dest.latitude === 0 && dest.longitude === 0);

  // Animação de entrada.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  // ESC fecha.
  useEffect(() => {
    if (!mounted) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mounted, onClose]);

  // Trava scroll do body enquanto aberto.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Carrega fretes de retorno ao abrir + quando o raio muda.
  useEffect(() => {
    if (!open || !validDest) return;

    // Cancela request anterior, se existir.
    if (abortRef.current) abortRef.current.cancelled = true;
    const flag = { cancelled: false };
    abortRef.current = flag;

    setLoading(true);
    setError(null);
    setFretes(null);

    (async () => {
      try {
        const result = await findNearbyFretes(dest.latitude, dest.longitude, radiusKm);
        if (flag.cancelled) return;
        setFretes(result);
      } catch (err) {
        if (flag.cancelled) return;
        setError(err instanceof Error ? err.message : 'Erro ao buscar fretes de retorno');
      } finally {
        if (!flag.cancelled) setLoading(false);
      }
    })();
  }, [open, radiusKm, dest.latitude, dest.longitude, validDest]);

  // Filtra o próprio frete original da lista.
  const visibleFretes = useMemo(() => {
    if (!fretes) return [];
    return fretes.filter((f) => f.id !== origemFrete.id);
  }, [fretes, origemFrete.id]);

  if (!mounted) return null;

  // Cidade do destino — extrai do label "Cidade, UF".
  const destinoLabel = origemFrete.destination || '—';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fretes de retorno"
      className="fixed inset-0 z-[10000] overflow-hidden"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black transition-opacity duration-300 ease-out ${
          visible ? 'opacity-75' : 'opacity-0'
        }`}
      />

      {/* Painel */}
      <div className="fixed inset-0 flex items-end md:items-center justify-center pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative bg-white border border-gray-200 shadow-xl pointer-events-auto
            w-full md:max-w-2xl
            max-h-[90vh] md:max-h-[85vh] overflow-y-auto
            rounded-t-2xl md:rounded-lg
            transform transition duration-300 ease-out
            ${
              visible
                ? 'translate-y-0 opacity-100 md:scale-100'
                : 'translate-y-full opacity-0 md:translate-y-4 md:scale-95'
            }`}
        >
          {/* Handle de arrasto (mobile) */}
          <div className="md:hidden flex justify-center pt-2 pb-1">
            <span className="block h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />
          </div>

          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-3 sm:px-4 py-2 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-gray-800 leading-tight">
                Fretes disponíveis no destino{' '}
                <span className="text-purple-700">{destinoLabel}</span> — Raio de {radiusKm} km
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Encontre cargas próximas para evitar voltar vazio.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="text-gray-400 hover:text-gray-700 p-1 -mr-1 shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Toggle de raio */}
          <div className="px-3 sm:px-4 py-2 border-b border-gray-100 flex items-center gap-2">
            <span className="text-[11px] text-gray-500">Raio:</span>
            {[50, 100].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r as RetornoRadius)}
                className={`px-3 py-1 text-xs font-medium rounded-full min-h-[32px] transition-colors ${
                  r === radiusKm
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {r} km
              </button>
            ))}
          </div>

          {/* Conteúdo */}
          <div className="p-3 sm:p-4">
            {!validDest ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
                Destino sem coordenadas — não é possível buscar retornos.
              </div>
            ) : loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 rounded-md animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <p className="mb-2">{error}</p>
                <button
                  type="button"
                  onClick={() => setRadiusKm((r) => (r === 50 ? 100 : 50))}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium"
                >
                  Tentar com outro raio
                </button>
              </div>
            ) : visibleFretes.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 text-center">
                Nenhum frete de retorno encontrado em {radiusKm} km de {destinoLabel}.{' '}
                {radiusKm === 50 && (
                  <button
                    type="button"
                    onClick={() => setRadiusKm(100)}
                    className="underline font-medium hover:text-yellow-900"
                  >
                    Tente aumentar o raio para 100 km.
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleFretes.map((f) => {
                  const distOrigem =
                    Number.isFinite(f.originLocation.latitude) && validDest
                      ? haversineDistanceKm(dest, f.originLocation)
                      : null;
                  return (
                    <div
                      key={f.id}
                      className="border border-gray-200 rounded-md p-2.5 bg-white hover:border-purple-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          {f.origin} → {f.destination}
                        </p>
                        <span className="text-xs font-bold text-green-700 shrink-0">
                          {formatBRL(f.value)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                          {f.distanceKm && (
                            <span>Rota: {f.distanceKm.toLocaleString('pt-BR')} km</span>
                          )}
                          {distOrigem !== null && (
                            <span>{formatKm(distOrigem)} km do destino atual</span>
                          )}
                          {f.product && (
                            <span className="text-gray-700 font-medium">{f.product}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectRetorno(f)}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-medium rounded shrink-0"
                        >
                          Ver detalhes
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
