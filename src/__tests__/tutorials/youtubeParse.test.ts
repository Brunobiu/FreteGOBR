/**
 * Teste de regressão — parser de URL do YouTube dos tutoriais.
 * Garante que as formas comuns de URL viram o embed correto e que lixo
 * retorna null (o service rejeita link inválido na criação).
 */

import { describe, it, expect } from 'vitest';
import { parseYouTubeId, youTubeEmbedUrl } from '../../services/tutorials';

describe('parseYouTubeId / youTubeEmbedUrl', () => {
  it('reconhece watch?v=', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reconhece youtu.be/', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reconhece shorts/ e embed/', () => {
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('retorna null para URL inválida', () => {
    expect(parseYouTubeId('https://exemplo.com/video')).toBeNull();
    expect(parseYouTubeId('nada')).toBeNull();
  });

  it('monta a URL de embed', () => {
    expect(youTubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
    expect(youTubeEmbedUrl('link quebrado')).toBeNull();
  });
});
