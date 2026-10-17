export interface AdminActionErrorPayload {
  ok?: boolean;
  success?: boolean;
  code?: string;
  error?: string;
  message?: string;
  missingFields?: string[];
  warnings?: string[];
  partial?: boolean;
  outcome?: unknown;
}

export class AdminActionError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly missingFields: string[];
  readonly warnings: string[];
  readonly partial: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      missingFields?: string[];
      warnings?: string[];
      partial?: boolean;
    },
  ) {
    super(message);
    this.name = "AdminActionError";
    this.status = options.status;
    this.code = options.code;
    this.missingFields = options.missingFields || [];
    this.warnings = options.warnings || [];
    this.partial = options.partial === true;
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(cleanString)
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

function parsePayload(text: string): AdminActionErrorPayload | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as AdminActionErrorPayload)
      : null;
  } catch {
    return null;
  }
}

export async function readAdminActionResponse<T>(
  response: Response,
  fallbackMessage: string,
  validateSuccess?: (payload: AdminActionErrorPayload) => boolean,
): Promise<T> {
  const responseText = await response.text();
  const payload = parsePayload(responseText);

  if (response.ok) {
    if (
      !payload ||
      (payload.ok !== true && payload.success !== true) ||
      (validateSuccess && !validateSuccess(payload))
    ) {
      throw new AdminActionError(fallbackMessage, {
        status: 502,
        code: "INVALID_SUCCESS_RESPONSE",
      });
    }
    return payload as T;
  }

  const missingFields = cleanStringArray(payload?.missingFields);
  const warnings = cleanStringArray(payload?.warnings);
  let message =
    cleanString(payload?.error) ||
    cleanString(payload?.message) ||
    fallbackMessage;

  const unmentionedFields = missingFields.filter(
    (field) => !message.includes(field),
  );
  if (unmentionedFields.length > 0) {
    message = `${message}: ${unmentionedFields.join("، ")}`;
  }

  throw new AdminActionError(message, {
    status: response.status,
    code: cleanString(payload?.code) || undefined,
    missingFields,
    warnings,
    partial: payload?.partial === true,
  });
}

export function getAdminActionErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  return error instanceof AdminActionError && error.message.trim()
    ? error.message.trim()
    : fallbackMessage;
}
