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

        const perfilFalta =
          !userData?.name?.trim() ||
          !userData?.cpf?.trim() ||
          !profile?.rgNumber?.trim() ||
          !profile?.addressCep?.trim();

        const tracaoFalta =
          !profile?.vehiclePlate?.trim() ||
          !profile?.vehicleModel?.trim() ||
          !profile?.vehicleYearManufacture ||
          !profile?.vehicleYearModel;

        const carroceriaFalta = !profile?.vehicleType?.trim() || !profile?.bodyType?.trim();

        const complementoFalta =
          !profile?.kmPerLiter ||
          !profile?.trailerAxles ||
          !profile?.grossWeightTon ||
          !profile?.tareWeightTon ||
          !profile?.dieselPrice;

        const referenciasFalta = !refs || refs.length === 0;

        setGroups({
          perfil: !!perfilFalta,
          tracao: !!tracaoFalta,
          carroceria: !!carroceriaFalta,
          complemento: !!complementoFalta,
          referencias: !!referenciasFalta,
        });
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
