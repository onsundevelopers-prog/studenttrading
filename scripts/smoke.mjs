/**
 * Authenticated page smoke test.
 *
 * Why this exists: `next build`, `tsc` and the DB suites all passed while every
 * logged-in page returned HTTP 500. An unauthenticated request is redirected by
 * the proxy before the application shell renders, so a status check against
 * `/teacher` proves nothing about the page behind it — the shell, its client
 * components and its context providers are only exercised once a real session
 * exists. A missing `TooltipProvider` in the top bar broke all of them.
 *
 * So this signs in for real, builds the same `@supabase/ssr` session cookie the
 * browser would hold, and requests every authenticated route, asserting that it
 * renders and contains content it could only get from the database.
 *
 * Requires a running server and at least one classroom with students:
 *
 *   npm run dev            # or: npm run dev -- -p 2000
 *   npm run smoke          # or: npm run smoke -- --base=http://localhost:2000
 *
 * Credentials: set SMOKE_TEACHER_EMAIL / SMOKE_TEACHER_PASSWORD /
 * SMOKE_STUDENT_EMAIL / SMOKE_STUDENT_PASSWORD in .env.local or the
 * environment. They must belong to real accounts in your project.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const baseArg = process.argv.find((arg) => arg.startsWith("--base="));
const base = (baseArg ? baseArg.slice("--base=".length) : process.env.SMOKE_BASE) ||
  "http://localhost:3000";

const TEACHER = {
  email: env.SMOKE_TEACHER_EMAIL,
  password: env.SMOKE_TEACHER_PASSWORD,
};
const STUDENT = {
  email: env.SMOKE_STUDENT_EMAIL,
  password: env.SMOKE_STUDENT_PASSWORD,
};

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

if (!TEACHER.email || !TEACHER.password || !STUDENT.email || !STUDENT.password) {
  console.error(
    "Missing smoke credentials. Set SMOKE_TEACHER_EMAIL, SMOKE_TEACHER_PASSWORD,\n" +
      "SMOKE_STUDENT_EMAIL and SMOKE_STUDENT_PASSWORD in .env.local (or the environment)\n" +
      "to the accounts you want to smoke-test with.",
  );
  process.exit(1);
}

const ref = new URL(url).host.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;

/** The cookie value @supabase/ssr writes: "base64-" + base64url(session JSON). */
async function sessionCookie(email, password) {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw new Error(`could not sign in as ${email}: ${error?.message ?? "no session"}`);
  }
  const encoded = Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  return `${cookieName}=base64-${encoded}`;
}

const ERROR_MARKERS = [
  "Application error",
  "Internal Server Error",
  "__next_error__",
];

let failures = 0;
let checked = 0;

/** `expected` may be one string or several; every one must appear in the HTML. */
async function check(path, cookie, expected) {
  checked += 1;
  const wanted = expected === undefined ? [] : [expected].flat();

  let response;
  try {
    response = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${path}  (cannot reach ${base}: ${error.message})`);
    return;
  }

  const html = await response.text();
  const marker = ERROR_MARKERS.find((value) => html.includes(value));
  const missing = wanted.filter((value) => !html.includes(value));

  if (response.status !== 200 || marker || missing.length > 0) {
    failures += 1;
    console.log(
      `  FAIL  ${path}  HTTP ${response.status}` +
        (marker ? ` (${marker})` : "") +
        (missing.length > 0 ? ` (missing ${missing.map((v) => `"${v}"`).join(", ")})` : ""),
    );
    return;
  }
  console.log(`  pass  ${path}`);
}

console.log(`Smoke testing ${base}\n`);

let teacherCookie;
let studentCookie;
try {
  teacherCookie = await sessionCookie(TEACHER.email, TEACHER.password);
  studentCookie = await sessionCookie(STUDENT.email, STUDENT.password);
} catch (error) {
  console.error(`${error.message}\n`);
  console.error(
    "Set SMOKE_TEACHER_EMAIL / SMOKE_TEACHER_PASSWORD / SMOKE_STUDENT_EMAIL /\n" +
      "SMOKE_STUDENT_PASSWORD to real accounts in this project and retry.",
  );
  process.exit(1);
}

console.log("Teacher pages");
await check("/teacher", teacherCookie, "Best performer");
await check("/teacher/students", teacherCookie, "Students");
await check("/teacher/activity", teacherCookie, "Trade activity");
await check("/teacher/leaderboard", teacherCookie, "Leaderboard");
await check("/teacher/controls", teacherCookie, "Trading");
await check("/teacher/competitions", teacherCookie, "Competition");

console.log("\nStudent pages");
await check("/student", studentCookie, "Portfolio");
await check("/student/market", studentCookie, "Market");
await check("/student/holdings", studentCookie, "Portfolio");
await check("/student/activity", studentCookie, "Activity");
await check("/student/watchlist", studentCookie, "Watchlist");
await check("/student/leaderboard", studentCookie, "Leaderboard");
// News is provider-backed and cached, so it renders whether or not the daily
// Alpha Vantage allowance is still available — but it must always render.
await check("/student/news", studentCookie, "News");

console.log(
  failures === 0
    ? `\n${checked}/${checked} pages rendered`
    : `\n${checked - failures}/${checked} pages rendered — ${failures} failing`,
);

process.exit(failures === 0 ? 0 : 1);
