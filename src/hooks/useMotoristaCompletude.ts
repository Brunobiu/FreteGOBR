/**
 * Hook que avalia quais grupos do perfil do motorista estao incompletos.
 *
 * Usado pelo MotoristaMenuPage para exibir o alertinha "faltam dados"
 * em cada tile (Perfil, Tracao, Carroceria, Complemento, Referencias).
 *
 * Retorna um Record<grupo, boolean> onde true = INCOMPLETO.
 *
 * Regra de "incompleto" por grupo (cobre os campos que importam para
 * o motorista usar o app: ver fretes, ser aprovado pelo admin):
 *
 *   perfil:
 *     - nome, cpf, rgNumber, addressCep ou pis ausente
 *
 *   tracao:
 *     - vehiclePlate, vehicleModel, vehicleYearManufacture ou
 *       vehicleYearModel ausente
 *
 *   carroceria:
 *     - vehicleType ou bodyType ausente
 *
 *   complemento:
 *     - kmPerLiter, trailerAxles, grossWeightTon, tareWeightTon ou
 *       dieselPrice ausente
 *
 *   referencias:
 *     - lista vazia (zero referencias cadastradas)
 *
 * Em caso de erro de leitura, retorna todos como false (nao alarma o
 * motorista por causa de um erro de rede).
 */

import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getMotoristaProfile, getMotoristaReferences } from '../services/motorista';
import { getUserData } from '../services/motorista';

export interface CompletudeGroups {
  perfil: boolean;
  tracao: boolean;
  carroceria: boolean;
  complemento: boolean;
  referencias: boolean;
}

const ALL_OK: CompletudeGroups = {
  perfil: false,
  tracao: false,
  carroceria: false,
  complemento: false,
  referencias: false,
};

/**
 * Grupos OBRIGATORIOS para liberar o contato com o embarcador.
 * Referencias NAO entra: e opcional (decisao do produto).
 */
export type RequiredCompletudeGroup = 'perfil' | 'tracao' | 'carroceria' | 'complemento';

/**
 * Avalia os grupos a partir dos dados ja carregados (funcao pura, reusavel
 * tanto pelo hook quanto pelo gate de contato no FreteModal).
 */
export function computeCompletudeGroups(
  userData: { name?: string | null; cpf?: string | null } | null,
  profile: {
    rgNumber?: string | null;
    addressCep?: string | null;
    vehiclePlate?: string | null;
    vehicleModel?: string | null;
    vehicleYearManufacture?: number | string | null;
    vehicleYearModel?: number | string | null;
    vehicleType?: string | null;
    bodyType?: string | null;
    kmPerLiter?: number | string | null;
    trailerAxles?: number | string | null;
    grossWeightTon?: number | string | null;
    tareWeightTon?: number | string | null;
    dieselPrice?: number | string | null;
  } | null,
  refsCount: number
): CompletudeGroups {
  const perfilFalta =
    !userData?.name?.toString().trim() ||
    !userData?.cpf?.toString().trim() ||
    !profile?.rgNumber?.toString().trim() ||
    !profile?.addressCep?.toString().trim();

  const tracaoFalta =
    !profile?.vehiclePlate?.toString().trim() ||
    !profile?.vehicleModel?.toString().trim() ||
    !profile?.vehicleYearManufacture ||
    !profile?.vehicleYearModel;

  const carroceriaFalta =
    !profile?.vehicleType?.toString().trim() || !profile?.bodyType?.toString().trim();

  const complementoFalta =
    !profile?.kmPerLiter ||
    !profile?.trailerAxles ||
    !profile?.grossWeightTon ||
    !profile?.tareWeightTon ||
    !profile?.dieselPrice;

  return {
    perfil: !!perfilFalta,
    tracao: !!tracaoFalta,
    carroceria: !!carroceriaFalta,
    complemento: !!complementoFalta,
    referencias: refsCount === 0,
  };
}

/**
 * True quando TODOS os grupos obrigatorios (perfil, tracao, carroceria,
 * complemento) estao completos. Referencias e ignorado de proposito.
 */
export function isRequiredComplete(groups: CompletudeGroups): boolean {
  return !groups.perfil && !groups.tracao && !groups.carroceria && !groups.complemento;
}

/**
 * Carrega o perfil do motorista e avalia os grupos de completude.
 * Usado fora de React (ex: gate de contato no FreteModal).
 */
export async function fetchMotoristaCompletude(userId: string): Promise<CompletudeGroups> {
  const [profile, userData, refs] = await Promise.all([
    getMotoristaProfile(userId),
    getUserData(userId),
    getMotoristaReferences(userId).catch(() => []),
  ]);
  return computeCompletudeGroups(userData, profile, refs?.length ?? 0);
}

export function useMotoristaCompletude(): {
  loading: boolean;
  groups: CompletudeGroups;
} {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<CompletudeGroups>(ALL_OK);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [profile, userData, refs] = await Promise.all([
          getMotoristaProfile(user.id),
          getUserData(user.id),
          getMotoristaReferences(user.id).catch(() => []),
        ]);
        if (cancelled) return;

        setGroups(computeCompletudeGroups(userData, profile, refs?.length ?? 0));
      } catch {
        if (!cancelled) setGroups(ALL_OK);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { loading, groups };
}
