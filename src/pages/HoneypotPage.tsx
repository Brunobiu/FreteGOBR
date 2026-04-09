/**
 * HoneypotPage - Página armadilha para detectar scanners e bots
 * 
 * Esta página não deve ser linkada em nenhum lugar do site.
 * Qualquer acesso a ela indica atividade suspeita (scanner de vulnerabilidades).
 */

import { useEffect } from 'react';
import HoneypotDetector from '../services/honeypotDetector';

export default function HoneypotPage() {
  useEffect(() => {
    // Registrar acesso à rota honeypot
    HoneypotDetector.handleRouteAccess(
      window.location.pathname,
      'client-side', // Em produção, obtido via header
      navigator.userAgent
    );
  }, []);

  // Retorna uma página fake de admin para enganar o bot
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded shadow-md max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Admin Login</h1>
        <form className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Username</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded"
              placeholder="••••••"
            />
          </div>
          <button
            type="button"
            className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Login
          </button>
        </form>
        <p className="mt-4 text-xs text-gray-400 text-center">
          Admin Panel v2.1.0
        </p>
      </div>
    </div>
  );
}
