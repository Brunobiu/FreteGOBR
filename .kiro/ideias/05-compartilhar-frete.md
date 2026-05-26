# Ideia 5 — Compartilhar Frete

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Todo frete na plataforma tem um ícone de compartilhar. Ao clicar, abre um menu/bottom-sheet com opções de compartilhamento: WhatsApp, Telegram, SMS (mensagem de texto) e E-mail. O link compartilhado leva para uma página pública do frete (ou abre o app se instalado).

## Regras de Negócio (rascunho)

### Botão
- Ícone de compartilhar (Share2 do Lucide ou similar) presente em:
  - Card de frete na listagem
  - Modal/detalhe do frete
  - Página do frete (se existir rota pública)
- Ao clicar: abre menu com as opções de canal

### Canais de Compartilhamento
- **WhatsApp:** `https://wa.me/?text=<mensagem_encodada>`
- **Telegram:** `https://t.me/share/url?url=<url>&text=<texto>`
- **SMS:** `sms:?body=<mensagem_encodada>`
- **E-mail:** `mailto:?subject=<assunto>&body=<mensagem_encodada>`
- **Copiar link:** copia a URL do frete para o clipboard (fallback universal)

### Mensagem Padrão
Texto pré-formatado com resumo do frete:
```
🚚 Frete disponível no FreteGO!
📍 De: <origem>
📍 Para: <destino>
💰 Valor: R$ <valor>
📦 Produto: <produto>
📏 Distância: <km> km

Veja mais: <url_do_frete>
```

### URL do Frete
- Rota pública: `/frete/<id>` (acessível sem login para visualização básica)
- Se não existir rota pública, criar uma landing page simples do frete
- Meta tags OG (Open Graph) para preview bonito no WhatsApp/Telegram/redes sociais

### Comportamento Mobile
- Em dispositivos móveis: usar `navigator.share()` (Web Share API) se disponível
- Fallback: menu manual com os botões de cada canal
- Web Share API já integra com todos os apps instalados no celular

## Dependências Técnicas

- Rota pública do frete (pode já existir ou precisar criar)
- Meta tags OG dinâmicas (título, descrição, imagem) — pode precisar de SSR ou Edge Function
- Nenhuma migration necessária (é feature puramente frontend)

## Integração com Existente

- `FreteCard.tsx` — adicionar ícone de compartilhar
- `FreteModal.tsx` — adicionar botão de compartilhar
- Roteamento (React Router) — rota pública do frete
- Componente reutilizável `ShareMenu.tsx` ou `ShareButton.tsx`

## Notas para Implementação

- Componente genérico `ShareButton` que recebe `{ url, title, text }` e renderiza o menu
- Usar Web Share API como primeira opção (mobile nativo), fallback para menu manual
- Sem backend necessário — tudo client-side com deep links dos apps
- Considerar analytics: contar quantas vezes um frete foi compartilhado (opcional, pode ser coluna `share_count` na tabela fretes ou evento no audit)
- OG tags: se o projeto usa Vite SPA puro, as meta tags dinâmicas precisam de uma Edge Function ou middleware no Vercel para funcionar no preview do WhatsApp
- Feature leve — pode ser implementada rapidamente como quick win
