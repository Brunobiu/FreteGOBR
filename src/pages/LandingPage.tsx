/**
 * LandingPage — página de entrada pública do FreteGO (rota `/` para
 * visitantes não logados).
 *
 * Estrutura básica (será expandida depois):
 *  - Header: logo à esquerda, botões "Ver fretes" e "Entrar" à direita.
 *  - Hero central com chamada e botão principal "Ver fretes".
 *  - Mesma identidade visual do app (fundo cinza-claro, verde de ação).
 *  - SiteFooter (Termos/Privacidade).
 *
 * Fluxo: Landing → "Ver fretes" (/fretes) → cadastro/login.
 */

import { Link, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import SiteFooter from '../components/SiteFooter';

export default function LandingPage() {
  useDocumentTitle(null);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Esquerda: logo */}
          <Link to="/" aria-label="FreteGO" className="flex items-center">
            <img
              src="/logo.png"
              alt="FreteGO"
              className="h-9 sm:h-11 w-auto object-contain select-none"
              draggable={false}
            />
          </Link>

          {/* Direita: ações */}
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/login"
              className="text-sm font-medium text-gray-700 hover:text-gray-900 px-2"
            >
              Entrar
            </Link>
            <button
              type="button"
              onClick={() => navigate('/fretes')}
              className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
            >
              Ver fretes
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-3xl text-center">
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 leading-tight">
            Fretes que cabem na sua rota
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-xl mx-auto">
            O FreteGO conecta caminhoneiros e embarcadores. Veja os fretes disponíveis perto de você
            e negocie direto, sem complicação.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/fretes')}
              className="w-full sm:w-auto px-6 py-3 text-base font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors shadow-sm"
            >
              Ver fretes
            </button>
            <Link
              to="/register"
              className="w-full sm:w-auto px-6 py-3 text-base font-semibold bg-white text-gray-800 border border-gray-300 rounded-xl hover:border-green-500 hover:text-green-700 transition-colors text-center"
            >
              Criar conta
            </Link>
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Já tem conta?{' '}
            <Link to="/login" className="text-green-700 font-medium hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
