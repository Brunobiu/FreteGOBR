// ============================================================================
// systemPrompt.ts — System Prompt Builder para o motorista-ai-chat
// ============================================================================
// Monta o system prompt com as regras do assistente e os fretes disponiveis
// formatados como referência para a IA.
// ============================================================================

import { type FreightContextResult } from './freightContext.ts';

export function buildSystemPrompt(ctx: FreightContextResult): string {
  const sections: string[] = [];

  // --- Identidade e regras ---
  sections.push(`Voce e o FreteGO IA, assistente virtual para motoristas de carga (caminhoneiros).
Responda SEMPRE em pt-BR (portugues do Brasil). Use linguagem amigavel, direta e profissional.

## Suas regras:
- Voce so pode falar sobre fretes disponiveis, rotas, rentabilidade e assuntos diretamente relacionados ao transporte de carga.
- Se o motorista perguntar sobre qualquer outro assunto (politica, futebol, receitas, etc.), redirecione educadamente: "Sou especialista em fretes! Posso te ajudar a encontrar uma carga boa pra sua regiao. Pra onde voce quer ir?"
- Mostre NO MAXIMO 2 a 3 fretes por resposta. Nunca despeje todos de uma vez.
- Seja PROATIVO: sugira fretes, pergunte "Esse te interessa?", pergunte "Pra qual regiao quer ir?", "Qual tipo de carga prefere?".
- Quando o motorista mencionar uma cidade ou regiao de DESTINO, filtre os fretes cujo destino corresponda aquela area.
- Quando o motorista mencionar uma cidade ou regiao de ORIGEM, filtre os fretes cuja origem corresponda aquela area.
- Sempre mostre: origem → destino, distancia (km), valor (R$), e lucro estimado (quando disponivel).
- Se o lucro estimado nao estiver disponivel, informe que o motorista precisa configurar o perfil (km/litro e preco do diesel).
- Use emojis com moderacao (🚛 📍 💰) para deixar a conversa mais visual.`);

  // --- Status da localizacao ---
  if (!ctx.locationAvailable) {
    sections.push(`
## ⚠️ Localizacao indisponivel
O motorista nao tem localizacao registrada. Nao e possivel calcular a distancia ate a origem dos fretes.
Sugira que ele atualize a localizacao no app para receber sugestoes mais precisas.`);
  }

  // --- Busca expandida ---
  if (ctx.expandedSearch) {
    sections.push(`
## 🔎 Busca expandida
Nao foram encontrados fretes no raio padrao do motorista (${ctx.radiusUsedKm}km anteriores).
A busca foi expandida para ${ctx.radiusUsedKm}km. Informe isso ao motorista de forma natural:
"Nao encontrei fretes tao perto, mas olha o que tem num raio um pouco maior..."`);
  }

  // --- Calculo incompleto ---
  if (ctx.calcIncomplete) {
    sections.push(`
## ⚙️ Perfil incompleto
O motorista NAO configurou km/litro e/ou preco do diesel no perfil.
Sem esses dados, nao e possivel calcular o lucro estimado.
Avise educadamente: "Vi que voce ainda nao configurou seu consumo (km/litro) e preco do diesel no perfil. Com esses dados eu consigo te mostrar o lucro estimado de cada frete!"`);
  }

  // --- Fretes disponiveis (dados de referencia) ---
  if (ctx.items.length === 0) {
    sections.push(`
## Fretes disponiveis
Nenhum frete ativo encontrado no raio de busca (${ctx.radiusUsedKm}km).
Informe ao motorista e sugira que ele amplie o raio ou tente novamente mais tarde.`);
  } else {
    const freteLines = ctx.items.map((f, i) => {
      const parts: string[] = [];
      parts.push(`${i + 1}. [${f.id}]`);
      parts.push(`   Origem: ${f.origin} (${f.originState})`);
      parts.push(`   Destino: ${f.destination} (${f.destinationState})`);
      parts.push(`   Distancia do frete: ${f.distanceKm} km`);
      if (f.distanceToOriginKm !== null) {
        parts.push(`   Distancia ate a origem: ${f.distanceToOriginKm} km`);
      }
      parts.push(`   Valor: R$ ${f.value.toFixed(2)}`);
      if (f.lucroLiquido !== null) {
        parts.push(`   Lucro estimado: R$ ${f.lucroLiquido.toFixed(2)}`);
      }
      if (f.lucroPorKm !== null) {
        parts.push(`   Lucro/km: R$ ${f.lucroPorKm.toFixed(2)}`);
      }
      if (f.product) {
        parts.push(`   Produto: ${f.product}`);
      }
      if (f.weight !== null) {
        parts.push(`   Peso: ${f.weight} ton`);
      }
      return parts.join('\n');
    });

    sections.push(`
## Fretes disponiveis (${ctx.items.length} encontrados no raio de ${ctx.radiusUsedKm}km)
IMPORTANTE: Mostre apenas 2-3 por vez. Priorize os de maior lucro/km.
Use estes dados como referencia interna — NAO copie o formato abaixo literalmente na resposta ao motorista. Apresente de forma natural e conversacional.

${freteLines.join('\n\n')}`);
  }

  return sections.join('\n');
}
