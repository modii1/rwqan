/**
 * Dev script: isolated Enjazatik interactive-button WhatsApp test.
 *
 * Sends 3 button-text messages to the fixed test number 0591005515 through
 * Enjazatik's send-template endpoint, using ENJAZATIK_BUTTONS_TOKEN from
 * .env.development.local only.
 *
 * Requirements:
 *   ENJAZATIK_BUTTONS_TOKEN=<token>
 *   ENJAZATIK_BUTTON_TEST_APPROVED=true
 *
 * The script never prints the API token.
 */
import "./loadEnv";
import {
  createEnjazatikButtonSender,
  type EnjazatikButtonMessage,
} from "../integrations/enjazatikButtons";

const ENDPOINT = "https://business.enjazatik.com/api/v1/send-template";
const FIXED_TEST_RECIPIENT = "0591005515";

const url = String(process.env.ENJAZATIK_BUTTONS_URL || ENDPOINT).trim();
const token = String(process.env.ENJAZATIK_BUTTONS_TOKEN || "").trim();
const approved = process.env.ENJAZATIK_BUTTON_TEST_APPROVED === "true";

if (!token) {
  console.error("❌ ENJAZATIK_BUTTONS_TOKEN is not set in .env.development.local");
  process.exit(1);
}
if (!approved) {
  console.error(
    "❌ ENJAZATIK_BUTTON_TEST_APPROVED is not set to 'true'. This gate prevents accidental sends.",
  );
  process.exit(1);
}

const send = createEnjazatikButtonSender({
  url,
  token,
  request: (u, init) => fetch(u, init),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const baseBody = "اختبار الأزرار التفاعلية من روقان TEST";
const footer = "رسالة اختبار";

const scenarios: Array<{ label: string; message: EnjazatikButtonMessage }> = [
  {
    label: "1. replyButton only",
    message: {
      to: FIXED_TEST_RECIPIENT,
      body: baseBody,
      footer,
      buttons: [{ type: "replyButton", title: "تأكيد" }],
    },
  },
  {
    label: "2. replyButton + urlButton",
    message: {
      to: FIXED_TEST_RECIPIENT,
      body: baseBody,
      footer,
      buttons: [
        { type: "replyButton", title: "تأكيد" },
        {
          type: "urlButton",
          title: "فتح صفحة الاختبار",
          url: "https://rwqan.sa",
        },
      ],
    },
  },
  {
    label: "3. replyButton + urlButton + callButton",
    message: {
      to: FIXED_TEST_RECIPIENT,
      body: baseBody,
      footer,
      buttons: [
        { type: "replyButton", title: "تأكيد" },
        {
          type: "urlButton",
          title: "فتح صفحة الاختبار",
          url: "https://rwqan.sa",
        },
        {
          type: "callButton",
          title: "اتصال",
          phoneNumber: "966591005515",
        },
      ],
    },
  },
];

async function main() {
  console.log(`▶ Enjazatik send-template endpoint: ${url}`);
  console.log(`▶ Recipient: ${FIXED_TEST_RECIPIENT.replace(/\d(?=\d{4})/g, "*")}`);
  console.log(`▪ Sending ${scenarios.length} scenarios sequentially with zero retries.\n`);

  for (const scenario of scenarios) {
    console.log(`--- ${scenario.label} ---`);
    const result = await send(scenario.message, 0);

    console.log(`  success:        ${result.success}`);
    console.log(`  httpStatus:     ${result.httpStatus ?? "N/A"}`);
    console.log(`  responseCode:   ${result.responseCode ?? "N/A"}`);
    console.log(`  providerMsgId:  ${result.providerMessageId ?? "N/A"}`);
    console.log(`  error:          ${result.error ?? "N/A"}`);
    console.log(`  rawResponse:    ${result.rawResponse ?? "N/A"}`);
    console.log();

    if (!result.success) {
      console.error("Stopping because this scenario failed. No further messages were sent.");
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  console.log("✅ All 3 scenarios completed. Check the handset to verify rendering and interaction.");
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
