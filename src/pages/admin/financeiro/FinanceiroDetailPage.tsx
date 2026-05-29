/**
 * FinanceiroDetailPage — /admin/financeiro/:id
 *
 * Detalhe de um repasse com ações de pagamento (marcar como pago)
 * e estorno, ambas gated por FINANCEIRO_EDIT. Idempotência forte:
 * marcar pago duas vezes retorna toast neutro (CP-2). Versionamento
 * otimista via updated_at (STALE_VERSION → refetch).
 *
 * Spec: .kiro/specs/admin-financeiro/{requirements,design,tasks}.md
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  FINANCEIRO_ERROR_MESSAGES,
  FinanceiroError,
  estornar,
  formatBRL,
  formatDate,
  formatPaymentMethod,
  getRepasseDetail,
  markAsPaid,
  type PaymentMethod,
  type RepasseDetail,
} from '../../../services/admin/financeiro';

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  pago: 'bg-green-100 text-green-800 border-green-200',
  estornado: 'bg-gray-100 text-gray-700 border-gray-200',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  estornado: 'Estornado',
};

export default function FinanceiroDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { allowed: canView } = useAdminPermission('FINANCEIRO_VIEW');
  const { allowed: canEdit } = useAdminPermission('FINANCEIRO_EDIT');

  const [repasse, setRepasse] = useState<RepasseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [revertModalOpen, setRevertModalOpen] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getRepasseDetail(id)
      .then(setRepasse)
      .catch((err) => {
        const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
        setError(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Repasse nao encontrado.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!canView) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  if (!canView || (error && !repasse)) {
    return (
      <div className="p-6 text-center text-gray-500">
        <h2 className="text-lg font-semibold text-gray-700">Pagina nao encontrada</h2>
        <p className="text-sm mt-2">A rota solicitada nao existe.</p>
        <button
          onClick={() => navigate('/admin/financeiro')}
          className="text-xs mt-4 px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          Voltar ao financeiro
        </button>
      </div>
    );
  }

  if (loading || !repasse) {
    return (
      <div className="p-6 flex items-center text-gray-500 text-sm">
        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-5 max-w-3xl space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/financeiro')}
            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            ← Voltar
          </button>
          <span className="font-mono text-sm text-gray-700">#{repasse.id.slice(0, 8)}</span>
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_BADGE[repasse.status]}`}
          >
            {STATUS_LABEL[repasse.status]}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            {repasse.status === 'pendente' && (
              <button
                onClick={() => setPayModalOpen(true)}
                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Marcar como pago
              </button>
            )}
            {repasse.status === 'pago' && (
              <button
                onClick={() => setRevertModalOpen(true)}
                className="text-xs px-2.5 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Estornar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Valores */}
      <div className="bg-white border border-gray-200 rounded p-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Valor bruto</p>
          <p className="text-base sm:text-lg font-semibold text-gray-800">
            {formatBRL(repasse.valor_bruto)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Comissao ({repasse.commission_pct}%)
          </p>
          <p className="text-base sm:text-lg font-semibold text-gray-600">
            {formatBRL(repasse.commission_value)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Liquido</p>
          <p className="text-base sm:text-lg font-semibold text-green-700">
            {formatBRL(repasse.valor_liquido)}
          </p>
        </div>
      </div>

      {/* Partes */}
      <div className="bg-white border border-gray-200 rounded p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Embarcador</span>
          <span className="text-gray-800">{repasse.embarcador_name ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Motorista</span>
          <span className="text-gray-800">{repasse.motorista_name ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Frete</span>
          <span className="font-mono text-xs text-gray-600">#{repasse.frete_id.slice(0, 8)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Encerrado em</span>
          <span className="text-gray-800">{formatDate(repasse.closed_at)}</span>
        </div>
      </div>

      {/* Bloco de pagamento (quando pago) */}
      {repasse.status === 'pago' && (
        <div className="bg-green-50 border border-green-200 rounded p-4 space-y-2 text-sm">
          <h3 className="font-semibold text-green-800 text-sm">Pagamento confirmado</h3>
          <div className="flex justify-between">
            <span className="text-gray-600">Metodo</span>
            <span className="text-gray-800">{formatPaymentMethod(repasse.payment_method)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Pago em</span>
            <span className="text-gray-800">{formatDate(repasse.paid_at)}</span>
          </div>
          {repasse.paid_by_name && (
            <div className="flex justify-between">
              <span className="text-gray-600">Confirmado por</span>
              <span className="text-gray-800">{repasse.paid_by_name}</span>
            </div>
          )}
          {repasse.notes && (
            <div>
              <span className="text-gray-600 block mb-0.5">Observacoes</span>
              <p className="text-gray-800 text-xs bg-white rounded p-2 border border-green-100">
                {repasse.notes}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Bloco de estorno (quando estornado) */}
      {repasse.status === 'estornado' && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-2 text-sm">
          <h3 className="font-semibold text-gray-700 text-sm">Pagamento estornado</h3>
          <div className="flex justify-between">
            <span className="text-gray-600">Estornado em</span>
            <span className="text-gray-800">{formatDate(repasse.reverted_at)}</span>
          </div>
          {repasse.reverted_by_name && (
            <div className="flex justify-between">
              <span className="text-gray-600">Por</span>
              <span className="text-gray-800">{repasse.reverted_by_name}</span>
            </div>
          )}
          {repasse.revert_reason && (
            <div>
              <span className="text-gray-600 block mb-0.5">Motivo</span>
              <p className="text-gray-800 text-xs bg-white rounded p-2 border border-gray-100">
                {repasse.revert_reason}
              </p>
            </div>
          )}
          {/* Snapshot histórico do pagamento original preservado */}
          {repasse.payment_method && (
            <p className="text-[11px] text-gray-500 italic pt-1 border-t border-gray-200">
              Pagamento original: {formatPaymentMethod(repasse.payment_method)} em{' '}
              {formatDate(repasse.paid_at)}
            </p>
          )}
        </div>
      )}

      {payModalOpen && (
        <MarkAsPaidModal
          onClose={() => setPayModalOpen(false)}
          onConfirm={async (method, notes) => {
            try {
              const result = await markAsPaid(repasse.id, {
                payment_method: method,
                payment_proof_url: null,
                notes: notes || null,
                expected_updated_at: repasse.updated_at,
              });
              setPayModalOpen(false);
              if ('skipped' in result) {
                showToast('Este repasse ja estava pago.');
              } else {
                showToast('Pagamento confirmado.');
              }
              load();
            } catch (err) {
              const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
              if (code === 'STALE_VERSION') {
                showToast('Outro admin atualizou. Recarregando.');
                load();
              } else {
                showToast(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Erro ao confirmar pagamento.');
              }
              setPayModalOpen(false);
            }
          }}
        />
      )}

      {revertModalOpen && (
        <EstornarModal
          onClose={() => setRevertModalOpen(false)}
          onConfirm={async (reason) => {
            try {
              const result = await estornar(repasse.id, {
                revert_reason: reason,
                expected_updated_at: repasse.updated_at,
              });
              setRevertModalOpen(false);
              if ('skipped' in result) {
                showToast('Este repasse ja estava estornado.');
              } else {
                showToast('Pagamento estornado.');
              }
              load();
            } catch (err) {
              const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
              if (code === 'STALE_VERSION') {
                showToast('Outro admin atualizou. Recarregando.');
                load();
              } else {
                showToast(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Erro ao estornar.');
              }
              setRevertModalOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: Marcar como pago ─────────────────────────────────────────────────

function MarkAsPaidModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (method: PaymentMethod, notes: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-800">Confirmar pagamento</h3>

        <div>
          <label className="text-xs text-gray-600 block mb-1">Metodo de pagamento</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
          >
            <option value="pix">PIX</option>
            <option value="ted">TED</option>
            <option value="boleto">Boleto</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="outro">Outro</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-600 block mb-1">Observacoes (opcional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Ex: comprovante enviado por email"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 resize-none"
          />
          <p className="text-[10px] text-gray-400 text-right">{notes.length}/1000</p>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              setSubmitting(true);
              onConfirm(method, notes.trim());
            }}
            disabled={submitting}
            className="text-sm px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Confirmando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Estornar ─────────────────────────────────────────────────────────

function EstornarModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 500;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-800">Estornar pagamento</h3>
        <p className="text-xs text-gray-500">
          O pagamento sera revertido para o estado pendente. O historico do pagamento original e
          preservado para auditoria.
        </p>

        <div>
          <label className="text-xs text-gray-600 block mb-1">Motivo do estorno *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Ex: pagamento duplicado por engano"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 resize-none"
          />
          <p className="text-[10px] text-gray-400 text-right">{reason.length}/500</p>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              setSubmitting(true);
              onConfirm(trimmed);
            }}
            disabled={!canSubmit || submitting}
            className="text-sm px-4 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Estornando...' : 'Confirmar estorno'}
          </button>
        </div>
      </div>
    </div>
  );
}
