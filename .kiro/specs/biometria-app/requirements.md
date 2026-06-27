# Documento de Requisitos — Entrada por Biometria no App (rosto/digital)

## Introdução

Esta spec adiciona, **no app mobile (Capacitor)**, uma trava de entrada por **biometria**
(rosto ou digital), no estilo dos apps de banco: a pessoa permanece "logada" entre
aberturas e, ao abrir o app, desbloqueia com biometria em vez de digitar senha. A biometria
**não autentica no servidor** — ela é uma **trava local** que destrava uma `Sessao_Supabase`
previamente guardada em **armazenamento seguro** do aparelho.

### Contexto técnico que define o escopo

O app FreteGO é um **shell remoto** Capacitor: o invólucro nativo carrega
`https://www.fretegobr.com.br` numa WebView. Mudanças de UI/web vão por `git push`, **mas**
biometria exige um **plugin nativo novo** — portanto exige **rebuild do APK/IPA e
re-submissão às lojas** (mudança "binária"). Esta spec assume Fase 3, após
`auth-otp-whatsapp` e `login-sem-senha`.

### Fora de escopo

- Autenticação biométrica server-side / WebAuthn-passkeys no navegador (alternativa citada no design, não implementada aqui).
- Login sem senha por código (spec `login-sem-senha`) — é o **fallback** desta.
- Qualquer mudança no fluxo web puro (browser desktop/mobile sem app).

## Glossário

- **App_Nativo**: build Capacitor (Android/iOS) que carrega a WebView do FreteGO.
- **Plataforma_Nativa**: contexto onde `Capacitor.isNativePlatform()` é verdadeiro.
- **Plugin_Biometria**: plugin Capacitor de biometria (ex.: `capacitor-native-biometric`), com prompt nativo e armazenamento seguro.
- **Storage_Seguro**: Keychain (iOS) / Keystore-EncryptedSharedPreferences (Android), exposto pelo Plugin_Biometria.
- **Sessao_Supabase**: par access/refresh token do Supabase Auth.
- **Refresh_Token_Guardado**: o refresh token da `Sessao_Supabase` salvo no Storage_Seguro.
- **Trava_Biometrica**: tela de bloqueio exibida na abertura do App_Nativo quando a biometria está ativa.
- **Biometria_Ativa**: estado em que a pessoa optou por usar biometria (flag local persistente).
- **Login_Completo**: autenticação por senha (existente) ou por código (spec `login-sem-senha`), usada como fallback.

## Requisitos

### Requisito 1: Disponibilidade e Ativação (Opt-in)

**User Story:** Como usuário do App_Nativo, eu quero ativar a entrada por biometria depois de
logar, para abrir o app sem digitar senha nas próximas vezes.

#### Critérios de Aceitação

1. WHERE o contexto é Plataforma_Nativa AND o Plugin_Biometria reporta hardware disponível e cadastrado, THE Sistema_FreteGO SHALL oferecer a opção "Ativar entrada por biometria" após um Login_Completo bem-sucedido.
2. WHERE o contexto NÃO é Plataforma_Nativa (navegador) OR a biometria não está disponível, THE Sistema_FreteGO SHALL ocultar a opção e nunca exibir a Trava_Biometrica.
3. WHEN o usuário ativa a biometria, THE Sistema_FreteGO SHALL exigir uma verificação biométrica de confirmação e, em sucesso, salvar o Refresh_Token_Guardado no Storage_Seguro e marcar Biometria_Ativa.
4. THE Sistema_FreteGO SHALL permitir desativar a biometria a qualquer momento, removendo o Refresh_Token_Guardado e a flag Biometria_Ativa.
5. THE Sistema_FreteGO SHALL nunca armazenar a senha do usuário no Storage_Seguro.

### Requisito 2: Trava na Abertura do App

**User Story:** Como usuário com biometria ativa, eu quero que o app peça meu rosto/digital ao
abrir, para proteger meus dados mesmo com a sessão viva.

#### Critérios de Aceitação

1. WHEN o App_Nativo inicia (cold start) OR retorna do background, WHERE Biometria_Ativa é verdadeiro, THE Sistema_FreteGO SHALL exibir a Trava_Biometrica antes de revelar qualquer conteúdo autenticado.
2. WHEN a verificação biométrica tem sucesso, THE Sistema_FreteGO SHALL restaurar a Sessao_Supabase a partir do Refresh_Token_Guardado e liberar o conteúdo.
3. IF a restauração da sessão falha (refresh token expirado/revogado), THEN THE Sistema_FreteGO SHALL limpar o estado e encaminhar para o Login_Completo.
4. WHEN o usuário cancela a biometria, THE Sistema_FreteGO SHALL oferecer "Entrar com senha ou código" (Login_Completo) como saída.
5. THE Trava_Biometrica SHALL impedir a navegação para áreas autenticadas enquanto não houver sucesso na biometria ou Login_Completo.

### Requisito 3: Limite de Tentativas e Fallback

**User Story:** Como usuário, eu quero uma alternativa quando a biometria falha, para não
ficar trancado para fora do app.

#### Critérios de Aceitação

1. IF a verificação biométrica falha repetidamente (limite do SO ou 5 tentativas), THEN THE Sistema_FreteGO SHALL encaminhar para o Login_Completo (senha ou código), sem bloquear a conta.
2. THE Login_Completo (senha + login sem senha) SHALL permanecer sempre disponível como rota alternativa.
3. WHEN o usuário escolhe o login por código no fallback, THE Sistema_FreteGO SHALL usar a spec `login-sem-senha`.

### Requisito 4: Permanência de Sessão ("manter logado")

**User Story:** Como usuário, eu quero permanecer logado entre aberturas (estilo rede
social), com a biometria apenas como cadeado.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL persistir a Sessao_Supabase entre aberturas do App_Nativo (a persistência da WebView já mantém os tokens).
2. THE biometria SHALL atuar como camada de desbloqueio sobre a sessão persistida, não como troca de credencial no servidor.
3. WHILE Biometria_Ativa é falso, THE Sistema_FreteGO SHALL manter o comportamento atual (sessão persistida sem trava).
4. WHEN o usuário faz logout explícito, THE Sistema_FreteGO SHALL limpar a Sessao_Supabase, o Refresh_Token_Guardado e a flag Biometria_Ativa.

### Requisito 5: Segurança do Armazenamento

**User Story:** Como Sistema_FreteGO, eu quero guardar o segredo de sessão com segurança, para
que um aparelho comprometido não exponha a conta facilmente.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL guardar apenas o Refresh_Token_Guardado (ou segredo equivalente) no Storage_Seguro, nunca senha nem access token de longa duração.
2. THE acesso ao Refresh_Token_Guardado SHALL ser condicionado à verificação biométrica do Plugin_Biometria.
3. THE Sistema_FreteGO SHALL remover o Refresh_Token_Guardado em logout, ao desativar a biometria e ao detectar refresh token inválido.
4. THE Sistema_FreteGO SHALL NÃO registrar tokens em logs.
5. WHERE o aparelho remove/zera a biometria cadastrada, THE Sistema_FreteGO SHALL invalidar o Refresh_Token_Guardado e exigir Login_Completo.

### Requisito 6: Empacotamento Nativo (build/lojas)

**User Story:** Como mantenedor, eu quero entender e executar as mudanças nativas necessárias,
para distribuir o recurso corretamente.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL adicionar o Plugin_Biometria às dependências e rodar `npx cap sync` para Android e iOS.
2. THE Sistema_FreteGO SHALL declarar as permissões/descrições necessárias: Android `USE_BIOMETRIC`; iOS `NSFaceIDUsageDescription`.
3. THE recurso SHALL exigir rebuild do APK/IPA e re-submissão às lojas; o web (shell) SHALL detectar a presença do plugin e degradar com segurança onde ele não existir.
4. WHEN o app sem o Plugin_Biometria carrega a versão web nova, THE Sistema_FreteGO SHALL não quebrar (feature detection): a biometria simplesmente não aparece.
5. THE documentação SHALL descrever o passo a passo de build e publicação.

### Requisito 7: Compatibilidade e Degradação

**User Story:** Como usuário em qualquer plataforma, eu quero que o app funcione mesmo sem
biometria, para nunca ficar travado por falta de suporte.

#### Critérios de Aceitação

1. WHERE não há Plataforma_Nativa OR não há hardware biométrico, THE Sistema_FreteGO SHALL operar normalmente com Login_Completo.
2. THE feature detection SHALL ocorrer em runtime, sem assumir presença do plugin.
3. IF o Plugin_Biometria lança erro inesperado, THEN THE Sistema_FreteGO SHALL capturar e cair para o Login_Completo sem travar a UI.
