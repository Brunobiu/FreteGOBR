/**
 * FinanceiroConfiguracoesPage — /admin/financeiro/configuracoes
 *
 * Configuração de comissão (percentual flat OU faixas escalonadas).
 * Cada save cria uma linha-snapshot histórica em `financial_settings`
 * preservando configurações antigas para auditoria de repasses
 * passados.
 *
 * Spec: .kiro/specs/admin-financeiro/{requirements,design,tasks}.md
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  FINANCEIRO_ERROR_MESSAGES,
  FinanceiroError,
  formatBRL,
  getSettings,
  updateSettings,
  validateBrackets,
  type CommissionBracket,
  type FinanceiroSettings,
} from '../../../services/admin/financeiro';

export default function FinanceiroConfiguracoesPage() {
  const navigate = useNavigate();
  const { allowed: canEdit } = useAdminPermission('FINANCEIRO_EDIT');

  const [settings, setSettings] = useState<FinanceiroSettings | null>(null);
  const [pct, setPct] = useState<number>(0);
  const [brackets, setBrackets] = useState<CommissionBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setPct(s.commission_pct);
        setBrackets(s.commission_brackets);
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
        setError(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Erro ao carregar configuracoes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit]);

  if (loading) {
    return (
      <div className="p-6 flex items-center text-gray-500 text-sm">
        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2" />
        Carregando...
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="p-6 text-center text-gray-500">
        <h2 className="text-lg font-semibold text-gray-700">Pagina nao encontrada</h2>
        <p className="text-sm mt-2">A rota solicitada nao existe.</p>
      </div>
    );
  }

  const addBracket = () => {
    if (brackets.length >= 5) return;
    const last = brackets[brackets.length - 1];
    const newMin = last ? last.max_value : 0;
    setBrackets([...brackets, { min_value: newMin, max_value: newMin + 1000, pct: 5 }]);
  };

  const removeBracket = (idx: number) => {
    setBrackets(brackets.filter((_, i) => i !== idx));
  };

  const updateBracket = (idx: number, patch: Partial<CommissionBracket>) => {
    setBrackets(brackets.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const handleSave = async () => {
    setError(null);
    setValidationError(null);
    setSuccess(false);

    // Validação client-side antes da RPC
    if (pct < 0 || pct > 50) {
      setValidationError('Percentual deve estar entre 0 e 50.');
      return;
    }
    if (brackets.length > 0) {
      const result = validateBrackets(brackets);
      if (!result.ok) {
        const idx = 'index' in result && result.index !== undefined ? result.index + 1 : 0;
        setValidationError(`Faixas invalidas: ${result.code} (linha ${idx})`);
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await updateSettings(
        { commission_pct: pct, commission_brackets: brackets },
        settings?.updated_at ?? null
      );
      setSettings(updated);
      setPct(updated.commission_pct);
      setBrackets(updated.commission_brackets);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
      setError(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/admin/financeiro')}
          className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          ← Voltar
        </button>
        <span className="text-xs text-gray-500">Configurar comissao</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">
          {error}
        </div>
      )}
      {validationError && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded p-3">
          {validationError}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded p-3">
          Configuracao salva. Repasses futuros usarao a nova taxa.
        </div>
      )}

      {/* Comissão flat */}
      <div className="bg-white border border-gray-200 rounded p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Comissao base</h3>
        <p className="text-xs text-gray-500 mb-3">
          Aplicada quando nao houver faixas escalonadas, ou para valores fora do alcance das faixas.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={pct}
            onChange={(e) => setPct(parseFloat(e.target.value || '0'))}
            min={0}
            max={50}
            step={0.5}
            className="w-24 text-sm border border-gray-300 rounded px-2 py-1"
          />
          <span className="text-sm text-gray-600">% (0 a 50)</span>
        </div>
      </div>

      {/* Faixas escalonadas */}
      <div className="bg-white border border-gray-200 rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Faixas escalonadas (opcional)</h3>
            <p className="text-xs text-gray-500">
              Ate 5 faixas. Sem sobreposicao nem buracos. Ex: 0–5000 = 3%, 5000–20000 = 5%.
            </p>
          </div>
          <button
            onClick={addBracket}
            disabled={brackets.length >= 5}
            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            + Adicionar
          </button>
        </div>

        {brackets.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-3">
            Nenhuma faixa configurada. Comissao base ({pct}%) sera aplicada.
          </p>
        ) : (
          <div className="space-y-2">
            {brackets.map((b, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500 w-8">#{idx + 1}</span>
                <input
                  type="number"
                  value={b.min_value}
                  onChange={(e) =>
                    updateBracket(idx, { min_value: parseFloat(e.target.value || '0') })
                  }
                  placeholder="De"
                  className="w-28 border border-gray-300 rounded px-2 py-1"
                />
                <span className="text-gray-500">ate</span>
                <input
                  type="number"
                  value={b.max_value}
                  onChange={(e) =>
                    updateBracket(idx, { max_value: parseFloat(e.target.value || '0') })
                  }
                  placeholder="Ate"
                  className="w-28 border border-gray-300 rounded px-2 py-1"
                />
                <span className="text-gray-500">=</span>
                <input
                  type="number"
                  value={b.pct}
                  onChange={(e) => updateBracket(idx, { pct: parseFloat(e.target.value || '0') })}
                  step={0.5}
                  className="w-20 border border-gray-300 rounded px-2 py-1"
                />
                <span className="text-gray-500">%</span>
                <button
                  onClick={() => removeBracket(idx)}
                  className="ml-auto text-red-600 hover:bg-red-50 p-1 rounded"
                  title="Remover faixa"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snapshot atual (só info) */}
      {settings && settings.id && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">
          <p>
            <strong>Configuracao atual em vigor:</strong> {settings.commission_pct}% base
            {settings.commission_brackets.length > 0
              ? ` + ${settings.commission_brackets.length} faixa(s)`
              : ' (sem faixas)'}
          </p>
          <p className="mt-1 text-[10px] text-gray-500">
            Ultima atualizacao em{' '}
            {settings.updated_at ? new Date(settings.updated_at).toLocaleString('pt-BR') : '—'}
          </p>
          <p className="mt-2 text-[10px] text-gray-500">
            Exemplo: um frete de {formatBRL(10000)} hoje rende{' '}
            {formatBRL((10000 * settings.commission_pct) / 100)} de comissao.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving ? (
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : null}
          Salvar configuracao
        </button>
        <Link
          to="/admin/financeiro"
          className="text-sm px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
        >
          Cancelar
        </Link>
      </div>

      <p className="text-[10px] text-gray-400 italic">
        Cada save cria uma nova linha-snapshot histórica. Repasses ja gerados mantem a configuracao
        vigente no momento do encerramento do frete.
      </p>
    </div>
  );
}
