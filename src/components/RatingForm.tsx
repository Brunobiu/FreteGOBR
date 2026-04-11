import { useState } from 'react';
import { createRating } from '../services/ratings';
import InputValidator, { INPUT_LIMITS } from '../utils/inputValidator';

interface RatingFormProps {
  motoristaId: string;
  embarcadorId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RatingForm({
  motoristaId,
  embarcadorId,
  onSuccess,
  onCancel,
}: RatingFormProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      setError('Selecione uma nota');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createRating({ motoristaId, embarcadorId, rating, comment: comment || undefined });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar avaliação');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Estrelas */}
      <div>
        <label className="block text-sm text-gray-600 mb-2">Nota</label>
        <div className="flex space-x-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
              className="p-1 transition-transform hover:scale-110"
            >
              <svg
                className={`w-8 h-8 ${(hoverRating || rating) >= star ? 'text-yellow-400' : 'text-gray-300'}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Comentário */}
      <div>
        <label className="block text-sm text-gray-600 mb-1">
          Comentário (opcional)
          <span className="text-gray-400 ml-1">
            ({comment.length}/{INPUT_LIMITS.MAX_RATING_COMMENT})
          </span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length <= INPUT_LIMITS.MAX_RATING_COMMENT) {
              const validation = InputValidator.validateRatingComment(value);
              if (validation.isValid || value.length === 0) {
                setComment(value);
              } else {
                setComment(validation.sanitizedValue);
              }
            }
          }}
          maxLength={INPUT_LIMITS.MAX_RATING_COMMENT}
          rows={3}
          placeholder="Como foi sua experiência?"
          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-300"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting || rating === 0}
          className="px-4 py-2 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Enviando...' : 'Enviar Avaliação'}
        </button>
      </div>
    </form>
  );
}
