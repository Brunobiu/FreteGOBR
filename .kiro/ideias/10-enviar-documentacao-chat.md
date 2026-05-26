# Ideia 10 — Enviar Documentação Completa no Chat (1 clique)

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

No chat entre motorista e embarcador, após trocarem pelo menos 2-3 mensagens cada um, aparece um botão "Enviar Documentação" para o motorista. Ao clicar, o sistema empacota TODA a documentação do motorista (documentos pessoais, do veículo, carreta, proprietário, RNTRC, referências, MTTs — tudo que ele já cadastrou) em um único arquivo ZIP e envia no chat. O embarcador baixa o ZIP e tem tudo organizado em pastas.

## Regras de Negócio (rascunho)

### Quando o Botão Aparece
- Só aparece para o MOTORISTA (embarcador não tem esse botão)
- Só após ambos terem trocado pelo menos 2-3 mensagens cada (evita spam de docs sem contexto)
- Contagem: `COUNT(messages WHERE sender = motorista) >= 2 AND COUNT(messages WHERE sender = embarcador) >= 2`
- Aparece como botão discreto na área de input do chat (ícone de pasta/documento)
- Não aparece de uma vez — surge suavemente após a condição ser atingida

### O que é Enviado
Todos os documentos já cadastrados pelo motorista, organizados em pastas dentro do ZIP:

```
documentacao_motorista_<nome>.zip
├── motorista/
│   ├── cnh_frente.pdf
│   ├── cnh_verso.pdf
│   ├── rg_cpf.pdf
│   └── foto_perfil.jpg
├── veiculo/
│   ├── crlv.pdf
│   ├── foto_frente.jpg
│   ├── foto_lateral.jpg
│   └── foto_traseira.jpg
├── carreta/
│   ├── crlv_carreta.pdf
│   └── fotos_carreta/
├── proprietario/
│   ├── contrato_social.pdf
│   ├── cnpj.pdf
│   └── procuracao.pdf (se aplicável)
├── rntrc/
│   └── rntrc.pdf
├── referencias/
│   └── referencias.pdf
└── mtt/
    └── mtt.pdf
```

### Fluxo
1. Motorista clica "Enviar Documentação"
2. Loading: "Preparando documentação..." (pode levar alguns segundos para gerar o ZIP)
3. Sistema coleta todos os arquivos do storage do motorista
4. Gera ZIP em memória (ou via Edge Function)
5. Faz upload do ZIP no storage (bucket de chat attachments ou novo bucket)
6. Envia mensagem no chat com o arquivo anexado: "📁 Documentação completa enviada"
7. Embarcador vê a mensagem com botão "Baixar documentação" (download do ZIP)

### Proteções
- Só pode enviar 1x por conversa (ou com cooldown de 24h) — evita spam
- Se o motorista não tem documentos cadastrados: botão desabilitado com tooltip "Complete seu cadastro primeiro"
- Documentos sensíveis: o ZIP é acessível apenas pelos 2 participantes da conversa (RLS no storage)
- ZIP expira após 30 dias (limpeza automática — os docs originais continuam no perfil do motorista)

### Lado do Embarcador
- Recebe mensagem no chat: "📁 Documentação completa do motorista <nome>"
- Botão "Baixar" — faz download do ZIP
- Pode abrir no computador e ver tudo organizado em pastas
- Não precisa pedir documento por documento

## Dependências Técnicas

- Geração de ZIP: usar lib JS (`jszip` ou `fflate`) no client, OU Edge Function server-side
- Storage: bucket de chat attachments (já existe `chat_attachments`?) ou novo bucket `doc_packages`
- Documentos do motorista: já estão no storage (bucket de documentos — verificar nome)
- Signed URLs para baixar cada documento original antes de empacotar

## Integração com Existente

- Chat (`FreteChatWidget.tsx`, `ChatWidget.tsx`) — adicionar botão condicional
- Sistema de mensagens (tabela `messages`) — nova mensagem tipo "document_package"
- Storage do motorista (documentos já cadastrados)
- Perfil do motorista (saber quais documentos existem)
- Sistema de attachments do chat (já existe — reusar padrão)

## Notas para Implementação

- **Geração do ZIP:**
  - Opção A (client-side): usar `jszip` (lib leve ~45kb). Baixa signed URLs dos docs → monta ZIP em memória → upload
  - Opção B (Edge Function): mais robusto, não depende da conexão do motorista. Edge Function coleta docs do storage, gera ZIP, faz upload, retorna URL
  - Recomendação: Edge Function (mais confiável, não sobrecarrega o celular do motorista)
- **Tamanho:** documentação completa pode ter 10-50MB. ZIP comprime bem PDFs/imagens
- **Fallback:** se algum documento falhar no download, incluir arquivo `_FALTANDO.txt` listando o que não foi possível incluir
- **Nova dep npm:** `jszip` ou `fflate` (se client-side) — verificar se é aceitável pelo projeto (convenção diz "zero novas deps npm" para admin, mas isso é feature de usuário)
- **Mensagem especial no chat:** tipo `attachment_type: 'document_package'` para renderizar diferente (ícone de pasta, nome "Documentação completa", tamanho do ZIP)
- Considerar: preview dos documentos inline no chat (thumbnails) antes de baixar o ZIP inteiro
