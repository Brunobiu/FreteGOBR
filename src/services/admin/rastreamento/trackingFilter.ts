/**
 * rastreamento/trackingFilter.ts — sanitização do texto de busca do Tracking_Filter.
 *
 * **Reusa** `escapeIlike`/`normalizeQuery` de `admin-cliente-360` (espelho exato
 * da sanitização SQL de `admin_global_search`): NÃO recria o escape de curingas
 * `ILIKE` (`%`, `_`, `\`). A `Global_Search` de cliente-360 continua sendo a
 * autoridade de identificação por nome/e-mail/telefone/ID/empresa.
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.8).
 * _Requirements: 13.5, 13.6_
 */

export { escapeIlike, normalizeQuery } from '../cliente360/search';
