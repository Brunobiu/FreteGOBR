import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  getMotoristaProfile,
  getUserData,
  updateMotoristaProfile,
  getMotoristaReferences,
  replaceMotoristaReferences,
  uploadReferenceCte,
  getDocumentSignedUrlByPath,
} from '../services/motorista';
import {
  uploadDocument,
  getSignedUrl,
  deleteDocument,
  validateDocumentType,
} from '../services/documents';
import {
  sendEmailVerificationCode,
  getVerificationStatus,
  VerificationError,
} from '../services/verification';
import { lookupCnpj, formatCnpj, sanitizeCnpj, CnpjLookupError } from '../services/cnpj';
import { lookupCep, formatCep, sanitizeCep, CepLookupError } from '../services/cep';
import { capitalizeName } from '../utils/textCase';
import { formatPlate, isValidMercosulPlate } from '../utils/plateValidation';
import { sanitizePhone, formatPhoneBR, isValidPhoneBR } from '../utils/phoneFormat';
import { maskDecimal, maskedToNumber, numberToMasked } from '../utils/numberMask';
import { formatCpf, sanitizeCpf } from '../utils/cpfFormat';
import { supabase } from '../services/supabase';
import ModalVerificacaoEmail from '../components/ModalVerificacaoEmail';
import VehicleTypePicker from '../components/VehicleTypePicker';
import BodyTypePicker from '../components/BodyTypePicker';
import { vehicleTypeLabel } from '../data/vehicleTypes';
import { bodyTypeLabel } from '../data/bodyTypes';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PDF_IMG = 'image/*,application/pdf';
const IMG_ONLY = 'image/*';
const PDF_ONLY = 'application/pdf';
const MAX_SIZE = 5 * 1024 * 1024;

// Lista canonica de tipos de caminhao vem de `data/vehicleTypes` e
// e exibida via VehicleTypePicker (modal). O <select> antigo (com
// poucas opcoes hardcoded) foi removido.

// Lista canonica de fabricantes/montadoras de caminhao usados no
// perfil do motorista. Mantida em ordem alfabetica (com excecao do
// "Outro" no fim, que sai porque o motorista deve escolher um da
// lista). Editar SO aqui.
const MODELOS_CAMINHAO = [
  'Agrale',
  'DAF',
  'Ford (apenas modelos usados)',
  'Foton',
  'Iveco',
  'JAC Motors',
  'Mercedes-Benz',
  'Scania',
  'Volkswagen (VWCO)',
  'Volvo',
] as const;

// Tipos de documento por seção
const TIPOS_PESSOAIS = ['cnh', 'foto_segurando_cnh', 'comprovante_endereco_motorista'];
const TIPOS_VEICULO = [
  'crlv_cavalo',
  'crlv_carreta_1',
  'crlv_carreta_2',
  'crlv_carreta_3',
  'crlv_carreta_4',
  'rntrc_cavalo',
  'rntrc_carreta_1',
  'rntrc_carreta_2',
  'foto_frente_caminhao',
  'foto_caminhao_completo',
];
const TIPOS_PROPRIETARIO = ['comprovante_endereco_proprietario', 'documento_proprietario'];
const TIPOS_CONTRATO = ['contrato_arrendamento'];

const CURRENT_YEAR = new Date().getFullYear();

type SecaoKey = 'dadosPessoais' | 'veiculo' | 'proprietario' | 'contrato';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type DocStatus = 'pendente' | 'aprovado' | 'rejeitado';

interface DocRecord {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  status?: DocStatus;
  rejectionReason?: string;
  url?: string;
}

interface SlotConfig {
  type: string;
  label: string;
  accept: string;
  note?: string;
  optional?: boolean;
}

interface ReferenciaLocal {
  id: string;
  companyName: string;
  phone: string;
  persisted: boolean;
  /** CT-e já salvo no storage (caminho + nome). */
  ctePath?: string | null;
  cteName?: string | null;
  /** URL assinada para pré-visualizar o CT-e já salvo. */
  cteUrl?: string | null;
  /** Arquivo de CT-e selecionado e ainda não enviado (sobe ao salvar). */
  ctePendingFile?: File | null;
}

// ─── Componente de Slot de Documento (com câmera ou arquivo) ────────────────

interface DocSlotProps {
  slot: SlotConfig;
  doc: DocRecord | undefined;
  uploading: boolean;
  onUpload: (type: string, file: File) => void;
  onDelete: (type: string) => void;
}

function DocSlot({ slot, doc, uploading, onUpload, onDelete }: DocSlotProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const status = doc?.status ?? (doc ? 'pendente' : undefined);
  const canDelete = doc && status !== 'aprovado';
  const allowsImage = slot.accept === IMG_ONLY || slot.accept === PDF_IMG;
  const allowsPdf = slot.accept === PDF_ONLY || slot.accept === PDF_IMG;

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpload(slot.type, file);
    e.target.value = '';
    setMenuOpen(false);
  };

  const statusBadge = (() => {
    if (!doc) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-400 text-white">
          Não enviado
        </span>
      );
    }
    if (status === 'aprovado') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-600 text-white">
          ✓ Doc. confirmado
        </span>
      );
    }
    if (status === 'rejeitado') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-600 text-white">
          Recusado
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600 text-white">
        Pendente
      </span>
    );
  })();

  return (
    <div className="flex items-start gap-2 p-2 bg-white border border-gray-200 rounded-md">
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-medium text-gray-800 leading-tight">
            {slot.label}
            {slot.optional && <span className="ml-1 text-[10px] text-gray-400">(opcional)</span>}
          </p>
          <div className="shrink-0">{statusBadge}</div>
        </div>
        {slot.note && <p className="text-[10px] text-gray-500 mt-0.5">{slot.note}</p>}
        {doc && (
          <p className="text-[10px] text-gray-400 truncate mt-0.5">
            {doc.fileName}
            {doc?.url && (
              <>
                {' · '}
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  ver
                </a>
              </>
            )}
            {canDelete && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => onDelete(slot.type)}
                  className="text-red-500 hover:text-red-700"
                >
                  deletar
                </button>
              </>
            )}
          </p>
        )}
        {doc?.status === 'rejeitado' && doc.rejectionReason && (
          <p className="text-[10px] text-red-600 mt-0.5">Motivo: {doc.rejectionReason}</p>
        )}
      </div>

      {status !== 'aprovado' && (
        <div className="relative shrink-0">
          {/* Inputs ocultos: câmera, galeria e PDF. */}
          {allowsImage && (
            <>
              <input
                ref={cameraRef}
                type="file"
                accept={IMG_ONLY}
                capture="environment"
                hidden
                disabled={uploading}
                onChange={handlePick}
              />
              <input
                ref={galleryRef}
                type="file"
                accept={IMG_ONLY}
                hidden
                disabled={uploading}
                onChange={handlePick}
              />
            </>
          )}
          {allowsPdf && (
            <input
              ref={pdfRef}
              type="file"
              accept={PDF_ONLY}
              hidden
              disabled={uploading}
              onChange={handlePick}
            />
          )}

          {/* Único botão: clipe. Abre o menuzinho de opções. */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={uploading}
            aria-label={doc ? 'Trocar arquivo' : 'Enviar arquivo'}
            title={doc ? 'Trocar arquivo' : 'Enviar arquivo'}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-7 h-7 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md disabled:opacity-50"
          >
            {uploading ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  opacity="0.25"
                />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            )}
          </button>

          {menuOpen && !uploading && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50"
              >
                {allowsImage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => cameraRef.current?.click()}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    Tirar uma foto
                  </button>
                )}
                {allowsImage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => galleryRef.current?.click()}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    Galeria de fotos
                  </button>
                )}
                {allowsPdf && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pdfRef.current?.click()}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <svg
                      className="w-4 h-4 text-red-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Enviar PDF
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bloco compacto da foto de perfil do motorista. Imagem redonda no
 * canto direito, com um botaozinho de "editar" sobreposto. Ao clicar,
 * abre um popover com as opcoes Camera / Galeria / Excluir foto.
 *
 * Substituiu o bloco antigo que ocupava muito espaco vertical com
 * texto explicativo + botao grande "Trocar foto".
 */
interface ProfilePhotoBlockProps {
  url: string | undefined;
  uploading: boolean;
  hasPhoto: boolean;
  onUpload: (file: File) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

function ProfilePhotoBlock({
  url,
  uploading,
  hasPhoto,
  onUpload,
  onDelete,
}: ProfilePhotoBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fecha o popover ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-photo-popover]')) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await onUpload(file);
    e.target.value = '';
    setMenuOpen(false);
  };

  return (
    <div className="relative shrink-0" data-photo-popover>
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-300">
        {url ? (
          <img
            src={url}
            alt="Foto"
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={uploading}
        aria-label="Editar foto de perfil"
        className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md flex items-center justify-center disabled:opacity-50 disabled:cursor-wait"
      >
        {uploading ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        )}
      </button>

      {/* Inputs ocultos */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={pick}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={pick}
      />

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Tirar foto
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {hasPhoto ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {hasPhoto && (
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                await onDelete();
              }}
              className="w-full px-3 py-2 text-xs text-left text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Excluir foto
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Controle de CT-e por referência ───────────────────────────────────────

/**
 * Selo + botão para anexar o CT-e (PDF ou imagem) de uma referência.
 * Mostra o nome do arquivo e link "ver" quando há CT-e (salvo ou recém
 * escolhido), além de permitir trocar/remover.
 */
function ReferenceCteControl({
  cteName,
  cteUrl,
  onPick,
  onClear,
}: {
  cteName?: string | null;
  cteUrl?: string | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasCte = !!cteName;
  return (
    <div className="flex items-center gap-2 pt-1.5 border-t border-gray-200">
      <input
        ref={inputRef}
        type="file"
        accept={PDF_IMG}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[11px] font-medium hover:bg-blue-100"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
          />
        </svg>
        {hasCte ? 'Trocar CT-e' : 'Anexar CT-e (PDF ou foto)'}
      </button>
      {hasCte && (
        <span className="flex items-center gap-1.5 min-w-0 text-[10px] text-gray-500">
          {cteUrl ? (
            <a
              href={cteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate max-w-[120px]"
            >
              {cteName}
            </a>
          ) : (
            <span className="truncate max-w-[120px]">{cteName}</span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="text-red-500 hover:text-red-700"
            title="Remover CT-e"
          >
            remover
          </button>
        </span>
      )}
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

/**
 * Botão "+" para adicionar um novo contrato de arrendamento (PDF ou imagem).
 */
function ContratoAddButton({
  uploading,
  onPick,
}: {
  uploading: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={PDF_IMG}
        hidden
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label="Adicionar contrato"
        title="Adicionar contrato"
        className="w-7 h-7 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-sm disabled:opacity-50"
      >
        {uploading ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
        )}
      </button>
    </>
  );
}

/**
 * Bloco de endereco colapsavel: quando ja preenchido, mostra so o resumo
 * em uma linha + botoes "Editar" e "Excluir". Em modo edicao (ou quando
 * vazio) mostra os 7 campos (CEP, logradouro, numero, complemento,
 * bairro, cidade, UF) em grid compacto.
 *
 * Reduz o espaco vertical do perfil em quase 200px na maioria dos casos.
 */
interface AddressBlockProps {
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  uf: string;
  cepLoading: boolean;
  cepError: string | null;
  fieldErrorUf: string | undefined;
  onCepChange: (v: string) => void;
  onStreetChange: (v: string) => void;
  onNumberChange: (v: string) => void;
  onComplementChange: (v: string) => void;
  onNeighborhoodChange: (v: string) => void;
  onCityChange: (v: string) => void;
  onUfChange: (v: string) => void;
  onClear: () => void;
}

function AddressBlock(props: AddressBlockProps) {
  const {
    cep,
    street,
    number,
    complement,
    neighborhood,
    city,
    uf,
    cepLoading,
    cepError,
    fieldErrorUf,
  } = props;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-700">Endereço</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-1">
          <label className="block text-[10px] text-gray-600 mb-0.5">CEP</label>
          <input
            type="text"
            value={formatCep(cep)}
            onChange={(e) => props.onCepChange(sanitizeCep(e.target.value))}
            placeholder="00000-000"
            maxLength={9}
            inputMode="numeric"
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="col-span-1 sm:col-span-3">
          <label className="block text-[10px] text-gray-600 mb-0.5">Logradouro</label>
          <input
            type="text"
            value={street}
            onChange={(e) => props.onStreetChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-600 mb-0.5">Número</label>
          <input
            type="text"
            value={number}
            onChange={(e) => props.onNumberChange(e.target.value)}
            maxLength={10}
            placeholder="123"
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] text-gray-600 mb-0.5">Complemento</label>
          <input
            type="text"
            value={complement}
            onChange={(e) => props.onComplementChange(e.target.value)}
            placeholder="Apto 101"
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-600 mb-0.5">Bairro</label>
          <input
            type="text"
            value={neighborhood}
            onChange={(e) => props.onNeighborhoodChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="col-span-1 sm:col-span-3">
          <label className="block text-[10px] text-gray-600 mb-0.5">Cidade</label>
          <input
            type="text"
            value={city}
            onChange={(e) => props.onCityChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-600 mb-0.5">UF</label>
          <input
            type="text"
            value={uf}
            onChange={(e) => props.onUfChange(e.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
            placeholder="GO"
            data-error={fieldErrorUf ? 'true' : undefined}
            className={`w-full px-2 py-1.5 bg-white border rounded-md text-gray-800 text-sm uppercase focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              fieldErrorUf ? 'border-red-400' : 'border-gray-300'
            }`}
          />
        </div>
      </div>
      {cepLoading && (
        <p className="mt-1 text-[10px] text-gray-500">Buscando endereço pelo CEP...</p>
      )}
      {cepError && <p className="mt-1 text-[10px] text-red-600">{cepError}</p>}
      {fieldErrorUf && <p className="mt-1 text-[10px] text-red-600">{fieldErrorUf}</p>}
    </div>
  );
}

/**
 * Barra superior compacta usada na pagina de perfil. Substitui o
 * `AppHeader` global (sino, localizacao, navegacao) por uma barra
 * minimalista no estilo "back + titulo" para liberar espaco vertical
 * em telas pequenas.
 */
function ProfileTopBar({
  onBack,
  onSave,
  saveDisabled,
  saving,
}: {
  onBack: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
}) {
  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 -ml-1 px-1.5 py-1.5 text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span className="text-[11px] sm:text-xs">Voltar</span>
        </button>
        <div className="flex-1" />
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            className="px-4 py-1.5 bg-blue-600 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        )}
      </div>
    </div>
  );
}

export type MotoristaPerfilView =
  | 'all'
  | 'perfil'
  | 'veiculo'
  | 'tracao'
  | 'carroceria'
  | 'complemento'
  | 'referencias'
  | 'contrato';

interface MotoristaPerfilPageProps {
  view?: MotoristaPerfilView;
}

const VIEW_TITLES: Record<MotoristaPerfilView, string> = {
  all: 'Perfil do Motorista',
  perfil: 'Meu Perfil',
  veiculo: 'Veículo',
  tracao: 'Tração (cavalo)',
  carroceria: 'Carroceria',
  complemento: 'Complemento do Veículo',
  referencias: 'Referências',
  contrato: 'Contrato',
};

export default function MotoristaPerfilPage({ view = 'all' }: MotoristaPerfilPageProps = {}) {
  useDocumentTitle(VIEW_TITLES[view]);
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isLoading, setIsLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);

  // === Dados pessoais ========================================================
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailVerifiedAtServer, setEmailVerifiedAtServer] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [emailRateLimitedUntil, setEmailRateLimitedUntil] = useState<number | null>(null);
  const [cpf, setCpf] = useState('');
  const [rgNumber, setRgNumber] = useState('');
  const [pis, setPis] = useState('');

  // === Endereço (Migration 018) =============================================
  const [addressCep, setAddressCep] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [addressNeighborhood, setAddressNeighborhood] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressUf, setAddressUf] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const lastCepRef = useRef<string>('');
  const cepReqIdRef = useRef(0);

  // === Referências profissionais ============================================
  const [references, setReferences] = useState<ReferenciaLocal[]>([]);

  // === Veículo ==============================================================
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleTypePickerOpen, setVehicleTypePickerOpen] = useState(false);
  const [bodyType, setBodyType] = useState('');
  const [bodyTypePickerOpen, setBodyTypePickerOpen] = useState(false);
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModelSelect, setVehicleModelSelect] = useState('');
  const [vehicleYearManufacture, setVehicleYearManufacture] = useState('');
  const [vehicleYearModel, setVehicleYearModel] = useState('');
  const [kmPerLiter, setKmPerLiter] = useState('');
  const [trailerAxles, setTrailerAxles] = useState('');
  const [cargoCapacityTon, setCargoCapacityTon] = useState('');
  const [grossWeightTon, setGrossWeightTon] = useState('');
  const [tareWeightTon, setTareWeightTon] = useState('');
  const [dieselPrice, setDieselPrice] = useState('');

  // === Proprietário =========================================================
  const [isNotOwner, setIsNotOwner] = useState(false);
  const [ownerCnpj, setOwnerCnpj] = useState('');
  const [ownerCompanyName, setOwnerCompanyName] = useState('');
  const [ownerPisNumber, setOwnerPisNumber] = useState('');
  const [ownerIsDriver, setOwnerIsDriver] = useState(false);

  // === Tipo de RNTRC (Migration 022) ========================================
  const [rntrcType, setRntrcType] = useState<'fisica' | 'juridica' | ''>('');
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const lastCnpjRef = useRef<string>('');
  const cnpjReqIdRef = useRef(0);

  // === Documentos ===========================================================
  const [documents, setDocuments] = useState<Record<string, DocRecord>>({});
  // Contratos de arrendamento: lista (o motorista pode ter vários — uma carreta
  // arrendada, um dolly de terceiro, etc). Diferente dos demais docs (1 por tipo).
  const [contratoDocs, setContratoDocs] = useState<DocRecord[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  // Quantas carretas estão visíveis na Carroceria (1..4). Começa em 1 e o
  // motorista adiciona/remove uma de cada vez.
  const [carretaCount, setCarretaCount] = useState(1);

  // === Erros por campo ======================================================
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // === Estado dirty/saving/feedback por seção ==============================
  const [dirty, setDirty] = useState<Record<SecaoKey, boolean>>({
    dadosPessoais: false,
    veiculo: false,
    proprietario: false,
    contrato: false,
  });
  const [saving, setSaving] = useState<Record<SecaoKey, boolean>>({
    dadosPessoais: false,
    veiculo: false,
    proprietario: false,
    contrato: false,
  });
  const [sectionFeedback, setSectionFeedback] = useState<
    Record<SecaoKey, { type: 'success' | 'error'; msg: string } | null>
  >({
    dadosPessoais: null,
    veiculo: null,
    proprietario: null,
    contrato: null,
  });

  const markDirty = (s: SecaoKey) => setDirty((p) => ({ ...p, [s]: true }));
  const setSecaoFeedback = (s: SecaoKey, fb: { type: 'success' | 'error'; msg: string } | null) =>
    setSectionFeedback((p) => ({ ...p, [s]: fb }));

  const emailDirty =
    emailInput.trim() !== '' && emailInput.trim() !== (emailVerifiedAtServer ?? '');
  const emailVerifiedNow =
    emailInput.trim() === (emailVerifiedAtServer ?? '') && emailInput.trim() !== '';

  // ─── Carregamento inicial ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      const [userData, profile, { data: rawDocs }, verifStatus, pisRow, refsList] =
        await Promise.all([
          getUserData(user.id),
          getMotoristaProfile(user.id).catch(() => null),
          supabase
            .from('documents')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          getVerificationStatus().catch(() => ({ emailVerified: false })),
          (async () => {
            try {
              const r = await supabase
                .from('motorista_pis')
                .select('pis_number')
                .eq('user_id', user.id)
                .maybeSingle();
              return r.data;
            } catch {
              return null;
            }
          })(),
          getMotoristaReferences(user.id).catch(() => []),
        ]);

      setName(userData.name ? capitalizeName(userData.name) : '');
      setPhone(userData.phone ? formatPhoneBR(userData.phone) : '');
      setEmailInput(userData.email || '');
      setEmailVerifiedAtServer(verifStatus.emailVerified ? userData.email || '' : null);
      setCpf(userData.cpf || '');
      setPis(pisRow?.pis_number ?? '');

      if (profile) {
        setVehicleType(profile.vehicleType || '');
        setBodyType(profile.bodyType || '');
        setVehiclePlate(profile.vehiclePlate || '');
        if (profile.vehicleModel) {
          if ((MODELOS_CAMINHAO as readonly string[]).includes(profile.vehicleModel)) {
            setVehicleModelSelect(profile.vehicleModel);
          } else {
            // Modelo legado fora da lista atual: limpa para forcar nova
            // escolha entre os fabricantes canonicos.
            setVehicleModelSelect('');
          }
        }
        setVehicleYearManufacture(
          profile.vehicleYearManufacture?.toString() ?? profile.vehicleYear?.toString() ?? ''
        );
        setVehicleYearModel(profile.vehicleYearModel?.toString() ?? '');
        setKmPerLiter(numberToMasked(profile.kmPerLiter ?? null, 1));
        setTrailerAxles(profile.trailerAxles?.toString() ?? '');
        setCargoCapacityTon(numberToMasked(profile.cargoCapacityTon ?? null, 3));
        setGrossWeightTon(numberToMasked(profile.grossWeightTon ?? null, 3));
        setTareWeightTon(numberToMasked(profile.tareWeightTon ?? null, 3));
        setDieselPrice(numberToMasked(profile.dieselPrice ?? null, 2));
        setIsNotOwner(profile.isOwner === false);

        // Migration 018: endereço, RG, owner_*
        setAddressCep(profile.addressCep ?? '');
        lastCepRef.current = sanitizeCep(profile.addressCep ?? '');
        setAddressStreet(profile.addressStreet ?? '');
        setAddressNumber(profile.addressNumber ?? '');
        setAddressComplement(profile.addressComplement ?? '');
        setAddressNeighborhood(profile.addressNeighborhood ?? '');
        setAddressCity(profile.addressCity ?? '');
        setAddressUf(profile.addressUf ?? '');
        setRgNumber(profile.rgNumber ?? '');
        setOwnerCnpj(profile.ownerCnpj ?? '');
        lastCnpjRef.current = sanitizeCnpj(profile.ownerCnpj ?? '');
        setOwnerCompanyName(profile.ownerCompanyName ?? '');
        setOwnerPisNumber(profile.ownerPisNumber ?? '');
        setOwnerIsDriver(profile.ownerIsDriver ?? false);
        setRntrcType((profile.rntrcType as 'fisica' | 'juridica') ?? '');
      }

      setReferences(
        refsList.map((r) => ({
          id: r.id,
          companyName: r.companyName,
          phone: r.phone,
          persisted: true,
          ctePath: r.ctePath ?? null,
          cteName: r.cteName ?? null,
          cteUrl: null,
          ctePendingFile: null,
        }))
      );
      // Gera as URLs assinadas dos CT-e já salvos (em paralelo, sem travar o load).
      void (async () => {
        const withCte = refsList.filter((r) => r.ctePath);
        if (withCte.length === 0) return;
        const urls = await Promise.all(
          withCte.map(
            async (r) => [r.id, await getDocumentSignedUrlByPath(r.ctePath as string)] as const
          )
        );
        const urlById = new Map(urls);
        setReferences((prev) =>
          prev.map((ref) =>
            urlById.has(ref.id) ? { ...ref, cteUrl: urlById.get(ref.id) ?? null } : ref
          )
        );
      })();

      if (rawDocs) {
        const docsMap: Record<string, DocRecord> = {};
        const contratoList: DocRecord[] = [];
        for (const d of rawDocs) {
          // Contratos de arrendamento: coleta TODOS (lista, não 1 por tipo).
          if (d.document_type === 'contrato_arrendamento') {
            contratoList.push({
              id: d.id,
              documentType: d.document_type,
              fileName: d.file_name,
              fileSize: d.file_size,
              mimeType: d.mime_type,
              uploadedAt: new Date(d.created_at),
              status: d.status ?? 'pendente',
              rejectionReason: d.rejection_reason ?? undefined,
            });
            continue;
          }
          if (!docsMap[d.document_type]) {
            docsMap[d.document_type] = {
              id: d.id,
              documentType: d.document_type,
              fileName: d.file_name,
              fileSize: d.file_size,
              mimeType: d.mime_type,
              uploadedAt: new Date(d.created_at),
              status: d.status ?? 'pendente',
              rejectionReason: d.rejection_reason ?? undefined,
            };
          }
        }

        const urlEntries = await Promise.all(
          Object.entries(docsMap).map(async ([type, doc]) => {
            try {
              const url = await getSignedUrl(doc.id);
              return [type, url] as [string, string];
            } catch {
              return [type, undefined] as [string, undefined];
            }
          })
        );
        for (const [type, url] of urlEntries) {
          if (url) docsMap[type].url = url;
        }

        setDocuments(docsMap);

        // URLs assinadas dos contratos (lista).
        const contratoWithUrls = await Promise.all(
          contratoList.map(async (doc) => {
            try {
              return { ...doc, url: await getSignedUrl(doc.id) };
            } catch {
              return doc;
            }
          })
        );
        setContratoDocs(contratoWithUrls);

        // Define quantas carretas exibir com base nos documentos já enviados.
        let maxCarreta = 1;
        for (let n = 4; n >= 2; n--) {
          if (docsMap[`crlv_carreta_${n}`] || docsMap[`rntrc_carreta_${n}`]) {
            maxCarreta = n;
            break;
          }
        }
        setCarretaCount(maxCarreta);
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    loadAll();
    // Só recarrega quando troca o usuário (id), não a cada refreshUser()
    // (ex: upload de foto) — senão limpa os campos não salvos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ─── Scroll para a seção via hash (#veiculo, #dados-pessoais...) ─────────
  // Usado pelo MotoristaMenuSheet, que navega com hash pra abrir a página
  // já posicionada na seção certa. Espera o paint inicial (loadAll resolveu
  // ou não) pra garantir que o nó do <section id="..."> exista.
  useEffect(() => {
    if (isLoading) return;
    const hash = location.hash.replace('#', '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    // Pequeno timeout pra dar tempo do layout estabilizar (imagens, pickers).
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [isLoading, location.hash]);

  // ─── Lookup automático de CEP ────────────────────────────────────────────
  useEffect(() => {
    const digits = sanitizeCep(addressCep);
    if (digits.length !== 8) {
      setCepError(null);
      return;
    }
    if (digits === lastCepRef.current) return;
    lastCepRef.current = digits;

    const myReq = ++cepReqIdRef.current;
    setCepLoading(true);
    setCepError(null);
    (async () => {
      try {
        const data = await lookupCep(digits);
        if (myReq !== cepReqIdRef.current) return;
        setAddressStreet(data.logradouro);
        setAddressNeighborhood(data.bairro);
        setAddressCity(data.localidade);
        setAddressUf(data.uf);
      } catch (err) {
        if (myReq !== cepReqIdRef.current) return;
        if (err instanceof CepLookupError && err.code === 'NOT_FOUND') {
          setCepError('CEP não encontrado. Verifique o número digitado.');
        } else if (err instanceof CepLookupError && err.code === 'NETWORK') {
          setCepError('Não foi possível consultar o CEP agora. Tente novamente.');
        } else {
          setCepError('Erro ao consultar CEP.');
        }
      } finally {
        if (myReq === cepReqIdRef.current) setCepLoading(false);
      }
    })();
  }, [addressCep]);

  // ─── Lookup automático de CNPJ do proprietário ───────────────────────────
  useEffect(() => {
    const digits = sanitizeCnpj(ownerCnpj);
    if (digits.length !== 14) {
      setCnpjError(null);
      return;
    }
    if (digits === lastCnpjRef.current) return;
    lastCnpjRef.current = digits;

    const myReq = ++cnpjReqIdRef.current;
    setCnpjLoading(true);
    setCnpjError(null);
    (async () => {
      try {
        const data = await lookupCnpj(digits);
        if (myReq !== cnpjReqIdRef.current) return;
        setOwnerCompanyName(data.razaoSocial || data.nomeFantasia || '');
      } catch (err) {
        if (myReq !== cnpjReqIdRef.current) return;
        if (err instanceof CnpjLookupError && err.code === 'NOT_FOUND') {
          setCnpjError('CNPJ não encontrado.');
        } else if (err instanceof CnpjLookupError && err.code === 'NETWORK') {
          setCnpjError('Não foi possível consultar o CNPJ agora. Tente novamente.');
        } else {
          setCnpjError('Erro ao consultar CNPJ.');
        }
      } finally {
        if (myReq === cnpjReqIdRef.current) setCnpjLoading(false);
      }
    })();
  }, [ownerCnpj]);

  // ─── Handlers de e-mail ─────────────────────────────────────────────────
  const handleSendEmailCode = async () => {
    setTopError(null);
    if (!emailInput || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) {
      setFieldErrors((p) => ({ ...p, email: 'Informe um e-mail válido.' }));
      return;
    }
    if (emailRateLimitedUntil && Date.now() < emailRateLimitedUntil) return;

    setSendingCode(true);
    try {
      await sendEmailVerificationCode(emailInput);
      setShowEmailModal(true);
    } catch (err) {
      if (err instanceof VerificationError && err.code === 'RATE_LIMITED') {
        setEmailRateLimitedUntil(Date.now() + 60_000);
        setFieldErrors((p) => ({
          ...p,
          email: 'Muitas tentativas. Tente novamente em algumas horas.',
        }));
      } else {
        setFieldErrors((p) => ({
          ...p,
          email: err instanceof Error ? err.message : 'Erro ao enviar código',
        }));
      }
    } finally {
      setSendingCode(false);
    }
  };

  const handleEmailVerified = async (verifiedEmail: string) => {
    setShowEmailModal(false);
    setEmailVerifiedAtServer(verifiedEmail);
    setSecaoFeedback('dadosPessoais', { type: 'success', msg: 'E-mail confirmado!' });
    setTimeout(() => setSecaoFeedback('dadosPessoais', null), 3000);
    await refreshUser();
  };

  // ─── Handlers de upload de documento ────────────────────────────────────
  const handleDocUpload = async (docType: string, file: File) => {
    if (!user) return;

    if (!validateDocumentType(docType)) {
      setTopError(`Tipo de documento inválido: "${docType}".`);
      return;
    }

    // Validação extra: contrato_arrendamento somente PDF
    if (docType === 'contrato_arrendamento' && file.type !== 'application/pdf') {
      setTopError('Apenas arquivos PDF são aceitos para o contrato de arrendamento.');
      return;
    }

    if (file.size > MAX_SIZE) {
      setTopError('Arquivo muito grande. Máximo permitido: 5MB.');
      return;
    }

    setUploadingDoc(docType);
    setTopError(null);
    try {
      const existing = documents[docType];
      // Mantém histórico: documentos RECUSADOS nunca são apagados (evidência
      // para o admin). Só substituímos um envio ainda 'pendente' (reenvio
      // antes de revisão) para não acumular duplicado sem revisão.
      if (existing && existing.status === 'pendente') {
        await deleteDocument(existing.id);
      }
      const doc = await uploadDocument(user.id, docType, file);
      let url: string | undefined;
      try {
        url = await getSignedUrl(doc.id);
      } catch {
        // ignore
      }
      setDocuments((prev) => ({
        ...prev,
        [docType]: {
          id: doc.id,
          documentType: docType,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          uploadedAt: doc.uploadedAt,
          // Status real definido pelo servidor (trigger 072): 'aprovado' no 1º
          // envio, 'pendente' quando já houve recusa anterior.
          status: doc.status ?? 'aprovado',
          url,
        },
      }));
      // Marca dirty na seção correspondente
      if (TIPOS_PESSOAIS.includes(docType)) markDirty('dadosPessoais');
      else if (TIPOS_VEICULO.includes(docType)) markDirty('veiculo');
      else if (TIPOS_PROPRIETARIO.includes(docType)) markDirty('proprietario');
      else if (TIPOS_CONTRATO.includes(docType)) markDirty('contrato');
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleDocDelete = async (docType: string) => {
    const doc = documents[docType];
    if (!doc || doc.status === 'aprovado') return;
    if (!confirm('Deletar este documento?')) return;
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => {
        const n = { ...prev };
        delete n[docType];
        return n;
      });
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  // ─── Handlers de contratos de arrendamento (lista) ───────────────────────
  // O motorista pode ter VÁRIOS contratos (uma carreta arrendada, um dolly de
  // terceiro, etc). Cada upload cria uma nova linha 'contrato_arrendamento'.
  const handleContratoAdd = async (file: File) => {
    if (!user) return;
    const isPdf = file.type === 'application/pdf';
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg) {
      setTopError('O contrato deve ser um PDF ou uma imagem.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setTopError('Arquivo muito grande. Máximo permitido: 5MB.');
      return;
    }
    setUploadingDoc('contrato_arrendamento');
    setTopError(null);
    try {
      const doc = await uploadDocument(user.id, 'contrato_arrendamento', file);
      let url: string | undefined;
      try {
        url = await getSignedUrl(doc.id);
      } catch {
        // ignore
      }
      setContratoDocs((prev) => [
        ...prev,
        {
          id: doc.id,
          documentType: 'contrato_arrendamento',
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          uploadedAt: doc.uploadedAt,
          status: doc.status ?? 'aprovado',
          url,
        },
      ]);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleContratoDelete = async (docId: string) => {
    const doc = contratoDocs.find((d) => d.id === docId);
    if (!doc || doc.status === 'aprovado') return;
    if (!confirm('Deletar este contrato?')) return;
    try {
      await deleteDocument(doc.id);
      setContratoDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  // ─── Handlers de referências ────────────────────────────────────────────
  const addReference = () => {
    setReferences((prev) => [
      ...prev,
      {
        id: `tmp_${Date.now()}_${prev.length}`,
        companyName: '',
        phone: '',
        persisted: false,
        ctePath: null,
        cteName: null,
        cteUrl: null,
        ctePendingFile: null,
      },
    ]);
    markDirty('dadosPessoais');
  };
  const updateReference = (id: string, patch: Partial<ReferenciaLocal>) => {
    setReferences((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markDirty('dadosPessoais');
  };
  const removeReference = (id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
    markDirty('dadosPessoais');
  };
  /** Seleciona um arquivo de CT-e (PDF ou imagem) para uma referência. */
  const pickReferenceCte = (id: string, file: File) => {
    if (file.size > MAX_SIZE) {
      setTopError('Arquivo muito grande. Máximo permitido: 5MB.');
      return;
    }
    const isPdf = file.type === 'application/pdf';
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg) {
      setTopError('O CT-e deve ser um PDF ou uma imagem.');
      return;
    }
    // Prévia local imediata (objeto URL) até salvar e gerar a signed URL.
    const localUrl = URL.createObjectURL(file);
    updateReference(id, { ctePendingFile: file, cteName: file.name, cteUrl: localUrl });
  };

  // ─── Handler "Sou eu o proprietário" ────────────────────────────────────
  const handleSouEuProprietario = () => {
    // Marca a flag e mantém os campos editáveis. Os dados de
    // identidade pessoal (CPF/RG/PIS/endereço) já moram em "Dados
    // Pessoais"; aqui apenas marcamos `owner_is_driver = true`
    // para o admin saber que é o mesmo. Também limpamos o CNPJ
    // (caso estivesse preenchido, deixa de fazer sentido).
    setOwnerIsDriver(true);
    setOwnerCnpj('');
    setOwnerCompanyName('');
    setOwnerPisNumber('');
    markDirty('proprietario');
  };

  // Após salvar com sucesso numa sub-tela (perfil/tracao/etc), volta ao menu
  // do motorista — comportamento pedido pelo produto.
  const redirectToMenuIfSubview = () => {
    if (view !== 'all') {
      setTimeout(() => navigate('/motorista/menu'), 600);
    }
  };

  // ─── Save Dados Pessoais ────────────────────────────────────────────────
  const handleSaveDadosPessoais = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) errs.name = 'Informe seu nome completo';
    if (emailDirty) errs.email = 'Verifique o novo e-mail antes de salvar';
    if (phone.trim() && !isValidPhoneBR(phone)) errs.phone = 'Telefone inválido (10 ou 11 dígitos)';
    if (pis && pis.length !== 11) errs.pis = 'PIS deve ter exatamente 11 dígitos';
    if (addressUf && !/^[A-Z]{2}$/.test(addressUf)) errs.addressUf = 'UF deve ter 2 letras';

    // Validação cruzada de referências
    references.forEach((r) => {
      const nameFilled = r.companyName.trim() !== '';
      const phoneDigits = sanitizePhone(r.phone);
      const phoneFilled = phoneDigits.length > 0;
      if (nameFilled && !isValidPhoneBR(r.phone)) {
        errs[`ref_${r.id}_phone`] = 'Telefone inválido (use 10 ou 11 dígitos)';
      }
      if (phoneFilled && !nameFilled) {
        errs[`ref_${r.id}_name`] = 'Informe o nome da empresa';
      }
    });

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('dadosPessoais', {
        type: 'error',
        msg: 'Verifique os campos destacados.',
      });
      const first = document.querySelector<HTMLElement>('[data-error="true"]');
      first?.focus();
      return;
    }

    setSaving((p) => ({ ...p, dadosPessoais: true }));
    try {
      await updateMotoristaProfile(user.id, {
        name: trimmedName,
        phone: sanitizePhone(phone) || undefined,
        cpf: cpf || undefined,
        rgNumber: rgNumber || undefined,
        addressCep: sanitizeCep(addressCep) || undefined,
        addressStreet: addressStreet || undefined,
        addressNumber: addressNumber || undefined,
        addressComplement: addressComplement || undefined,
        addressNeighborhood: addressNeighborhood || undefined,
        addressCity: addressCity || undefined,
        addressUf: addressUf || undefined,
      });

      if (pis && pis.length === 11) {
        await supabase
          .from('motorista_pis')
          .upsert({ user_id: user.id, pis_number: pis }, { onConflict: 'user_id' });
      }

      // Sobe os CT-e pendentes (novos arquivos) antes de regravar as referências.
      const refsToSave: {
        companyName: string;
        phone: string;
        ctePath?: string | null;
        cteName?: string | null;
      }[] = [];
      for (const r of references) {
        let ctePath = r.ctePath ?? null;
        let cteName = r.cteName ?? null;
        if (r.ctePendingFile) {
          const up = await uploadReferenceCte(user.id, r.ctePendingFile);
          ctePath = up.path;
          cteName = up.name;
        }
        refsToSave.push({
          companyName: r.companyName,
          phone: sanitizePhone(r.phone),
          ctePath,
          cteName,
        });
      }
      // Replace-all de referências (filtra vazias dentro do service)
      await replaceMotoristaReferences(user.id, refsToSave);

      setDirty((p) => ({ ...p, dadosPessoais: false }));
      setSecaoFeedback('dadosPessoais', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('dadosPessoais', null), 3000);
      redirectToMenuIfSubview();
    } catch (err) {
      setSecaoFeedback('dadosPessoais', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, dadosPessoais: false }));
    }
  };

  // ─── Save Veículo ───────────────────────────────────────────────────────
  const handleSaveVeiculo = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    if (vehiclePlate && !isValidMercosulPlate(vehiclePlate)) {
      errs.plate = 'Placa inválida. Formato esperado: ABC1D23';
    }
    const yearFab = vehicleYearManufacture ? parseInt(vehicleYearManufacture) : undefined;
    const yearMod = vehicleYearModel ? parseInt(vehicleYearModel) : undefined;
    if (yearFab !== undefined && (yearFab < 1980 || yearFab > CURRENT_YEAR + 1)) {
      errs.yearManufacture = 'Ano de fabricação fora do intervalo permitido';
    }
    if (yearMod !== undefined && (yearMod < 1980 || yearMod > CURRENT_YEAR + 2)) {
      errs.yearModel = 'Ano modelo fora do intervalo permitido';
    }
    if (yearFab !== undefined && yearMod !== undefined && yearMod < yearFab) {
      errs.yearModel = 'Ano modelo deve ser maior ou igual ao ano de fabricação';
    }
    if (kmPerLiter) {
      const v = maskedToNumber(kmPerLiter, 1);
      if (Number.isNaN(v) || v < 1 || v > 10) {
        errs.kmPerLiter = 'Valor fora do intervalo permitido (1,0 a 10,0)';
      }
    }
    if (trailerAxles && (parseInt(trailerAxles) < 2 || parseInt(trailerAxles) > 9)) {
      errs.trailerAxles = 'Valor fora do intervalo permitido (2 a 9)';
    }
    if (cargoCapacityTon) {
      const v = maskedToNumber(cargoCapacityTon, 3);
      if (Number.isNaN(v) || v < 1 || v > 80) {
        errs.cargoCapacityTon = 'Valor fora do intervalo permitido (1,000 a 80,000)';
      }
    }
    if (grossWeightTon) {
      const v = maskedToNumber(grossWeightTon, 3);
      if (Number.isNaN(v) || v < 1 || v > 100) {
        errs.grossWeightTon = 'Peso bruto fora do intervalo (1,000 a 100,000 t)';
      }
    }
    if (tareWeightTon) {
      const v = maskedToNumber(tareWeightTon, 3);
      if (Number.isNaN(v) || v < 0.5 || v > 50) {
        errs.tareWeightTon = 'Tara fora do intervalo (0,500 a 50,000 t)';
      }
    }
    if (grossWeightTon && tareWeightTon) {
      const bruto = maskedToNumber(grossWeightTon, 3);
      const tara = maskedToNumber(tareWeightTon, 3);
      if (!Number.isNaN(bruto) && !Number.isNaN(tara) && tara >= bruto) {
        errs.tareWeightTon = 'A tara deve ser menor que o peso bruto';
      }
    }
    if (dieselPrice) {
      const v = maskedToNumber(dieselPrice, 2);
      if (Number.isNaN(v) || v < 1 || v > 20) {
        errs.dieselPrice = 'Valor fora do intervalo permitido (R$ 1,00 a R$ 20,00)';
      }
    }

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('veiculo', { type: 'error', msg: 'Verifique os campos destacados.' });
      return;
    }

    setSaving((p) => ({ ...p, veiculo: true }));
    try {
      const finalModel = vehicleModelSelect;

      await updateMotoristaProfile(user.id, {
        vehicleType: vehicleType || undefined,
        bodyType: bodyType || undefined,
        vehiclePlate: vehiclePlate || undefined,
        vehicleModel: finalModel || undefined,
        vehicleYearManufacture: yearFab,
        vehicleYearModel: yearMod,
        kmPerLiter: kmPerLiter ? maskedToNumber(kmPerLiter, 1) : undefined,
        trailerAxles: trailerAxles ? parseInt(trailerAxles) : undefined,
        cargoCapacityTon: cargoCapacityTon ? maskedToNumber(cargoCapacityTon, 3) : undefined,
        grossWeightTon: grossWeightTon ? maskedToNumber(grossWeightTon, 3) : undefined,
        tareWeightTon: tareWeightTon ? maskedToNumber(tareWeightTon, 3) : undefined,
        dieselPrice: dieselPrice ? maskedToNumber(dieselPrice, 2) : undefined,
        isOwner: !isNotOwner,
        rntrcType: rntrcType || undefined,
      });

      setDirty((p) => ({ ...p, veiculo: false }));
      setSecaoFeedback('veiculo', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('veiculo', null), 3000);
      redirectToMenuIfSubview();
    } catch (err) {
      setSecaoFeedback('veiculo', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, veiculo: false }));
    }
  };

  // ─── Save Proprietário ──────────────────────────────────────────────────
  const handleSaveProprietario = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    if (ownerPisNumber && ownerPisNumber.length !== 11) {
      errs.ownerPis = 'PIS deve ter exatamente 11 dígitos';
    }

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('proprietario', {
        type: 'error',
        msg: 'Verifique os campos destacados.',
      });
      return;
    }

    setSaving((p) => ({ ...p, proprietario: true }));
    try {
      await updateMotoristaProfile(user.id, {
        ownerCnpj: sanitizeCnpj(ownerCnpj) || undefined,
        ownerCompanyName: ownerCompanyName || undefined,
        ownerPisNumber: ownerPisNumber || undefined,
        ownerIsDriver: ownerIsDriver,
      });
      setDirty((p) => ({ ...p, proprietario: false }));
      setSecaoFeedback('proprietario', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('proprietario', null), 3000);
    } catch (err) {
      setSecaoFeedback('proprietario', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, proprietario: false }));
    }
  };

  // ─── Save Contrato (apenas reseta dirty) ────────────────────────────────
  const handleSaveContrato = () => {
    setDirty((p) => ({ ...p, contrato: false }));
    setSecaoFeedback('contrato', { type: 'success', msg: 'Seção salva.' });
    setTimeout(() => setSecaoFeedback('contrato', null), 3000);
    redirectToMenuIfSubview();
  };

  // ─── Helper de rodapé "Salvar" por seção ────────────────────────────────
  // Em sub-telas (perfil/tracao/etc) o botão Salvar vive no topo (ProfileTopBar),
  // então aqui mostramos só o feedback. Na view 'all' mantém o botão no rodapé.
  const SectionFooter = ({ section, onSave }: { section: SecaoKey; onSave: () => void }) => {
    const fb = sectionFeedback[section];
    const showButton = view === 'all';
    return (
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        {fb ? (
          <span
            className={`text-[11px] px-2 py-1 rounded ${
              fb.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {fb.msg}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">
            {dirty[section] ? 'Há alterações não salvas' : '—'}
          </span>
        )}
        {showButton && (
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty[section] || saving[section]}
            className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving[section] ? 'Salvando...' : 'Salvar'}
          </button>
        )}
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Mapeia a view atual para a seção/salvamento correspondente, para o botão
  // "Salvar" do topo (fora do formulário) e o redirect ao menu após salvar.
  const viewSaveMap: Partial<Record<MotoristaPerfilView, { section: SecaoKey; save: () => void }>> =
    {
      perfil: { section: 'dadosPessoais', save: handleSaveDadosPessoais },
      referencias: { section: 'dadosPessoais', save: handleSaveDadosPessoais },
      tracao: { section: 'veiculo', save: handleSaveVeiculo },
      carroceria: { section: 'veiculo', save: handleSaveVeiculo },
      complemento: { section: 'veiculo', save: handleSaveVeiculo },
      contrato: { section: 'contrato', save: handleSaveContrato },
    };
  const currentSave = view !== 'all' ? viewSaveMap[view] : undefined;

  // Voltar das sub-telas (perfil/tracao/etc): se o motorista preencheu algo e
  // nao clicou em Salvar, auto-salva antes de sair (o proprio save redireciona
  // ao menu no sucesso). Sem mudancas, vai direto pro menu. Na view 'all',
  // mantem o voltar padrao do historico.
  const handleBack = () => {
    if (view !== 'all') {
      if (currentSave && dirty[currentSave.section]) {
        currentSave.save();
        return;
      }
      navigate('/motorista/menu');
      return;
    }
    navigate(-1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <ProfileTopBar onBack={handleBack} />
        <div className="flex justify-center py-20 text-gray-600">Carregando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ProfileTopBar
        onBack={handleBack}
        onSave={currentSave ? currentSave.save : undefined}
        saveDisabled={
          currentSave ? !dirty[currentSave.section] || saving[currentSave.section] : false
        }
        saving={currentSave ? saving[currentSave.section] : false}
      />
      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-3">
        {topError && (
          <div
            role="alert"
            className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs"
          >
            {topError}
          </div>
        )}

        <form onSubmit={(e) => e.preventDefault()} className="space-y-3" data-view={view}>
          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 1 — Dados Pessoais (Motorista)
              ────────────────────────────────────────────────────────────────── */}
          <section
            data-secao="perfil"
            className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Dados Pessoais</h2>
            </div>

            {/* Foto de perfil — compacta no canto direito + campos ao lado */}
            <div className="flex items-start gap-3 mb-3 pb-3 border-b border-gray-100">
              <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-gray-600 mb-0.5">Nome *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    onBlur={(e) => setName(capitalizeName(e.target.value))}
                    required
                    data-error={fieldErrors.name ? 'true' : undefined}
                    className={`w-full px-2.5 py-1.5 bg-white border rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      fieldErrors.name ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {fieldErrors.name && (
                    <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.name}</p>
                  )}
                </div>
              </div>
              <ProfilePhotoBlock
                url={documents.profile_photo?.url}
                uploading={uploadingDoc === 'profile_photo'}
                hasPhoto={!!documents.profile_photo}
                onUpload={async (file) => {
                  await handleDocUpload('profile_photo', file);
                  await refreshUser();
                }}
                onDelete={async () => {
                  await handleDocDelete('profile_photo');
                  await refreshUser();
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-gray-600 mb-0.5">CPF</label>
                <input
                  type="text"
                  value={formatCpf(cpf)}
                  onChange={(e) => {
                    setCpf(sanitizeCpf(e.target.value));
                    markDirty('dadosPessoais');
                  }}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-600 mb-0.5">RG</label>
                <input
                  type="text"
                  value={rgNumber}
                  onChange={(e) => {
                    setRgNumber(e.target.value);
                    markDirty('dadosPessoais');
                  }}
                  maxLength={20}
                  placeholder="00.000.000-0"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-gray-600 mb-0.5">E-mail</label>
                {emailVerifiedNow ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-gray-800 text-sm">
                      {emailInput}
                    </p>
                    <span className="px-1.5 py-0.5 bg-green-50 border border-green-200 text-green-700 text-[10px] font-medium rounded">
                      ✓ Confirmado
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => {
                        setEmailInput(e.target.value);
                        markDirty('dadosPessoais');
                        setFieldErrors((p) => ({ ...p, email: '' }));
                      }}
                      placeholder="seu@email.com"
                      data-error={fieldErrors.email ? 'true' : undefined}
                      className={`flex-1 px-2.5 py-1.5 bg-white border rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.email ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleSendEmailCode}
                      disabled={
                        sendingCode ||
                        !emailDirty ||
                        (emailRateLimitedUntil !== null && Date.now() < emailRateLimitedUntil)
                      }
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sendingCode ? 'Enviando...' : 'Verificar'}
                    </button>
                  </div>
                )}
                {fieldErrors.email && (
                  <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.email}</p>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-gray-600 mb-0.5">
                  Telefone (WhatsApp)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(formatPhoneBR(e.target.value));
                    markDirty('dadosPessoais');
                    setFieldErrors((p) => ({ ...p, phone: '' }));
                  }}
                  placeholder="(00) 0 0000-0000"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={17}
                  data-error={fieldErrors.phone ? 'true' : undefined}
                  className={`w-full px-2.5 py-1.5 bg-white border rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    fieldErrors.phone ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.phone && (
                  <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.phone}</p>
                )}
              </div>
            </div>

            {/* Endereço — colapsavel quando preenchido */}
            <AddressBlock
              cep={addressCep}
              street={addressStreet}
              number={addressNumber}
              complement={addressComplement}
              neighborhood={addressNeighborhood}
              city={addressCity}
              uf={addressUf}
              cepLoading={cepLoading}
              cepError={cepError}
              fieldErrorUf={fieldErrors.addressUf}
              onCepChange={(v) => {
                setAddressCep(v);
                markDirty('dadosPessoais');
              }}
              onStreetChange={(v) => {
                setAddressStreet(v);
                markDirty('dadosPessoais');
              }}
              onNumberChange={(v) => {
                setAddressNumber(v);
                markDirty('dadosPessoais');
              }}
              onComplementChange={(v) => {
                setAddressComplement(v);
                markDirty('dadosPessoais');
              }}
              onNeighborhoodChange={(v) => {
                setAddressNeighborhood(v);
                markDirty('dadosPessoais');
              }}
              onCityChange={(v) => {
                setAddressCity(v);
                markDirty('dadosPessoais');
              }}
              onUfChange={(v) => {
                setAddressUf(v);
                markDirty('dadosPessoais');
              }}
              onClear={() => {
                setAddressCep('');
                setAddressStreet('');
                setAddressNumber('');
                setAddressComplement('');
                setAddressNeighborhood('');
                setAddressCity('');
                setAddressUf('');
                markDirty('dadosPessoais');
              }}
            />

            {/* Documentos pessoais */}
            <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
              <DocSlot
                slot={{ type: 'cnh', label: 'CNH (frente e verso)', accept: PDF_IMG }}
                doc={documents.cnh}
                uploading={uploadingDoc === 'cnh'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'foto_segurando_cnh',
                  label: 'Foto segurando CNH',
                  accept: IMG_ONLY,
                  note: 'Use a câmera traseira, não a frontal.',
                }}
                doc={documents.foto_segurando_cnh}
                uploading={uploadingDoc === 'foto_segurando_cnh'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'comprovante_endereco_motorista',
                  label: 'Comprovante de endereço (motorista)',
                  accept: PDF_IMG,
                }}
                doc={documents.comprovante_endereco_motorista}
                uploading={uploadingDoc === 'comprovante_endereco_motorista'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
            </div>

            {/* PIS */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <label className="block text-xs text-gray-600 mb-1">PIS (11 dígitos)</label>
              <input
                type="text"
                value={pis}
                onChange={(e) => {
                  setPis(e.target.value.replace(/\D/g, '').slice(0, 11));
                  markDirty('dadosPessoais');
                }}
                placeholder="00000000000"
                maxLength={11}
                inputMode="numeric"
                data-error={fieldErrors.pis ? 'true' : undefined}
                className={`w-48 px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  fieldErrors.pis ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {fieldErrors.pis && (
                <p className="mt-1 text-[11px] text-red-600">{fieldErrors.pis}</p>
              )}
              {!pis && (
                <p className="mt-1 text-[11px] text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 inline-block">
                  ⚠ Transportadoras hoje em dia pedem muito o PIS, favor preencher.
                </p>
              )}
            </div>

            {/* Referências profissionais */}
            <div data-bloco="referencias" className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-700">Referências profissionais</h3>
                <button
                  type="button"
                  onClick={addReference}
                  aria-label="Adicionar referência"
                  title="Adicionar referência"
                  className="w-7 h-7 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mb-2">
                Adicione transportadoras com quem você já carregou: nome da empresa, telefone e o
                CT-e ou MDF-e daquele frete (PDF ou foto). Toque no + para adicionar quantas quiser.
              </p>
              {references.length === 0 ? (
                <p className="text-[11px] text-gray-500">Nenhuma referência cadastrada ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {references.map((r) => (
                    <div
                      key={r.id}
                      className="relative flex flex-col gap-1.5 p-2 border border-gray-200 rounded-md bg-gray-50"
                    >
                      <div className="flex flex-col sm:flex-row gap-1.5">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={r.companyName}
                            onChange={(e) =>
                              updateReference(r.id, { companyName: e.target.value.slice(0, 80) })
                            }
                            onBlur={(e) =>
                              updateReference(r.id, { companyName: capitalizeName(e.target.value) })
                            }
                            maxLength={80}
                            placeholder="Nome da transportadora"
                            data-error={fieldErrors[`ref_${r.id}_name`] ? 'true' : undefined}
                            className={`w-full px-2 py-1.5 bg-white border rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              fieldErrors[`ref_${r.id}_name`] ? 'border-red-400' : 'border-gray-300'
                            }`}
                          />
                          {fieldErrors[`ref_${r.id}_name`] && (
                            <p className="mt-0.5 text-[10px] text-red-600">
                              {fieldErrors[`ref_${r.id}_name`]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-start gap-1.5">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={formatPhoneBR(r.phone)}
                              onChange={(e) =>
                                updateReference(r.id, { phone: sanitizePhone(e.target.value) })
                              }
                              inputMode="tel"
                              placeholder="(00) 00000-0000"
                              data-error={fieldErrors[`ref_${r.id}_phone`] ? 'true' : undefined}
                              className={`w-full px-2 py-1.5 bg-white border rounded-md text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                fieldErrors[`ref_${r.id}_phone`]
                                  ? 'border-red-400'
                                  : 'border-gray-300'
                              }`}
                            />
                            {fieldErrors[`ref_${r.id}_phone`] && (
                              <p className="mt-0.5 text-[10px] text-red-600">
                                {fieldErrors[`ref_${r.id}_phone`]}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeReference(r.id)}
                            aria-label="Remover referência"
                            title="Remover"
                            className="w-8 h-8 shrink-0 flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* CT-e da carga (PDF ou imagem) */}
                      <ReferenceCteControl
                        cteName={r.cteName}
                        cteUrl={r.cteUrl}
                        onPick={(file) => pickReferenceCte(r.id, file)}
                        onClear={() =>
                          updateReference(r.id, {
                            ctePendingFile: null,
                            cteName: null,
                            ctePath: null,
                            cteUrl: null,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <SectionFooter section="dadosPessoais" onSave={handleSaveDadosPessoais} />
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 2 — Veículo
              ────────────────────────────────────────────────────────────────── */}
          <section
            data-secao="veiculo"
            id="veiculo"
            className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4 scroll-mt-20"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">
                {view === 'tracao'
                  ? 'Tração // Cavalo'
                  : view === 'carroceria'
                    ? 'Carroceria'
                    : view === 'complemento'
                      ? 'Complemento do Veículo'
                      : 'Veículo'}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div data-grupo="carroceria">
                <label className="block text-xs text-gray-600 mb-1">Tipo</label>
                <button
                  type="button"
                  onClick={() => setVehicleTypePickerOpen(true)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-base sm:text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <span
                    className={`whitespace-normal break-words leading-tight ${
                      vehicleType ? 'text-gray-800' : 'text-gray-400'
                    }`}
                  >
                    {vehicleType ? vehicleTypeLabel(vehicleType) : 'Selecione o tipo de caminhão'}
                  </span>
                  <span className="text-gray-400 text-xs ml-2 shrink-0">▾</span>
                </button>
                <VehicleTypePicker
                  open={vehicleTypePickerOpen}
                  onClose={() => setVehicleTypePickerOpen(false)}
                  selected={vehicleType ? [vehicleType] : []}
                  onChange={(next) => {
                    const v = next[0] ?? '';
                    setVehicleType(v);
                    markDirty('veiculo');
                  }}
                  mode="single"
                  title="Tipo de Caminhão"
                />
              </div>

              <div data-grupo="carroceria">
                <label className="block text-xs text-gray-600 mb-1">Carroceria</label>
                <button
                  type="button"
                  onClick={() => setBodyTypePickerOpen(true)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-base sm:text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <span
                    className={`whitespace-normal break-words leading-tight ${
                      bodyType ? 'text-gray-800' : 'text-gray-400'
                    }`}
                  >
                    {bodyType ? bodyTypeLabel(bodyType) : 'Selecione a carroceria'}
                  </span>
                  <span className="text-gray-400 text-xs ml-2 shrink-0">▾</span>
                </button>
                <BodyTypePicker
                  open={bodyTypePickerOpen}
                  onClose={() => setBodyTypePickerOpen(false)}
                  selected={bodyType ? [bodyType] : []}
                  onChange={(next) => {
                    const v = next[0] ?? '';
                    setBodyType(v);
                    markDirty('veiculo');
                  }}
                  mode="single"
                  title="Carroceria"
                />
              </div>

              <div data-grupo="tracao">
                <label className="block text-xs text-gray-600 mb-1">Placa (Mercosul)</label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => {
                    setVehiclePlate(formatPlate(e.target.value));
                    markDirty('veiculo');
                  }}
                  placeholder="ABC1D23"
                  maxLength={7}
                  data-error={fieldErrors.plate ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.plate ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.plate && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.plate}</p>
                )}
              </div>

              <div data-grupo="tracao">
                <label className="block text-xs text-gray-600 mb-1">Modelo (fabricante)</label>
                <select
                  value={vehicleModelSelect}
                  onChange={(e) => {
                    setVehicleModelSelect(e.target.value);
                    markDirty('veiculo');
                  }}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione...</option>
                  {MODELOS_CAMINHAO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div data-grupo="tracao">
                <label className="block text-xs text-gray-600 mb-1">Ano de fabricação</label>
                <input
                  type="number"
                  value={vehicleYearManufacture}
                  onChange={(e) => {
                    setVehicleYearManufacture(e.target.value.slice(0, 4));
                    markDirty('veiculo');
                  }}
                  min={1980}
                  max={CURRENT_YEAR + 1}
                  placeholder="2020"
                  data-error={fieldErrors.yearManufacture ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.yearManufacture ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.yearManufacture && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.yearManufacture}</p>
                )}
              </div>

              <div data-grupo="tracao">
                <label className="block text-xs text-gray-600 mb-1">Ano modelo</label>
                <input
                  type="number"
                  value={vehicleYearModel}
                  onChange={(e) => {
                    setVehicleYearModel(e.target.value.slice(0, 4));
                    markDirty('veiculo');
                  }}
                  min={1980}
                  max={CURRENT_YEAR + 2}
                  placeholder="2021"
                  data-error={fieldErrors.yearModel ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.yearModel ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.yearModel && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.yearModel}</p>
                )}
              </div>

              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">
                  Consumo (km por litro do cavalo)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={kmPerLiter}
                  onChange={(e) => {
                    setKmPerLiter(maskDecimal(e.target.value, 1));
                    markDirty('veiculo');
                  }}
                  placeholder="2,5"
                  data-error={fieldErrors.kmPerLiter ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.kmPerLiter ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                <p className="mt-1 text-[10px] text-gray-500">
                  Ex: caminhão pesado carregado faz 2,5 a 4 km/L.
                </p>
                {fieldErrors.kmPerLiter && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.kmPerLiter}</p>
                )}
              </div>

              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">Eixos da carreta</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={trailerAxles}
                  onChange={(e) => {
                    // Só dígitos, máximo 2 (range 2..9, mas evita 99 errado também)
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setTrailerAxles(digits);
                    markDirty('veiculo');
                  }}
                  placeholder="6"
                  maxLength={2}
                  data-error={fieldErrors.trailerAxles ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.trailerAxles ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.trailerAxles && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.trailerAxles}</p>
                )}
              </div>

              {/* Bruto + Tara → Líquido (Capacidade) calculado.
                  O motorista informa o PBT e a TARA do caminhão; o líquido
                  é o quanto ele consegue carregar (bruto - tara) e segue
                  gravado em `cargo_capacity_ton`, que alimenta os cálculos
                  do painel de fretes. O campo "Líquido" é readonly e fica
                  com fundo cinza para deixar claro que é derivado. */}
              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">
                  Capacidade bruta - PBT (toneladas)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={grossWeightTon}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    const next = maskDecimal(digits, 3);
                    setGrossWeightTon(next);
                    // Recalcula liquido = bruto - tara
                    const bruto = maskedToNumber(next, 3);
                    const tara = maskedToNumber(tareWeightTon, 3);
                    if (!Number.isNaN(bruto) && !Number.isNaN(tara) && tara > 0 && bruto > tara) {
                      setCargoCapacityTon(numberToMasked(bruto - tara, 3));
                    } else if (!tareWeightTon) {
                      // sem tara, deixa vazio o liquido
                      setCargoCapacityTon('');
                    } else {
                      setCargoCapacityTon('');
                    }
                    markDirty('veiculo');
                  }}
                  placeholder="47,000"
                  data-error={fieldErrors.grossWeightTon ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.grossWeightTon ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.grossWeightTon && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.grossWeightTon}</p>
                )}
              </div>

              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">
                  Tara do caminhão (toneladas)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tareWeightTon}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    const next = maskDecimal(digits, 3);
                    setTareWeightTon(next);
                    // Recalcula liquido = bruto - tara
                    const bruto = maskedToNumber(grossWeightTon, 3);
                    const tara = maskedToNumber(next, 3);
                    if (!Number.isNaN(bruto) && !Number.isNaN(tara) && bruto > 0 && bruto > tara) {
                      setCargoCapacityTon(numberToMasked(bruto - tara, 3));
                    } else {
                      setCargoCapacityTon('');
                    }
                    markDirty('veiculo');
                  }}
                  placeholder="17,000"
                  data-error={fieldErrors.tareWeightTon ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.tareWeightTon ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.tareWeightTon && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.tareWeightTon}</p>
                )}
                <p className="mt-1 text-[11px] text-gray-500">
                  Peso do caminhão vazio (sem carga).
                </p>
              </div>

              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">
                  Líquido — capacidade de carga (toneladas)
                </label>
                <input
                  type="text"
                  value={cargoCapacityTon}
                  readOnly
                  tabIndex={-1}
                  placeholder="—"
                  className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 text-base sm:text-sm cursor-not-allowed"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Calculado automaticamente: bruto − tara.
                </p>
                {fieldErrors.cargoCapacityTon && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.cargoCapacityTon}</p>
                )}
              </div>

              <div data-grupo="complemento">
                <label className="block text-xs text-gray-600 mb-1">
                  Valor do diesel (R$/litro)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={dieselPrice}
                  onChange={(e) => {
                    setDieselPrice(maskDecimal(e.target.value, 2));
                    markDirty('veiculo');
                  }}
                  placeholder="5,99"
                  data-error={fieldErrors.dieselPrice ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.dieselPrice ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.dieselPrice && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.dieselPrice}</p>
                )}
              </div>
            </div>

            {(!kmPerLiter || !trailerAxles || !cargoCapacityTon) && (
              <div
                data-grupo="complemento"
                className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800"
              >
                ⚠ Preencha consumo, eixos e capacidade para desbloquear cálculos no painel.
              </div>
            )}

            {/* Documentos do veículo */}
            <div className="mt-3 space-y-2">
              <div data-grupo="tracao">
                <DocSlot
                  slot={{ type: 'crlv_cavalo', label: 'CRLV do cavalo', accept: PDF_IMG }}
                  doc={documents.crlv_cavalo}
                  uploading={uploadingDoc === 'crlv_cavalo'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>

              {/* Tipo de RNTRC (ANTT) — Pessoa Física ou Jurídica */}
              <div
                data-grupo="tracao"
                className="col-span-1 md:col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-lg"
              >
                <p className="text-xs font-semibold text-blue-800 mb-1.5">
                  Tipo da sua RNTRC (ANTT)
                </p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="rntrc_type"
                      value="fisica"
                      checked={rntrcType === 'fisica'}
                      onChange={() => {
                        setRntrcType('fisica');
                        markDirty('veiculo');
                      }}
                      className="accent-blue-600"
                    />
                    Pessoa Física
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="rntrc_type"
                      value="juridica"
                      checked={rntrcType === 'juridica'}
                      onChange={() => {
                        setRntrcType('juridica');
                        markDirty('veiculo');
                      }}
                      className="accent-blue-600"
                    />
                    Pessoa Jurídica
                  </label>
                </div>
              </div>

              <div data-grupo="tracao">
                <DocSlot
                  slot={{ type: 'rntrc_cavalo', label: 'ANTT', accept: PDF_IMG }}
                  doc={documents.rntrc_cavalo}
                  uploading={uploadingDoc === 'rntrc_cavalo'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>
              {/* ── Carroceria: carretas (1..4), uma de cada vez ──────────── */}
              <div data-grupo="carroceria" className="space-y-3">
                {Array.from({ length: carretaCount }, (_, i) => i + 1).map((n) => {
                  // Rótulo por posição: 1, 2, Dolly (3), Carreta 3 (4).
                  // As CHAVES de documento (crlv_carreta_3/_4) são mantidas; só o
                  // texto exibido muda.
                  const isDolly = n === 3;
                  const cardLabel = isDolly ? 'Dolly' : n === 4 ? 'Carreta 3' : `Carreta ${n}`;
                  const crlvLabel = isDolly
                    ? 'CRLV do Dolly'
                    : `CRLV da ${cardLabel.toLowerCase()}`;
                  const anttLabel = isDolly
                    ? 'ANTT do Dolly'
                    : `ANTT da ${cardLabel.toLowerCase()}`;
                  return (
                    <div
                      key={`carreta-${n}`}
                      className="relative rounded-lg border border-gray-200 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-700">{cardLabel}</p>
                        {/* X para remover — só na última e quando há mais de uma */}
                        {n === carretaCount && carretaCount > 1 && (
                          <button
                            type="button"
                            aria-label={`Remover ${cardLabel}`}
                            title="Remover este item"
                            onClick={async () => {
                              // Remove documentos enviados desta carreta antes de ocultar.
                              for (const t of [`crlv_carreta_${n}`, `rntrc_carreta_${n}`]) {
                                if (documents[t]) await handleDocDelete(t);
                              }
                              setCarretaCount((c) => Math.max(1, c - 1));
                            }}
                            className="w-6 h-6 flex items-center justify-center rounded-full text-red-500 hover:bg-red-50"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <DocSlot
                        slot={{
                          type: `crlv_carreta_${n}`,
                          label: crlvLabel,
                          accept: PDF_IMG,
                          optional: n > 1,
                        }}
                        doc={documents[`crlv_carreta_${n}`]}
                        uploading={uploadingDoc === `crlv_carreta_${n}`}
                        onUpload={handleDocUpload}
                        onDelete={handleDocDelete}
                      />
                      <DocSlot
                        slot={{
                          type: `rntrc_carreta_${n}`,
                          label: anttLabel,
                          accept: PDF_IMG,
                          optional: n > 1,
                        }}
                        doc={documents[`rntrc_carreta_${n}`]}
                        uploading={uploadingDoc === `rntrc_carreta_${n}`}
                        onUpload={handleDocUpload}
                        onDelete={handleDocDelete}
                      />
                    </div>
                  );
                })}

                {carretaCount < 4 && (
                  <button
                    type="button"
                    onClick={() => setCarretaCount((c) => Math.min(4, c + 1))}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    + adicionar mais carretas
                  </button>
                )}
              </div>

              <div data-grupo="tracao">
                <DocSlot
                  slot={{
                    type: 'foto_frente_caminhao',
                    label: 'Foto da frente do caminhão',
                    accept: IMG_ONLY,
                  }}
                  doc={documents.foto_frente_caminhao}
                  uploading={uploadingDoc === 'foto_frente_caminhao'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>
              <div data-grupo="tracao">
                <DocSlot
                  slot={{
                    type: 'foto_caminhao_completo',
                    label: 'Foto do caminhão completo (conjunto)',
                    accept: IMG_ONLY,
                  }}
                  doc={documents.foto_caminhao_completo}
                  uploading={uploadingDoc === 'foto_caminhao_completo'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>
            </div>

            <SectionFooter section="veiculo" onSave={handleSaveVeiculo} />
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 3 — Proprietário (renderiza apenas se isNotOwner)
              ────────────────────────────────────────────────────────────────── */}
          {isNotOwner && (
            <section
              data-secao="proprietario"
              className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">Proprietário</h2>
              </div>

              <button
                type="button"
                onClick={handleSouEuProprietario}
                className="mb-3 min-h-[44px] px-3 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 border border-gray-200"
              >
                Sou eu o proprietário
              </button>

              {ownerIsDriver && (
                <p className="mb-3 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  ✓ Você marcou que é o proprietário. Os dados pessoais serão usados como
                  referência.
                </p>
              )}

              {!ownerIsDriver && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">CNPJ do proprietário</label>
                    <input
                      type="text"
                      value={formatCnpj(ownerCnpj)}
                      onChange={(e) => {
                        setOwnerCnpj(sanitizeCnpj(e.target.value));
                        markDirty('proprietario');
                      }}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                      inputMode="numeric"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {cnpjLoading && (
                      <p className="mt-1 text-[11px] text-gray-500">Buscando empresa...</p>
                    )}
                    {cnpjError && <p className="mt-1 text-[11px] text-red-600">{cnpjError}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome da empresa</label>
                    <input
                      type="text"
                      value={ownerCompanyName}
                      disabled
                      placeholder="Preenchido automaticamente pela Receita"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 text-base sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      PIS do proprietário (11 dígitos)
                    </label>
                    <input
                      type="text"
                      value={ownerPisNumber}
                      onChange={(e) => {
                        setOwnerPisNumber(e.target.value.replace(/\D/g, '').slice(0, 11));
                        markDirty('proprietario');
                      }}
                      placeholder="00000000000"
                      maxLength={11}
                      inputMode="numeric"
                      data-error={fieldErrors.ownerPis ? 'true' : undefined}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        fieldErrors.ownerPis ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {fieldErrors.ownerPis && (
                      <p className="mt-1 text-[11px] text-red-600">{fieldErrors.ownerPis}</p>
                    )}
                    {!ownerPisNumber && (
                      <p className="mt-1 text-[11px] text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 inline-block">
                        ⚠ PIS do proprietário não informado.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
                <DocSlot
                  slot={{
                    type: 'documento_proprietario',
                    label: 'Documento do proprietário (CNH ou RG)',
                    accept: PDF_IMG,
                  }}
                  doc={documents.documento_proprietario}
                  uploading={uploadingDoc === 'documento_proprietario'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
                <DocSlot
                  slot={{
                    type: 'comprovante_endereco_proprietario',
                    label: 'Comprovante de endereço do proprietário',
                    accept: PDF_IMG,
                  }}
                  doc={documents.comprovante_endereco_proprietario}
                  uploading={uploadingDoc === 'comprovante_endereco_proprietario'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>

              <SectionFooter section="proprietario" onSave={handleSaveProprietario} />
            </section>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 4 — Contratos de Arrendamento (apenas se isNotOwner)
              ────────────────────────────────────────────────────────────────── */}
          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 4 — Contrato (upload de arquivos, sempre disponível)
              ────────────────────────────────────────────────────────────────── */}
          <section
            data-secao="contrato"
            className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Contrato</h2>
              <ContratoAddButton
                uploading={uploadingDoc === 'contrato_arrendamento'}
                onPick={handleContratoAdd}
              />
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              Anexe seus contratos em PDF ou foto (máximo 5MB cada). Toque no + para adicionar
              quantos arquivos precisar — todos ficam salvos aqui.
            </p>

            {contratoDocs.length === 0 ? (
              <p className="text-[11px] text-gray-500">Nenhum contrato adicionado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {contratoDocs.map((doc, idx) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-2 p-2 bg-white border border-gray-200 rounded-md"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-gray-800 leading-tight">
                        Contrato {idx + 1}
                        {doc.status === 'rejeitado' && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-600 text-white">
                            Recusado
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {doc.fileName}
                        {doc.url && (
                          <>
                            {' · '}
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              ver
                            </a>
                          </>
                        )}
                      </p>
                      {doc.status === 'rejeitado' && doc.rejectionReason && (
                        <p className="text-[10px] text-red-600 mt-0.5">
                          Motivo: {doc.rejectionReason}
                        </p>
                      )}
                    </div>
                    {doc.status !== 'aprovado' && (
                      <button
                        type="button"
                        onClick={() => handleContratoDelete(doc.id)}
                        aria-label="Remover contrato"
                        title="Remover"
                        className="w-8 h-8 shrink-0 flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <SectionFooter section="contrato" onSave={handleSaveContrato} />
          </section>

          {/* Botão voltar — só na view completa ('all'); nas sub-telas o
              "Voltar" já vive no topo (ProfileTopBar). Evita botão duplicado. */}
          {view === 'all' && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="min-h-[44px] px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                ← Voltar
              </button>
            </div>
          )}
        </form>
      </main>

      <ModalVerificacaoEmail
        email={emailInput}
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSuccess={handleEmailVerified}
      />
    </div>
  );
}
