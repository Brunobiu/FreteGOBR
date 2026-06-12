/**
 * Data_Cache em memória com escopo de sessão (Requirements 6, 7).
 *
 * Camada de cache opt-in e agnóstica de Supabase: recebe uma chave estável
 * (string) e uma função fetcher. Coalesce requisições concorrentes com a mesma
 * chave (dedupe via Map<key, Promise>), reutiliza valores válidos entre
 * navegações e expira por TTL.
 *
 * Princípio fail-safe (design — Error Handling): o cache NUNCA mascara erros do
 * fetcher. Em falha, a requisição em voo é removida (não cacheamos rejeição) e o
 * erro é propagado ao chamador exatamente como hoje. Nenhum entry é armazenado.
 */

/** Uma entrada do Data_Cache. Válida sse `now < expiresAt`. */
export interface CacheEntry<T> {
  /** Valor cacheado (equivalente ao retorno da fonte). */
  value: T;
  /** Epoch ms da gravação. */
  storedAt: number;
  /** Epoch ms de expiração (`storedAt + ttlMs`). */
  expiresAt: number;
}

/** Opções de `getOrFetch`. */
export interface GetOrFetchOptions {
  /** Tempo de vida da entrada, em ms. */
  ttlMs: number;
  /** Quando true, ignora entry válido e força refetch (mantendo dedupe). */
  forceRefresh?: boolean;
}

/** Contrato público do Data_Cache. */
export interface DataCache {
  /** Retorna do cache se válido; senão coalesce/fetch e armazena. */
  getOrFetch<T>(key: string, fetcher: () => Promise<T>, opts: GetOrFetchOptions): Promise<T>;
  /** Lê sem disparar fetch. */
  peek<T>(key: string): CacheEntry<T> | undefined;
  /** Invalida uma chave específica. */
  invalidate(key: string): void;
  /** Invalida todas as chaves de um namespace (prefixo `"namespace|"`). */
  invalidateNamespace(namespace: string): void;
  /** Sobrescreve/atualiza um valor (ex.: aplicar patch de realtime). */
  set<T>(key: string, value: T, ttlMs: number): void;
  /** Limpa todo o cache (ex.: logout). */
  clear(): void;
}

/** Separador entre namespace e parâmetros canonicalizados nas chaves. */
const NAMESPACE_SEPARATOR = '|';

/** Validade de uma entrada dado o instante atual. */
function isValid(entry: CacheEntry<unknown>, now: number): boolean {
  return now < entry.expiresAt;
}

class InMemoryDataCache implements DataCache {
  /** Entradas armazenadas por chave. */
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  /** Requisições em voo por chave (coalescência/dedupe). */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, opts: GetOrFetchOptions): Promise<T> {
    const now = Date.now();

    if (!opts.forceRefresh) {
      const existing = this.entries.get(key);
      if (existing !== undefined && isValid(existing, now)) {
        return existing.value as T;
      }
    }

    // Coalescência: se já há uma requisição em voo para a mesma chave,
    // retorna a mesma promise (uma única requisição de rede).
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending as Promise<T>;
    }

    const request = (async (): Promise<T> => {
      try {
        const value = await fetcher();
        const storedAt = Date.now();
        this.entries.set(key, {
          value,
          storedAt,
          expiresAt: storedAt + opts.ttlMs,
        });
        return value;
      } finally {
        // Remove o in-flight em qualquer desfecho (sucesso ou erro).
        // Em erro, nenhum entry foi gravado e o erro propaga ao chamador.
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, request);
    return request;
  }

  peek<T>(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key) as CacheEntry<T> | undefined;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  invalidateNamespace(namespace: string): void {
    const prefix = `${namespace}${NAMESPACE_SEPARATOR}`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const storedAt = Date.now();
    this.entries.set(key, {
      value,
      storedAt,
      expiresAt: storedAt + ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

/** Instância singleton do Data_Cache (escopo de sessão/módulo). */
export const dataCache: DataCache = new InMemoryDataCache();
