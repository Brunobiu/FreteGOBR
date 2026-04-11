# Log de Correções - Testes Manuais FreteGO

Este documento registra todos os erros encontrados durante os testes manuais e como foram corrigidos.

---

## Formato

### Erro #X - [Título curto]
- **Encontrado em:** [página/rota]
- **Descrição:** [o que aconteceu]
- **Status:** 🔴 Pendente / 🟢 Corrigido
- **Correção:** [como foi corrigido - preencher após confirmação]

---

## Erros Encontrados

### Erro #1 - Mensagem técnica de erro na Home (Supabase lock/fetch)
- **Encontrado em:** http://localhost:5173/ (Home)
- **Descrição:** Ao abrir a home, aparecia "Erro ao buscar fretes: Error: Lock lock:sb-... was released" e depois "TypeError: Failed to fetch" - mensagens técnicas do Supabase expostas ao usuário
- **Status:** 🟢 Corrigido
- **Correção:** 
  - `src/services/supabase.ts`: Adicionado `storageKey: 'fretego-auth'` e `flowType: 'implicit'` para evitar conflito de lock
  - `src/services/fretes.ts`: Tratamento de erros de conexão/auth retorna lista vazia ao invés de propagar erro
  - `src/pages/HomePage.tsx`: Erros de rede (Failed to fetch, lock) mostram "Nenhum frete disponível" ao invés de mensagem técnica
