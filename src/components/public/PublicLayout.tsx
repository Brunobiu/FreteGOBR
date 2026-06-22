/**
 * PublicLayout — moldura comum das páginas públicas: cabeçalho único
 * (PublicHeader) + conteúdo + rodapé. Centraliza o switch de rodapé
 * (SiteFooter na web / AppMiniFooter no app nativo) pra que toda página
 * pública tenha exatamente o mesmo header e o mesmo footer.
 *
 * Uso:
 *   - Landing (rota `/`): <PublicLayout headerVariant="landing"> — header
 *     translúcido/fixo sobre o hero.
 *   - Demais páginas públicas: <PublicLayout> (headerVariant="solid" é o
 *     padrão) — header branco sólido no topo.
 */

import { Capacitor } from '@capacitor/core';
import SiteFooter from '../SiteFooter';
import AppMiniFooter from '../AppMiniFooter';
import PublicHeader from './PublicHeader';

export default function PublicLayout({
  children,
  headerVariant = 'solid',
}: {
  children: React.ReactNode;
  headerVariant?: 'landing' | 'solid';
}) {
  // App nativo (Android/iOS): rodapé mínimo. Web: SiteFooter completo.
  const isApp = Capacitor.isNativePlatform();

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <PublicHeader variant={headerVariant} />
      {children}
      {isApp ? <AppMiniFooter /> : <SiteFooter />}
    </div>
  );
}
