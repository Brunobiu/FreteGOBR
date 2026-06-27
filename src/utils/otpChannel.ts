/**
 * otpChannel — decisão pura de qual canal entrega o OTP de cadastro, incluindo
 * o fallback WhatsApp → e-mail.
 *
 * É o ESPELHO testável da lógica que roda dentro da Edge `send-signup-otp`
 * (que não pode importar de `src/`). A Edge replica esta função; ambas DEVEM
 * permanecer em sincronia. Property test: CP9 (decisão determinística).
 *
 * Regras:
 *   - `forceEmail` (fallback manual "não recebi"): usa e-mail se houver e-mail
 *     válido; senão, não há canal possível (`none`).
 *   - Caso normal: tenta WhatsApp; se o envio por WhatsApp deu certo, canal é
 *     `whatsapp`; se falhou, cai para e-mail quando houver e-mail; senão `none`.
 *   - O MESMO código é usado em qualquer canal (o fallback não regenera código).
 */

export type OtpChannel = 'whatsapp' | 'email';
export type OtpChannelResult = OtpChannel | 'none';

export interface ChannelDecisionInput {
  /** Resultado do envio pela WhatsApp Cloud API (true = 2xx). */
  whatsappOk: boolean;
  /** Existe um e-mail válido para fallback? */
  hasEmail: boolean;
  /** Fallback manual forçado pelo usuário ("não recebi — enviar por e-mail"). */
  forceEmail: boolean;
}

/**
 * Decide o canal efetivo de envio do OTP. Retorna `'none'` quando nenhum canal
 * é possível (ex.: WhatsApp falhou e não há e-mail).
 */
export function decideSentChannel(input: ChannelDecisionInput): OtpChannelResult {
  const { whatsappOk, hasEmail, forceEmail } = input;

  if (forceEmail) {
    return hasEmail ? 'email' : 'none';
  }
  if (whatsappOk) {
    return 'whatsapp';
  }
  // WhatsApp falhou ⇒ fallback automático para e-mail (se houver).
  return hasEmail ? 'email' : 'none';
}
