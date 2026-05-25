import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
          <div className="max-w-md bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            <svg
              className="w-16 h-16 text-red-500 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
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
                onClick={() => {
                  // Recupera tentando re-renderizar a árvore atual sem hard reload.
                  // Hard reload faz o AuthProvider rodar getCurrentUser() de novo
                  // e, em conexão ruim, pode falhar e deslogar o usuário.
                  this.setState({ hasError: false, error: null });
                }}
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

    return this.props.children;
  }
}
