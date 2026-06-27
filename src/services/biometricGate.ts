/**
 * services/biometricGate.ts
 *
 * Lógica PURA da trava biométrica (spec biometria-app). Sem dependência do
 * plugin nativo — é o núcleo testável (property tests CP1–CP6). O wrapper
 * `biometricAuth.ts` e o hook `useBiometricGate.ts` consomem estas funções.
 *
 * Modelo: a biometria é uma TRAVA LOCAL sobre a sessão já persistida. Ela não
 * autentica no servidor; apenas autoriza restaurar o refresh token guardado em
 * armazenamento seguro.
 */

/** Ambiente observado em runtime (nativo? hardware disponível? opt-in ligado?). */
export interface BiometricEnv {
  isNative: boolean;
  isAvailable: boolean;
  isEnabled: boolean;
}

/**
 * CP1 — a trava só aparece quando É nativo E há hardware disponível E o usuário
 * habilitou (opt-in). Qualquer outra combinação ⇒ sem trava (comportamento atual).
 */
export function shouldShowLock(env: BiometricEnv): boolean {
  return env.isNative === true && env.isAvailable === true && env.isEnabled === true;
}

/**
 * Estados da trava:
 *   idle      — ainda não decidiu / sem trava
 *   locked    — exibindo a trava, aguardando biometria
 *   unlocking — biometria OK, restaurando a sessão
 *   unlocked  — liberado (conteúdo autenticado visível)
 *   fallback  — caiu para o Login_Completo (senha/código)
 */
export type GateState = 'idle' | 'locked' | 'unlocking' | 'unlocked' | 'fallback';

export type GateEvent =
  | { type: 'CHECK'; env: BiometricEnv }
  | { type: 'BIOMETRIC_SUCCESS' }
  | { type: 'BIOMETRIC_FAILED' }
  | { type: 'BIOMETRIC_CANCELLED' }
  | { type: 'SESSION_RESTORED' }
  | { type: 'SESSION_RESTORE_FAILED' }
  | { type: 'USE_PASSWORD' }
  | { type: 'RESET' };

/**
 * Reducer determinístico da máquina de estados.
 *
 * Invariantes (property tests):
 *   - CP5: só chega a 'unlocked' via BIOMETRIC_SUCCESS → SESSION_RESTORED
 *     (nunca direto de 'locked' sem verificação + restauração).
 *   - CP3: de 'locked'/'unlocking', falha/cancelamento/escolha de senha leva a
 *     'fallback' (Login_Completo) — nunca a um estado terminal de bloqueio.
 */
export function nextGateState(current: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case 'CHECK':
      // Decide a trava só a partir de 'idle' (evita reabrir após desbloqueio).
      if (current !== 'idle') return current;
      return shouldShowLock(event.env) ? 'locked' : 'unlocked';

    case 'BIOMETRIC_SUCCESS':
      return current === 'locked' ? 'unlocking' : current;

    case 'SESSION_RESTORED':
      return current === 'unlocking' ? 'unlocked' : current;

    case 'SESSION_RESTORE_FAILED':
      // Token inválido/revogado ⇒ login completo (não trava o usuário fora).
      return current === 'unlocking' ? 'fallback' : current;

    case 'BIOMETRIC_FAILED':
    case 'BIOMETRIC_CANCELLED':
      // Biometria falhou/cancelou ⇒ volta para a trava (permite tentar de novo
      // ou escolher "entrar com senha"). NÃO desloga sozinho (Req 2.4).
      if (current === 'locked' || current === 'unlocking') return 'locked';
      return current;

    case 'USE_PASSWORD':
      // Escolha explícita do usuário ⇒ Login_Completo. De qualquer estado da
      // trava sempre há esta saída (nunca um bloqueio terminal — CP3).
      if (current === 'locked' || current === 'unlocking') return 'fallback';
      return current;

    case 'RESET':
      return 'idle';

    default:
      return current;
  }
}

/**
 * CP2 — o que vai para o armazenamento seguro é EXCLUSIVAMENTE o refresh token.
 * A função recebe só o token: estruturalmente, a senha do usuário nunca entra.
 */
export const BIOMETRIC_CREDENTIAL_USERNAME = 'fretego_session';

export interface SecureCredential {
  username: string;
  /** Segredo guardado = refresh token da sessão (NUNCA a senha do usuário). */
  password: string;
}

export function credentialToStore(refreshToken: string): SecureCredential {
  return { username: BIOMETRIC_CREDENTIAL_USERNAME, password: refreshToken };
}
