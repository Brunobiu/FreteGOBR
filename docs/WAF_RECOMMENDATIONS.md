# Recomendações de WAF (Web Application Firewall)

## Visão Geral

Um WAF protege sua aplicação contra ataques comuns na camada de aplicação. Para o FreteGO, recomendamos usar o Cloudflare como WAF principal.

## Por que Cloudflare?

- Plano gratuito com proteção básica
- CDN global para melhor performance
- Proteção DDoS incluída
- Fácil integração com Vercel
- Dashboard intuitivo

## Configuração Recomendada

### 1. Regras de Firewall

#### Bloquear SQL Injection
```
(http.request.uri.query contains "SELECT" or 
 http.request.uri.query contains "UNION" or 
 http.request.uri.query contains "INSERT" or 
 http.request.uri.query contains "DELETE" or 
 http.request.uri.query contains "DROP")
```
**Ação**: Block

#### Bloquear XSS
```
(http.request.uri.query contains "<script" or 
 http.request.uri.query contains "javascript:" or 
 http.request.uri.query contains "onerror=")
```
**Ação**: Block

#### Bloquear Scanners Conhecidos
```
(http.user_agent contains "sqlmap" or 
 http.user_agent contains "nikto" or 
 http.user_agent contains "nmap" or 
 http.user_agent contains "masscan")
```
**Ação**: Block

### 2. Rate Limiting

| Endpoint | Limite | Período | Ação |
|----------|--------|---------|------|
| /api/auth/login | 5 | 1 minuto | Challenge |
| /api/auth/register | 3 | 1 minuto | Challenge |
| /api/* | 100 | 1 minuto | Challenge |
| /* | 1000 | 1 minuto | Block |

### 3. Geo-Blocking (Opcional)

Se o FreteGO atende apenas o Brasil:

```
(not ip.geoip.country in {"BR"})
```
**Ação**: Challenge (não Block, para evitar falsos positivos)

### 4. Bot Management

- Ativar "Bot Fight Mode" (gratuito)
- Configurar "Super Bot Fight Mode" (plano Pro)
- Permitir bots conhecidos (Google, Bing)

### 5. Managed Rules

Ativar os seguintes conjuntos de regras:
- Cloudflare Managed Ruleset
- Cloudflare OWASP Core Ruleset
- Cloudflare Leaked Credentials Check

## Integração com Vercel

1. Adicionar domínio no Cloudflare
2. Atualizar nameservers no registrador
3. Configurar SSL/TLS como "Full (strict)"
4. Ativar "Always Use HTTPS"
5. Configurar Page Rules para cache

## Estimativa de Custos

| Plano | Preço/mês | Recursos |
|-------|-----------|----------|
| Free | $0 | Proteção básica, CDN, SSL |
| Pro | $20 | WAF avançado, Image optimization |
| Business | $200 | SLA 100%, Regras customizadas |
| Enterprise | Sob consulta | Suporte dedicado |

**Recomendação**: Começar com Free, migrar para Pro quando tiver tráfego significativo.

## Monitoramento

### Métricas Importantes
- Requests bloqueados por regra
- Top IPs bloqueados
- Países de origem do tráfego
- Ataques detectados por tipo

### Alertas Recomendados
- Pico de requests bloqueados (>100/min)
- Novo IP com muitos bloqueios
- Tentativas de SQL injection
- Ataques DDoS detectados

## Passos de Implementação

1. **Criar conta Cloudflare** (gratuito)
2. **Adicionar site** e seguir wizard
3. **Atualizar DNS** no registrador
4. **Aguardar propagação** (até 24h)
5. **Configurar regras** conforme acima
6. **Testar** com ferramentas como curl
7. **Monitorar** dashboard por 1 semana
8. **Ajustar** regras conforme necessário

## Testes de Validação

```bash
# Testar bloqueio de SQL injection
curl "https://seusite.com/?id=1' OR '1'='1"

# Testar bloqueio de XSS
curl "https://seusite.com/?q=<script>alert(1)</script>"

# Testar rate limiting
for i in {1..20}; do curl -s "https://seusite.com/api/test"; done
```

## Recursos Adicionais

- [Documentação Cloudflare WAF](https://developers.cloudflare.com/waf/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare + Vercel](https://vercel.com/guides/using-cloudflare-with-vercel)
