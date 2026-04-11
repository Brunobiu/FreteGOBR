import { useState, useEffect } from 'react';
import { getRatingsByEmbarcador, hasRated, type Rating } from '../services/ratings';
import { useAuth } from '../hooks/useAuth';
import RatingForm from './RatingForm';

interface RatingDisplayProps {
  embarcadorId: string;
  rating: number;
  totalRatings: number;
}

export default function RatingDisplay({ embarcadorId, rating, totalRatings }: RatingDisplayProps) {
  const { user, isAuthenticated } = useAuth();
  const [reviews, setReviews] = useState<Rating[]>([]);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadRatings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embarcadorId]);

  const loadRatings = async () => {
    try {
      setIsLoading(true);
      const data = await getRatingsByEmbarcador(embarcadorId);
      setReviews(data);
      if (isAuthenticated && user?.userType === 'motorista') {
        const rated = await hasRated(user.id, embarcadorId);
        setAlreadyRated(rated);
      }
    } catch (err) {
      console.error('Erro ao carregar avaliações:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const renderStars = (value: number) => (
    <div className="flex space-x-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`w-4 h-4 ${value >= star ? 'text-yellow-400' : 'text-gray-600'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Média */}
      <div className="flex items-center space-x-3">
        {renderStars(Math.round(rating))}
        <span className="text-sm text-gray-500">
          {rating > 0 ? rating.toFixed(1) : '—'} ({totalRatings} avaliação
          {totalRatings !== 1 ? 'ões' : ''})
        </span>
      </div>

      {/* Botão avaliar */}
      {isAuthenticated && user?.userType === 'motorista' && !alreadyRated && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700"
        >
          Avaliar Embarcador
        </button>
      )}
      {alreadyRated && <p className="text-xs text-gray-500">Você já avaliou este embarcador</p>}

      {/* Formulário */}
      {showForm && user && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <RatingForm
            motoristaId={user.id}
            embarcadorId={embarcadorId}
            onSuccess={() => {
              setShowForm(false);
              setAlreadyRated(true);
              loadRatings();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Lista de avaliações */}
      {isLoading ? (
        <p className="text-sm text-gray-500">Carregando avaliações...</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma avaliação ainda</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div key={review.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                {renderStars(review.rating)}
                <span className="text-xs text-gray-400">
                  {new Date(review.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </div>
              {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
