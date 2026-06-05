/**
 * Tipos compartilhados do conteúdo legal (Feature 1 — legal).
 */

export interface LegalSection {
  /** Âncora para navegação por índice. */
  id: string;
  /** Título da seção (inclui numeração). */
  heading: string;
  /** Parágrafos do corpo da seção. */
  body: string[];
  /** Itens de lista opcionais exibidos após o corpo. */
  bullets?: string[];
}
