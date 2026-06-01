/**
 * MarketingConfigPage — /admin/marketing/configuracoes
 *
 * Página de configuração da integração Meta (módulo admin-marketing, migration
 * 048). Casca fina: apenas aplica o gating de UI e renderiza o formulário
 * autossuficiente `MarketingConfigForm`.
 *
 * Gating em duas camadas (admin-patterns.md §2/§5):
 *   - Camada 1 (UI): `useAdminPermission('MARKETING_EDIT')`. Sem a permissão,
 *     renderiza `Stealth404` — 404 furtivo idêntico ao público, sem revelar a
 *     existência da rota (Req 1.5/1.6).
 *   - Camada 2 (servidor): reaplicada nas RPCs `SECURITY DEFINER` chamadas pelos
 *     wrappers de service usados internamente pelo formulário.
 *
 * O `MarketingConfigForm` é AUTOSSUFICIENTE: lê a config vigente via
 * `getConfig()`, salva via `updateConfig`/`setToken`/`clearToken`, trata
 * `STALE_VERSION` (toast informativo + refetch) e exibe o toast de sucesso
 * `Configuração salva.` com `role="status"` (Req 3.1, 3.13). Esta página só o
 * monta na casca compacta — SEM `<h1>` grande no topo (a sidebar já identifica
 * o módulo; Compact_Layout_Pattern / project-conventions.md).
 *
 * Requisitos: 1.2, 1.5, 1.6, 3.1, 3.11, 3.13.
 */

import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import MarketingConfigForm from '../../../components/admin/marketing/MarketingConfigForm';

export default function MarketingConfigPage() {
  // Camada 1 (UI): sem MARKETING_EDIT cai no 404 furtivo (Req 1.5/1.6). O
  // servidor reaplica o gating nas RPCs invocadas pelo formulário.
  const { allowed: canEdit } = useAdminPermission('MARKETING_EDIT');
  if (!canEdit) return <Stealth404 />;

  return (
    <div className="space-y-3">
      {/* Subtítulo discreto — sem <h1> grande (Compact_Layout_Pattern). */}
      <p className="text-xs text-gray-500">Configurar integração Meta</p>

      {/* Formulário autossuficiente: faz o próprio fetch/save e trata
          STALE_VERSION + toast de sucesso internamente (Req 3.1, 3.13). */}
      <MarketingConfigForm />
    </div>
  );
}
