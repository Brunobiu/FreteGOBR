/**
 * FinanceiroBlock — bloco Historico financeiro (Visao 360). Renderizado APENAS
 * quando o caller tem FINANCEIRO_VIEW (a pagina gateia; o bundle omite sem a
 * permissao). Cobrancas (subscription_charges) + repasses (financial_repasses)
 * por data desc. Req 9.2, 9.3, 9.4, 9.7.
 */

import type { FinancialHistory } from '../../../services/admin/cliente360';
import DashboardBlockError from '../dashboard/DashboardBlockError';
import { fmtDate, fmtMoney } from './format';

interface Props {
  financeiro: FinancialHistory | undefined;
  error?: string;
  onRetry: () => void;
}

export default function FinanceiroBlock({ financeiro, error, onRetry }: Props) {
  const charges = financeiro?.charges ?? [];
  const repasses = financeiro?.repasses ?? [];
  const isEmpty = charges.length === 0 && repasses.length === 0;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Histórico financeiro</h3>

      {error ? (
        <DashboardBlockError message={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <div className="text-xs text-gray-500">Nenhum lançamento financeiro registrado.</div>
      ) : (
        <div className="space-y-4">
          {charges.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Cobranças</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left font-semibold py-1">Valor</th>
                      <th className="text-left font-semibold py-1">Método</th>
                      <th className="text-left font-semibold py-1">Status</th>
                      <th className="text-left font-semibold py-1">Pago em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {charges.map((c) => (
                      <tr key={c.id}>
                        <td className="py-1 text-gray-200">{fmtMoney(c.amount)}</td>
                        <td className="py-1 text-gray-400">{c.payment_method}</td>
                        <td className="py-1 text-gray-400">{c.status}</td>
                        <td className="py-1 text-gray-400">{fmtDate(c.paid_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {repasses.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Repasses</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left font-semibold py-1">Bruto</th>
                      <th className="text-left font-semibold py-1">Comissão</th>
                      <th className="text-left font-semibold py-1">Líquido</th>
                      <th className="text-left font-semibold py-1">Status</th>
                      <th className="text-left font-semibold py-1">Papel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {repasses.map((r) => (
                      <tr key={r.id}>
                        <td className="py-1 text-gray-200">{fmtMoney(r.valor_bruto)}</td>
                        <td className="py-1 text-gray-400">{fmtMoney(r.commission_value)}</td>
                        <td className="py-1 text-gray-200">{fmtMoney(r.valor_liquido)}</td>
                        <td className="py-1 text-gray-400">{r.status}</td>
                        <td className="py-1 text-gray-400">{r.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
