/**
 * MarketplacePage — vitrine de anúncios entre usuários (estilo marketplace).
 *
 * Estado atual (v1, casca funcional):
 *  - Topo: título "Marketplace" + busca (lupa) + botão "Publicar" (verde).
 *  - Abas: "Para você" (ativa por padrão) e "Categorias".
 *  - "Seleções de hoje" com a localização (cidade) puxada do GPS/override.
 *  - Grade de itens ainda sem backend — exibe estado vazio amigável.
 *
 * A barra inferior do motorista continua fixa (renderizada aqui).
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useEffectiveLocation } from '../hooks/useEffectiveLocation';
import { useTabSlideClass } from '../hooks/useTabTransition';

type Tab = 'para-voce' | 'categorias';

export default function MarketplacePage() {
  useDocumentTitle('Marketplace');
  const navigate = useNavigate();
  const slideClass = useTabSlideClass();
  const { address } = useEffectiveLocation();
  const [tab, setTab] = useState<Tab>('para-voce');
  const [query, setQuery] = useState('');

  // Mostra só a cidade (primeira parte de "Cidade, Estado").
  const city = useMemo(() => (address ? address.split(',')[0].trim() : null), [address]);

  return (
    <div className="min-h-screen bg-gray-100 pb-6">
      {/* Topo próprio do Marketplace */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
                aria-label="Voltar"
              >
                <svg
                  className="w-5 h-5 text-gray-700"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Marketplace</h1>
            </div>
            <button
              type="button"
              onClick={() => window.alert('Publicar anúncio: em breve.')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-full shadow-sm"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Publicar
            </button>
          </div>
          {/* Busca */}
          <div className="mt-3 relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-400">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
                />
              </svg>
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no Marketplace"
              className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-gray-200 rounded-full text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Abas */}
          <div className="mt-3 flex gap-2">
            <TabPill
              label="Para você"
              active={tab === 'para-voce'}
              onClick={() => setTab('para-voce')}
            />
            <TabPill
              label="Categorias"
              active={tab === 'categorias'}
              onClick={() => setTab('categorias')}
            />
          </div>
        </div>
      </header>

      <main className={`max-w-2xl mx-auto px-4 py-4 ${slideClass}`}>
        {/* Cabeçalho da seção + localização */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Seleções de hoje</h2>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-blue-600">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
            </svg>
            {city ?? 'Localização'}
          </span>
        </div>

        {/* Grade de itens — vazia por enquanto (sem backend). */}
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-600/10 flex items-center justify-center mb-3">
            <svg
              className="w-6 h-6 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <p className="text-sm text-gray-700 font-medium">Ainda não há anúncios por aqui.</p>
          <p className="text-xs text-gray-500 mt-1">
            Em breve você poderá comprar e vender itens
            {city ? ` em ${city} e região.` : ' na sua região.'}
          </p>
        </div>
      </main>
    </div>
  );
}

function TabPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
        active ? 'bg-green-600/10 text-green-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
}
