/**
 * Testes unitários — service admin/comunidade (spec frete-comunidade, Fase 4).
 *
 * Cobre: mapError (códigos crus → CommunityError + mensagem pt-BR canônica),
 * round-trip parse↔serialize de filtros, e validação de foto (MIME/limite).
 * `vi.mock` é hoisted: não referencia variáveis externas no factory.
 */

import { describe, it, expect } from 'vitest';

import {
  mapError,
  CommunityError,
  COMMUNITY_ERROR_MESSAGES,
  validatePhotoFile,
  parseCommunityFilters,
  serializeCommunityFilters,
  DEFAULT_COMMUNITY_FILTERS,
  type CommunityFretesFilters,
} from '../../services/admin/comunidade';

describe('admin/comunidade — mapError', () => {
  it('42501 / permission_denied ⇒ PERMISSION_DENIED', () => {
    expect(mapError({ code: '42501', message: 'x' }).code).toBe('PERMISSION_DENIED');
    expect(mapError({ message: 'permission_denied: FINANCEIRO_VIEW' }).code).toBe(
      'PERMISSION_DENIED'
    );
  });

  it('mapeia os códigos de domínio para o enum correto', () => {
    expect(mapError({ message: 'STALE_VERSION' }).code).toBe('STALE_VERSION');
    expect(mapError({ message: 'NO_PROFILE' }).code).toBe('NO_PROFILE');
    expect(mapError({ message: 'FEATURE_DISABLED' }).code).toBe('FEATURE_DISABLED');
    expect(mapError({ message: 'CITY_UNRESOLVED' }).code).toBe('CITY_UNRESOLVED');
    expect(mapError({ message: 'INVALID_FILE_TYPE' }).code).toBe('INVALID_FILE_TYPE');
    expect(mapError({ message: 'INVALID_INPUT: name' }).code).toBe('INVALID_INPUT');
  });

  it('desconhecido ⇒ UNKNOWN; toda mensagem é pt-BR não-vazia', () => {
    expect(mapError(new Error('algo estranho')).code).toBe('UNKNOWN');
    expect(mapError(null).code).toBe('UNKNOWN');
    for (const msg of Object.values(COMMUNITY_ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('CommunityError carrega a mensagem canônica do código', () => {
    const e = new CommunityError('NO_PROFILE');
    expect(e.message).toBe(COMMUNITY_ERROR_MESSAGES.NO_PROFILE);
    expect(e.code).toBe('NO_PROFILE');
  });
});

describe('admin/comunidade — validatePhotoFile', () => {
  it('aceita png/jpeg/webp até 5MB', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/webp', size: 10 })).toBeNull();
  });

  it('rejeita MIME inválido e acima do limite', () => {
    expect(validatePhotoFile({ type: 'application/pdf', size: 10 })).toBe('INVALID_FILE_TYPE');
    expect(validatePhotoFile({ type: 'image/gif', size: 10 })).toBe('INVALID_FILE_TYPE');
    expect(validatePhotoFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe(
      'INVALID_FILE_TYPE'
    );
  });
});

describe('admin/comunidade — filtros round-trip', () => {
  it('serialize → parse preserva os campos relevantes', () => {
    const cases: CommunityFretesFilters[] = [
      { q: 'goiania', sort: 'value_desc', limit: 50, offset: 20 },
      { q: '', sort: 'recent', limit: 10, offset: 0 },
      { q: 'soja', sort: 'value_asc', limit: 100, offset: 0 },
    ];
    for (const f of cases) {
      const round = parseCommunityFilters(serializeCommunityFilters(f));
      expect(round.q).toBe(f.q?.trim() ?? '');
      expect(round.sort).toBe(f.sort);
      expect(round.limit).toBe(f.limit);
      expect(round.offset).toBe(f.offset);
    }
  });

  it('defaults para valores inválidos', () => {
    const parsed = parseCommunityFilters(new URLSearchParams('sort=xxx&limit=7&offset=-5'));
    expect(parsed.sort).toBe('recent');
    expect(parsed.limit).toBe(DEFAULT_COMMUNITY_FILTERS.limit);
    expect(parsed.offset).toBe(0);
  });

  it('omite parâmetros default na serialização (URL limpa)', () => {
    const sp = serializeCommunityFilters({ q: '', sort: 'recent', limit: 10, offset: 0 });
    expect(sp.toString()).toBe('');
  });
});
