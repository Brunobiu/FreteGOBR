/**
 * lazyWithRetry.tsx
 *
 * Carregamento resiliente de chunks (code splitting) para esta feature de
 * otimizacao de inicializacao (startup-performance-optimization).
 *
 * Problema: `React.lazy` nao possui mecanismo de retry nativo. Quando o
 * `import()` de um chunk falha (rede instavel, chunk antigo apos deploy), o
 * componente lanca o erro e, sem tratamento, derruba a arvore acima do
 * Suspense mais proximo — podendo levar toda a aplicacao a um estado de erro.
 *
 * Estrategia (Req 5.5):
 * 1. Envolver o `factory` (`() => import('./Pagina')`) numa funcao que tenta
 *    reimportar UMA vez antes de rejeitar. Falhas transitorias de rede (o caso
 *    mais comum) costumam resolver na segunda tentativa.
 * 2. Persistindo a falha, a rejeicao sobe normalmente. Um error boundary LOCAL
 *    (`LazyBoundary`) captura o erro e exibe um estado recuperavel
 *    (`LazyChunkErrorFallback`) — sem derrubar o restante do app.
 *
 * O retry vive DENTRO do factory passado ao `React.lazy`, preservando a
 * assinatura/contrato de `React.lazy` (retorna `LazyExoticComponent`).
 *
 * Requirements: 5.5
 */

import {
  Component,
  lazy,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';

/** Quantidade de retentativas alem da tentativa inicial (1 retry => 2 tentativas). */
const DEFAULT_RETRIES = 1;

/**
 * Tenta executar o `factory` de import dinamico, reimportando ate `retries`
 * vezes adicionais em caso de falha. Apos esgotar as tentativas, rejeita com o
 * ultimo erro (permitindo que um error boundary local trate de forma
 * recuperavel).
 */
export function retryImport<T>(
  factory: () => Promise<T>,
  retries: number = DEFAULT_RETRIES
): Promise<T> {
  return factory().catch((error: unknown) => {
    if (retries <= 0) {
      throw error;
    }
    return retryImport(factory, retries - 1);
  });
}

/**
 * `React.lazy` com 1 retry de `import()`. Use exatamente como `React.lazy`:
 *
 * ```tsx
 * const HomePage = lazyWithRetry(() => import('./pages/HomePage'));
 * ```
 *
 * Em falha persistente do import, o componente rejeita e deve ser envolvido por
 * `<LazyBoundary>` (ou outro error boundary) para exibir um estado recuperavel
 * sem derrubar o app.
 */
// O parametro de props usa `any` deliberadamente para espelhar a assinatura
// nativa de `React.lazy` (`ComponentType<any>`). Isso garante que
// `lazyWithRetry` seja um drop-in real: aceita tanto componentes sem props
// quanto componentes que recebem props (ex.: paginas com `view`), sem forcar
// casts no ponto de uso.
export function lazyWithRetry<T extends ComponentType<any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() => retryImport(factory));
}

/**
 * Estado de erro recuperavel exibido quando o carregamento de um chunk falha de
 * forma persistente. Mensagens em pt-BR. Oferece "Tentar novamente" (recarrega
 * a aplicacao para buscar os chunks novamente — recuperacao confiavel apos
 * deploy/cache antigo) e um link para voltar ao inicio.
 */
export function LazyChunkErrorFallback({
  onRetry,
}: {
  /** Acao de retry. Default: recarregar a pagina. */
  onRetry?: () => void;
}): JSX.Element {
  const handleRetry = (): void => {
    if (onRetry) {
      onRetry();
      return;
    }
    // Recarregar e a recuperacao confiavel para chunk antigo/ausente: o
    // navegador volta a buscar o manifest e os chunks atualizados.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div
      role="alert"
      className="min-h-[40vh] w-full bg-gray-100 flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-6 text-center shadow-sm">
        <svg
          className="w-12 h-12 text-amber-500 mx-auto mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Não foi possível carregar esta tela
        </h2>
        <p className="text-sm text-gray-500 mb-4">Verifique sua conexão e tente novamente.</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 text-center"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

interface LazyBoundaryProps {
  children: ReactNode;
  /** Fallback customizado; quando ausente usa `LazyChunkErrorFallback`. */
  fallback?: ReactNode;
}

interface LazyBoundaryState {
  hasError: boolean;
}

/**
 * Error boundary LOCAL para componentes carregados via `lazyWithRetry`.
 *
 * Isola a falha de carregamento de chunk a esta regiao da arvore: o restante do
 * app (Shell, demais rotas) continua vivo. Exibe um estado recuperavel ao inves
 * de propagar o erro ate o boundary global.
 *
 * "Tentar novamente" recarrega a aplicacao, pois o `React.lazy` memoiza a
 * promise rejeitada e nao reexecuta o `import()` apenas remontando a arvore;
 * recarregar garante a busca de chunks atualizados.
 */
export class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  constructor(props: LazyBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): LazyBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Falha de carregamento de chunk e recuperavel pelo usuario; nao propagamos
    // ao pipeline de captura global para nao poluir com ruido de rede.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return <LazyChunkErrorFallback />;
    }
    return this.props.children;
  }
}
