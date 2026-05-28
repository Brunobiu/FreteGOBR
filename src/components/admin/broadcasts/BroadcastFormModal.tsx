import { useEffect, useState } from 'react';
import {
  createBroadcast,
  previewBroadcastRecipients,
  type Broadcast,
  type TargetAudience,
  BroadcastError,
} from '../../../services/admin/broadcasts';

interface BroadcastFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (broadcast: Broadcast) => void;
}

const AUDIENCE_OPTIONS: Array<{
  value: TargetAudience;
  label: string;
  disabled?: boolean;
  hint?: string;
}> = [
  { value: 'motorista', label: 'Motoristas' },
  { value: 'embarcador', label: 'Embarcadores' },
  { value: 'empresa', label: 'Empresas', disabled: true, hint: 'Em breve' },
];

/**
 * Modal de criação de Broadcast pelo admin. Em duas etapas:
 *
 * 1. Form com title + body + link + audience.
 * 2. Confirmação com preview de destinatários estimados.
 */
export default function BroadcastFormModal({ open, onClose, onSuccess }: BroadcastFormModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<TargetAudience[]>(['motorista', 'embarcador']);

  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [estimatedRecipients, setEstimatedRecipients] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setTitle('');
      setBody('');
      setLink('');
      setAudience(['motorista', 'embarcador']);
      setStep('form');
      setEstimatedRecipients(null);
      setError(null);
    }
  }, [open]);

  const toggleAudience = (a: TargetAudience) => {
    setAudience((prev) => {
      if (prev.includes(a)) return prev.filter((x) => x !== a);
      return [...prev, a];
    });
  };

  const handleNext = async () => {
    setError(null);
    if (title.trim().length < 1 || title.trim().length > 120) {
      setError('Titulo invalido. Use entre 1 e 120 caracteres.');
      return;
    }
    if (body.trim().length < 1 || body.trim().length > 2000) {
      setError('Mensagem invalida. Use entre 1 e 2000 caracteres.');
      return;
    }
    if (link.trim().length > 500) {
      setError('Link muito longo (max 500 caracteres).');
      return;
    }
    if (audience.length === 0) {
      setError('Selecione ao menos um publico-alvo.');
      return;
    }
    // Empresa em Phase 1 nao gera destinatarios — filtra antes do preview
    const realAudience = audience.filter((a) => a !== 'empresa') as TargetAudience[];
    if (realAudience.length === 0) {
      setError('Empresas ainda nao recebem comunicados (em breve).');
      return;
    }
    try {
      const count = await previewBroadcastRecipients(realAudience);
      setEstimatedRecipients(count);
      setStep('confirm');
    } catch {
      setError('Nao foi possivel calcular destinatarios.');
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createBroadcast({
        title: title.trim(),
        body: body.trim(),
        link: link.trim() || null,
        targetAudience: audience,
      });
      onSuccess?.(created);
      onClose();
    } catch (err) {
      setError(err instanceof BroadcastError ? err.message : 'Nao foi possivel enviar.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'form' ? (
          <>
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-gray-100">Novo comunicado</h2>
              <p className="text-xs text-gray-400 mt-1">
                Aparece no painel de notificações dos usuários selecionados.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="Ex: Nova versão disponível"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <div className="text-right text-[10px] text-gray-500 mt-0.5">
                  {title.length} / 120
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Mensagem</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  required
                  placeholder="O que você quer comunicar?"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <div className="text-right text-[10px] text-gray-500 mt-0.5">
                  {body.length} / 2000
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Link (opcional)</label>
                <input
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  maxLength={500}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Quando o usuário clica na notificação, é redirecionado para esse link.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-2">Público-alvo</label>
                <div className="space-y-2">
                  {AUDIENCE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        opt.disabled
                          ? 'opacity-50 cursor-not-allowed border-gray-700 bg-gray-800/40'
                          : audience.includes(opt.value)
                            ? 'border-green-500 bg-green-900/20'
                            : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={audience.includes(opt.value)}
                          onChange={() => !opt.disabled && toggleAudience(opt.value)}
                          disabled={opt.disabled}
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-gray-200">{opt.label}</span>
                      </div>
                      {opt.hint && (
                        <span className="text-[10px] text-gray-500 italic">{opt.hint}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-700 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleNext}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg"
              >
                Continuar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-gray-100">Confirmar envio</h2>
            </div>

            <div className="p-6 space-y-3">
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Título</p>
                <p className="text-sm text-gray-100 font-medium">{title}</p>
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Mensagem</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{body}</p>
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Audiência</p>
                <div className="flex flex-wrap gap-1.5">
                  {audience.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-0.5 bg-blue-900/30 border border-blue-500/30 text-blue-300 text-[10px] font-medium rounded-full"
                    >
                      {AUDIENCE_OPTIONS.find((o) => o.value === a)?.label ?? a}
                      {a === 'empresa' && ' (em breve)'}
                    </span>
                  ))}
                </div>
              </div>

              <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-sm text-yellow-300 font-medium">
                  Estimativa: {estimatedRecipients ?? '—'} destinatário(s)
                </p>
                <p className="text-[11px] text-yellow-400/80 mt-1">
                  Não dá para desfazer após enviar.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-700 flex gap-2">
              <button
                onClick={() => setStep('form')}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Enviando...' : 'Enviar agora'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
