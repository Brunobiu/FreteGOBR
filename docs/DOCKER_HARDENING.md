# Docker Hardening - Guia de Segurança

## Visão Geral

Este documento descreve as melhores práticas de segurança para quando o FreteGO migrar para containers Docker. Atualmente o projeto usa Vercel, mas estas recomendações serão úteis para deploy em infraestrutura própria.

## 1. Não Rodar como Root

Por padrão, containers Docker rodam como root, o que é um risco de segurança.

### Dockerfile Recomendado

```dockerfile
# Usar imagem base mínima
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar apenas arquivos necessários para instalar dependências
COPY package*.json ./
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Build da aplicação
RUN npm run build

# Imagem de produção
FROM node:20-alpine AS production

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Copiar arquivos do builder
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./

# Mudar para usuário não-root
USER nextjs

# Expor porta não-privilegiada
EXPOSE 3000

# Comando de inicialização
CMD ["node", "dist/server.js"]
```

## 2. Imagens Base Mínimas

### Comparação de Tamanhos

| Imagem | Tamanho | Vulnerabilidades |
|--------|---------|------------------|
| node:20 | ~1GB | Muitas |
| node:20-slim | ~200MB | Algumas |
| node:20-alpine | ~130MB | Poucas |
| gcr.io/distroless/nodejs20 | ~100MB | Mínimas |

### Recomendação

Usar `node:20-alpine` para desenvolvimento e `distroless` para produção.

```dockerfile
# Produção com Distroless
FROM gcr.io/distroless/nodejs20-debian11

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules

WORKDIR /app
CMD ["dist/server.js"]
```

## 3. Filesystem Read-Only

Previne que atacantes modifiquem arquivos no container.

### docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    image: fretego:latest
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
    security_opt:
      - no-new-privileges:true
```

### Kubernetes

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      runAsUser: 1001
```

## 4. Gerenciamento de Secrets

### ❌ Errado

```dockerfile
ENV DATABASE_URL=postgres://user:password@host/db
ENV STRIPE_SECRET_KEY=sk_live_xxx
```

### ✅ Correto

```yaml
# docker-compose.yml
services:
  app:
    secrets:
      - db_password
      - stripe_key
    environment:
      - DATABASE_URL_FILE=/run/secrets/db_password

secrets:
  db_password:
    external: true
  stripe_key:
    external: true
```

### Kubernetes Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: fretego-secrets
type: Opaque
data:
  database-url: <base64-encoded>
  stripe-key: <base64-encoded>
```

## 5. Isolamento de Rede

### docker-compose.yml

```yaml
version: '3.8'

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # Sem acesso à internet

services:
  nginx:
    networks:
      - frontend
      - backend
  
  app:
    networks:
      - backend  # Apenas rede interna
  
  database:
    networks:
      - backend
```

## 6. Scanning de Imagens

### Ferramentas Recomendadas

1. **Trivy** (gratuito)
```bash
trivy image fretego:latest
```

2. **Snyk** (freemium)
```bash
snyk container test fretego:latest
```

3. **Docker Scout** (integrado ao Docker Desktop)
```bash
docker scout cves fretego:latest
```

### CI/CD Pipeline

```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build image
        run: docker build -t fretego:${{ github.sha }} .
      
      - name: Run Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: fretego:${{ github.sha }}
          severity: 'CRITICAL,HIGH'
          exit-code: '1'
```

## 7. Limites de Recursos

### docker-compose.yml

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## 8. Health Checks

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

## 9. Logging Seguro

### Não logar dados sensíveis

```javascript
// ❌ Errado
console.log('User login:', { email, password });

// ✅ Correto
console.log('User login:', { email, password: '[REDACTED]' });
```

### Configurar driver de log

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 10. Checklist de Segurança

- [ ] Usar usuário não-root
- [ ] Usar imagem base mínima (Alpine/Distroless)
- [ ] Filesystem read-only
- [ ] Secrets via Docker Secrets ou Vault
- [ ] Redes isoladas
- [ ] Scanning de vulnerabilidades no CI
- [ ] Limites de CPU/memória
- [ ] Health checks configurados
- [ ] Logs sem dados sensíveis
- [ ] Atualizar imagens regularmente

## Recursos Adicionais

- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [OWASP Docker Security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Distroless Images](https://github.com/GoogleContainerTools/distroless)
