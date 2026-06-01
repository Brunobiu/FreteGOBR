/**
 * AppErrorBoundary.tsx
 *
 * Error boundary do React que faz parte da Global_Error_Capture (modulo
 * Assistente). E um superset do `src/components/ErrorBoundary.tsx`: alem de
 * exibir a UI de fallback amigavel, ele captura o erro de renderizacao via
 * `captureError({ errorType: 'react_render' })` em `componentDidCatch`,
 * alimentando o pipeline de captura global (Req 3.1).
 *
 * Por que um componente .tsx separado de errorCapture.ts: o modulo de captura
 * (`src/services/admin/errorCapture.ts`) e .ts puro (sem JSX). O boundary
 * precisa renderizar JSX, entao vive aqui e delega a captura ao modulo central,
 * mantendo a logica de fila/flush/anti-flood centralizada.
 *
 * Requirements: 3.1
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buildErrorDraft, captureError } from '../../../services/admin/errorCapture';

interface Props {
  children: ReactNode;
  /** Fallback opcional; quando ausente usa a UI padrao pt-BR. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Captura global: nunca lança (captureError engole qualquer falha, Req 3.8).
    captureError(
      buildErrorDraft({
        errorType: 'react_render',
        message: error.message,
        // Prefere o componentStack do React quando disponivel; cai no stack do erro.
        stack: errorInfo.componentStack ?? error.stack ?? null,
      })
    );
  }

  private handleRetry = (): void => {
    // Recupera tentando re-renderizar a arvore atual sem hard reload.
    // Hard reload faz o AuthProvider rodar getCurrentUser() de novo e, em
    // conexao ruim, pode falhar e deslogar o usuario.
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <svg
            className="w-16 h-16 text-red-500 mx-auto mb-4"
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
          <h2 className="text-xl font-bold text-white mb-2">Algo deu errado</h2>
          <p className="text-sm text-gray-400 mb-4">
            {this.state.error?.message || 'Ocorreu um erro inesperado.'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Tentar novamente
            </button>
            <a
              href="/"
              className="px-5 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 text-center"
            >
              Voltar ao início
            </a>
          </div>
        </div>
      </div>
    );
  }
}
