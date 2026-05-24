/**
 * Overlay full-screen exibido durante operações longas (publicar/atualizar
 * frete) com a logomarca centralizada e uma mensagem de status.
 *
 * Uso:
 *   <PublishingOverlay open={isSubmitting} message="Publicando frete..." />
 */

interface PublishingOverlayProps {
  open: boolean;
  message?: string;
}

export default function PublishingOverlay({
  open,
  message = 'Publicando frete...',
}: PublishingOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4">
        {/* Logo: círculo no desktop, quadrado arredondado no mobile */}
        <div className="relative">
          <div
            className="
              w-32 h-32 sm:w-40 sm:h-40
              rounded-2xl sm:rounded-full
              bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700
              shadow-2xl
              flex items-center justify-center
              animate-pulse
            "
          >
            <span className="text-white text-3xl sm:text-4xl font-bold tracking-tight">
              FreteGO
            </span>
          </div>
          {/* Ring girando ao redor */}
          <div
            className="
              absolute inset-0
              rounded-2xl sm:rounded-full
              border-4 border-white/40 border-t-white
              animate-spin
            "
            style={{ animationDuration: '1.2s' }}
          />
        </div>

        <p className="text-white text-base sm:text-lg font-medium tracking-wide">
          {message}
        </p>
      </div>
    </div>
  );
}
