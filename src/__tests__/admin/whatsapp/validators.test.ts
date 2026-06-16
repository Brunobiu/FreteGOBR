import { describe, it, expect } from 'vitest';
import {
  validateSendInterval,
  validateExecutionQuota,
  validateContent,
  validateMimeType,
  validateKnowledgeBase,
  validateAiPrompt,
  KNOWLEDGE_BASE_MAX_LENGTH,
  SUPPORTED_MIME_TYPES,
  type ValidationResult,
} from '../../../services/admin/whatsapp/validation';

/**
 * Caminhos negativos (e o caso válido) dos validadores compartilhados
 * front+back (Req 5.6, 6.3, 6.5, 8.2, 8.4, 15.2, 15.3, 26.3).
 *
 * Cada falha deve trazer o Error_Code (inglês) e a Canonical_Message (pt-BR)
 * esperados; cada caso válido deve retornar `{ ok: true }`.
 */

function expectFailure(result: ValidationResult, error: string, message: string): void {
  expect(result.ok).toBe(false);
  if (result.ok === false) {
    expect(result.error).toBe(error);
    expect(result.message).toBe(message);
  }
}

describe('validateSendInterval', () => {
  it('rejeita zero', () => {
    expectFailure(validateSendInterval(0), 'INVALID_SEND_INTERVAL', 'Informe um intervalo válido.');
  });

  it('rejeita valor negativo', () => {
    expectFailure(
      validateSendInterval(-30),
      'INVALID_SEND_INTERVAL',
      'Informe um intervalo válido.'
    );
  });

  it('rejeita NaN', () => {
    expectFailure(
      validateSendInterval(NaN),
      'INVALID_SEND_INTERVAL',
      'Informe um intervalo válido.'
    );
  });

  it('rejeita string não numérica', () => {
    expectFailure(
      validateSendInterval('abc'),
      'INVALID_SEND_INTERVAL',
      'Informe um intervalo válido.'
    );
  });

  it('rejeita string vazia', () => {
    expectFailure(
      validateSendInterval('   '),
      'INVALID_SEND_INTERVAL',
      'Informe um intervalo válido.'
    );
  });

  it('rejeita valores não finitos', () => {
    expectFailure(
      validateSendInterval(Infinity),
      'INVALID_SEND_INTERVAL',
      'Informe um intervalo válido.'
    );
  });

  it('aceita intervalo positivo (number e string)', () => {
    expect(validateSendInterval(30)).toEqual({ ok: true });
    expect(validateSendInterval('45')).toEqual({ ok: true });
  });
});

describe('validateExecutionQuota', () => {
  it('rejeita valor abaixo de 1', () => {
    expectFailure(
      validateExecutionQuota(0),
      'INVALID_EXECUTION_QUOTA',
      'Informe uma quantidade válida.'
    );
  });

  it('rejeita valor negativo', () => {
    expectFailure(
      validateExecutionQuota(-5),
      'INVALID_EXECUTION_QUOTA',
      'Informe uma quantidade válida.'
    );
  });

  it('rejeita NaN', () => {
    expectFailure(
      validateExecutionQuota(NaN),
      'INVALID_EXECUTION_QUOTA',
      'Informe uma quantidade válida.'
    );
  });

  it('rejeita string não numérica', () => {
    expectFailure(
      validateExecutionQuota('dez'),
      'INVALID_EXECUTION_QUOTA',
      'Informe uma quantidade válida.'
    );
  });

  it('rejeita quantidade fracionária', () => {
    expectFailure(
      validateExecutionQuota(2.5),
      'INVALID_EXECUTION_QUOTA',
      'Informe uma quantidade válida.'
    );
  });

  it('aceita quantidade inteira >= 1 (number e string)', () => {
    expect(validateExecutionQuota(1)).toEqual({ ok: true });
    expect(validateExecutionQuota('100')).toEqual({ ok: true });
  });
});

describe('validateContent', () => {
  it('rejeita content sem texto e sem mídia', () => {
    expectFailure(
      validateContent({ body: '', mediaCount: 0 }),
      'EMPTY_CONTENT',
      'Informe um texto ou anexe ao menos uma mídia.'
    );
  });

  it('rejeita content só com espaços e sem mídia', () => {
    expectFailure(
      validateContent({ body: '   \n  ', mediaCount: 0 }),
      'EMPTY_CONTENT',
      'Informe um texto ou anexe ao menos uma mídia.'
    );
  });

  it('rejeita content sem texto e mídia ausente (undefined)', () => {
    expectFailure(
      validateContent({}),
      'EMPTY_CONTENT',
      'Informe um texto ou anexe ao menos uma mídia.'
    );
  });

  it('aceita content só com texto', () => {
    expect(validateContent({ body: 'Olá', mediaCount: 0 })).toEqual({ ok: true });
  });

  it('aceita content só com mídia', () => {
    expect(validateContent({ body: '', mediaCount: 1 })).toEqual({ ok: true });
  });

  it('aceita content com texto e mídia', () => {
    expect(validateContent({ body: 'Olá', mediaCount: 2 })).toEqual({ ok: true });
  });
});

describe('validateMimeType', () => {
  it('rejeita MIME fora do conjunto suportado', () => {
    expectFailure(
      validateMimeType('application/x-msdownload'),
      'INVALID_FILE_TYPE',
      'Tipo de arquivo não suportado.'
    );
  });

  it('rejeita MIME ausente/vazio', () => {
    expectFailure(validateMimeType(''), 'INVALID_FILE_TYPE', 'Tipo de arquivo não suportado.');
    expectFailure(
      validateMimeType(undefined),
      'INVALID_FILE_TYPE',
      'Tipo de arquivo não suportado.'
    );
  });

  it('rejeita extensão disfarçada que não é MIME suportado', () => {
    expectFailure(
      validateMimeType('text/html'),
      'INVALID_FILE_TYPE',
      'Tipo de arquivo não suportado.'
    );
  });

  it('aceita MIME suportado de cada media_type', () => {
    expect(validateMimeType('image/png')).toEqual({ ok: true });
    expect(validateMimeType('video/mp4')).toEqual({ ok: true });
    expect(validateMimeType('audio/mpeg')).toEqual({ ok: true });
    expect(validateMimeType('application/pdf')).toEqual({ ok: true });
  });

  it('aceita MIME com caixa alta e parâmetros', () => {
    expect(validateMimeType('IMAGE/PNG')).toEqual({ ok: true });
    expect(validateMimeType('text/plain; charset=utf-8')).toEqual({ ok: true });
  });

  it('cada MIME declarado em SUPPORTED_MIME_TYPES é aceito', () => {
    for (const list of Object.values(SUPPORTED_MIME_TYPES)) {
      for (const mime of list) {
        expect(validateMimeType(mime)).toEqual({ ok: true });
      }
    }
  });
});

describe('validateKnowledgeBase', () => {
  it('rejeita conteúdo acima do limite máximo', () => {
    const tooLong = 'a'.repeat(KNOWLEDGE_BASE_MAX_LENGTH + 1);
    expectFailure(
      validateKnowledgeBase(tooLong),
      'KNOWLEDGE_BASE_TOO_LONG',
      'O conteúdo excede o limite permitido.'
    );
  });

  it('aceita conteúdo exatamente no limite', () => {
    const atLimit = 'a'.repeat(KNOWLEDGE_BASE_MAX_LENGTH);
    expect(validateKnowledgeBase(atLimit)).toEqual({ ok: true });
  });

  it('aceita conteúdo vazio (Knowledge_Base é opcional)', () => {
    expect(validateKnowledgeBase('')).toEqual({ ok: true });
  });
});

describe('validateAiPrompt', () => {
  it('rejeita prompt vazio', () => {
    expectFailure(validateAiPrompt(''), 'INVALID_AI_PROMPT', 'Informe um prompt válido.');
  });

  it('rejeita prompt só com espaços', () => {
    expectFailure(validateAiPrompt('   \n\t '), 'INVALID_AI_PROMPT', 'Informe um prompt válido.');
  });

  it('rejeita prompt ausente (não string)', () => {
    expectFailure(validateAiPrompt(undefined), 'INVALID_AI_PROMPT', 'Informe um prompt válido.');
  });

  it('aceita prompt não vazio', () => {
    expect(validateAiPrompt('Você é um atendente da FreteGO.')).toEqual({
      ok: true,
    });
  });
});
