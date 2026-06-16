// Feature: whatsapp-automation, Property 8: Rendering never leaks literal marker
//
// Property 8 — A Rendered_Message nunca contém um marcador `{{...}}` literal.
//
// Para qualquer template (mistura de texto literal + variáveis suportadas
// `{{nome}}`/`{{telefone}}`/`{{empresa}}` + variáveis desconhecidas `{{xxx}}`) e
// qualquer Recipient_Data (possivelmente parcial), `renderMessage`:
//   - nunca deixa um marcador `{{...}}` literal na saída;
//   - substitui variáveis suportadas pelo valor (ou vazio/fallback quando
//     ausente/vazio);
//   - remove variáveis desconhecidas (string vazia);
//   - nunca aborta (sempre retorna uma string);
//   - não muta o template armazenado.
//
// Validates: Requirements 25.2, 25.4, 25.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  renderMessage,
  SUPPORTED_VARIABLES,
  type RecipientData,
  type VariableFallbacks,
  type SupportedVariable,
} from '../../../services/admin/whatsapp/render';

// Regex que detecta QUALQUER marcador `{{ ... }}` literal residual na saída.
// Espelha a captura tolerante a espaços usada na implementação (Property 8).
const RESIDUAL_MARKER = /\{\{\s*[^{}]*?\s*\}\}/;

// Texto livre de chaves: garante que qualquer `{{...}}` na saída só pode ter
// vindo de um marcador NÃO resolvido — tornando a asserção significativa.
function braceFreeText(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .string({ minLength: min, maxLength: max })
    .filter((s) => !s.includes('{') && !s.includes('}'));
}

// Valor de Recipient_Data / fallback: também sem chaves (dados reais de
// destinatário — nome/telefone/empresa — não contêm marcadores). Isso evita
// que um valor substituído reintroduza um `{{...}}` na saída.
function braceFreeValue(): fc.Arbitrary<string> {
  return braceFreeText(0, 12);
}

// Envolve um nome em um marcador, variando espaçamento e caixa internos para
// exercitar o trim()/toLowerCase() da implementação (Req 25.2).
function wrapMarker(name: string): fc.Arbitrary<string> {
  return fc
    .tuple(fc.constantFrom('', ' ', '  ', '\t'), fc.constantFrom('', ' ', '  ', '\t'))
    .map(([lead, trail]) => `{{${lead}${name}${trail}}}`);
}

type Segment = {
  // Trecho que será concatenado no template.
  raw: string;
  // Resolve o valor esperado deste trecho na saída renderizada.
  expected: (data: RecipientData, fb: VariableFallbacks) => string;
};

// Trecho literal: nunca contém chaves; renderiza como ele mesmo.
const literalSegment: fc.Arbitrary<Segment> = braceFreeText(0, 10).map((text) => ({
  raw: text,
  expected: () => text,
}));

// Trecho de variável suportada: `{{nome|telefone|empresa}}` com caixa/espaço
// variados. Valor = data[name] não vazio; senão fallback; senão vazio (Req 25.4).
const supportedSegment: fc.Arbitrary<Segment> = fc
  .tuple(
    fc.constantFrom<SupportedVariable>(...SUPPORTED_VARIABLES),
    fc.boolean() // varia a caixa para validar normalização
  )
  .chain(([name, upper]) => {
    const display = upper ? name.toUpperCase() : name;
    return wrapMarker(display).map((raw) => ({
      raw,
      expected: (data: RecipientData, fb: VariableFallbacks) => {
        const value = data[name];
        if (value !== undefined && value !== '') return value;
        return fb[name] ?? '';
      },
    }));
  });

// Nome de variável desconhecida: sem chaves, não vazio após trim e que NÃO
// colide com uma variável suportada. Renderiza sempre como string vazia.
const unknownName: fc.Arbitrary<string> = braceFreeText(1, 8).filter((s) => {
  const norm = s.trim().toLowerCase();
  return norm.length > 0 && !(SUPPORTED_VARIABLES as readonly string[]).includes(norm);
});

const unknownSegment: fc.Arbitrary<Segment> = unknownName.chain((name) =>
  wrapMarker(name).map((raw) => ({
    raw,
    expected: () => '',
  }))
);

// Marcador vazio `{{}}` / só espaços: variável desconhecida → removido.
const emptyMarkerSegment: fc.Arbitrary<Segment> = fc
  .constantFrom('{{}}', '{{ }}', '{{\t}}')
  .map((raw) => ({ raw, expected: () => '' }));

const anySegment: fc.Arbitrary<Segment> = fc.oneof(
  literalSegment,
  supportedSegment,
  supportedSegment,
  unknownSegment,
  emptyMarkerSegment
);

// Recipient_Data possivelmente parcial: cada variável suportada pode estar
// ausente, vazia ou preenchida; com chaves extras desconhecidas toleradas.
const recipientDataArb: fc.Arbitrary<RecipientData> = fc
  .record(
    {
      nome: fc.option(braceFreeValue(), { nil: undefined }),
      telefone: fc.option(braceFreeValue(), { nil: undefined }),
      empresa: fc.option(braceFreeValue(), { nil: undefined }),
      extra: fc.option(braceFreeValue(), { nil: undefined }),
    },
    { requiredKeys: [] }
  )
  .map((rec) => {
    const data: RecipientData = {};
    if (rec.nome !== undefined) data.nome = rec.nome;
    if (rec.telefone !== undefined) data.telefone = rec.telefone;
    if (rec.empresa !== undefined) data.empresa = rec.empresa;
    if (rec.extra !== undefined) data.xyz_unmapped = rec.extra;
    return data;
  });

const fallbacksArb: fc.Arbitrary<VariableFallbacks> = fc
  .record(
    {
      nome: fc.option(braceFreeValue(), { nil: undefined }),
      telefone: fc.option(braceFreeValue(), { nil: undefined }),
      empresa: fc.option(braceFreeValue(), { nil: undefined }),
    },
    { requiredKeys: [] }
  )
  .map((rec) => {
    const fb: VariableFallbacks = {};
    if (rec.nome !== undefined) fb.nome = rec.nome;
    if (rec.telefone !== undefined) fb.telefone = rec.telefone;
    if (rec.empresa !== undefined) fb.empresa = rec.empresa;
    return fb;
  });

// Template = junção de 0..12 trechos (literais + variáveis + desconhecidas).
const templateArb = fc.array(anySegment, { minLength: 0, maxLength: 12 });

describe('renderMessage — Property 8 (rendering never leaks literal marker)', () => {
  it('nunca deixa marcador {{...}} literal na saída (Req 25.4, 25.5)', () => {
    fc.assert(
      fc.property(templateArb, recipientDataArb, fallbacksArb, (segments, data, fb) => {
        const template = segments.map((s) => s.raw).join('');
        const out = renderMessage(template, data, fb);
        expect(typeof out).toBe('string'); // nunca aborta
        expect(RESIDUAL_MARKER.test(out)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('renderiza exatamente a concatenação esperada por trecho (Req 25.2, 25.4, 25.5)', () => {
    fc.assert(
      fc.property(templateArb, recipientDataArb, fallbacksArb, (segments, data, fb) => {
        const template = segments.map((s) => s.raw).join('');
        const expected = segments.map((s) => s.expected(data, fb)).join('');
        expect(renderMessage(template, data, fb)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('não muta o template nem o Recipient_Data (Req 25.7)', () => {
    fc.assert(
      fc.property(templateArb, recipientDataArb, fallbacksArb, (segments, data, fb) => {
        const template = segments.map((s) => s.raw).join('');
        const templateCopy = String(template);
        const dataCopy = JSON.stringify(data);
        renderMessage(template, data, fb);
        expect(template).toBe(templateCopy);
        expect(JSON.stringify(data)).toBe(dataCopy);
      }),
      { numRuns: 100 }
    );
  });

  it('substitui variável suportada presente e não vazia pelo seu valor (Req 25.2)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<SupportedVariable>(...SUPPORTED_VARIABLES),
        braceFreeText(1, 12).filter((v) => v.length > 0),
        (name, value) => {
          const data: RecipientData = { [name]: value };
          expect(renderMessage(`A{{${name}}}B`, data)).toBe(`A${value}B`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
