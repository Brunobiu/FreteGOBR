# Plano de Implementação - Layout Theme (Light Mode)

> **STATUS (29/05/2026)**: spec **100% concluída** via implementação
> incremental. App inteiro está em light mode com paleta verde
> FreteGO. Tema escuro original abandonado.

## Tarefas

- [x] 1. Configuração base de cores (Tailwind)
- [x] 2. Validação de configuração — done
- [x] 3. Migrar layouts principais (HomePage, AppHeader, etc.)
- [x] 4. Validação de migração de layout — done
- [x] 5. Cards e Modais em light mode
- [x] 6. Formulários em light mode (FreteForm, LoginForm, RegisterForm)
- [x] 7. Validação de migração de formulários — done
- [x] 8. NotificationBell, dropdowns, painéis em light mode
- [x] 9. Estados e alertas (erro/sucesso/warning) em light mode
- [x] 10. Validação de estados — done
- [x] 11. Validação e testes — funcional
- [x] 12. Checkpoint final — todas funcionalidades navegam OK

## Notas

A migração foi feita organicamente conforme novas features eram
implementadas — cada tela nova já nasceu em light mode, e telas
antigas foram migradas durante refatorações. Resultado validado
em produção.
