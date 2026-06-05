/**
 * Detecção de compatibilidade de contrato — spec `testes` (Tarefa 24).
 *
 * Modela um schema de payload de forma estrutural (sem depender de Zod, que
 * ainda não é usado no projeto) e compara um schema "current" contra um
 * "baseline" versionado, classificando mudanças em compatíveis vs
 * incompatíveis (breaking).
 *
 * Regra (Property 13):
 *   - COMPATÍVEL (não falha): adicionar campo opcional; adicionar valor de enum.
 *   - INCOMPATÍVEL (falha): remover campo; mudar tipo; tornar obrigatório um
 *     campo que era opcional ou novo obrigatório; remover valor de enum.
 *
 * Validates: Requirements 24.2, 24.3
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface FieldSpec {
  type: FieldType;
  required: boolean;
  /** Para campos enum (string com domínio fechado). */
  enum?: string[];
}

export type SchemaSpec = Record<string, FieldSpec>;

export interface SchemaDiff {
  breaking: string[];
  compatible: string[];
}

/**
 * Compara `current` contra `baseline` e classifica as diferenças.
 */
export function diffSchemas(baseline: SchemaSpec, current: SchemaSpec): SchemaDiff {
  const breaking: string[] = [];
  const compatible: string[] = [];

  // Campos do baseline ausentes ou alterados no current.
  for (const [name, base] of Object.entries(baseline)) {
    const cur = current[name];
    if (!cur) {
      breaking.push(`campo removido: ${name}`);
      continue;
    }
    if (cur.type !== base.type) {
      breaking.push(`tipo alterado: ${name} (${base.type} -> ${cur.type})`);
    }
    if (!base.required && cur.required) {
      breaking.push(`campo virou obrigatório: ${name}`);
    }
    if (base.enum && cur.enum) {
      const removed = base.enum.filter((v) => !cur.enum!.includes(v));
      if (removed.length > 0) {
        breaking.push(`valores de enum removidos em ${name}: ${removed.join(', ')}`);
      }
      const added = cur.enum.filter((v) => !base.enum!.includes(v));
      if (added.length > 0) {
        compatible.push(`valores de enum adicionados em ${name}: ${added.join(', ')}`);
      }
    }
  }

  // Campos novos no current.
  for (const [name, cur] of Object.entries(current)) {
    if (baseline[name]) continue;
    if (cur.required) {
      breaking.push(`novo campo obrigatório: ${name}`);
    } else {
      compatible.push(`novo campo opcional: ${name}`);
    }
  }

  return { breaking, compatible };
}

export function formatBreaking(diff: SchemaDiff): string {
  return diff.breaking.length === 0
    ? 'sem breaking changes'
    : `breaking changes:\n  - ${diff.breaking.join('\n  - ')}`;
}
