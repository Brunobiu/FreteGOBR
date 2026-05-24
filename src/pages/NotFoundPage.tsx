/**
 * 404 padrao do app. Tambem usado pelo Stealth404 do painel admin
 * (mesmo componente, garantindo CP-11 por construcao).
 */

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-7xl font-bold mb-4 bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
          404
        </div>
        <h1 className="text-2xl font-semibold mb-2">Pagina nao encontrada</h1>
        <p className="text-gray-400 mb-8">
          O endereco que voce tentou acessar nao existe ou foi movido.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:opacity-90 transition"
        >
          Voltar para o inicio
        </Link>
      </div>
    </main>
  );
}
