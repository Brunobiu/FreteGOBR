/**
 * MessagePreview (tasks 20.5 e 10.3, Req 25.1, 25.2, 25.4, 25.5, 25.6, 25.7)
 *
 * Pré-visualização da mensagem renderizada com DADOS DE EXEMPLO, reusando a
 * função pura `renderMessage` (a mesma usada no envio). Indica as
 * Message_Variables reconhecidas (`{{nome}}`/`{{telefone}}`/`{{empresa}}`) e as
 * desconhecidas (que são removidas na renderização). NUNCA altera o template
 * armazenado (recebe `template` por prop e só lê — Req 25.7); o resultado nunca
 * contém marcador `{{...}}` literal (Property 8).
 */

import { useMemo } from 'react';
import {
  renderMessage,
  SUPPORTED_VARIABLES,
  type RecipientData,
} from '../../../services/admin/whatsapp/render';

interface Props {
  /** Template do Content (com as variáveis não resolvidas). */
  template: string;
  /** Dados de exemplo opcionais; default usa um destinatário fictício. */
  sample?: RecipientData;
}

/** Recipient_Data de exemplo para a pré-visualização (Req 25.6). */
const DEFAULT_SAMPLE: RecipientData = {
  nome: 'Maria Silva',
  telefone: '+5562999998888',
  empresa: 'Transportes Acme',
};

const MARKER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Extrai os nomes de variáveis presentes no template (lower, dedup). */
function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(MARKER)) {
    const name = (match[1] ?? '').trim().toLowerCase();
    if (name) found.add(name);
  }
  return [...found];
}

export default function MessagePreview({ template, sample = DEFAULT_SAMPLE }: Props) {
  const rendered = useMemo(() => renderMessage(template, sample), [template, sample]);
  const variables = useMemo(() => extractVariables(template), [template]);

  const recognized = variables.filter((v) =>
    (SUPPORTED_VARIABLES as readonly string[]).includes(v)
  );
  const unknown = variables.filter(
    (v) => !(SUPPORTED_VARIABLES as readonly string[]).includes(v)
  );

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
        Pré-visualização (dados de exemplo)
      </div>

      {/* Bolha estilo WhatsApp */}
      <div className="rounded-lg rounded-tl-none bg-green-900/30 p-2.5 text-sm text-gray-100 whitespace-pre-wrap break-words">
        {rendered.length > 0 ? rendered : <span className="text-gray-500">(mensagem vazia)</span>}
      </div>

      {/* Variáveis reconhecidas / desconhecidas (Req 25.6) */}
      {variables.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {recognized.map((v) => (
            <span
              key={`ok-${v}`}
              className="rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-300"
              title="Variável reconhecida"
            >
              {`{{${v}}}`}
            </span>
          ))}
          {unknown.map((v) => (
            <span
              key={`x-${v}`}
              className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400 line-through"
              title="Variável desconhecida (será removida)"
            >
              {`{{${v}}}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
