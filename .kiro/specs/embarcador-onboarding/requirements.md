# Documento de Requisitos - Onboarding e Perfil do Embarcador

## Introdução

Este documento especifica os requisitos para o conjunto de melhorias de onboarding e perfil do Embarcador no FreteGO. As mudanças cobrem o fluxo de cadastro, o redirecionamento para login após criação de conta, a exibição do nome da empresa no cabeçalho, a simplificação da página de configurações, a verificação de e-mail com código descartável, o upload de logo da empresa, a barra de progresso de cadastro no perfil e a restrição que só permite ao Embarcador postar fretes quando o cadastro estiver 100% completo.

O escopo cobre apenas o tipo de usuário Embarcador. A verificação de telefone via SMS, mudanças no fluxo de Motorista, troca de e-mail após verificação confirmada, e verificação de CNPJ ou documentos da empresa estão fora do escopo desta spec.

## Glossário

- **Sistema_FreteGO**: Aplicação web do FreteGO em React + TypeScript + Vite + Supabase + Tailwind CSS
- **Embarcador**: Usuário do tipo `embarcador` registrado nas tabelas `users` e `embarcadores`
- **Página_Cadastro**: Componente `RegisterPage.tsx` que renderiza o formulário `RegisterForm.tsx`
- **Página_Login**: Componente `LoginPage.tsx` que renderiza o formulário de autenticação
- **Página_Configurações**: Componente `ConfiguracoesPage.tsx` acessível pelo menu do `AppHeader`
- **Página_Perfil_Embarcador**: Componente `EmbarcadorPerfilPage.tsx` acessível por `/perfil/embarcador`
- **Página_Embarcador**: Componente `EmbarcadorPage.tsx` em `/embarcador` que lista os fretes do Embarcador autenticado
- **AppHeader**: Componente `AppHeader.tsx` exibido no topo das páginas autenticadas
- **Badge_Tipo_Usuário**: Tag visual ao lado do logo no `AppHeader` com o texto "Embarcador" ou "Motorista"
- **Badge_Empresa**: Tag visual ao lado do `Badge_Tipo_Usuário` no `AppHeader` exibindo o `Nome_Empresa`
- **Nome_Empresa**: Valor da coluna `embarcadores.company_name` do Embarcador autenticado
- **Logo_Empresa**: Imagem enviada pelo Embarcador armazenada no Supabase Storage e referenciada por `embarcadores.company_logo_url`
- **Foto_Perfil**: Imagem do usuário armazenada via tabela `documents` (tipo `profile_photo`) e referenciada por `users.profile_photo_url`
- **Email_Verificado**: Estado em que o Embarcador confirmou o e-mail digitado, registrado em `users.email_verified = true`
- **Código_Verificação**: Sequência numérica de 6 dígitos gerada pelo `Sistema_FreteGO` para confirmar e-mail
- **Tabela_Códigos**: Tabela `verification_codes` que armazena códigos pendentes com expiração e contador de tentativas
- **Serviço_Email_OTP**: Componente do backend (Edge Function ou rotina Supabase) que envia o `Código_Verificação` para um e-mail
- **Modal_Verificação**: Diálogo modal que solicita ao Embarcador a digitação do `Código_Verificação` recebido
- **Barra_Progresso_Cadastro**: Indicador percentual no topo da `Página_Perfil_Embarcador` que reflete o estado de preenchimento do cadastro
- **Itens_Cadastro**: Conjunto fixo de itens que compõem o cadastro completo do Embarcador: `Foto_Perfil`, `Email_Verificado` e `Logo_Empresa`
- **Cadastro_Completo**: Estado em que todos os `Itens_Cadastro` estão preenchidos e/ou verificados
- **Postar_Frete**: Ação de criar um novo frete a partir da `Página_Embarcador`

## Requisitos

### Requisito 1: Texto do Botão de Criação de Conta

**User Story:** Como Embarcador em fase de cadastro, eu quero que o botão de envio do formulário de cadastro tenha o texto "Criar conta", para entender claramente que estou criando uma conta no FreteGO.

#### Critérios de Aceitação

1. WHEN o Embarcador visualiza o `RegisterForm` com tipo de usuário "Embarcador" selecionado, THE Sistema_FreteGO SHALL exibir o botão de envio com o texto "Criar conta"
2. THE Sistema_FreteGO SHALL aplicar o mesmo texto "Criar conta" ao botão de envio quando o tipo de usuário "Motorista" estiver selecionado
3. WHILE o envio do formulário está em andamento, THE Sistema_FreteGO SHALL exibir o texto "Criando conta..." no botão e desabilitar o botão

### Requisito 2: Fluxo de Cadastro Separado do Login

**User Story:** Como Embarcador em fase de cadastro, eu quero que após criar a conta o Sistema_FreteGO me direcione para a Página_Login com uma mensagem de sucesso, para que eu efetue o login manualmente com as credenciais que acabei de criar.

#### Critérios de Aceitação

1. WHEN a criação de conta do Embarcador é concluída com sucesso, THE Sistema_FreteGO SHALL encerrar a sessão criada automaticamente pelo Supabase Auth antes de redirecionar
2. WHEN a criação de conta do Embarcador é concluída com sucesso, THE Sistema_FreteGO SHALL redirecionar o navegador para a rota `/login`
3. WHEN o Embarcador é redirecionado para a Página_Login após cadastro, THE Sistema_FreteGO SHALL exibir a mensagem "Conta criada com sucesso. Faça login para continuar."
4. WHEN o Embarcador é redirecionado para a Página_Login após cadastro, THE Sistema_FreteGO SHALL pré-preencher o campo de telefone com o telefone usado no cadastro
5. IF a criação de conta falha, THEN THE Sistema_FreteGO SHALL manter o Embarcador na Página_Cadastro e exibir o erro retornado pelo serviço de autenticação
6. WHILE o Embarcador não realizar login manualmente, THE Sistema_FreteGO SHALL tratar o estado como não autenticado em todas as rotas protegidas

### Requisito 3: Badge da Empresa no Cabeçalho

**User Story:** Como Embarcador autenticado, eu quero ver o nome da minha empresa no cabeçalho ao lado do indicador "Embarcador", para identificar rapidamente em qual conta estou logado.

#### Critérios de Aceitação

1. WHEN o AppHeader é renderizado para um Embarcador autenticado, THE Sistema_FreteGO SHALL exibir o Badge_Empresa imediatamente à direita do Badge_Tipo_Usuário
2. THE Sistema_FreteGO SHALL preencher o Badge_Empresa com o valor de `embarcadores.company_name` do Embarcador autenticado
3. WHERE o usuário autenticado é Motorista, THE AppHeader SHALL ocultar o Badge_Empresa
4. IF `embarcadores.company_name` não está disponível, THEN THE AppHeader SHALL ocultar o Badge_Empresa
5. WHILE a largura da tela é menor que 640px, THE AppHeader SHALL truncar o texto do Badge_Empresa em até 20 caracteres com reticências
6. THE Badge_Empresa SHALL usar o mesmo estilo visual do Badge_Tipo_Usuário (mesma altura, padding, raio de borda e tipografia)

### Requisito 4: Remoção da Zona de Perigo na Página de Configurações

**User Story:** Como Embarcador, eu quero que a Página_Configurações exponha apenas a opção de trocar senha, para reduzir o risco de exclusão acidental de conta.

#### Critérios de Aceitação

1. THE Página_Configurações SHALL exibir a seção "Alterar Senha" com os campos de senha atual, nova senha e confirmação
2. THE Página_Configurações SHALL ocultar qualquer seção rotulada como "Zona de Perigo"
3. THE Página_Configurações SHALL ocultar o botão "Excluir Minha Conta"
4. THE Sistema_FreteGO SHALL remover o handler `handleDeleteAccount` da Página_Configurações
5. WHEN o Embarcador envia o formulário de alteração de senha com dados válidos, THE Sistema_FreteGO SHALL atualizar a senha via Supabase Auth e exibir a mensagem "Senha alterada com sucesso!"

### Requisito 5: Nome do Embarcador em Modo Somente Leitura

**User Story:** Como Embarcador, eu quero que meu nome no perfil apareça em modo somente leitura, para evitar alterações acidentais do nome de cadastro.

#### Critérios de Aceitação

1. WHEN a Página_Perfil_Embarcador é carregada, THE Sistema_FreteGO SHALL exibir o nome do Embarcador como texto estático sem campo de input editável
2. THE Página_Perfil_Embarcador SHALL exibir o valor de `users.name` ao lado do rótulo "Nome"
3. THE Página_Perfil_Embarcador SHALL omitir o campo `name` da requisição de atualização do perfil enviada para `updateEmbarcadorProfile`
4. IF o usuário tentar modificar o nome via DevTools, THEN THE Sistema_FreteGO SHALL ignorar a alteração no payload enviado ao backend

### Requisito 6: Verificação de E-mail por Código

**User Story:** Como Embarcador, eu quero verificar meu e-mail digitando um código recebido por mensagem, para que o Sistema_FreteGO confirme que o e-mail informado é meu.

#### Critérios de Aceitação

1. WHEN a Página_Perfil_Embarcador é carregada e `users.email_verified` é falso, THE Sistema_FreteGO SHALL exibir o campo de e-mail vazio com placeholder e o botão "Verificar e-mail" ao lado
2. WHEN a Página_Perfil_Embarcador é carregada e `users.email_verified` é verdadeiro, THE Sistema_FreteGO SHALL exibir o e-mail verificado em modo somente leitura com o selo "E-mail confirmado" e ícone verde
3. WHEN o Embarcador clica em "Verificar e-mail" com um e-mail no formato válido (RFC 5322), THE Serviço_Email_OTP SHALL gerar um Código_Verificação de 6 dígitos numéricos e enviá-lo para o e-mail informado
4. WHEN o Código_Verificação é gerado, THE Tabela_Códigos SHALL armazenar o registro com `user_id`, `purpose = 'email'`, `target` (e-mail), hash do código, `expires_at = now() + 10 minutos`, `attempts = 0` e `consumed = false`
5. WHEN o Código_Verificação é enviado, THE Sistema_FreteGO SHALL abrir o Modal_Verificação solicitando os 6 dígitos
6. WHEN o Embarcador submete o código no Modal_Verificação e o código corresponde ao registro mais recente não expirado e não consumido, THE Sistema_FreteGO SHALL marcar o registro como `consumed = true`, atualizar `users.email = <e-mail>`, atualizar `users.email_verified = true` e fechar o Modal_Verificação
7. WHEN a verificação de e-mail é concluída com sucesso, THE Sistema_FreteGO SHALL exibir a mensagem "E-mail confirmado" com ícone verde por no mínimo 3 segundos
8. IF o código submetido não corresponde ao registro válido, THEN THE Sistema_FreteGO SHALL incrementar `attempts` e exibir a mensagem "Código incorreto. Tente novamente."
9. IF `attempts` atinge 3, THEN THE Sistema_FreteGO SHALL invalidar o Código_Verificação, fechar o Modal_Verificação e exibir a mensagem "Código bloqueado. Solicite um novo código."
10. IF o Código_Verificação ultrapassa `expires_at`, THEN THE Sistema_FreteGO SHALL recusar a submissão e exibir a mensagem "Código expirado. Solicite um novo código."
11. THE Modal_Verificação SHALL oferecer um botão "Reenviar código" desabilitado por 60 segundos após cada envio
12. WHEN um novo Código_Verificação é gerado para o mesmo `user_id` e `purpose = 'email'`, THE Sistema_FreteGO SHALL invalidar todos os códigos anteriores não consumidos do mesmo par
13. THE Sistema_FreteGO SHALL persistir `users.email_verified` como `false` por padrão na criação de novas contas

### Requisito 7: Exibição do Telefone no Perfil

**User Story:** Como Embarcador, eu quero ver meu telefone no perfil em modo somente leitura, para reconhecer o número usado no cadastro sem possibilidade de alteração acidental.

#### Critérios de Aceitação

1. WHEN a Página_Perfil_Embarcador é carregada, THE Sistema_FreteGO SHALL exibir o telefone do Embarcador como texto formatado em modo somente leitura ao lado do rótulo "Telefone"
2. THE Página_Perfil_Embarcador SHALL formatar o telefone no padrão `(DD) D NNNN-NNNN` ou `(DD) NNNN-NNNN` conforme a quantidade de dígitos
3. THE Página_Perfil_Embarcador SHALL omitir o campo `phone` da requisição de atualização do perfil enviada para `updateEmbarcadorProfile`

### Requisito 8: Upload do Logo da Empresa

**User Story:** Como Embarcador, eu quero fazer upload do logo da minha empresa no perfil, para que o logo apareça associado à minha conta no Sistema_FreteGO.

#### Critérios de Aceitação

1. THE Página_Perfil_Embarcador SHALL exibir o campo "Logo da Empresa" imediatamente abaixo do campo "Nome da Empresa"
2. WHEN o Embarcador seleciona um arquivo de imagem para o logo, THE Sistema_FreteGO SHALL aceitar somente arquivos com mime-type `image/jpeg`, `image/png` ou `image/webp`
3. THE Sistema_FreteGO SHALL aceitar somente arquivos de logo com tamanho menor ou igual a 2 MB
4. IF o arquivo selecionado tem mime-type não permitido, THEN THE Sistema_FreteGO SHALL exibir a mensagem "Formato inválido. Envie JPG, PNG ou WEBP."
5. IF o arquivo selecionado tem tamanho maior que 2 MB, THEN THE Sistema_FreteGO SHALL exibir a mensagem "Arquivo muito grande. Limite de 2 MB."
6. WHEN o upload do logo é concluído com sucesso, THE Sistema_FreteGO SHALL armazenar o arquivo no bucket Supabase `company-logos` no caminho `embarcadores/<user_id>/logo.<ext>`
7. WHEN o upload do logo é concluído com sucesso, THE Sistema_FreteGO SHALL atualizar a coluna `embarcadores.company_logo_url` com a URL pública ou assinada do arquivo
8. WHEN a Página_Perfil_Embarcador é carregada e `embarcadores.company_logo_url` está preenchido, THE Sistema_FreteGO SHALL exibir o preview do logo no campo "Logo da Empresa"
9. WHILE o upload está em andamento, THE Sistema_FreteGO SHALL desabilitar o input de arquivo e exibir o estado "Enviando..."
10. THE Sistema_FreteGO SHALL aplicar política RLS no bucket `company-logos` que permite leitura pública dos arquivos e escrita apenas pelo Embarcador dono do `user_id` correspondente

### Requisito 9: Barra de Progresso de Cadastro

**User Story:** Como Embarcador, eu quero ver no topo do perfil uma barra de progresso que indica quanto do meu cadastro está completo, para saber o que ainda preciso preencher.

#### Critérios de Aceitação

1. THE Página_Perfil_Embarcador SHALL exibir a Barra_Progresso_Cadastro como o primeiro elemento abaixo do título da página
2. THE Barra_Progresso_Cadastro SHALL calcular o percentual com base nos três Itens_Cadastro com peso igual de aproximadamente 33,3% cada
3. THE Barra_Progresso_Cadastro SHALL contar `Foto_Perfil` como concluído quando `users.profile_photo_url` está preenchido
4. THE Barra_Progresso_Cadastro SHALL contar `Email_Verificado` como concluído quando `users.email_verified` é verdadeiro
5. THE Barra_Progresso_Cadastro SHALL contar `Logo_Empresa` como concluído quando `embarcadores.company_logo_url` está preenchido
6. WHILE o percentual calculado é menor que 50, THE Barra_Progresso_Cadastro SHALL renderizar a barra na cor vermelha
7. WHILE o percentual calculado é maior ou igual a 50 e menor que 100, THE Barra_Progresso_Cadastro SHALL renderizar a barra na cor amarela
8. WHILE o percentual calculado é igual a 100, THE Barra_Progresso_Cadastro SHALL renderizar a barra na cor verde
9. THE Barra_Progresso_Cadastro SHALL exibir o texto "<percentual>% completo" à direita da barra
10. THE Barra_Progresso_Cadastro SHALL exibir abaixo da barra uma lista dos Itens_Cadastro pendentes nomeados como "Adicionar foto de perfil", "Verificar e-mail" e "Adicionar logo da empresa"
11. WHEN um Item_Cadastro passa para o estado concluído, THE Barra_Progresso_Cadastro SHALL recalcular e re-renderizar o percentual sem recarregar a página

### Requisito 10: Restrição de Postagem de Frete por Cadastro Completo

**User Story:** Como Sistema_FreteGO, eu quero impedir que Embarcadores com cadastro incompleto postem fretes, para garantir que somente contas verificadas operem na plataforma.

#### Critérios de Aceitação

1. WHEN a Página_Embarcador é carregada e o Cadastro_Completo do Embarcador é falso, THE Sistema_FreteGO SHALL desabilitar o botão "Postar Frete"
2. WHEN o Embarcador tenta abrir o modal de criação de frete com Cadastro_Completo falso, THE Sistema_FreteGO SHALL exibir a mensagem "Complete seu cadastro para postar fretes" e listar os Itens_Cadastro pendentes
3. THE Sistema_FreteGO SHALL exibir o link "Completar cadastro" que navega para `/perfil/embarcador` quando o Cadastro_Completo é falso
4. WHEN o Embarcador chama a função `createFrete` via cliente com Cadastro_Completo falso, THE Sistema_FreteGO SHALL rejeitar a requisição com a mensagem "Cadastro incompleto. Verifique e-mail, foto e logo da empresa."
5. THE Sistema_FreteGO SHALL aplicar uma política RLS na tabela `fretes` que recusa `INSERT` quando qualquer dos seguintes é falso para o `embarcador_id`: `users.email_verified`, `users.profile_photo_url IS NOT NULL`, `embarcadores.company_logo_url IS NOT NULL`
6. WHEN o Cadastro_Completo do Embarcador é verdadeiro, THE Sistema_FreteGO SHALL habilitar o botão "Postar Frete" e permitir a criação de fretes sem limite adicional decorrente desta spec
7. THE Sistema_FreteGO SHALL avaliar o `Cadastro_Completo` como verdadeiro quando `users.profile_photo_url IS NOT NULL`, `users.email_verified = true` e `embarcadores.company_logo_url IS NOT NULL`

### Requisito 11: Schema de Banco de Dados

**User Story:** Como Sistema_FreteGO, eu quero persistir o estado de verificação e o logo no banco de dados, para que as regras de cadastro completo possam ser avaliadas em qualquer requisição.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL adicionar a coluna `email_verified BOOLEAN NOT NULL DEFAULT false` na tabela `users`
2. THE Sistema_FreteGO SHALL adicionar a coluna `company_logo_url TEXT` na tabela `embarcadores`
3. THE Sistema_FreteGO SHALL criar a tabela `verification_codes` com as colunas `id UUID PK`, `user_id UUID FK users(id)`, `purpose VARCHAR(20) CHECK (purpose IN ('email'))`, `target VARCHAR(255) NOT NULL`, `code_hash VARCHAR(255) NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `attempts INTEGER NOT NULL DEFAULT 0`, `consumed BOOLEAN NOT NULL DEFAULT false`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
5. THE Sistema_FreteGO SHALL criar índice em `verification_codes(user_id, purpose, consumed)` para acelerar a busca pelo código ativo
6. THE Sistema_FreteGO SHALL armazenar o `code_hash` como hash SHA-256 do código em base64 sem armazenar o código em texto claro
7. THE Sistema_FreteGO SHALL criar política RLS na tabela `verification_codes` que permite o usuário autenticado ler e atualizar apenas registros com `user_id = auth.uid()`
8. THE Sistema_FreteGO SHALL aplicar todas as alterações de schema em uma nova migration sequencial em `supabase/migrations`

### Requisito 12: Pretty Printer e Round-Trip do Código de Verificação

**User Story:** Como Sistema_FreteGO, eu quero garantir que a geração e validação do Código_Verificação sejam consistentes, para evitar falhas de comparação por formatação.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL gerar o Código_Verificação com exatamente 6 caracteres no conjunto `[0-9]`
2. THE Sistema_FreteGO SHALL normalizar o código submetido removendo espaços e caracteres não numéricos antes de comparar
3. FOR ALL códigos gerados, THE Sistema_FreteGO SHALL produzir um hash que, ao ser comparado com o hash do mesmo código submetido após normalização, resulte em correspondência (propriedade de round-trip gerar → hash → normalizar → hash)
4. THE Sistema_FreteGO SHALL recusar comparação por igualdade direta de código em texto claro e usar comparação em tempo constante sobre o hash

### Requisito 13: Telemetria e Logs de Verificação

**User Story:** Como administrador do Sistema_FreteGO, eu quero registrar tentativas de verificação para auditoria, para detectar abusos sem expor segredos.

#### Critérios de Aceitação

1. WHEN um Código_Verificação é gerado, THE Sistema_FreteGO SHALL registrar em `audit_logs` uma entrada com `action = 'verification_code_sent'`, `user_id` e `new_data` contendo `purpose` e `target` mascarado (apenas últimos 4 caracteres visíveis)
2. WHEN um Código_Verificação é validado com sucesso, THE Sistema_FreteGO SHALL registrar em `audit_logs` uma entrada com `action = 'verification_succeeded'` e `purpose`
3. WHEN um Código_Verificação é bloqueado por exceder tentativas, THE Sistema_FreteGO SHALL registrar em `audit_logs` uma entrada com `action = 'verification_blocked'` e `purpose`
4. THE Sistema_FreteGO SHALL omitir o valor do código e do hash em todos os registros de auditoria

### Requisito 14: Acessibilidade dos Componentes Novos

**User Story:** Como Embarcador, eu quero que os novos componentes de verificação e progresso sejam acessíveis via teclado e leitor de tela, para usar o sistema independente de minhas limitações.

#### Critérios de Aceitação

1. THE Modal_Verificação SHALL receber foco no primeiro input ao abrir e devolver o foco ao botão de origem ao fechar
2. THE Modal_Verificação SHALL fechar quando o Embarcador pressiona a tecla `Esc`
3. THE Barra_Progresso_Cadastro SHALL expor `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"` e `aria-valuemax="100"`
4. THE Badge_Empresa SHALL incluir o texto do nome da empresa de forma legível por leitores de tela sem depender apenas de cor para diferenciação
5. THE Sistema_FreteGO SHALL garantir contraste mínimo de 4.5:1 entre texto e fundo nos selos "E-mail confirmado" e "Telefone confirmado"
