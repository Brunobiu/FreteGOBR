/**
 * Property-Based Test — chat-enviar-documentos, Properties 1-4.
 *
 * Alvo: camada pura `src/services/driverDocsCatalog.ts`
 * (`buildSendableCatalog`, `selectSendables`, `docLabel`, `attachmentKindForMime`).
 *
 * Toda a lógica de "o que pode ser enviado", rótulo, agrupamento, seleção e
 * classificação de anexo deriva dessas funções — verificá-las cobre o núcleo
 * das Req 5, 6, 7 e parte da 9.
 *
 * Convenções fast-check do projeto: domínios fechados via `fc.constantFrom`,
 * nunca `fc.stringOf`. Mínimo de 100 iterações por property.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildSendableCatalog,
  selectSendables,
  docLabel,
  attachmentKindForMime,
  DRIVER_DOC_LABELS,
  type CatalogDocInput,
  type CatalogRefInput,
} from '../services/driverDocsCatalog';
import { VALID_DOCUMENT_TYPES, type DocumentType } from '../services/documents';

// Domínio fechado de tipos de documento (NUNCA fc.stringOf).
const docTypeArb = fc.constantFrom<DocumentType>(...VALID_DOCUMENT_TYPES);
const mimeArb = fc.constantFrom<string | null>(
  'image/png',
  'image/jpeg',
  'application/pdf',
  '',
  null
);

/** Lista de documentos com ids únicos e filePath não-vazio (como o banco real). */
const docsArb: fc.Arbitrary<CatalogDocInput[]> = fc
  .array(
    fc.record({
      documentType: docTypeArb,
      fileName: fc.constantFrom('cnh.pdf', 'foto.jpg', 'crlv.png'),
      mimeType: mimeArb,
    }),
    { maxLength: 12 }
  )
  .map((arr) =>
    arr.map((d, i) => ({
      id: `d${i}`,
      documentType: d.documentType,
      filePath: `user-1/${d.documentType}_${i}.bin`,
      fileName: d.fileName,
      mimeType: d.mimeType,
    }))
  );

/** Lista de referências com ids únicos; ctePath pode ser null (sem CT-e). */
const refsArb: fc.Arbitrary<CatalogRefInput[]> = fc
  .array(
    fc.record({
      companyName: fc.constantFrom('Transportes X', 'Empresa Y', '', '  '),
      hasCte: fc.boolean(),
    }),
    { maxLength: 6 }
  )
  .map((arr) =>
    arr.map((r, i) => ({
      id: `r${i}`,
      companyName: r.companyName,
      ctePath: r.hasCte ? `user-1/cte_${i}.pdf` : null,
      cteName: r.hasCte ? `cte_${i}.pdf` : null,
    }))
  );

describe('chat-enviar-documentos — camada pura driverDocsCatalog', () => {
  // Feature: chat-enviar-documentos, Property 1: Catálogo só documentos próprios e enviáveis
  // Validates: Requirements 5.2, 5.3, 9.1
  it('Property 1: catálogo só inclui docs enviáveis (sem profile_photo) e refs com CT-e', () => {
    fc.assert(
      fc.property(docsArb, refsArb, (docs, refs) => {
        const catalog = buildSendableCatalog(docs, refs);

        for (const item of catalog) {
          // (a) todo item tem sourcePath e label não-vazios.
          expect(item.sourcePath.length).toBeGreaterThan(0);
          expect(item.label.length).toBeGreaterThan(0);
          // (b) nenhum item corresponde a profile_photo.
          expect(item.docType).not.toBe('profile_photo');
          // (c) item de referência veio de uma ref com ctePath.
          if (item.kind === 'reference_cte') {
            const refId = item.id.slice('ref:'.length);
            const src = refs.find((r) => r.id === refId);
            expect(src?.ctePath).toBeTruthy();
          }
        }

        // Contagem = #docs(type ≠ profile_photo) + #refs(ctePath presente).
        const expected =
          docs.filter((d) => d.documentType !== 'profile_photo').length +
          refs.filter((r) => r.ctePath).length;
        expect(catalog.length).toBe(expected);

        // profile_photo nunca aparece como item de documento.
        expect(catalog.some((i) => i.docType === 'profile_photo')).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: chat-enviar-documentos, Property 2: Rótulo total/determinístico e identidade estável
  // Validates: Requirements 5.4, 6.1
  it('Property 2: docLabel é total; build é determinístico (mesmos ids/ordem)', () => {
    fc.assert(
      fc.property(docTypeArb, (type) => {
        const label = docLabel(type);
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
        // Tipo conhecido → rótulo canônico (nunca o enum cru).
        if (DRIVER_DOC_LABELS[type]) {
          expect(label).toBe(DRIVER_DOC_LABELS[type]);
        }
      }),
      { numRuns: 100 }
    );

    fc.assert(
      fc.property(docsArb, refsArb, (docs, refs) => {
        const a = buildSendableCatalog(docs, refs);
        const b = buildSendableCatalog(docs, refs);
        expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
        expect(a).toEqual(b);
        // Ids são únicos no catálogo (estabilidade da seleção por checkbox).
        expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: chat-enviar-documentos, Property 3: Seleção é subconjunto exato
  // Validates: Requirements 6.2, 6.4
  it('Property 3: selectSendables retorna exatamente os ids selecionados (subconjunto)', () => {
    fc.assert(
      fc.property(
        docsArb.chain((docs) =>
          refsArb.chain((refs) => {
            const catalog = buildSendableCatalog(docs, refs);
            const ids = catalog.map((i) => i.id);
            // Subconjunto arbitrário dos ids do catálogo + ids inexistentes.
            return fc
              .tuple(fc.subarray(ids), fc.subarray(['x:0', 'x:1']))
              .map(([picked, bogus]) => ({ catalog, picked, ids: [...picked, ...bogus] }));
          })
        ),
        ({ catalog, picked, ids }) => {
          const result = selectSendables(catalog, ids);
          // Retorna exatamente os itens cujo id ∈ seleção (ignora inexistentes).
          expect(result.map((i) => i.id).sort()).toEqual([...picked].sort());
          // É um subconjunto do catálogo, sem duplicatas, na ordem do catálogo.
          const catIds = catalog.map((i) => i.id);
          expect(result.every((i) => catIds.includes(i.id))).toBe(true);
          expect(new Set(result.map((i) => i.id)).size).toBe(result.length);
          const order = result.map((i) => catIds.indexOf(i.id));
          expect(order).toEqual([...order].sort((a, b) => a - b));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3 (caso único): selecionar 1 id retorna exatamente aquele item', () => {
    const docs: CatalogDocInput[] = [
      { id: '1', documentType: 'cnh', filePath: 'u/cnh.pdf', fileName: 'cnh.pdf', mimeType: 'application/pdf' },
      { id: '2', documentType: 'crlv_cavalo', filePath: 'u/crlv.png', fileName: 'crlv.png', mimeType: 'image/png' },
    ];
    const catalog = buildSendableCatalog(docs, []);
    const one = selectSendables(catalog, ['doc:1']);
    expect(one).toHaveLength(1);
    expect(one[0].id).toBe('doc:1');
    expect(selectSendables(catalog, [])).toHaveLength(0);
    expect(selectSendables(catalog, catalog.map((i) => i.id))).toHaveLength(catalog.length);
  });

  // Feature: chat-enviar-documentos, Property 4: Classificação de anexo por MIME
  // Validates: Requirement 7.3
  it('Property 4: attachmentKindForMime é "image" sse o MIME começa com image/', () => {
    const anyMimeArb = fc.oneof(
      fc.constantFrom('image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/plain', ''),
      fc.constant<string | null>(null),
      fc.string({ minLength: 0, maxLength: 20 })
    );
    fc.assert(
      fc.property(anyMimeArb, (mime) => {
        const kind = attachmentKindForMime(mime);
        const expected = mime != null && mime.startsWith('image/') ? 'image' : 'file';
        expect(kind).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  // Casos de borda (ramos defensivos) — cobertura e comportamento explícito.
  it('docLabel: tipo desconhecido vira rótulo humanizado; vazio vira "Documento"', () => {
    expect(docLabel('tipo_desconhecido_x')).toBe('Tipo desconhecido x');
    expect(docLabel('')).toBe('Documento');
  });

  it('buildSendableCatalog: ignora documento sem filePath e referência sem CT-e', () => {
    const catalog = buildSendableCatalog(
      [
        { id: '1', documentType: 'cnh', filePath: '', fileName: 'cnh.pdf', mimeType: 'application/pdf' },
        { id: '2', documentType: 'cnh', filePath: 'u/cnh.pdf', fileName: 'cnh.pdf', mimeType: 'application/pdf' },
      ],
      [{ id: 'r1', companyName: 'Sem CTe', ctePath: null, cteName: null }]
    );
    expect(catalog.map((i) => i.id)).toEqual(['doc:2']);
  });

  it('buildSendableCatalog: referência sem nome usa rótulo legível', () => {
    const catalog = buildSendableCatalog(
      [],
      [{ id: 'r1', companyName: '   ', ctePath: 'u/cte.pdf', cteName: 'cte.pdf' }]
    );
    expect(catalog[0].label).toBe('Referência: sem nome (CT-e)');
  });
});
