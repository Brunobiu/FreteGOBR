import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import type { CreateFreteData } from '../services/fretes';

const freteSchema = z.object({
  origin: z.string().min(3, 'Origem deve ter no mínimo 3 caracteres'),
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destination: z.string().min(3, 'Destino deve ter no mínimo 3 caracteres'),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
  cargoType: z.string().min(1, 'Tipo de carga é obrigatório'),
  vehicleType: z.string().min(1, 'Tipo de veículo é obrigatório'),
  weight: z.number().positive('Peso deve ser maior que zero'),
  value: z.number().positive('Valor deve ser maior que zero'),
  deadline: z.string().min(1, 'Prazo é obrigatório'),
  loadingTime: z.number().min(0, 'Tempo de carga deve ser maior ou igual a zero'),
  unloadingTime: z.number().min(0, 'Tempo de descarga deve ser maior ou igual a zero'),
  specifications: z.string().optional(),
});

type FreteFormData = z.infer<typeof freteSchema>;

interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData) => Promise<void>;
  onCancel?: () => void;
  initialData?: Partial<FreteFormData>;
}

export default function FreteForm({
  embarcadorId,
  onSubmit,
  onCancel,
  initialData,
}: FreteFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FreteFormData>({
    resolver: zodResolver(freteSchema),
    defaultValues: initialData,
  });

  const onFormSubmit = async (data: FreteFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        embarcadorId,
        origin: data.origin,
        originLocation: {
          latitude: data.originLat,
          longitude: data.originLng,
        },
        destination: data.destination,
        destinationLocation: {
          latitude: data.destinationLat,
          longitude: data.destinationLng,
        },
        cargoType: data.cargoType,
        vehicleType: data.vehicleType,
        weight: data.weight,
        value: data.value,
        deadline: new Date(data.deadline),
        loadingTime: data.loadingTime,
        unloadingTime: data.unloadingTime,
        specifications: data.specifications,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar frete');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {/* Origem */}
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
        <h3 className="text-lg font-semibold text-white mb-4">Origem</h3>

        <div>
          <label htmlFor="origin" className="block text-sm font-medium text-gray-300 mb-2">
            Cidade/Estado *
          </label>
          <input
            type="text"
            id="origin"
            {...register('origin')}
            placeholder="Ex: Goiânia, GO"
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.origin && <p className="mt-1 text-sm text-red-400">{errors.origin.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="originLat" className="block text-sm font-medium text-gray-300 mb-2">
              Latitude *
            </label>
            <input
              type="number"
              step="any"
              id="originLat"
              {...register('originLat', { valueAsNumber: true })}
              placeholder="-16.6869"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.originLat && (
              <p className="mt-1 text-sm text-red-400">{errors.originLat.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="originLng" className="block text-sm font-medium text-gray-300 mb-2">
              Longitude *
            </label>
            <input
              type="number"
              step="any"
              id="originLng"
              {...register('originLng', { valueAsNumber: true })}
              placeholder="-49.2648"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.originLng && (
              <p className="mt-1 text-sm text-red-400">{errors.originLng.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Destino */}
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
        <h3 className="text-lg font-semibold text-white mb-4">Destino</h3>

        <div>
          <label htmlFor="destination" className="block text-sm font-medium text-gray-300 mb-2">
            Cidade/Estado *
          </label>
          <input
            type="text"
            id="destination"
            {...register('destination')}
            placeholder="Ex: São Paulo, SP"
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.destination && (
            <p className="mt-1 text-sm text-red-400">{errors.destination.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="destinationLat"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Latitude *
            </label>
            <input
              type="number"
              step="any"
              id="destinationLat"
              {...register('destinationLat', { valueAsNumber: true })}
              placeholder="-23.5505"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.destinationLat && (
              <p className="mt-1 text-sm text-red-400">{errors.destinationLat.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="destinationLng"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Longitude *
            </label>
            <input
              type="number"
              step="any"
              id="destinationLng"
              {...register('destinationLng', { valueAsNumber: true })}
              placeholder="-46.6333"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.destinationLng && (
              <p className="mt-1 text-sm text-red-400">{errors.destinationLng.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Detalhes da Carga */}
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
        <h3 className="text-lg font-semibold text-white mb-4">Detalhes da Carga</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="cargoType" className="block text-sm font-medium text-gray-300 mb-2">
              Tipo de Carga *
            </label>
            <select
              id="cargoType"
              {...register('cargoType')}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione</option>
              <option value="geral">Carga Geral</option>
              <option value="granel">Granel</option>
              <option value="refrigerada">Refrigerada</option>
              <option value="perigosa">Perigosa</option>
              <option value="fragil">Frágil</option>
            </select>
            {errors.cargoType && (
              <p className="mt-1 text-sm text-red-400">{errors.cargoType.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="vehicleType" className="block text-sm font-medium text-gray-300 mb-2">
              Tipo de Veículo *
            </label>
            <select
              id="vehicleType"
              {...register('vehicleType')}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione</option>
              <option value="truck">Caminhão</option>
              <option value="van">Van</option>
              <option value="pickup">Pickup</option>
              <option value="carreta">Carreta</option>
            </select>
            {errors.vehicleType && (
              <p className="mt-1 text-sm text-red-400">{errors.vehicleType.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-gray-300 mb-2">
              Peso (kg) *
            </label>
            <input
              type="number"
              step="0.01"
              id="weight"
              {...register('weight', { valueAsNumber: true })}
              placeholder="1000"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.weight && <p className="mt-1 text-sm text-red-400">{errors.weight.message}</p>}
          </div>

          <div>
            <label htmlFor="value" className="block text-sm font-medium text-gray-300 mb-2">
              Valor (R$) *
            </label>
            <input
              type="number"
              step="0.01"
              id="value"
              {...register('value', { valueAsNumber: true })}
              placeholder="5000.00"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.value && <p className="mt-1 text-sm text-red-400">{errors.value.message}</p>}
          </div>
        </div>
      </div>

      {/* Prazos */}
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
        <h3 className="text-lg font-semibold text-white mb-4">Prazos</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="deadline" className="block text-sm font-medium text-gray-300 mb-2">
              Prazo de Entrega *
            </label>
            <input
              type="date"
              id="deadline"
              {...register('deadline')}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.deadline && (
              <p className="mt-1 text-sm text-red-400">{errors.deadline.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="loadingTime" className="block text-sm font-medium text-gray-300 mb-2">
              Tempo de Carga (min) *
            </label>
            <input
              type="number"
              id="loadingTime"
              {...register('loadingTime', { valueAsNumber: true })}
              placeholder="60"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.loadingTime && (
              <p className="mt-1 text-sm text-red-400">{errors.loadingTime.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="unloadingTime" className="block text-sm font-medium text-gray-300 mb-2">
              Tempo de Descarga (min) *
            </label>
            <input
              type="number"
              id="unloadingTime"
              {...register('unloadingTime', { valueAsNumber: true })}
              placeholder="60"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.unloadingTime && (
              <p className="mt-1 text-sm text-red-400">{errors.unloadingTime.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Especificações */}
      <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
        <label htmlFor="specifications" className="block text-sm font-medium text-gray-300 mb-2">
          Especificações Adicionais
        </label>
        <textarea
          id="specifications"
          {...register('specifications')}
          rows={4}
          placeholder="Informações adicionais sobre a carga..."
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Buttons */}
      <div className="flex justify-end space-x-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : 'Publicar Frete'}
        </button>
      </div>
    </form>
  );
}
