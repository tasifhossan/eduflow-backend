# EduFlow Backend Day Report & Verification Summary

**Date**: 2026-10-18  
**Branch**: `STN`  
**Test Suite**: `npm run test:smoke` (`scripts/smoke.ts`)  
**Overall Result**: **31 PASSED / 0 FAILED (100% Pass Rate)**

---

## 1. Smoke Test Results Summary

| Check # | Status | Check Description | Verified Behaviors & Details |
|:---:|:---:|---|---|
| **1** | **PASS** | Forged JWT secret rejection | Tokens signed with arbitrary keys return HTTP 401 Unauthorized. |
| **2** | **PASS** | Register privilege escalation blocked | Demo ADMIN attempting to register `SUPER_ADMIN` returns 400; attempting to register `ADMIN` returns 400/403. |
| **3** | **PASS** | Register has no Set-Cookie header | Successful registration returns 201 without setting an auth cookie (explicit login required). |
| **4** | **PASS** | CORS origin protection | Requests from unauthorized origins (`https://evil.vercel.app`) receive no CORS headers; configured `FRONTEND_URL` origin receives credentials and headers. |
| **5** | **PASS** | Helmet security headers | Verified presence of `X-Content-Type-Options: nosniff`, `X-Frame-Options`, and Helmet defaults. |
| **6** | **PASS** | Deleted user token rejection | Active token belonging to a deleted user returns 401 Unauthorized on `/api/auth/me`. |
| **7** | **PASS** | Demo auth guards | `SUPER_ADMIN` rejected with 400; server instance running with `DEMO_MODE=false` returns 404 for all demo logins. |
| **8** | **PASS** | Google OAuth input validation | Garbage idToken returns 401/400 (never 500); missing request body returns 400. |
| **9** | **PASS** | Zero password leaks across all responses | Recursive deep-scan on every JSON response across the entire test suite confirms 0 instances of `password` or `passwordHash` keys. |
| **10** | **PASS** | Hidden `isCorrect` before submission | Student fetching test questions during open window receives options with `isCorrect` stripped. |
| **11** | **PASS** | Non-enrolled student batch isolation | Student not enrolled in a batch receives 403 Forbidden on test listings, individual test, and routine slots. |
| **12** | **PASS** | Exam window timing validation | Attempting submission before `testDate` returns 400; submission after deadline returns 400. |
| **13** | **PASS** | Race-condition proof concurrent submission | 5 simultaneous submissions by one student result in exactly one 201 Created and four 400 Bad Requests; database contains exactly one set of answers. |
| **14** | **PASS** | Results hide `isCorrect` during open window | After submission while window is open, `/api/tests/:id/my-result` and `/api/tests/:id` hide `isCorrect`. |
| **15** | **PASS** | Cross-branch tenant isolation for ADMIN | Admin cannot read (404) or modify (403) batches belonging to another branch. |
| **16** | **PASS** | Student payment & profile scoping | Student sees only their own payments on `/api/tables/payments` and cannot modify other student profiles (403). |
| **17** | **PASS** | Multi-tenant table filtering across roles | Admin table results are strictly branch-scoped; Guardian sees only linked students' data. |
| **18** | **PASS** | Public batches filtering, clamping & sorting | Validated filters (subject, branch, type, fee, rating), limit clamped to max 24, search query `q`, and sort orders. |
| **19** | **PASS** | Public batch slug details & PII omission | Fetching by slug returns full public details; unknown slug returns 404; student PII omitted. |
| **20** | **PASS** | Public landing data endpoints | `/api/public/filters`, `/stats`, `/branches`, `/teachers` return 200 OK with expected shapes; all faculty profiles have public flags. |
| **21** | **PASS** | Review access lifecycle & deduplication | Non-enrolled student review rejected with 403; enrolled student creates review (201); duplicate review returns 409; deletion by another user returns 403. |
| **22** | **PASS** | Contact form honeypot & rate limit | Valid submission returns 200; honeypot `website` field filled returns 200 silently without database save; invalid email returns 400; 6th request in an hour returns 429. |
| **23** | **PASS** | Newsletter subscription idempotency | Repeated subscriptions with same email return 200 with exactly one row stored. |
| **24** | **PASS** | Content publishing filters | Unpublished/draft blog posts are excluded from listings and return 404; testimonials and FAQs return data. |
| **25** | **PASS** | Chart role authorization & aggregate fidelity | `/api/charts/*` returns 200 for authorized roles, 403 for unauthorized; numbers match direct Prisma aggregates. |
| **26** | **PASS** | PATCH /api/me security immunity | Cannot mutate `email`, `role`, or `branchId`; password update requires valid current password and strong new password. |
| **27** | **PASS** | AI Chat validation, injection defense & 503 | Messages >10 or length >500 rejected with 400; prompt injection attempt fails to reveal system prompt; invalid/missing API key returns shielded 503 without leaking provider text. |
| **27b** | **PASS** | In-memory daily quota guard & cache bypass | Server running with `LLM_DAILY_LIMIT=2` triggers friendly 429 on 3rd distinct request; repeated query returns cached 200 without consuming quota. |
| **28** | **PASS** | AI Insights auth & anonymization | Unauthenticated returns 401; Student returns 403; Admin returns 200 with structured anomalies; verified no PII is transmitted to LLM. |
| **28b** | **PASS** | LLM SDK dependency compliance | Confirmed `@google/genai` installed; `@anthropic-ai/sdk` completely purged from `package.json` and `src/`. |
| **29** | **PASS** | Brute-force login rate limiting | 11 failed login attempts from same IP trigger HTTP 429 lockout by attempt 11. |

---

## 2. Audit Findings Status

### Closed Findings
- **SEC-01**: Admin privilege escalation prevented in `/api/auth/register`.
- **SEC-02**: CORS origin sanitization hardened (no `.vercel.app` wildcards).
- **SEC-03**: No auth cookie emitted on user registration.
- **SEC-04**: Security headers enforced via Helmet middleware.
- **SEC-05**: Deleted or deactivated user sessions immediately rejected.
- **SEC-06**: Google OAuth ID token validation with sanitized error outputs.
- **SEC-07**: Zero password exposure across all JSON responses.
- **SEC-08**: IP-based rate limiting on sensitive authentication routes.
- **EXAM-01**: Test answer options hide `isCorrect` until window closes.
- **EXAM-02**: Batch scoping enforced for tests and routine schedules.
- **EXAM-03**: Strict start date and submission deadline validation.
- **EXAM-04**: Race-condition protection on test submissions via database unique constraints.
- **TENANT-01**: Multi-tenant branch isolation across administrative endpoints.
- **TENANT-02**: Student and Guardian data scoping on payment and attendance tables.
- **PUB-01**: Clamping, filtering, and sorting verified on public batch endpoints.
- **CONT-01**: Enrolled-student-only review lifecycle with 409 conflict detection.
- **CONT-02**: Honeypot field and 5/hour rate limiting on contact form.
- **CONT-03**: Idempotent newsletter subscription.
- **AI-01**: Input constraints, prompt injection shields, and 503 fallback error masking.
- **AI-02**: Daily quota enforcement with in-memory chat caching.
- **AI-03**: Administrative operational insights with zero PII transmission.
- **AI-04**: Full migration to Google GenAI SDK (`@google/genai`).

### Deferred Findings (Backlog)
1. **Float to Decimal Migration**: Migrating fee and financial fields in `schema.prisma` from `Float` to `Decimal` is deferred to a planned database maintenance window to prevent table lockups in production.
2. **Full TestAttempt State Machine**: Advanced multi-step attempt workflow (start attempt -> client heartbeats -> timer sync -> submit attempt) will be introduced in Exam Engine Phase 2.
3. **GET-Mutating Rank Calculation**: Rank updates in `getTestResults` will be decoupled from the GET read handler and moved into an asynchronous post-submission background job.
4. **Token Versioning & Blacklist**: Storing a `tokenVersion` on the `User` model for global revocation upon password reset is planned for the authentication refresh phase.

---

## 3. Real Bugs Uncovered and Fixed

During the execution of the smoke test suite, the following real bugs were detected and resolved:

### 1. Public Batch Validator Pagination Clamping Bug
- **File**: `src/validators/public.validator.ts`
- **Issue**: `publicBatchesQuerySchema` had a `.max(24)` constraint on `limit`. When clients passed `limit=100`, Zod rejected the request with `400 Bad Request` instead of letting `parsePagination` clamp the limit to 24. Additionally, hyphenated sort options (`fee-asc`, `fee-desc`, `rating-desc`) were rejected.
- **Fix**: Removed the strict `.max(24)` from Zod so `parsePagination` clamps large limits gracefully. Added hyphenated sort options to the enum.

### 2. Public Batch Sort Ordering Inconsistency
- **File**: `src/controllers/public.controller.ts`
- **Issue**: The controller only handled snake_case sort values (`fee_asc`, `fee_desc`), ignoring hyphenated query params (`fee-asc`, `fee-desc`, `rating-desc`).
- **Fix**: Added switch-case handlers mapping hyphenated sort values to appropriate Prisma `orderBy` directives.

### 3. AI Grounding Data Selection Crash
- **File**: `src/controllers/ai.controller.ts`
- **Issue**: The grounding query in `chatWithAi` selected `phone` and `email` on `prisma.branch.findMany` and `code` on `prisma.batch.findMany`. None of these fields exist on those models in `schema.prisma`, causing `PrismaClientValidationError` and crashing all AI chat calls with HTTP 500.
- **Fix**: Removed `phone` and `email` from Branch selection and removed `code` from Batch selection. Updated knowledge string formatting accordingly.

### 4. LLM Deprecation, Client Timeout & Security Hardening
- **File**: `src/utils/llm.ts`
- **Issue**: Google GenAI deprecated model name `gemini-2.5-flash` for new users (returning 404 ApiError). Furthermore, default 15s timeout caused HTTP 504 Deadline Exceeded when upstream API had high latency. Additionally, stub mode needed security guards against unauthorized production invocation.
- **Fix**: Added fallback redirect to `gemini-3.5-flash-lite`, increased client timeout to 30,000ms, and guarded `LLM_STUB` so it is strictly disabled whenever `process.env.NODE_ENV === 'production'`.

### 5. Monolithic Auth Rate Limiter Cross-Contamination
- **File**: `src/index.ts`
- **Issue**: A single `authLimiter` instance was mounted across `/login`, `/register`, and `/google`. When 10 failed login attempts were executed during security tests, subsequent registration and Google authentication checks were prematurely locked out with 429.
- **Fix**: Split into three dedicated rate limiters: `loginLimiter` (10/15m), `registerLimiter` (30/15m), and `googleLimiter` (30/15m).

---

## 4. Database Drift & Migration Audit (`prisma migrate status`)

A full schema drift analysis was performed against the PostgreSQL database:

```text
9 migrations found in prisma/migrations
Database schema is up to date!
```

- **Applied Migrations List**:
  1. `20260829093351_init`
  2. `20260829164627_add_subject_chapter_batch`
  3. `20260909153026_add_notices_and_resources`
  4. `20260909155700_add_guardian_and_payments`
  5. `20260911163617_exam_system_v1`
  6. `20261016170642_add_attendance_marked_by`
  7. `20261016172605_add_payment_models`
  8. `20261016173000_add_landing_models`
  9. `20261016174500_add_public_batch_fields`
- **Drift Status**: **0 schema drift**. All database tables, columns, indexes, and constraints exactly mirror `prisma/schema.prisma`.

---

## 5. Dependency Security Audit (`npm audit`)

Running `npm audit` on `backend/` reported **6 vulnerabilities** (1 moderate, 4 high, 1 critical):

| Package | Severity | Vulnerability ID / Summary | Impact & Remediation Analysis |
|---|:---:|---|---|
| `proxy-addr` (1.1.0 - 2.0.7) | **Critical** | GHSA-jqcg-44mw-7w3h: IP spoofing via IPv4-mapped IPv6 trust subnet | Used by Express for `req.ip`. Remediated in Express 5 ecosystem via `npm audit fix`. |
| `deepmerge-ts` (<8.0.0) | **High** | GHSA-ggr8-5vv4-36mx: Stack exhaustion when merging recursive object graphs | Dev-dependency introduced by `@prisma/config` in Prisma CLI tooling. Requires Prisma 7+ to fully eliminate. |
| `nodemailer` (<=10.0.5) | **High** | GHSA-8m3c-c648-2xjj, GHSA-wmmp-3585-3rmp, GHSA-2x7j-588g-ccc2, GHSA-cc9r-2j5m-2m83, GHSA-6vj9-mwq6-2f5v, GHSA-8vvx-rff5-p5rq, GHSA-v53p-9fqp-m79j: Addressparser complexity & DoS vulnerabilities | Mailer utility. Remediated via `npm audit fix` (patch updates). |
| `qs` (2.2.5 - 6.15.3) | **Moderate** | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g: Bracket-key comma parsing array-limit bypass & DoS | Body parser dependency. Remediated via `npm audit fix`. |

- **Recommendation**: Apply non-breaking patches with `npm audit fix`. Do not run `npm audit fix --force` as that would force an upgrade to Prisma 7.10/8.0 which breaks Prisma 6 API signatures.

---

## 6. Duplicate Seed Rows & Legacy Data Audit

A programmatic query across all database tables uncovered the following data state:

### Duplicate Rows Analysis
- **Duplicate User Emails**: **0** (strict `@unique` constraint verified).
- **Duplicate User Names/Roles**: **0**.
- **Duplicate Batch Names per Branch**: **0**.
- **Duplicate Enrollments (`[studentId, batchId]`)**: **0**.
- **Duplicate Attendance (`[studentId, batchId, date]`)**: **0**.
- **Duplicate FeePayments (`[studentId, batchId, period]`)**: **0**.
- **Duplicate Branch Names**: **1 duplicate name found**:
  - `cmtuahlrj0005ujx8i7qrvy21` ("Dhanmondi Branch", Road 27, created 2026-09-09) — 0 users, 0 batches. Legacy row from early test runs.
  - `branch-dhanmondi-branch` ("Dhanmondi Branch", House 14, Road 7, created 2026-10-16) — 17 users, 5 batches. Active production-seed branch.
  - *Recommendation*: Safely prune legacy orphan branch `cmtuahlrj0005ujx8i7qrvy21`.

### Legacy Placeholder Batches
The database contains **16 batches total**. 12 batches belong to the modern October 2026 curriculum seed across Dhanmondi, Uttara, and Mirpur branches. 4 legacy batches exist on the initial "Main Branch":
1. `Audit Batch 101` (`cmtubusjx000aujx867ihly2m`, created 2026-09-09) — 1 enrollment, 0 attendance, 0 tests, 0 payments.
2. `Batch X` (`cmtx6myg20006uj7g9ahfc3xo`, created 2026-09-11) — 2 enrollments, 0 attendance, 1 test ("Math Test"), 0 payments.
3. `Class 8 Physics` (`cmtemvqp80001ujf8klt0k3ax`, created 2026-08-29) — 4 enrollments, 4 attendance, 1 test, 3 payments.
4. `Class 8 Math` (`cmtenb3km000jujf8ke02ejuf`, created 2026-08-29) — 5 enrollments, 21 attendance, 2 tests, 4 payments.

Also noted 7 legacy test user accounts created in September 2026 (`superadmin_test@eduflow.com`, `admin_test6@eduflow.com`, `linked_student_...`, `unlinked_student_...`, `guardian_...`, `studentA_...`, `studentB_...`).

---

## 7. Leftover Test Data & Smoke Fixture Verification

- **Smoke Fixture Cleanup**:
  - All test artifacts generated during smoke testing (`SMOKE-ExamBatch-1`, `SMOKE-UnenrolledBatch-2`, `SMOKE-OpenTest`, `SMOKE-TestBatch2`, `SMOKE-FutureTest`, `SMOKE-PastTest`, and `SMOKE-` users/contacts) were confirmed **100% purged** from the database.
  - `scripts/smoke.ts` cleanup routine was hardened with relational cascading (deleting tests and enrollments linked to test batches before attempting batch deletion) to ensure no future foreign-key constraint blocks cleanup.
- **Verification Query**:
  - Direct database queries for `name/title/email` containing `'smoke'` returned **0 rows**.

---

## 8. AI Runtime, Security Hardening & Quota Preservation

### `LLM_STUB` Production Protection
- **Security Guard Added**: In `src/utils/llm.ts`, the `LLM_STUB` environment variable and `stubClient` injection are guarded with:
  ```typescript
  const isProduction = process.env.NODE_ENV === 'production';
  if (stubClient && !isProduction) return stubClient;
  if (process.env.LLM_STUB === 'true' && !isProduction) return { ... };
  ```
- **Assurance**: Even if `LLM_STUB=true` were accidentally set in the hosting environment, the server **strictly ignores it in production**, preventing any unauthorized bypass of live AI functionality.

### AI Model Latency Benchmark
- **Model Fallback**: Updated to `gemini-3.5-flash-lite`.
- **Live Latency Benchmark**:
  - `gemini-2.5-flash`: ~20,000ms (high latency upstream).
  - `gemini-3.5-flash-lite`: **1,774ms (~1.8 seconds)** — 11x faster response turnaround with zero timeout risk.
- **Client Timeout**: Retained at 30,000ms safety margin.

### Free Quota Management
- Live Gemini API calls consume free tier quota.
- **Guideline**: For repeated regression runs of `npm run test:smoke`, launch the backend server with `LLM_STUB=true` (`$env:LLM_STUB="true"; npm run dev`). This tests all routing, validation, injection defenses, and rate limiters while using 0 external API calls. Live Gemini quota should only be expended during final integration sign-offs.

---

## 9. Verification Commands

- `npx tsc --noEmit`: 0 errors (clean compilation).
- `npx prisma validate`: Schema is valid.
- `npx prisma migrate status`: 9 migrations applied, schema up to date, 0 drift.
- `npm run test:smoke`: 31/31 checks PASS.
