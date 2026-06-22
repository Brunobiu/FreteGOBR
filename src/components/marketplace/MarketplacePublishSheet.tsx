/**
 * MarketplacePublishSheet — formulário de publicação de anúncio.
 *
 * Campos: título (máx. 30), valor (obrigatório, com máscara "R$" e milhar),
 * descrição (máx. 2000) e até 10 fotos (galeria com seleção múltipla ou câmera).
 * A localização é obrigatória e forçada pelo MarketplaceLocationGate. O botão
 * "Publicar" fica desabilitado enquanto a validação (núcleo puro) não passar.
 *
 * Validates: Requirements 2.1-2.6, 3.x, 4.4, 4.5, 5.1, 5.2
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { GeographicPoint } from '../../types';
import {
  createMarketplacePost,
  MarketplaceError,
  type MarketplacePost,
} from '../../services/marketplace';
import {
  validateMarketplacePostInput,
  groupThousands,
  MAX_PHOTOS,
  TITLE_MAX,
} from '../../utils/marketplacePost';
import MarketplaceLocationGate from './MarketplaceLocationGate';

interface Props {
  author: { id: string; name: string; profilePhotoUrl: string | null };
  onClose: () => void;
  onPublished: (post: MarketplacePost) => void;
}

const IMG_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

function objectUrl(file: File): string {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(file)
    : '';
}

export default function MarketplacePublishSheet({ author, onClose, onPublished }: Props) {
  const [title, setTitle] = useState('');
  const [priceDigits, setPriceDigits] = useState(''); // só dígitos (reais inteiros)
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [point, setPoint] = useState<GeographicPoint | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleResolved = useCallback((p: GeographicPoint, label: string) => {
    setPoint(p);
    setLocationLabel(label);
  }, []);

  const previews = useMemo(() => photos.map(objectUrl), [photos]);

  const effectivePrice = priceDigits ? Number(priceDigits) : null;

  const validation = validateMarketplacePostInput({
    postType: 'venda',
    title,
    description,
    price: effectivePrice,
    photos: photos.map((f) => ({ mime: f.type, sizeBytes: f.size })),
    hasLocation: Boolean(point),
  });
  const canPublish = validation.ok && !submitting;

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setPhotos((prev) => {
      const room = MAX_PHOTOS - prev.length;
      if (room <= 0) {
        setError('Você pode adicionar no máximo 10 fotos.');
        return prev;
      }
      if (incoming.length > room) {
        setError('Você pode adicionar no máximo 10 fotos.');
      } else {
        setError(null);
      }
      return [...prev, ...incoming.slice(0, room)];
    });
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handlePublish() {
    if (!point || effectivePrice == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await createMarketplacePost({
        authorId: author.id,
        authorName: author.name,
        authorPhotoPath: author.profilePhotoUrl,
        postType: 'venda',
        title,
        description,
        price: effectivePrice,
        photos,
        point,
        locationLabel,
      });
      onPublished(post);
    } catch (err) {
      setError(
        err instanceof MarketplaceError ? err.message : 'Não foi possível publicar. Tente novamente.'
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Publicar anúncio"
        aria-modal="true"
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl"
      >
        {/* Cabeçalho */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Publicar anúncio</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Título */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="mp-title">
              Título
            </label>
            <input
              id="mp-title"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Caminhão Volkswagen 2008"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="mt-0.5 text-[10px] text-gray-400 text-right">
              {title.length}/{TITLE_MAX}
            </p>
          </div>

          {/* Valor (obrigatório, máscara R$ + milhar) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="mp-price">
              Valor
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-sm text-gray-500 pointer-events-none">
                R$
              </span>
              <input
                id="mp-price"
                type="text"
                inputMode="numeric"
                value={priceDigits ? groupThousands(priceDigits) : ''}
                onChange={(e) => setPriceDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="0"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="mp-desc">
              Descrição
            </label>
            <textarea
              id="mp-desc"
              value={description}
              maxLength={2000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Conte os detalhes do que está anunciando."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="mt-0.5 text-[10px] text-gray-400 text-right">
              {description.length}/2000
            </p>
          </div>

          {/* Fotos */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Fotos ({photos.length}/{MAX_PHOTOS})
            </label>

            {/* Galeria com seleção MÚLTIPLA (ação principal) */}
            <input
              ref={galleryRef}
              type="file"
              accept={IMG_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {/* Câmera (uma foto por vez) */}
            <input
              ref={cameraRef}
              type="file"
              accept={IMG_ACCEPT}
              capture="environment"
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <div className="grid grid-cols-4 gap-2">
              {previews.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                  {url && <img src={url} alt="" className="w-full h-full object-cover" />}
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label={`Remover foto ${i + 1}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:text-green-600 hover:border-green-400"
                  aria-label="Adicionar fotos"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z" />
                  </svg>
                  <span className="text-[10px] mt-0.5">Adicionar</span>
                </button>
              )}
            </div>

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-green-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Usar câmera
              </button>
            )}
            <p className="mt-1 text-[10px] text-gray-400">
              Você pode selecionar várias fotos de uma vez na galeria.
            </p>
          </div>

          {/* Localização obrigatória */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Localização</label>
            <MarketplaceLocationGate onResolved={handleResolved} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Rodapé */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={handlePublish}
            disabled={!canPublish}
            className="w-full py-2.5 rounded-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
