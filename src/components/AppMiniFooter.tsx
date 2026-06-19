/**
 * AppMiniFooter — rodapé minimalista exibido SOMENTE no app nativo
 * (Android/iOS).
 *
 * Mantém apenas o link de "Termos de Uso" e a versão do app, com layout
 * limpo e centralizado, para uma aparência mais profissional dentro do
 * aplicativo. Na web, as páginas públicas continuam usando o
 * <SiteFooter /> completo (sem alteração).
 *
 * Uso padrão nas telas públicas (login, cadastro, landing):
 *
 *   import { Capacitor } from '@capacitor/core';
 *   const isApp = Capacitor.isNativePlatform();
 *   ...
 *   {isApp ? <AppMiniFooter /> : <SiteFooter />}
 */

import { Link } from 'react-router-dom';
import { LEGAL_DOCS } from '../data/legal';

// Versao exibida no rodape do app. Manter em sintonia com o versionName
// nativo (android/app/build.gradle e iOS). Atualmente "1.0".
export const APP_VERSION = '1.0';

export default function AppMiniFooter() {
  return (
    <footer className="px-4 pb-6 pt-2 text-center">
      <Link
        to={LEGAL_DOCS.terms.route}
        className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
      >
        {LEGAL_DOCS.terms.title}
      </Link>
      <p className="mt-1 text-[11px] text-gray-300">FreteGO v{APP_VERSION}</p>
    </footer>
  );
}
