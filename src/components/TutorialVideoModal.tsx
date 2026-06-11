import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { TutorialVideo } from '../services/tutorials';

/**
 * Modal de reprodução de um vídeo de tutorial. Toca YouTube (iframe embed) ou
 * arquivo (tag <video>). Renderizado via portal no body para ficar acima de
 * tudo. Fecha no X, no backdrop ou ESC.
 */
export default function TutorialVideoModal({
  video,
  completed,
  onClose,
  onToggleCompleted,
}: {
  video: TutorialVideo;
  completed: boolean;
  onClose: () => void;
  onToggleCompleted: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
      className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden w-full max-w-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <p className="text-sm font-semibold text-gray-100 truncate pr-2">{video.title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-400 hover:text-gray-100 p-1 shrink-0"
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
        </div>

        {/* Player 16:9 */}
        <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
          {video.sourceType === 'youtube' ? (
            <iframe
              src={video.playbackUrl}
              title={video.title}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              src={video.playbackUrl}
              controls
              autoPlay
              className="absolute inset-0 w-full h-full"
            >
              Seu navegador não suporta vídeo.
            </video>
          )}
        </div>

        <div className="px-4 py-3 space-y-3">
          {video.description && <p className="text-xs text-gray-400">{video.description}</p>}
          <button
            type="button"
            onClick={onToggleCompleted}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
              completed
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700'
            }`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {completed ? 'Concluído' : 'Marcar como concluído'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
