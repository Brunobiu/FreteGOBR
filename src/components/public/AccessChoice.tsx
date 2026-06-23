/**
 * AccessChoice — quando o visitante clica num CTA que leva a cadastro/login
 * (Entrar, Criar conta grátis, Começar de graça...), em vez de ir direto,
 * abre um modal perguntando se ele prefere BAIXAR O APP (App Store / Google
 * Play) ou CONTINUAR NA WEB. Se escolher web, segue pro destino original.
 *
 * Peças:
 *   - AccessChoiceProvider: monta o modal uma vez (no App, dentro do Router).
 *   - useAccessChoice(): hook (pode ser null se não houver provider).
 *   - AccessButton: usar no lugar de <Link> nos CTAs de cadastro/login. Sem
 *     provider (ex.: em testes isolados) cai num <Link> normal — não quebra.
 *
 * App ainda não publicado: os botões de loja apontam pra página "App em breve"
 * (APP_STORE_URL/PLAY_STORE_URL em src/data/appLinks). Quando publicar, troca
 * só lá.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { APP_STORE_URL, PLAY_STORE_URL } from '../../data/appLinks';

type AccessChoiceContextValue = { requestAccess: (to: string) => void };
const AccessChoiceContext = createContext<AccessChoiceContextValue | null>(null);

/** Rotas que disparam o modal (entrada no produto). */
function isAuthRoute(to: string): boolean {
  return to === '/register' || to === '/login';
}

type IconProps = { className?: string };

function Apple({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.564 13.13c-.03-3.05 2.49-4.51 2.6-4.58-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.41-1.07-3.96-1.04-2.04.03-3.92 1.18-4.97 3.01-2.12 3.68-.54 9.12 1.52 12.11 1.01 1.46 2.21 3.1 3.78 3.04 1.52-.06 2.09-.98 3.93-.98 1.83 0 2.35.98 3.96.95 1.63-.03 2.66-1.49 3.66-2.96 1.15-1.69 1.62-3.32 1.65-3.41-.04-.02-3.17-1.22-3.2-4.83z" />
      <path d="M14.78 4.27c.84-1.02 1.41-2.43 1.25-3.84-1.21.05-2.68.81-3.54 1.83-.78.9-1.46 2.34-1.28 3.71 1.35.11 2.73-.68 3.57-1.7z" />
    </svg>
  );
}

function GooglePlay({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#00C3FF"
        d="M3.6 1.81C3.24 2 3 2.36 3 2.83v18.34c0 .47.24.83.6 1.02l.06.06 10.28-10.28v-.12L3.66 1.75l-.06.06z"
      />
      <path
        fill="#FFCE00"
        d="M17.3 8.42 13.94 12.06v.12l3.36 3.64.08-.05 4.06-2.31c1.16-.66 1.16-1.74 0-2.4l-4.06-2.31-.08-.04z"
      />
      <path
        fill="#FF424D"
        d="M13.94 12.06 3.6 22.19c.38.4 1.01.45 1.72.05l11.98-6.81-3.36-3.37z"
      />
      <path fill="#00D76F" d="M5.32 1.71C4.61 1.31 3.98 1.36 3.6 1.76l10.34 10.3 3.36-3.64L5.32 1.71z" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function StoreButton({
  href,
  topLabel,
  bottomLabel,
  icon,
}: {
  href: string;
  topLabel: string;
  bottomLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-center gap-2.5 rounded-xl bg-gray-900 px-4 py-2.5 text-white shadow-sm transition-colors hover:bg-black"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col text-left leading-none">
        <span className="text-[10px] font-medium text-white/70">{topLabel}</span>
        <span className="text-sm font-semibold tracking-tight">{bottomLabel}</span>
      </span>
    </a>
  );
}

function AccessChoiceModal({
  onClose,
  onContinueWeb,
}: {
  onClose: () => void;
  onContinueWeb: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-choice-title"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        <h2 id="access-choice-title" className="pr-6 text-lg font-extrabold text-gray-900 sm:text-xl">
          Como você prefere usar o FreteGO?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Baixe o aplicativo e tenha a melhor experiência.
        </p>

        {/* Lojas — foco do modal */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <StoreButton
            href={APP_STORE_URL}
            topLabel="Baixar na"
            bottomLabel="App Store"
            icon={<Apple className="h-6 w-6" />}
          />
          <StoreButton
            href={PLAY_STORE_URL}
            topLabel="Disponível no"
            bottomLabel="Google Play"
            icon={<GooglePlay className="h-5 w-5" />}
          />
        </div>

        {/* Continuar na web — link discreto (botão disfarçado): o acesso web
            continua funcionando, mas sem destaque, pra incentivar o download
            do app. */}
        <button
          type="button"
          onClick={onContinueWeb}
          className="mx-auto mt-5 block text-center text-xs text-gray-400 underline-offset-2 transition-colors hover:text-gray-600 hover:underline"
        >
          Continuar na versão web
        </button>
      </div>
    </div>
  );
}

export function AccessChoiceProvider({ children }: { children: React.ReactNode }) {
  const [dest, setDest] = useState<string | null>(null);
  const navigate = useNavigate();

  const requestAccess = useCallback((to: string) => setDest(to), []);
  const close = useCallback(() => setDest(null), []);
  const continueWeb = useCallback(() => {
    setDest((current) => {
      if (current) navigate(current);
      return null;
    });
  }, [navigate]);

  const value = useMemo(() => ({ requestAccess }), [requestAccess]);

  return (
    <AccessChoiceContext.Provider value={value}>
      {children}
      {dest !== null && <AccessChoiceModal onClose={close} onContinueWeb={continueWeb} />}
    </AccessChoiceContext.Provider>
  );
}

/**
 * Botão de CTA que, em rotas de cadastro/login e com o provider montado, abre
 * o modal de escolha App/Web. Em qualquer outro caso (rota não-auth, ou sem
 * provider) se comporta como um <Link> normal.
 */
export function AccessButton({
  to,
  className,
  children,
  ariaLabel,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const ctx = useContext(AccessChoiceContext);
  if (ctx && isAuthRoute(to)) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => ctx.requestAccess(to)}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }
  return (
    <Link to={to} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
