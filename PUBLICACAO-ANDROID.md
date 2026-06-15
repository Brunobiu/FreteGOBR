# Checklist de Publicação — FreteGO (Android / Google Play)

> Documento de apoio para publicar o app. Não é código; é um guia operacional.
> Atualize os checkboxes conforme for concluindo.

## Estratégia recomendada

Não vá direto pra **Produção** (público geral). Use as trilhas do Play Console nesta ordem:

1. **Teste interno** — libera pra uma lista de e-mails (você + equipe). Aprovação
   quase imediata. É aqui que você valida notificação, criar conta e pagamento
   (pode ser com Asaas **sandbox**).
2. **Teste fechado (beta)** — grupo maior, ainda controlado. Opcional.
3. **Produção** — público geral, review mais rigoroso. Só depois que tudo abaixo
   estiver redondo (incluindo Asaas em **produção**).

Regra de ouro: **sandbox só nas trilhas de teste**. Em produção, ninguém pode
cair num checkout que não cobra de verdade.

---

## 1. Configuração atual do app (já no projeto)

| Item | Valor atual | Observação |
|------|-------------|------------|
| applicationId | `br.com.fretego.app` | imutável após publicar |
| versionName | `1.0` | string visível ao usuário |
| versionCode | `1` | **incrementar a cada upload** (1 → 2 → 3...) |
| Arquitetura | App shell remoto (Capacitor) → `https://www.fretegobr.com.br` | mudanças de UI não exigem novo APK |
| Push base | `google-services.json` presente | FCM configurado na base |
| Splash/StatusBar | verde `#16a34a` | em `capacitor.config.ts` |

**Importante (arquitetura shell remoto):** como o app carrega o site de produção,
as mudanças que damos `git push` aparecem sozinhas. Só precisa gerar novo
AAB/APK quando mudar: ícone, splash, permissões, plugins nativos ou versão.

---

## 2. Antes de QUALQUER upload (teste interno incluso)

- [ ] Criar conta no **Google Play Console** (taxa única de US$ 25).
- [ ] Gerar a **keystore de assinatura** (`.jks`) e guardar em local seguro +
      backup. **Se perder, não consegue mais atualizar o app.**
- [ ] Ativar **Play App Signing** (o Google recomenda; ele guarda a chave final).
- [ ] Definir ícone do app (512×512) e gráfico de destaque (1024×500).
- [ ] Tirar 2–8 **screenshots** do app rodando (celular).
- [ ] `versionCode` = 1 no primeiro envio.

### Gerar o pacote (AAB) — passo a passo
```
npm run build            # gera o dist/ (web)
npx cap sync android     # sincroniza web + plugins pro projeto Android
```
Depois, no **Android Studio**: Build → Generate Signed Bundle/APK →
**Android App Bundle (.aab)** → assina com a keystore → sobe o `.aab` no Play
Console.

> Observação: como é shell remoto, o `cap sync` raramente muda algo visual, mas
> rode sempre antes de gerar o bundle pra garantir plugins/config atualizados.

---

## 3. Notificações (Push / FCM)

- [ ] Confirmar que o `google-services.json` é do projeto Firebase correto.
- [ ] Testar push em **dispositivo real** (emulador às vezes não recebe FCM).
- [ ] No Android 13+ a permissão de notificação é solicitada em runtime —
      validar que o app pede e que o usuário consegue aceitar.
- [ ] Conferir o fluxo: token salvo no banco (`device_tokens`) → envio →
      recebimento com app aberto e fechado.

---

## 4. Pagamento (Asaas) — sandbox → produção

O Asaas vive **server-side** (Edge Functions Supabase), nunca no app. Variáveis:

| Edge Function | Variável | Sandbox (teste) | Produção |
|---------------|----------|-----------------|----------|
| `asaas-create-subscription` | `ASAAS_BASE_URL` | `https://sandbox.asaas.com/api/v3` | `https://api.asaas.com/api/v3` |
| `asaas-create-subscription` | `ASAAS_API_KEY` | chave sandbox | **chave de produção** |
| `asaas-webhook` | `ASAAS_WEBHOOK_TOKEN` | token de teste | token de produção |

### Para testar (trilha interna) — pode manter sandbox
- [ ] Confirmar que `ASAAS_API_KEY` (sandbox) está setada nas secrets do Supabase.
- [ ] Validar fluxo: criar assinatura (PIX/boleto/cartão) → ver checkout →
      simular pagamento no painel sandbox → webhook marca `paid`.

### Antes de Produção (cobrança real)
- [ ] Trocar `ASAAS_BASE_URL` para `https://api.asaas.com/api/v3` nas secrets.
- [ ] Trocar `ASAAS_API_KEY` para a **chave de produção** do Asaas.
- [ ] Cadastrar a URL do webhook no painel **Asaas produção** + `ASAAS_WEBHOOK_TOKEN`.
- [ ] Fazer 1 cobrança real de valor baixo pra validar ponta a ponta.

### ⚠️ Política de pagamento do Google Play (verificar antes da Produção)
O Google exige **Google Play Billing** (taxa ~15–30%) para **bens/serviços
digitais**. **Serviços do mundo real** (fretes, conexão caminhoneiro↔embarcador)
costumam ser **isentos** e podem usar pagamento externo (PIX/boleto/cartão via
Asaas). É uma zona que o Google às vezes questiona — **confirmar a "Payments
policy" atual** antes do lançamento público. (Isto não é orientação jurídica;
vale validar com a documentação oficial / um especialista.)

---

## 5. Play Console — fichas obrigatórias (para Produção)

- [ ] **Política de Privacidade (URL):** já existe em `/privacidade` →
      `https://www.fretegobr.com.br/privacidade`.
- [ ] **Termos de Uso:** já existe em `/termos`.
- [ ] **Formulário "Segurança dos dados" (Data Safety)** — declarar:
  - [ ] Localização aproximada/precisa (usada para buscar fretes por raio).
  - [ ] Info pessoal: nome, e-mail, telefone, CPF (cadastro/perfil).
  - [ ] Fotos/arquivos (documentos, CT-e, foto de perfil).
  - [ ] Dados de pagamento (processados pelo Asaas — declarar terceiro).
  - [ ] Se há criptografia em trânsito (sim — HTTPS) e como excluir conta
        (já existe fluxo de exclusão de dados — migration 065).
- [ ] **Classificação de conteúdo** (questionário) → provável "Livre/L".
- [ ] **Público-alvo** (não direcionado a crianças).
- [ ] **Ficha da loja:** título, descrição curta, descrição completa, ícone,
      screenshots, gráfico de destaque.
- [ ] **Justificar permissões** (localização, notificações).

---

## 6. Qualidade / técnico antes de Produção

- [ ] `targetSdkVersion` em dia com a exigência atual do Play (checar o ano).
- [ ] Testar em telas pequenas e grandes (o layout mobile já foi tratado).
- [ ] Testar offline / sem GPS (degradação controlada).
- [ ] `webContentsDebuggingEnabled` = `false` em release (já está).
- [ ] Conferir que o domínio `www.fretegobr.com.br` está no ar e estável
      (é o coração do shell remoto).
- [ ] Suite de testes verde (`npm run build` + testes).

---

## 7. Pendências conhecidas do projeto (não bloqueiam teste interno)

- [ ] **Chave da IA do assistente:** hoje o `assistant_config` aponta pra
      `gemini` com model do Claude (inconsistente) e só há chave Gemini no
      Vault. Configurar provider + chave + model no painel admin para a IA
      real funcionar (senão usa o fallback local). Não bloqueia publicar.
- [ ] **Links reais de redes sociais** e **e-mail de contato** no rodapé
      (hoje placeholders).

---

## 8. Resumo Go / No-Go

**Pode subir AGORA em Teste Interno?** ✅ Sim — com Asaas sandbox, pra validar
notificação, cadastro e fluxo de pagamento com testadores.

**Pode subir em Produção?** ⚠️ Só depois de:
1. Asaas em produção (URL + chave + webhook).
2. Data Safety + ficha da loja + classificação preenchidos.
3. Validar a política de pagamento do Play pro seu caso.
4. Push testado em dispositivo real.
