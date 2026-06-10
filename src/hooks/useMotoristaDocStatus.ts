/**
 * useMotoristaDocStatus
 *
 * Avalia o status de REVISÃO dos documentos do motorista, agrupado por área do
 * menu (perfil, tracao, carroceria, contrato). Diferente de
 * `useMotoristaCompletude` (que checa se os CAMPOS estão preenchidos), aqui
 * olhamos a coluna `documents.status` ('pendente' | 'aprovado' | 'rejeitado').
 *
 * Status derivado por grupo (apenas grupos que possuem documentos):
 *   - 'rejeitado'  : algum documento do grupo foi recusado.
 *   - 'pendente'   : há documento enviado aguardando revisão.
 *   - 'aprovado'   : há documentos e todos os enviados estão aprovados.
 *   - 'nenhum'     : nenhum documento enviado para o grupo.
 *
 * Usado pelo MotoristaMenuPage para o selo dos tiles (azul "Pendente" /
 * verde "Doc. confirmado" / vermelho "Recusado").
 */

import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../services/supabase';

export type DocReviewStatus = 'nenhum' | 'pendente' | 'aprovado' | 'rejeitado';

export type DocGroup = 'perfil' | 'tracao' | 'carroceria' | 'contrato';

/** Mapa: área do menu → tipos de documento que pertencem a ela. */
const GROUP_DOC_TYPES: Record<DocGroup, string[]> = {
  perfil: ['cnh', 'foto_segurando_cnh', 'comprovante_endereco_motorista'],
  // Tração (cavalo) — espelha os DocSlots com data-grupo="tracao" na tela.
  tracao: ['crlv_cavalo', 'rntrc_cavalo', 'foto_frente_caminhao', 'foto_caminhao_completo'],
  // Carroceria (carretas) — apenas documentos de carreta.
  carroceria: [
    'crlv_carreta_1',
    'crlv_carreta_2',
    'crlv_carreta_3',
    'crlv_carreta_4',
    'rntrc_carreta_1',
    'rntrc_carreta_2',
    'rntrc_carreta_3',
    'rntrc_carreta_4',
  ],
  contrato: ['contrato_arrendamento'],
};

type GroupStatus = Record<DocGroup, DocReviewStatus>;

const EMPTY: GroupStatus = {
  perfil: 'nenhum',
  tracao: 'nenhum',
  carroceria: 'nenhum',
  contrato: 'nenhum',
};

/**
 * Status derivado por grupo (apenas grupos que possuem documentos):
 *   - 'rejeitado'  : algum documento do grupo foi recusado pelo admin.
 *   - 'aprovado'   : há documentos enviados e nenhum recusado (aprovação
 *                    imediata — o motorista não espera revisão).
 *   - 'nenhum'     : nenhum documento enviado para o grupo.
 *
 * Modelo "aprovação imediata": enviar já vale. O admin só RECUSA o que vier
 * errado; recusado é o único estado de alerta.
 */
function deriveStatus(statuses: string[]): DocReviewStatus {
  if (statuses.length === 0) return 'nenhum';
  if (statuses.includes('rejeitado')) return 'rejeitado';
  // Reenvio após recusa aguardando aprovação do admin: selo azul "em análise".
  if (statuses.includes('pendente')) return 'pendente';
  // Qualquer documento enviado e não recusado conta como confirmado (verde).
  return 'aprovado';
}

export function useMotoristaDocStatus(): { loading: boolean; groups: GroupStatus } {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || user.userType !== 'motorista') {
      setGroups(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('document_type, status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (error || !data) {
          setGroups(EMPTY);
          return;
        }
        // Mantém apenas a versão VIGENTE (mais recente) de cada tipo. Versões
        // recusadas antigas são histórico/evidência e não devem influenciar o
        // selo — o que vale é o estado atual do documento.
        const latestByType = new Map<string, string>();
        for (const d of data) {
          if (!latestByType.has(d.document_type)) {
            latestByType.set(d.document_type, (d.status as string) ?? 'pendente');
          }
        }
        const next: GroupStatus = { ...EMPTY };
        (Object.keys(GROUP_DOC_TYPES) as DocGroup[]).forEach((g) => {
          const types = GROUP_DOC_TYPES[g];
          const statuses = types
            .filter((t) => latestByType.has(t))
            .map((t) => latestByType.get(t) as string);
          next[g] = deriveStatus(statuses);
        });
        setGroups(next);
      } catch {
        if (!cancelled) setGroups(EMPTY);
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
