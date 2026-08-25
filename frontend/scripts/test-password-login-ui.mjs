/**
 * UI password login smoke — requires local Next server (npm run start).
 * Does not print credentials.
 *
 * Usage: PORT=3010 node scripts/test-password-login-ui.mjs
 */
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 3010);
const BASE = process.env.LOGISTICS_BASE_URL || `http://127.0.0.1:${PORT}`;
const FIXTURE_EMAIL = "dev.ap@pscs.local";
const FIXTURE_PASSWORD = "DevAp#2026Test";

async function runCase(label, password, expectDashboard) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByLabel("E-mail").fill(FIXTURE_EMAIL);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForTimeout(expectDashboard ? 10000 : 4000);

  const body = (await page.textContent("body")) || "";
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));

  const result = {
    label,
    finalUrl: page.url(),
    hasAppError: body.includes("Application error"),
    pageErrors,
    consoleErrors: consoleErrors.slice(0, 5),
    authCookieCount: cookies.length,
    emailPreserved: expectDashboard
      ? null
      : (await page.getByLabel("E-mail").inputValue().catch(() => "")).length > 0,
    hasPortugueseError: /incorretos|não foi possível/i.test(body),
  };

  await browser.close();
  return result;
}

const invalid = await runCase("invalid_password", "invalid-probe-only", false);
const valid = await runCase("valid_password", FIXTURE_PASSWORD, true);

const report = {
  base: BASE,
  invalid,
  valid,
  pass:
    !invalid.hasAppError &&
    invalid.finalUrl.includes("/login") &&
    invalid.hasPortugueseError &&
    invalid.emailPreserved === true &&
    valid.finalUrl.includes("/dashboard") &&
    !valid.hasAppError &&
    valid.authCookieCount > 0,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
