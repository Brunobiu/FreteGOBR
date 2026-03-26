# FreteGO

Marketplace de frete brasileiro conectando embarcadores e motoristas.

## 🚀 Tecnologias

- **React 18** - Biblioteca UI
- **TypeScript** - Tipagem estática
- **Vite** - Build tool e dev server
- **Tailwind CSS** - Framework CSS utility-first
- **ESLint** - Linter para qualidade de código
- **Prettier** - Formatação de código
- **Husky** - Git hooks para automação

## 📁 Estrutura do Projeto

```
FreteGO/
├── src/
│   ├── components/     # Componentes React reutilizáveis
│   ├── services/       # Serviços e integrações (Supabase, APIs)
│   ├── hooks/          # Custom React hooks
│   ├── types/          # Definições de tipos TypeScript
│   ├── utils/          # Funções utilitárias
│   ├── App.tsx         # Componente principal
│   ├── main.tsx        # Entry point
│   └── index.css       # Estilos globais com Tailwind
├── .husky/             # Git hooks
├── .env.example        # Exemplo de variáveis de ambiente
└── package.json        # Dependências e scripts
```

## 🛠️ Configuração

### Pré-requisitos

- Node.js 18+ 
- npm ou yarn

### Instalação

1. Clone o repositório
```bash
git clone <repository-url>
cd FreteGO
```

2. Instale as dependências
```bash
npm install
```

3. Configure as variáveis de ambiente
```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais do Supabase:
- `VITE_SUPABASE_URL` - URL do projeto Supabase
- `VITE_SUPABASE_ANON_KEY` - Chave anônima do Supabase
- `VITE_SUPABASE_SERVICE_KEY` - Chave de serviço do Supabase

### Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev          # Inicia servidor de desenvolvimento

# Build
npm run build        # Compila para produção
npm run preview      # Preview da build de produção

# Qualidade de Código
npm run lint         # Executa ESLint
npm run format       # Formata código com Prettier
```

## 🔧 Configurações

### TypeScript

O projeto usa TypeScript em modo **strict** para máxima segurança de tipos. Configurações em `tsconfig.json`.

### ESLint

Configurado com regras recomendadas para React e TypeScript. Veja `.eslintrc.cjs`.

### Prettier

Formatação automática com configurações em `.prettierrc`:
- Single quotes
- 2 espaços de indentação
- 100 caracteres por linha

### Husky

Git hooks configurados:
- **pre-commit**: Executa lint-staged para validar código antes do commit

## 📝 Próximos Passos

1. Configurar Supabase (Task 2)
2. Implementar autenticação (Tasks 4-5)
3. Desenvolver gestão de fretes (Tasks 11-12)
4. Adicionar mapa interativo (Task 15)

## 📄 Licença

Este projeto é privado e proprietário.
