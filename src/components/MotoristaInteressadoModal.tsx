import { useEffect, useState } from 'react';
import { getLikersOfFrete, type FreteLiker } from '../services/likes';

interface MotoristaInteressadoModalProps {
  freteId: string | null;
  /** Quando fornecido, abre direto o motorista específico. */
  motoristaId?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal exibido para o embarcador quando ele clica numa notificação
 * de "Motorista interessado". Mostra a lista (ou destaque do motorista
 * específico) com nome, telefone (com botão WhatsApp), foto, modelo
 * do caminhão, placa, eixos e capacidade.
 */
export default function MotoristaInteressadoModal({
  freteId,
  motoristaId,
  isOpen,
  onClose,
}: MotoristaInteressadoModalProps) {
  const [likers, setLikers] = useState<FreteLiker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !freteId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLikersOfFrete(freteId)
      .then((list) => {
        if (cancelled) return;
        // Se um motorista específico foi solicitado, ele vem primeiro.
        if (motoristaId) {
          const idx = list.findIndex((l) => l.motoristaId === motoristaId);
          if (idx > 0) {
            const [target] = list.splice(idx, 1);
            list = [target, ...list];
          }
        }
        setLikers(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, freteId, motoristaId]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !freteId) return null;

  const formatPhone = (raw: string | null) => {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return raw;
  };

  const openWhatsApp = (phone: string | null, name: string) => {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Olá, ${name}! Vim do FreteGO. Vi seu interesse no meu frete e gostaria de conversar.`
    );
    window.open(`https://wa.me/55${digits}?text=${msg}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-75" onClick={onClose} />

      <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
        <div className="relative bg-white rounded-lg max-w-lg w-full border border-gray-200 shadow-xl">
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 p-1 z-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div className="p-4">
            <h2 className="text-base sm:text-lg font-bold text-gray-800 mb-3 pr-8">
              Motoristas interessados
            </h2>

            {loading ? (
              <div className="py-8 text-center text-sm text-gray-500">Carregando...</div>
            ) : error ? (
              <div className="py-6 text-center text-sm text-red-600">{error}</div>
            ) : likers.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                Nenhum motorista curtiu este frete ainda.
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {likers.map((liker) => (
                  <div
                    key={liker.motoristaId}
                    className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                  >
                    <div className="flex items-start gap-3">
                      {liker.profilePhoto ? (
                        <img
                          src={liker.profilePhoto}
                          alt={liker.name}
                          className="w-14 h-14 rounded-full object-cover border-2 border-white shadow"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg shadow">
                          {liker.name.charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {liker.name}
                        </p>
                        {liker.phone && (
                          <p className="text-xs text-gray-600">{formatPhone(liker.phone)}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Curtiu em{' '}
                          {liker.likedAt.toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Detalhes do caminhão */}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {liker.vehicleType && (
                        <div className="bg-white p-1.5 rounded border border-gray-200 col-span-2">
                          <p className="text-[10px] text-gray-500">Tipo de caminhão</p>
                          <p className="text-xs text-gray-800 font-medium capitalize">
                            {liker.vehicleType}
                          </p>
                        </div>
                      )}
                      {liker.vehicleModel && (
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <p className="text-[10px] text-gray-500">Modelo</p>
                          <p className="text-xs text-gray-800 font-medium">
                            {liker.vehicleModel}
                          </p>
                        </div>
                      )}
                      {liker.vehiclePlate && (
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <p className="text-[10px] text-gray-500">Placa</p>
                          <p className="text-xs text-gray-800 font-medium uppercase">
                            {liker.vehiclePlate}
                          </p>
                        </div>
                      )}
                      {liker.trailerAxles !== null && (
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <p className="text-[10px] text-gray-500">Eixos</p>
                          <p className="text-xs text-gray-800 font-medium">{liker.trailerAxles}</p>
                        </div>
                      )}
                      {liker.cargoCapacity !== null && (
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <p className="text-[10px] text-gray-500">Capacidade</p>
                          <p className="text-xs text-gray-800 font-medium">
                            {liker.cargoCapacity} ton
                          </p>
                        </div>
                      )}
                      {liker.rntrcType && (
                        <div className="bg-white p-1.5 rounded border border-gray-200 col-span-2">
                          <p className="text-[10px] text-gray-500">RNTRC (ANTT)</p>
                          <p className="text-xs text-gray-800 font-medium">
                            {liker.rntrcType === 'fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 mt-2">
                      {liker.phone && (
                        <button
                          onClick={() => openWhatsApp(liker.phone, liker.name)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                          WhatsApp
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
