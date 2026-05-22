# Plano de Implementação — Onboarding e Perfil do Embarcador

## Visão Geral

Implementação incremental em quatro camadas, do schema para a UI. Primeiro a Migration 010 e o bucket de logos consolidam o terreno no Supabase. Em seguida, a Edge Function e os serviços (`verification.ts`, `embarcador.ts`) expõem a API consumida pelos novos componentes. Os quatro componentes apresentacionais são entregues antes das telas que os integram, para que cada página existente seja refatorada uma única vez. As mudanças no fluxo de cadastro/login vêm cedo porque são autocontidas; o `EmbarcadorPerfilPage` é o ponto de junção mais complexo e fica isolado em uma task. Por último, o guard em `fretes.ts` e o banner em `EmbarcadorPage` fecham o ciclo de bloqueio de cadastro incompleto. Tarefas de testes baseados em propriedades são opcionais e ficam ao final, junto da bateria de smoke tests manuais.

Convenção: tarefas marcadas com `*` são opcionais. Arquivos a tocar e requisitos cobertos estão indicados em cada item.

## Tarefas

- [x] 1. Criar Migration 010 com schema de onboarding
  - Arquivo: `supabase/migrations/010_embarcador_onboarding.sql`
  - Migration idempotente, mesmo padrão da 009, dentro de `BEGIN; ... COMMIT;`

  - [x] 1.1 Adicionar colunas `users.email_verified` e `embarcadores.company_logo_url`
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`
    - `ALTER TABLE embarcadores ADD COLUMN IF NOT EXISTS company_logo_url TEXT`
    - _Refs: Requisito 11.1, 11.2, 6.13_

  - [x] 1.2 Criar tabela `verification_codes` com RLS habilitada
    - Colunas conforme schema do design (id, user_id, purpose, target, code_hash, expires_at, attempts, consumed, created_at)
    - `CHECK (purpose IN ('email'))`, FK para `users(id) ON DELETE CASCADE`
    - `ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY`
    - _Refs: Requisito 11.3, 6.4_

  - [x] 1.3 Criar índice composto `idx_verification_codes_user_purpose_consumed`
    - `CREATE INDEX IF NOT EXISTS ... ON verification_codes (user_id, purpose, consumed)`
    - _Refs: Requisito 11.5_

  - [x] 1.4 Criar políticas RLS de SELECT e UPDATE em `verification_codes`
    - `verification_codes_select_policy` com `USING (user_id = auth.uid())`
    - `verification_codes_update_policy` com `USING (user_id = auth.uid())`
    - Sem policy de INSERT pública (INSERT só via RPC `SECURITY DEFINER`)
    - _Refs: Requisito 11.7_

  - [x] 1.5 Criar função e trigger `invalidate_old_verification_codes`
    - Função `SECURITY DEFINER` que marca códigos anteriores do mesmo `(user_id, purpose)` como `consumed = true`
    - Trigger `AFTER INSERT ON verification_codes FOR EACH ROW`
    - _Refs: Requisito 6.12_

  - [x] 1.6 Criar função `hash_verification_code(p_code TEXT)`
    - `IMMUTABLE`, usa `digest(...,'sha256')` em base64 sobre o código normalizado (regex `\D` removido)
    - Compartilhada por `generate_*` e `confirm_*`
    - _Refs: Requisito 11.6, 12.3_

  - [x] 1.7 Criar RPC `generate_email_verification_code(p_email TEXT)`
    - `SECURITY DEFINER`, valida `auth.uid()` não nulo, valida formato RFC 5322 do e-mail
    - Aplica rate limit de 3 envios em 24h por `(user_id, purpose='email')`
    - Gera código 6 dígitos com `lpad((floor(random()*1000000))::int::text, 6, '0')`
    - Insere em `verification_codes` com `expires_at = NOW() + interval '10 minutes'`
    - Insere em `audit_logs` com `target_masked` (`****<últimos 4>`)
    - Dispara `net.http_post` para a Edge Function `send-verification-email`, lendo `app.settings.edge_url` e `app.settings.service_key`
    - Retorna `jsonb_build_object('ok', true)`
    - _Refs: Requisito 6.3, 6.4, 6.11, 12.1, 13.1_

  - [x] 1.8 Criar RPC `confirm_email_verification_code(p_code TEXT)`
    - `SECURITY DEFINER`, valida `auth.uid()` não nulo
    - Busca registro mais recente não consumido para `(auth.uid(),'email')`
    - Trata `EXPIRED` (não encontrado ou `expires_at < NOW()`), `BLOCKED` (`attempts >= 3`), `INVALID` (hash diferente, incrementa attempts)
    - Em sucesso: marca `consumed=true`, atualiza `users.email = target` e `users.email_verified = true`, registra `verification_succeeded` em audit
    - Retorna `jsonb_build_object('status', <STATUS>)`
    - _Refs: Requisito 6.6, 6.8, 6.9, 6.10, 12.2, 12.4, 13.2, 13.3_

  - [x] 1.9 Recriar `fretes_insert_policy` exigindo cadastro completo
    - `DROP POLICY IF EXISTS fretes_insert_policy ON fretes`
    - `WITH CHECK` validando `embarcador_id = auth.uid()` AND `users.email_verified = true` AND `users.profile_photo_url IS NOT NULL` AND `embarcadores.company_logo_url IS NOT NULL`
    - _Refs: Requisito 10.5, 10.7_

- [x] 2. Criar bucket `company-logos` com policies
  - Arquivo novo: `supabase/storage/setup_company_logos.sql`
  - Mesmo padrão de `supabase/storage/setup_storage.sql`

  - [x] 2.1 Criar bucket público `company-logos`
    - `INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos','company-logos', true) ON CONFLICT (id) DO UPDATE SET public = true`
    - _Refs: Requisito 8.6, 8.10_

  - [x] 2.2 Política de leitura pública
    - `CREATE POLICY` em `storage.objects` permitindo `SELECT` quando `bucket_id = 'company-logos'`
    - _Refs: Requisito 8.10_

  - [x] 2.3 Política de escrita restrita ao dono
    - `INSERT/UPDATE/DELETE` permitidos apenas quando `bucket_id = 'company-logos'` e o caminho começa com `embarcadores/<auth.uid()>/`
    - _Refs: Requisito 8.10_

- [x] 3. Criar Edge Function `send-verification-email`
  - Arquivo novo: `supabase/functions/send-verification-email/index.ts`
  - Deno `serve(...)` aceitando POST com `{ email, code }`

  - [x] 3.1 Validar header de autorização
    - Confere `Authorization: Bearer <service_key>` antes de processar; retorna 401 se inválido
    - _Refs: Requisito 6.3, 13.1_

  - [x] 3.2 Implementar modo dev (console.log)
    - Quando `Deno.env.get('VERIFICATION_DEV_LOG') === 'true'`, faz `console.log` do par `{ email, code }` e retorna `200`
    - _Refs: Requisito 6.3_

  - [x] 3.3 Implementar stub de produção
    - Comentário `TODO: integrar com Resend/SendGrid/SMTP do Supabase`
    - Por enquanto retorna `200` mesmo sem provedor configurado
    - _Refs: Requisito 6.3_

- [x] 4. Criar serviço `verification.ts` (cliente das RPCs)
  - Arquivo novo: `src/services/verification.ts`
  - Importa `supabase` de `./supabase`

  - [x] 4.1 Implementar `sendEmailVerificationCode(email: string): Promise<void>`
    - Chama `supabase.rpc('generate_email_verification_code', { p_email: email })`
    - Lança `Error` com `error.message` em caso de falha
    - _Refs: Requisito 6.3_

  - [x] 4.2 Implementar `confirmEmailVerificationCode(code: string): Promise<void>`
    - Chama `supabase.rpc('confirm_email_verification_code', { p_code: code })`
    - Mapeia `data.status` em `BLOCKED`, `EXPIRED`, `INVALID` em erros tipados (`(e as any).code = data.status`)
    - Sucesso silencioso para `OK`
    - _Refs: Requisito 6.6, 6.8, 6.9, 6.10, 12.2_

  - [x] 4.3 Implementar `getVerificationStatus(): Promise<{ emailVerified: boolean }>`
    - Lê `users.email_verified` do usuário autenticado via `supabase.auth.getUser()` e `.from('users').select('email_verified')`
    - _Refs: Requisito 6.2, 9.4_

- [x] 5. Estender serviço `embarcador.ts`
  - Arquivo: `src/services/embarcador.ts`

  - [x] 5.1 Adicionar `uploadCompanyLogo(userId: string, file: File): Promise<string>`
    - Valida `file.type` ∈ `['image/jpeg','image/png','image/webp']`, lança `Error('Formato inválido. Envie JPG, PNG ou WEBP.')` se inválido
    - Valida `file.size <= 2 * 1024 * 1024`, lança `Error('Arquivo muito grande. Limite de 2 MB.')` se acima
    - Faz `supabase.storage.from('company-logos').upload('embarcadores/<userId>/logo.<ext>', file, { upsert: true, contentType })`
    - Obtém `getPublicUrl` e atualiza `embarcadores.company_logo_url`
    - Retorna a URL pública
    - _Refs: Requisito 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 5.2 Adicionar `getEmbarcadorOnboardingProgress(userId: string)`
    - Retorna `{ profilePhoto, emailVerified, companyLogo, percent, missing }`
    - Lê `users.profile_photo_url`, `users.email_verified` e `embarcadores.company_logo_url`
    - `percent = Math.round((done / 3) * 100)` com peso igual
    - `missing` em pt-BR: "Adicionar foto de perfil", "Verificar e-mail", "Adicionar logo da empresa"
    - _Refs: Requisito 9.2, 9.3, 9.4, 9.5, 9.10_

- [x] 6. Criar componentes apresentacionais novos

  - [x] 6.1 `BadgeEmpresa.tsx`
    - Arquivo novo: `src/components/BadgeEmpresa.tsx`
    - Prop `companyName: string`, integra `useIsMobile`
    - Trunca em 20 caracteres com `…` quando mobile e nome maior que 20
    - `aria-label={\`Empresa: ${companyName}\`}` e `title={companyName}`
    - Mesma altura, padding, tipografia e raio do Badge_Tipo_Usuário existente em `AppHeader`
    - _Refs: Requisito 3.5, 3.6, 14.4_

  - [x] 6.2 `BarraProgressoCadastro.tsx`
    - Arquivo novo: `src/components/BarraProgressoCadastro.tsx`
    - Props: `{ percent: number; missing: string[] }`
    - Cor: `<50` vermelha, `<100` amarela, `100` verde
    - Texto "<percent>% completo" à direita; lista de pendências em `<ul>` abaixo
    - Atributos `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`
    - _Refs: Requisito 9.6, 9.7, 9.8, 9.9, 9.10, 14.3_

  - [x] 6.3 `ModalVerificacaoEmail.tsx`
    - Arquivo novo: `src/components/ModalVerificacaoEmail.tsx`
    - Props: `{ email: string; onClose: () => void; onSuccess: () => void }`
    - 6 inputs de dígito com auto-avanço, paste handler para colar 6 dígitos de uma vez
    - Timer de reenvio de 60s desabilitando o botão "Reenviar código"
    - Foco no primeiro input ao montar; `Escape` fecha; foco devolvido ao botão de origem ao desmontar
    - Submit chama `confirmEmailVerificationCode`; trata `BLOCKED`, `EXPIRED`, `INVALID` com mensagens em pt-BR
    - _Refs: Requisito 6.5, 6.7, 6.8, 6.9, 6.10, 6.11, 14.1, 14.2_

  - [x] 6.4 `LogoUploadField.tsx`
    - Arquivo novo: `src/components/LogoUploadField.tsx`
    - Props: `{ currentUrl: string | null; userId: string; onUploaded: (url: string) => void }`
    - Renderiza preview quando `currentUrl` está presente; placeholder neutro caso contrário
    - Input `type="file"` com `accept="image/jpeg,image/png,image/webp"`
    - Estado "Enviando..." que desabilita o input durante o upload
    - Em erro de validação, exibe a mensagem retornada por `uploadCompanyLogo`
    - _Refs: Requisito 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.9_

- [x] 7. Atualizar `RegisterForm.tsx` — texto do botão
  - Arquivo: `src/components/RegisterForm.tsx`

  - [x] 7.1 Trocar texto do botão de envio
    - `{isLoading ? 'Criando conta...' : 'Criar conta'}` para qualquer tipo selecionado
    - Remover lógica condicional de "Transporte conosco"
    - _Refs: Requisito 1.1, 1.2, 1.3_

- [x] 8. Refatorar fluxo de cadastro separado de login
  - Arquivos: `src/pages/RegisterPage.tsx`, `src/pages/LoginPage.tsx`, `src/components/LoginForm.tsx`

  - [x] 8.1 Em `RegisterPage`, encerrar sessão e redirecionar para `/login`
    - Após `register()` com sucesso, chamar `supabase.auth.signOut()` e `localStorage.removeItem('fretego_user')`
    - `navigate('/login', { state: { successMessage: 'Conta criada com sucesso. Faça login para continuar.', phone: data.phone } })`
    - Manter tratamento de erro existente em caso de falha
    - _Refs: Requisito 2.1, 2.2, 2.5, 2.6_

  - [x] 8.2 Em `LoginPage`, ler `location.state` e propagar para o `LoginForm`
    - `useLocation()` extrai `successMessage` e `phone` opcionais
    - Passa props `successMessage` e `initialPhone` para `LoginForm`
    - _Refs: Requisito 2.3, 2.4_

  - [x] 8.3 Em `LoginForm`, aceitar e renderizar `successMessage` e `initialPhone`
    - Adicionar props opcionais `successMessage?: string` e `initialPhone?: string`
    - Renderizar a `successMessage` em banner verde acima do formulário quando presente
    - Usar `initialPhone` em `defaultValues` do telefone
    - _Refs: Requisito 2.3, 2.4_

- [x] 9. Atualizar `AppHeader.tsx` — Badge da Empresa
  - Arquivo: `src/components/AppHeader.tsx`

  - [x] 9.1 Carregar `company_name` no mount para Embarcador
    - `useEffect` que chama `getEmbarcadorProfile(user.id)` quando `user.userType === 'embarcador'`
    - Estado local `companyName: string | null`
    - _Refs: Requisito 3.2, 3.4_

  - [x] 9.2 Renderizar `<BadgeEmpresa companyName={...} />` ao lado do Badge_Tipo_Usuário
    - Só renderiza quando autenticado, `userType === 'embarcador'` e `companyName` truthy
    - _Refs: Requisito 3.1, 3.3, 3.4_

- [x] 10. Simplificar `ConfiguracoesPage.tsx`
  - Arquivo: `src/pages/ConfiguracoesPage.tsx`

  - [x] 10.1 Remover seção "Zona de Perigo"
    - Apaga o `<div>` correspondente, incluindo o botão "Excluir Minha Conta"
    - _Refs: Requisito 4.2, 4.3_

  - [x] 10.2 Remover handler `handleDeleteAccount` e imports órfãos
    - Apaga função e quaisquer imports que ficaram sem uso (incluindo `useNavigate` se não houver outro uso)
    - Mantém intacta a seção "Alterar Senha"
    - _Refs: Requisito 4.1, 4.4, 4.5_

- [ ] 11. Checkpoint — Garantir que tudo compila e os testes existentes passam
  - Rodar `getDiagnostics` nos arquivos modificados até aqui e o conjunto atual de testes (`npm test -- --run`)
  - Em caso de dúvida, perguntar ao usuário antes de seguir

- [x] 12. Refatorar `EmbarcadorPerfilPage.tsx` (ponto de junção principal)
  - Arquivo: `src/pages/EmbarcadorPerfilPage.tsx`
  - Importa os quatro componentes novos e o serviço `verification.ts`

  - [x] 12.1 Adicionar `BarraProgressoCadastro` no topo da página
    - Carrega `getEmbarcadorOnboardingProgress(user.id)` no `useEffect` do mount
    - Estado `progress` é a fonte de verdade para a barra
    - _Refs: Requisito 9.1, 9.2, 9.10_

  - [x] 12.2 Exibir nome em texto estático somente leitura
    - Substitui `<input>` por `<p>` com classes neutras
    - _Refs: Requisito 5.1, 5.2_

  - [x] 12.3 Exibir telefone formatado em texto estático somente leitura
    - Helper local de formatação `(DD) D NNNN-NNNN` ou `(DD) NNNN-NNNN`
    - _Refs: Requisito 7.1, 7.2_

  - [x] 12.4 Adicionar campo de e-mail com botão "Verificar e-mail" e modal
    - Quando `email_verified` é falso: input editável + botão "Verificar e-mail" abre `ModalVerificacaoEmail`
    - Quando `email_verified` é verdadeiro: texto somente leitura + selo verde "E-mail confirmado"
    - `onSuccess` do modal exibe toast "E-mail confirmado" por 3s e recarrega progresso
    - _Refs: Requisito 6.1, 6.2, 6.7_

  - [x] 12.5 Adicionar `LogoUploadField` após "Nome da Empresa"
    - Recebe `currentUrl = embarcadores.company_logo_url`
    - `onUploaded` atualiza estado local e recarrega progresso
    - _Refs: Requisito 8.1, 8.8_

  - [x] 12.6 Remover `name`, `phone` e `whatsapp` do payload de update
    - `updateEmbarcadorProfile` recebe somente os campos editáveis remanescentes (e-mail nunca passa por aqui — ele é atualizado pela RPC `confirm_email_verification_code`)
    - _Refs: Requisito 5.3, 5.4, 7.3_

  - [x] 12.7 Recarregar progresso após cada conclusão (foto, e-mail, logo)
    - Cada handler de sucesso chama novamente `getEmbarcadorOnboardingProgress` para atualizar o estado
    - _Refs: Requisito 9.11_

- [x] 13. Atualizar `EmbarcadorPage.tsx` — bloqueio de postagem
  - Arquivo: `src/pages/EmbarcadorPage.tsx`

  - [x] 13.1 Carregar progresso no mount
    - `useEffect` chamando `getEmbarcadorOnboardingProgress(user.id)` para popular `progress`
    - _Refs: Requisito 10.1, 10.7_

  - [x] 13.2 Desabilitar botão "Postar Frete" quando incompleto
    - `disabled={progress.percent < 100}`
    - `title`/tooltip com a mensagem "Complete seu cadastro para postar fretes"
    - _Refs: Requisito 10.1, 10.2, 10.6_

  - [x] 13.3 Banner de aviso para usuários com cadastro incompleto
    - Exibe pendências e link "Completar cadastro" para `/perfil/embarcador`
    - Só aparece quando `progress.percent < 100`
    - _Refs: Requisito 10.2, 10.3_

- [x] 14. Adicionar guard em `fretes.ts`
  - Arquivo: `src/services/fretes.ts`

  - [x] 14.1 Adicionar verificação inicial em `createFrete`
    - Chama `getEmbarcadorOnboardingProgress(data.embarcadorId)` antes do `INSERT`
    - Lança `Error('Cadastro incompleto. Verifique e-mail, foto e logo da empresa.')` se `percent < 100`
    - _Refs: Requisito 10.4_

- [ ] 15. Property-based tests (opcionais)

  - [ ]* 15.1 Round-trip do hash de verificação
    - Arquivo novo: `src/__tests__/verification.property.test.ts`
    - **Propriedade: gerar → hash → normalizar → hash é idempotente**
    - Gera código aleatório de 6 dígitos, insere ruído (espaços, hífens), normaliza e confere igualdade dos hashes
    - **Valida: Requisito 12.3**

  - [ ]* 15.2 Cálculo de progresso de onboarding
    - Arquivo novo: `src/__tests__/onboardingProgress.property.test.ts`
    - **Propriedade: percent = round(done/3 * 100) e missing reflete exatamente os flags falsos**
    - Para todas as 8 combinações dos três booleanos, percent ∈ {0, 33, 67, 100} e tamanho de missing = 3 - done
    - **Valida: Requisito 9.2, 9.3, 9.4, 9.5, 9.10_

  - [ ]* 15.3 Mascaramento do alvo em logs
    - Arquivo novo: `src/__tests__/maskTarget.property.test.ts`
    - **Propriedade: máscara preserva últimos 4 caracteres e oculta o restante**
    - Para qualquer string com pelo menos 4 caracteres, `mask(s)` termina com `right(s,4)` e começa com `****`
    - **Valida: Requisito 13.1, 13.4_

- [ ] 16. Smoke tests manuais (verificação de ponta a ponta)
  - Estas tarefas pedem execução manual no ambiente do usuário; o agente apenas documenta passos e valida o estado por consulta SQL ou inspeção visual

  - [ ] 16.1 Aplicar Migration 010 e bucket SQL no Supabase
    - Rodar `supabase/migrations/010_embarcador_onboarding.sql` e `supabase/storage/setup_company_logos.sql`
    - Conferir presença das colunas, tabela, índice, policies e RPCs
    - _Refs: Requisito 11.1, 11.2, 11.3, 11.5, 11.7, 11.8_

  - [ ] 16.2 Configurar variáveis de ambiente do Supabase
    - Definir `app.settings.edge_url` e `app.settings.service_key` no Postgres (`ALTER DATABASE ... SET ...`)
    - Definir `VERIFICATION_DEV_LOG=true` na Edge Function durante o smoke test
    - _Refs: Requisito 6.3_

  - [ ] 16.3 Cadastrar Embarcador novo
    - Validar texto "Criar conta" e estado "Criando conta..." durante envio
    - Confirmar redirect para `/login`, sessão encerrada
    - _Refs: Requisito 1.1, 1.3, 2.1, 2.2_

  - [ ] 16.4 Login com mensagem e telefone pré-preenchidos
    - Confirmar banner "Conta criada com sucesso. Faça login para continuar."
    - Confirmar telefone preenchido automaticamente
    - _Refs: Requisito 2.3, 2.4_

  - [ ] 16.5 Header exibe `BadgeEmpresa`
    - Para Embarcador autenticado, badge aparece à direita do Badge_Tipo_Usuário com o `company_name`
    - Em mobile, validar truncamento em 20 caracteres
    - _Refs: Requisito 3.1, 3.2, 3.5, 3.6_

  - [ ] 16.6 `ConfiguracoesPage` sem Zona de Perigo
    - Visualmente confirmar que só "Alterar Senha" aparece
    - _Refs: Requisito 4.1, 4.2, 4.3_

  - [ ] 16.7 `EmbarcadorPerfilPage` em estado inicial
    - Barra de progresso vermelha (0% ou 33%), nome e telefone em texto estático
    - Lista de pendências completa com os três itens
    - _Refs: Requisito 5.1, 5.2, 7.1, 7.2, 9.1, 9.6, 9.10_

  - [ ] 16.8 Verificar e-mail (modo dev)
    - Clicar "Verificar e-mail", ler código no console da Edge Function
    - Submeter código no modal: confirmar atualização de `users.email` e `users.email_verified`
    - Validar mensagens de "Código incorreto" (digita errado) e "Código bloqueado" (3 erros)
    - _Refs: Requisito 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [ ] 16.9 Upload de logo da empresa
    - Tipo válido (PNG ≤ 2 MB) → preview e `company_logo_url` atualizado
    - Tipo inválido (PDF) → mensagem "Formato inválido. Envie JPG, PNG ou WEBP."
    - Tamanho > 2 MB → mensagem "Arquivo muito grande. Limite de 2 MB."
    - _Refs: Requisito 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 16.10 Cadastro 100% completo
    - Após foto, e-mail e logo concluídos: barra verde, sem pendências, recálculo sem reload
    - _Refs: Requisito 9.8, 9.11, 10.7_

  - [ ] 16.11 Postar frete com cadastro incompleto
    - Botão "Postar Frete" desabilitado e banner com link para `/perfil/embarcador`
    - Tentativa direta no client (`createFrete`) é rejeitada com mensagem de cadastro incompleto
    - Tentativa via SQL bruto também é rejeitada pela RLS (`fretes_insert_policy`)
    - _Refs: Requisito 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 16.12 Postar frete com cadastro 100% completo
    - Botão habilitado, frete criado normalmente
    - _Refs: Requisito 10.6_

- [ ] 17. Checkpoint final — Garantir que tudo compila e nenhuma regressão foi introduzida
  - Rodar `getDiagnostics` em todos os arquivos tocados
  - Rodar a suíte de testes em modo `--run`
  - Em caso de qualquer dúvida ou divergência com o design, parar e perguntar ao usuário

## Notas

- Tarefas marcadas com `*` são opcionais (PBTs) e podem ser puladas em um MVP
- Cada tarefa cita os requisitos cobertos via `_Refs:_`
- Smoke tests no item 16 não escrevem código novo, mas validam ponta a ponta os critérios de aceitação dos requisitos 1 a 14
- Esta spec termina no item 17. A execução de cada tarefa acontece sob demanda no editor pelo botão "Start task"
