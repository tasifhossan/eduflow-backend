# EduFlow Backend Day Report & Verification Summary

**Date**: 2026-10-18  
**Branch**: `STN`  
**Test Suite**: `npm run test:smoke` (`scripts/smoke.ts`)  
**Overall Result**: **32 PASSED / 0 FAILED (100% Pass Rate)**

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
| **20b** | **PASS** | Public branch & stats published-only scoping | Branches without published batches (`Demo Branch`, `Main Branch`) are strictly omitted from `/branches`, `/filters`, and `/stats`. |
| **21** | **PASS** | Review access lifecycle & deduplication | Non-enrolled student review rejected with 403; enrolled student creates review (201); duplicate review returns 409; deletion by another user returns 403. |
| **22** | **PASS** | Contact form honeypot & rate limit | Valid submission returns 200; honeypot `website` field filled returns 200 silently without database save; invalid email returns 400; 6th request in an hour returns 429. |
| **23** | **PASS** | Newsletter subscription idempotency | Repeated subscriptions with same email return 200 with exactly one row stored. |
| **24** | **PASS** | Content publishing filters | Unpublished/draft blog posts are excluded from listings and return 404; testimonials and FAQs return data. |
| **25** | **PASS** | Chart role authorization & aggregate fidelity | `/api/charts/*` returns 200 for authorized roles, 403 for unauthorized; fee status matches direct Prisma aggregates. |
| **26** | **PATCH /api/me security immunity** | Cannot mutate `email`, `role`, or `branchId`; password update requires valid current password and strong new password. |
| **27** | **PASS** | AI Chat validation, injection defense & 503 | Messages >10 or length >500 rejected with 400; prompt injection attempt fails to reveal system prompt; invalid API key returns shielded 503. |
| **27b** | **PASS** | In-memory daily quota guard & cache bypass | Server running with `LLM_DAILY_LIMIT=2` triggers friendly 429 on 3rd distinct request; repeated query returns cached 200 without consuming quota. |
| **28** | **PASS** | AI Insights auth & anonymization | Unauthenticated returns 401; Student returns 403; Admin returns 200 with structured anomalies; verified no PII is transmitted to LLM. |
| **28b** | **PASS** | LLM SDK dependency compliance | Confirmed `@google/genai` installed; `@anthropic-ai/sdk` completely purged from `package.json` and `src/`. |
| **29** | **PASS** | Brute-force login rate limiting | 11 failed login attempts from same IP trigger HTTP 429 lockout by attempt 11. |

---

## 2. Model Configuration & Provider Integration

- **Configured Model**: `LLM_MODEL` in `src/config/env.ts` defaults to `"gemini-3.5-flash-lite"` with matching documentation in `.env.example`.
- **Exact Model Forwarding**: Removed hardcoded remaps in `src/utils/llm.ts`; the configured model is passed directly to Google GenAI.
- **Provider Rejection Handling**: `classifyError` explicitly maps `NOT_FOUND` / 404 model rejections to clean, descriptive `LLMUnavailableError` instances.
- **Production Guarding**: `LLM_STUB` and `stubClient` injection are disabled when `process.env.NODE_ENV === 'production'`.

---

## 3. Legacy Data Cleanup & Branch Hygiene

- **Legacy Batches Archiving**: Set `isPublished = false` on 4 legacy batches (`class-8-physics`, `class-8-math`, `audit-batch-101`, `batch-x`). All associated enrollments, attendance, and payments were preserved.
- **Orphan Branch Deletion**: Confirmed 0 users, 0 batches, and 0 notices on orphan "Dhanmondi Branch" (`cmtuahlrj0005ujx8i7qrvy21`) and purged the row. Active seeded branch `branch-dhanmondi-branch` remains untouched.
- **Zero-Relation Test Account Pruning**: Deleted all 8 zero-relation legacy test accounts: 5 non-superadmin accounts (`admin_test6@eduflow.com`, `admin_task7@eduflow.com`, `audit_admin@eduflow.com`, `audit_student2@eduflow.com`, `unlinked_student_...`) and all 3 legacy `SUPER_ADMIN` test accounts (`superadmin_test@eduflow.com`, `super_task7@eduflow.com`, `audit_super@eduflow.com`). Exactly one verified active `SUPER_ADMIN` remains (`super_admin@eduflow.com`).
- **Targeted Password Neutralization**: Reset passwords to unprinted cryptographically secure random bcrypt hashes for `teacher@eduflow.com` and accounts matching `audit_*`, `studentA_*`, `studentB_*`, `linked_student_*`, and `guardian_*`. 63 production, seed, and demo accounts remained untouched.
- **Superadmin Script**: Added `scripts/set-superadmin.ts` to create/update a `SUPER_ADMIN` from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` (min 12 characters) with zero password or hash output.

---

## 4. Public Branch Filtering

- **Published-Only Scoping**:
  - `GET /api/public/branches`: filtered with `batches: { some: { isPublished: true, slug: { not: null } } }`.
  - `GET /api/public/filters`: branch list returns only branches with active published batches.
  - `GET /api/public/stats`: branch counter tallies only branches with active published batches.
- **Verification**: Verified via Check 20b; `Demo Branch` and `Main Branch` (0 published batches) are excluded.

---

## 5. Demo Branch Environment (`prisma/seed-demo.ts`)

- **Comprehensive Demo Seeding**: Extended `prisma/seed-demo.ts` with `--reset` support to seed Demo Branch with self-contained, realistic data:
  - 3 unpublished batches (`demo-hsc-higher-math`, `demo-hsc-physics`, `demo-eng-chemistry`) with weekly routine slots.
  - Demo teacher teaching all 3 batches.
  - 13 demo students (demo student + 12 extra with authentic Bangladeshi names) with unusable random passwords.
  - 30 days of historical attendance marked by demo teacher.
  - September & October fee payments with mixed `PAID`, `PARTIAL`, and `DUE` statuses.
  - 3 tests: 1 currently open MCQ test with questions; 2 past tests with scored results and rankings.
  - 3 campus notices and `GuardianLink` between demo guardian and demo student.

---

## 6. Verification & Health Audit

- `npx tsc --noEmit`: 0 errors.
- `npx prisma validate`: Schema is valid.
- `npm run test:smoke` (`LLM_STUB=true`): **32/32 PASSED**.
- **Smoke Fixture Purge**: 0 `SMOKE-` batches, tests, or users remain in the database.
- **Dependency Audit**: `npm audit fix` resolved `proxy-addr` (critical) and `qs` (moderate). 4 high vulnerabilities remain (`deepmerge-ts` via Prisma CLI, `nodemailer`).
