# Fase 7 - Configuração do Supabase Storage

## ✅ O que foi implementado

1. **DocumentService completo** (`src/services/documents.ts`)
   - `uploadDocument()` - Upload de documentos
   - `getDocumentsByUser()` - Buscar documentos do usuário
   - `deleteDocument()` - Deletar documento
   - `getSignedUrl()` - Gerar URL temporária para acesso
   - `getDocumentByType()` - Buscar documento por tipo

2. **Validação de arquivos** (`src/utils/fileValidation.ts`)
   - Validação de tipo (PDF, JPG, PNG)
   - Validação de tamanho (máximo 10MB)
   - Funções auxiliares para formatação

3. **Tipos TypeScript** atualizados

## 🔧 Configuração necessária no Supabase

Você precisa executar o SQL para criar o bucket de storage e as políticas de acesso.

### Passo 1: Abrir SQL Editor no Supabase

1. Vá em https://supabase.com/dashboard
2. Selecione o projeto FreteGO
3. Clique em **SQL Editor** no menu lateral

### Passo 2: Executar o SQL

Abra o arquivo `supabase/storage/setup_storage.sql` e execute todo o conteúdo no SQL Editor.

O SQL vai:
- Criar o bucket 'documents' (privado, limite 10MB)
- Criar políticas RLS para:
  - Usuários podem fazer upload dos próprios documentos
  - Usuários podem visualizar os próprios documentos
  - Usuários podem deletar os próprios documentos
  - Admins podem visualizar e deletar qualquer documento

### Passo 3: Verificar

Após executar o SQL, verifique:
1. No Supabase, vá em **Storage** no menu lateral
2. Você deve ver o bucket **documents** criado
3. Clique nele para confirmar que está vazio e pronto para uso

## 📝 Tipos de documentos suportados

- `cpf` - Documento CPF
- `cnh` - Carteira Nacional de Habilitação
- `antt` - Registro ANTT
- `vehicle_registration` - Documento do veículo
- `vehicle_insurance` - Seguro do veículo
- `profile_photo` - Foto de perfil

## 🎯 Próxima fase

Após configurar o storage, podemos implementar a **Fase 8: Gestão de documentos - Frontend** com:
- Componente de upload com drag & drop
- Preview de imagens
- Progress bar
- Lista de documentos

## ⚠️ Importante

O storage está configurado para:
- **Tamanho máximo**: 10MB por arquivo
- **Formatos permitidos**: PDF, JPG, JPEG, PNG
- **Acesso**: Privado (apenas o dono e admins podem acessar)
