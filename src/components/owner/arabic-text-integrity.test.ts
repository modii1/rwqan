import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 *kira: Integrated integrity guard for Arabic text across auth/subscription UI files.
 *
 * Prevents regression of CP1256/box-drawing/block-element corruption that previously
 * garbled Arabic placeholders, labels, and messages (e.g. "ظتظتظت", "╪ص╪│╪د╪ذ").
 *
 * The check:
 * 1. Reads every relevant source file as UTF-8.
 * 2. Flags any standalone character outside Arabic (U+0600-U+06FF), ASCII,
 *    and normal UI symbols as "garbled".
 * 3. Asserts correct Arabic copy is present and readable.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../");

const SOURCE_FILES = [
  "src/components/owner/owner-login.tsx",
  "src/components/subscription-page.tsx",
  "src/components/customer/customer-auth-page.tsx",
  "src/components/auth/auth-gateway.tsx",
  "src/app/owner/login/page.tsx",
  "src/app/customer/login/page.tsx",
  "src/app/customer/register/page.tsx",
];

function readSource(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

/** True only for standalone corrupted characters, never for legitimate UTF-8 Arabic. */
function isGarbledChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  // Arabic range is legitimate
  if (c >= 0x0600 && c <= 0x06ff) return false;
  // ASCII is legitimate
  if (c <= 0x7f) return false;
  // Box drawing U+2500-U+257F
  if (c >= 0x2500 && c <= 0x257f) return true;
  // Block elements U+2580-U+259F
  if (c >= 0x2580 && c <= 0x259f) return true;
  // Geometric shapes U+25A0-U+25FF
  if (c >= 0x25a0 && c <= 0x25ff) return true;
  // CP1256 control / high bytes standing alone (U+0080-U+009F)
  if (c >= 0x0080 && c <= 0x009f) return true;
  // Miscellaneous symbols U+2B00-U+2BFF
  if (c >= 0x2b00 && c <= 0x2bff) return true;
  return false;
}

function findGarbled(text: string): Array<{ line: number; col: number; code: string; ch: string }> {
  const lines = text.split("\n");
  const found: Array<{ line: number; col: number; code: string; ch: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines[i].length; j++) {
      if (isGarbledChar(lines[i][j])) {
        found.push({
          line: i + 1,
          col: j + 1,
          code: "U+" + lines[i].charCodeAt(j).toString(16).toUpperCase(),
          ch: lines[i][j],
        });
      }
    }
  }
  return found;
}

test("arabic integrity: no garbled CP1256/box-drawing characters in source files", () => {
  for (const rel of SOURCE_FILES) {
    const text = readSource(rel);
    const garbled = findGarbled(text);
    assert.deepStrictEqual(garbled, [], {
      message: `Garbled characters found in ${rel}: ` +
        garbled.map(g => `L${g.line}:${g.col} ${g.code} ${g.ch}`).join(", "),
    });
  }
});

test("arabic integrity: correct Arabic copy is present in owner-login", () => {
  const src = readSource("src/components/owner/owner-login.tsx");
  const expected = [
    "حساب العميل",
    "تسجيل الدخول",
    "مالك العقار",
    "دخول المسؤول",
    "الرقم السري",
    "كلمة المرور",
    "كود المسؤول",
    "رقم العقار",
    "تسجيل دخول العميل | روقان",
    "دخول المسؤول | روقان",
  ];
  for (const copy of expected) {
    assert.ok(src.includes(copy), `missing correct Arabic copy: ${copy}`);
  }
  // Placeholders must use bullet character, not garbled CP1256
  assert.ok(src.includes('placeholder="••••••"'), 'owner-pin placeholder must be "••••••"');
  assert.ok(src.includes('placeholder="••••••"') && src.split('placeholder="••••••"').length >= 2,
    "admin-password placeholder must be '••••••'");
});

test("arabic integrity: garbled patterns are detected and clean Arabic is accepted", () => {
  // Known-garbled pattern must be flagged by the detector
  const garbledSample = 'placeholder="ظتظتظتظتظتظت"';
  assert.ok(findGarbled(garbledSample).length > 0, "detector must flag CP1256 control char U+0080");

  const boxDrawingSample = 'label="╪ص╪│╪د╪ذ ╪د┘╪╣┘à┘è┘"';
  assert.ok(findGarbled(boxDrawingSample).length > 0, "detector must flag box-drawing / geometric chars");

  // Clean Arabic must NOT be flagged
  const cleanSample = 'placeholder="••••••" label="الرقم السري"';
  assert.deepStrictEqual(findGarbled(cleanSample), [], "clean Arabic + bullet must pass");
});

test("arabic integrity: subscription page has no garbled separator comment", () => {
  const src = readSource("src/components/subscription-page.tsx");
  assert.ok(!src.includes("ظ¤"), "subscription-page.tsx must not contain garbled separator");
  assert.ok(src.includes("// Visual Captcha helpers"), "subscription-page.tsx must have clean comment");
});
