import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '../services/platform';

/**
 * Trata o botão de voltar nativo do Android dentro do app Capacitor.
 *
 * Comportamento:
 * - Se houver histórico, volta uma página.
 * - Se está na rota raiz `/`, exibe confirmação de saída e fecha o app
 *   se o usuário confirmar.
 *
 * No web não faz nada (o botão de voltar do navegador já é nativo).
 */
export default function NativeBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNative()) return;

    let cleanup: (() => void) | undefined;

    CapacitorApp.addListener('backButton', () => {
      const isRoot = location.pathname === '/' || location.pathname === '/embarcador';

      if (isRoot) {
        // Confirma saida do app
        const ok = window.confirm('Deseja sair do FreteGO?');
        if (ok) {
          CapacitorApp.exitApp();
        }
      } else {
        navigate(-1);
      }
    }).then((handle) => {
      cleanup = () => handle.remove();
    });

    return () => {
      cleanup?.();
    };
  }, [navigate, location.pathname]);

  return null;
}
