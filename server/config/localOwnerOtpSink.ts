/**
 * LOCAL-only owner OTP console sink.
 *
 * This module lives under `server/config/`, which the LIVE sync excludes, so
 * the sink implementation never travels to LIVE. It is loaded lazily from
 * `server/config/loadEnv.ts` only in development and installs an explicit
 * sender override through the neutral dependency-injection seam exported by
 * `server/routes/owner-accounts.ts`.
 *
 * It only substitutes delivery: the OTP code is still random, HMAC-hashed,
 * verified normally, and keeps the same TTL and attempt/issue limits. It never
 * touches Enjazatik settings or credentials.
 */
import { sendOwnerWhatsApp } from "../integrations/whatsapp";
import {
  setOwnerAccountOtpSender,
} from "../routes/owner-accounts";
import type { OwnerAccountOtpSender } from "../services/OwnerAccountService";
import { devOwnerOtpSinkEnabled } from "./runtimeEnvironment";

function maskOwnerOtpPhone(phone: string): string {
  const localPhone = `0${phone}`;
  return `${localPhone.slice(0, 2)}••••${localPhone.slice(-4)}`;
}

export function createOwnerOtpSender(dependencies: {
  sinkEnabled: () => boolean;
  send: OwnerAccountOtpSender;
  log: (line: string) => void;
}): OwnerAccountOtpSender {
  return async (phone, message, retries) => {
    if (dependencies.sinkEnabled()) {
      dependencies.log(
        `[DEV OWNER OTP] to=${maskOwnerOtpPhone(phone)} :: ${message}`,
      );
      return { success: true };
    }
    return dependencies.send(phone, message, retries);
  };
}

/**
 * Installs the console sink for the current process when the strict LOCAL
 * conditions hold (NODE_ENV=development + DEV_OWNER_OTP_SINK=console + the
 * isolated DEV Firebase project). Otherwise it is a no-op and the route keeps
 * the default `sendOwnerWhatsApp` sender.
 */
export function installLocalOwnerOtpSink(): void {
  if (!devOwnerOtpSinkEnabled()) return;
  setOwnerAccountOtpSender(
    createOwnerOtpSender({
      sinkEnabled: devOwnerOtpSinkEnabled,
      send: sendOwnerWhatsApp,
      log: (line) => console.log(line),
    }),
  );
}
