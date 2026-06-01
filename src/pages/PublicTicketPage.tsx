import { Link } from 'react-router-dom';
import PublicTicketForm from '../components/PublicTicketForm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePixel } from '../components/marketing/pixelContext';

/**
 * Página pública `/contato` para visitantes anônimos enviarem tickets de
 * suporte sem precisar criar conta. O componente `PublicTicketForm` lida
 * com a lógica de submit e anti-bot.
 */
export default function PublicTicketPage() {
  useDocumentTitle('Contato — FreteGO');
  const { trackEvent } = usePixel();

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header simples */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" aria-label="FreteGO" className="flex items-center">
            <img
              src="/logo.png"
              alt="FreteGO"
              className="h-9 sm:h-11 w-auto object-contain select-none"
              draggable={false}
            />
          </Link>
          <nav className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-gray-700 hover:text-gray-900">
              Entrar
            </Link>
            <Link
              to="/register"
              className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 w-full max-w-md">
          {/*
            Dispara o Tracked_Event `lead` (browser) na conclusao do contato
            publico. O `event_id` e gerado uma unica vez por ocorrencia (CP-4);
            a porta de consentimento (CP-5) e aplicada dentro do Pixel_Loader.
            O disparo server-side (CAPI) com o MESMO event_id e fiado na 7.5.
          */}
          <PublicTicketForm withHeader onSuccess={() => trackEvent('lead')} />

          <div className="mt-6 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
            <p>
              Já tem conta?{' '}
              <Link to="/login" className="text-green-700 font-medium hover:underline">
                Entrar
              </Link>
            </p>
            <p className="mt-2">
              Ao enviar, voce concorda com receber resposta no e-mail informado.
            </p>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 px-4 py-4 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} FreteGO — Todos os direitos reservados.
      </footer>
    </div>
  );
}
