import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicEmbarcadorProfile, getEmbarcadorRatings } from '../services/embarcador';
import { getSignedUrl, getDocumentByType } from '../services/documents';

interface Rating {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  motoristaName: string;
  motoristaPhoto: string | null;
}

export default function EmbarcadorPublicProfilePage() {
  const { embarcadorId } = useParams<{ embarcadorId: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [userName, setUserName] = useState('');
  const [rating, setRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [ratings, setRatings] = useState<Rating[]>([]);

  useEffect(() => {
    if (!embarcadorId) return;

    const loadProfile = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load public profile
        const profile = await getPublicEmbarcadorProfile(embarcadorId);
        setCompanyName(profile.companyName);
        setUserName(profile.userName);
        setRating(profile.rating);
        setTotalRatings(profile.totalRatings);

        // Load profile photo if exists
        if (profile.profilePhotoUrl) {
          const profilePhotoDoc = await getDocumentByType(profile.userId, 'profile_photo');
          if (profilePhotoDoc) {
            const signedUrl = await getSignedUrl(profilePhotoDoc.id);
            setProfilePhotoUrl(signedUrl);
          }
        }

        // Load ratings
        const ratingsData = await getEmbarcadorRatings(embarcadorId);
        setRatings(ratingsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [embarcadorId]);

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <svg
            key={star}
            className={`w-5 h-5 ${star <= rating ? 'text-yellow-500' : 'text-gray-600'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
        <span className="ml-2 text-sm text-gray-400">
          ({totalRatings} {totalRatings === 1 ? 'avaliação' : 'avaliações'})
        </span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-950">
        <div className="text-white">Carregando perfil...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-950">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Profile Header */}
        <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 mb-8">
          <div className="flex items-center space-x-6">
            <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden">
              {profilePhotoUrl ? (
                <img
                  src={profilePhotoUrl}
                  alt="Foto de perfil"
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg className="w-12 h-12 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-white mb-2">{companyName}</h1>
              <p className="text-gray-400 mb-3">{userName}</p>
              {renderStars(rating)}
            </div>
          </div>
        </div>

        {/* Fretes Ativos */}
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Fretes Ativos</h2>
          <p className="text-gray-400">Nenhum frete ativo no momento.</p>
          <p className="text-sm text-gray-500 mt-2">Aguardando implementação da gestão de fretes</p>
        </div>

        {/* Avaliações */}
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
          <h2 className="text-2xl font-bold text-white mb-6">Avaliações</h2>

          {ratings.length === 0 ? (
            <p className="text-gray-400">Nenhuma avaliação ainda.</p>
          ) : (
            <div className="space-y-6">
              {ratings.map((review) => (
                <div key={review.id} className="border-b border-gray-800 pb-6 last:border-b-0">
                  <div className="flex items-start space-x-4">
                    <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {review.motoristaPhoto ? (
                        <img
                          src={review.motoristaPhoto}
                          alt={review.motoristaName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <svg
                          className="w-6 h-6 text-gray-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-white font-medium">{review.motoristaName}</h3>
                        <span className="text-sm text-gray-400">
                          {new Date(review.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      {renderStars(review.rating)}
                      {review.comment && <p className="text-gray-300 mt-3">{review.comment}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
