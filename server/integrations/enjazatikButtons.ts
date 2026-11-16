/**
 * Isolated Enjazatik interactive-button WhatsApp test harness.
 *
 * This module is intentionally separate from the existing owner/customer OTP
 * and notification flows in `server/integrations/whatsapp.ts`. It sends
 * `button-text` messages to Enjazatik's `POST /api/v1/send-template` endpoint
 * using the payload shape supplied by the operator:
 *
 * {
 *   "number": "966591005515",
 *   "type": "button-text",
 *   "content": {
 *     "text": "...",
 *     "buttons": [{ "type": "replyButton", "title": "..." }],
 *     "footerText": "..."
 *   }
 * }
 *
 * The module never logs the API token.
 */

export type EnjazatikButtonType = "replyButton" | "urlButton" | "callButton";

export interface EnjazatikReplyButton {
  type: "replyButton";
  title: string;
}

export interface EnjazatikUrlButton {
  type: "urlButton";
  title: string;
  url: string;
}

export interface EnjazatikCallButton {
  type: "callButton";
  title: string;
  phoneNumber: string;
}

export type EnjazatikButton =
  | EnjazatikReplyButton
  | EnjazatikUrlButton
  | EnjazatikCallButton;

export interface EnjazatikButtonMessage {
  to: string;
  body: string;
  footer?: string;
  buttons: EnjazatikButton[];
}

export interface EnjazatikSendResult {
  success: boolean;
  httpStatus?: number;
  responseCode?: string | number | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  error?: string;
  rawResponse?: string;
}

export interface EnjazatikSenderDependencies {
  url: string;
  token: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  delay: (milliseconds: number) => Promise<void>;
}

const SAUDI_MOBILE_REGEX = /^(?:0|966)?5\d{8}$/;

export function normalizeSaudiWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `966${digits.slice(1)}`;
  if (digits.startsWith("966")) return digits;
  if (digits.startsWith("05")) return `966${digits.slice(2)}`;
  return `966${digits}`;
}

export function isValidSaudiMobile(phone: string): boolean {
  return SAUDI_MOBILE_REGEX.test(phone.replace(/[^0-9]/g, ""));
}

function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{4})/g, "*");
}

export function buildEnjazatikButtonPayload(
  message: EnjazatikButtonMessage,
): unknown {
  return {
    number: normalizeSaudiWhatsAppNumber(message.to),
    type: "button-text",
    content: {
      text: message.body,
      buttons: message.buttons.map((button) => {
        const base = { type: button.type, title: button.title };
        switch (button.type) {
          case "replyButton":
            return base;
          case "urlButton":
            return { ...base, url: button.url };
          case "callButton":
            return { ...base, phoneNumber: button.phoneNumber };
          default:
            return base;
        }
      }),
      ...(message.footer ? { footerText: message.footer } : {}),
    },
  };
}

function extractProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const keys = [
    "messageId",
    "message_id",
    "messageID",
    "whatsappMessageId",
    "whatsapp_message_id",
    "wamid",
    "messageUuid",
    "message_uuid",
    "msgId",
    "msg_id",
    "id",
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof record.data === "object" && record.data !== null) {
    return extractProviderMessageId(record.data);
  }
  return null;
}

function extractResponseCode(payload: unknown): string | number | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.code === "string" || typeof record.code === "number") {
    return record.code;
  }
  if (typeof record.status === "string" || typeof record.status === "number") {
    return record.status;
  }
  if (typeof record.success === "boolean") {
    return record.success ? "success" : "failed";
  }
  return null;
}

async function executeEnjazatikRequest(
  dependencies: EnjazatikSenderDependencies,
  payload: unknown,
  retries: number,
): Promise<EnjazatikSendResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await dependencies.request(dependencies.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dependencies.token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responsePayload: unknown = null;
      try {
        if (responseText.trim()) responsePayload = JSON.parse(responseText);
      } catch {
        // Keep raw text for diagnostics.
      }

      if (response.ok) {
        const providerMessageId = extractProviderMessageId(responsePayload);
        const code = extractResponseCode(responsePayload);
        return {
          success: true,
          httpStatus: response.status,
          responseCode: code,
          providerMessageId,
          providerStatus: "accepted",
          rawResponse: responseText.slice(0, 4096),
        };
      }

      lastError = new Error(
        `HTTP ${response.status}: ${responseText.slice(0, 512)}`,
      );
      if (attempt < retries) {
        await dependencies.delay(5_000 * (attempt + 1));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await dependencies.delay(5_000 * (attempt + 1));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message ?? "Failed after retries",
  };
}

function validateCommonInput(
  dependencies: EnjazatikSenderDependencies,
  to: string,
): EnjazatikSendResult | null {
  if (!dependencies.url || !dependencies.token) {
    return { success: false, error: "Missing Enjazatik URL or token" };
  }

  if (!isValidSaudiMobile(to)) {
    return {
      success: false,
      error: `Invalid recipient number: ${maskPhone(to)}`,
    };
  }

  return null;
}

export function createEnjazatikButtonSender(
  dependencies: EnjazatikSenderDependencies,
) {
  return async function sendEnjazatikButtonMessage(
    message: EnjazatikButtonMessage,
    retries = 0,
  ): Promise<EnjazatikSendResult> {
    const validationError = validateCommonInput(dependencies, message.to);
    if (validationError) return validationError;

    if (message.buttons.length === 0) {
      return { success: false, error: "At least one button is required" };
    }

    if (message.buttons.length > 3) {
      return { success: false, error: "Maximum 3 buttons supported" };
    }

    const payload = buildEnjazatikButtonPayload(message);
    return executeEnjazatikRequest(dependencies, payload, retries);
  };
}
