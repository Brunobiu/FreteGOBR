/**
 * render.ts
 *
 * Renderizacao de variaveis de mensagem do WhatsApp_Module (Req 25).
 *
 * Funcao PURA, sem I/O nem efeitos colaterais (alvo de property test P8).
 * Resolve as Message_Variables `{{nome}}`, `{{telefone}}` e `{{empresa}}` por
 * Dispatch_Recipient no momento do envio, a partir do Recipient_Data.
 *
 * Invariantes (design.md "Renderizacao de variaveis (Req 25)" / Property 8):
 *  - Variavel suportada ausente/vazia => string vazia (ou fallback configurado),
 *    nunca o marcador literal (Req 25.4).
 *  - Variavel desconhecida => removida (string vazia), sem abortar (Req 25.5).
 *  - A Rendered_Message nunca contem um marcador `{{...}}` literal (Property 8).
 *  - O template armazenado nunca e alterado (Req 25.7).
 */

/**
 * Conjunto fechado de Message_Variables suportadas (Req 25.1).
 * `telefone` e derivado do Contact_Number; `nome`/`empresa` vem do CSV_Import.
 */
export const SUPPORTED_VARIABLES = ['nome', 'telefone', 'empresa'] as const;

export type SupportedVariable = (typeof SUPPORTED_VARIABLES)[number];

/**
 * Recipient_Data de um Dispatch_Recipient (Req 25.2, 25.3).
 *
 * Os campos suportados sao opcionais (podem estar ausentes/vazios). Campos
 * adicionais oriundos do CSV sao tolerados, mas apenas as SUPPORTED_VARIABLES
 * sao substituidas; quaisquer outras variaveis no template sao removidas.
 */
export type RecipientData = {
  nome?: string;
  telefone?: string;
  empresa?: string;
} & Record<string, string | undefined>;

/**
 * Valores de fallback opcionais por variavel suportada (Req 25.4). Usados quando
 * o Recipient_Data nao possui valor (ausente ou vazio) para a variavel.
 */
export type VariableFallbacks = Partial<Record<SupportedVariable, string>>;

// Captura qualquer marcador `{{ ... }}` do template, tolerando espacos internos.
// O conteudo capturado nao inclui chaves aninhadas para evitar matches ambiguos.
const VARIABLE_MARKER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function isSupportedVariable(name: string): name is SupportedVariable {
  return (SUPPORTED_VARIABLES as readonly string[]).includes(name);
}

/**
 * Gera a Rendered_Message substituindo as Message_Variables do template pelos
 * valores do Recipient_Data, em uma unica passada (os valores substituidos NAO
 * sao reprocessados). Nao muta `template` nem `data`.
 *
 * @param template Texto do Content com as variaveis nao resolvidas.
 * @param data Recipient_Data do Dispatch_Recipient.
 * @param fallbacks Fallbacks opcionais por variavel suportada (Req 25.4).
 * @returns Rendered_Message sem nenhum marcador `{{...}}` literal.
 */
export function renderMessage(
  template: string,
  data: RecipientData,
  fallbacks: VariableFallbacks = {}
): string {
  return template.replace(VARIABLE_MARKER, (_match, rawName: string) => {
    const name = rawName.trim().toLowerCase();

    // Variavel desconhecida => removida (string vazia), sem abortar (Req 25.5).
    if (!isSupportedVariable(name)) {
      return '';
    }

    // Variavel suportada: usa o valor do Recipient_Data quando presente e nao
    // vazio; caso contrario, o fallback configurado; senao, string vazia (Req 25.4).
    const value = data[name];
    if (value !== undefined && value !== '') {
      return value;
    }

    return fallbacks[name] ?? '';
  });
}
