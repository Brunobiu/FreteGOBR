import { useEffect } from 'react';

/**
 * Atualiza o título da aba do navegador.
 * Sempre prefixa com "FreteGO". Ex: useDocumentTitle('Embarcador')
 * resulta em "FreteGO - Embarcador".
 */
export function useDocumentTitle(suffix?: string | null) {
  useEffect(() => {
    const previous = document.title;
    document.title = suffix ? `FreteGO - ${suffix}` : 'FreteGO';
    return () => {
      document.title = previous;
    };
  }, [suffix]);
}
