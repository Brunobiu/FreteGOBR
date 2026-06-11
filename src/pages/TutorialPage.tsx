import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import AppHeader from '../components/AppHeader';
import TutorialVideoModal from '../components/TutorialVideoModal';
import {
  listTutorialsForUser,
  setTutorialCompleted,
  type TutorialAudience,
  type TutorialVideo,
} from '../services/tutorials';

/**
 * TutorialPage — lista de vídeos de tutorial para o usuário logado.
 *
 * O público (motorista/embarcador) é derivado do tipo do usuário. Mostra os
 * vídeos numerados ("Vídeo 1, 2, 3..."); ao clicar abre o modal do player, com
 * a opção de marcar como concluído (✓ verde no card quando concluído).
 */
export default function TutorialPage() {
  useDocumentTitle('Tutorial');
  const navigate = useNavigate();
  const { user } = useAuth();

  const audience: TutorialAudience = user?.userType === 'embarcador' ? 'embarcador' : 'motorista';

  const [videos, setVideos] = useState<TutorialVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<TutorialVideo | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setVideos(await listTutorialsForUser(audience, user.id));
      setError(null);
    } catch {
      setError('Não foi possível carregar os tutoriais.');
    } finally {
      setLoading(false);
    }
  }, [user, audience]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = async (video: TutorialVideo) => {
    if (!user) return;
    const next = !video.completed;
    // Otimista
    setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, completed: next } : v)));
    setActive((cur) => (cur && cur.id === video.id ? { ...cur, completed: next } : cur));
    try {
      await setTutorialCompleted(video.id, user.id, next);
    } catch {
      // Reverte em caso de falha
      setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, completed: !next } : v)));
    }
  };

  const completedCount = videos.filter((v) => v.completed).length;

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-gray-800">Tutorial</h1>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Aprenda a usar o FreteGO com vídeos curtos.
          {videos.length > 0 && ` ${completedCount} de ${videos.length} concluídos.`}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-500">Carregando...</div>
        ) : videos.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <p className="text-gray-500">Ainda não há tutoriais disponíveis. Volte em breve.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {videos.map((v, idx) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setActive(v)}
                  className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 text-left hover:bg-gray-50 transition-colors shadow-sm"
                >
                  {/* Thumb / play */}
                  <span className="relative w-12 h-12 rounded-lg bg-green-600/10 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wider text-gray-400">
                      Vídeo {idx + 1}
                    </span>
                    <span className="block text-sm font-medium text-gray-800 truncate">
                      {v.title}
                    </span>
                    {v.description && (
                      <span className="block text-xs text-gray-500 truncate">{v.description}</span>
                    )}
                  </span>
                  {/* Selo de concluído */}
                  {v.completed && (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"
                      aria-label="Concluído"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Concluído
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {active && (
        <TutorialVideoModal
          video={active}
          completed={!!active.completed}
          onClose={() => setActive(null)}
          onToggleCompleted={() => handleToggle(active)}
        />
      )}
    </div>
  );
}
