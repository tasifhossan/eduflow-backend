# ⚙️ EduFlow Backend — Express 5 REST API & Assessment Service

> High-performance multi-branch coaching center REST API, fee ledger, and digital assessment service built with Express.js 5, TypeScript, Prisma ORM v6, PostgreSQL, and Google Gemini AI.

[![Express.js](https://img.shields.io/badge/Express.js-5.2-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x--7.x-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-v6.19-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-API-8E75C2?style=for-the-badge&logo=google-gemini&logoColor=white)](https://ai.google.dev/)
[![Zod](https://img.shields.io/badge/Zod-3.x--4.x-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev/)

---

## 📌 Table of Contents

- [About the Project](#-about-the-project)
- [Project Overview](#-project-overview)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Backend Architecture & Request Lifecycle](#-backend-architecture--request-lifecycle)
- [Database Schema & Models](#-database-schema--models)
- [Folder Structure](#-folder-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Environment Variables](#-environment-variables)
- [Database Migration & Seeding](#-database-migration--seeding)
- [Running the Backend](#-running-the-backend)
- [Testing & Verification Suite](#-testing--verification-suite)
- [API Reference](#-api-reference)
- [Frontend Integration](#-frontend-integration)
- [How to Contribute](#-how-to-contribute)
- [License](#-license)
- [Contact](#-contact)

---

## 💡 About the Project

The **EduFlow Backend API** is the core operational, assessment, and financial engine powering the EduFlow coaching center management platform. It manages tenant branch isolation, automated exam grading, fee ledger accounting, weekly routine scheduling, attendance tracking, and transactional guardian notifications.

Designed as an independent REST API microservice, it exposes strictly typed JSON endpoints consumed by the separate [EduFlow Frontend Web Application](https://github.com/tasifhossan/eduflow-frontend).

---

## 🧭 Project Overview

- **Multi-Tenant Isolation**: Enforces tenant data isolation by branch ID across all database operations, with an automated 118-call cross-branch security verification matrix.
- **Enterprise Accounting**: Eliminates floating-point rounding errors by handling monetary dues, adjustments, charges, and payments with exact 2-decimal arithmetic and monotonic receipt sequences.
- **Resilient Assessment Engine**: Evaluates online MCQs with deterministic seed shuffling and autosave heartbeats, allows subjective written answer grading, and ranks offline physical paper exam cohorts using competition tie rankings (`1, 1, 3`).
- **AI-Powered Diagnostics**: Integrates Google Gemini (`@google/genai`) for academic student tutoring and automated administrative insights.

---

## ✨ Key Features

### 🏛️ 1. Multi-Tenant Branch Scoping & RBAC
- **6 Discrete System Roles**:
  - `SUPER_ADMIN`: Cross-branch administrative access, center configuration, branch lifecycle, and audit logs.
  - `ADMIN`: Assigned branch management, admissions, fee policies, teacher allocations, and enrollments.
  - `TEACHER`: Assigned batch routine access, lecture join links, attendance entry, exam authoring, and grading.
  - `STUDENT`: Timed exam sessions, personal fee receipts, routine calendars, and AI academic chat.
  - `GUARDIAN`: Multi-child linkage, real-time absence alerts, fee receipts, and academic report cards.
  - `ACCOUNTANT`: Payment collection, gap-free receipt issuing, fee reversals, and dues generation.
- **Strict Role-Gating**: 151 endpoints declare explicit `authorize()` role gates, validated against an automated 7-principal audit matrix.

### 💰 2. Double-Decimal Fee Ledger & Receipts
- **Ledger Architecture**: Separate models for `FeeCharge`, `FeeAdjustment`, `Payment`, `PaymentAllocation`, and `PaymentReversal`.
- **Gap-Free Receipts**: Thread-safe atomic receipt sequence increments per branch.
- **Automated Monthly Dues**: Idempotent batch-level dues generation with `dryRun` evaluation previews.
- **Audit Trails**: Payment reversals mandate administrative reason tracking; configuration changes log old and new fee values as formatted 2-decimal strings.
- **CSV Security**: All fee exports sanitize cells to prevent spreadsheet formula injection attacks (`=`, `+`, `-`, `@`).

### 📝 3. Digital & Physical Assessment Engine
- **Deterministic MCQ Shuffling**: Question and option orders are seeded per student ID to prevent collusion while maintaining reproducible grading.
- **Strict Answer Secrecy**: Correct answer keys (`isCorrect`) are concealed before, during, and while the test window remains open.
- **Autosave & Deadlines**: Students send periodic answer heartbeats; exams auto-finalize at deadline.
- **Competition Rankings**: Leaderboard computations handle tied scores appropriately (e.g. `1, 1, 3`).
- **Soft Deletion & Restoration**: Batches and tests support soft archiving without losing historical student scores.

### 📅 4. Attendance, Alerts & Academics
- **Attendance Registry**: Daily batch records (`PRESENT`, `ABSENT`, `LATE`) with future-date guards and teacher edit windows.
- **Transactional Email Alerts**: Event-driven email dispatches to guardians via Brevo HTTP API or Nodemailer SMTP fallback.
- **Weekly Routine Engine**: Generates lectures from routine slots with UTC normalization (`Asia/Dhaka`).
- **Join Window Access Gating**: Online class meeting links and passcodes are concealed from student and guardian payloads outside the active class join window.

### 🤖 5. Google Gemini AI Integration
- **Student Academic Tutor**: Powered by `@google/genai` (Gemini 3.5 Flash Lite) with character limits, prompt injection mitigation, and in-memory daily rate limit quotas.
- **Director Strategic Insights**: Automated analysis detecting student attendance drops and test weaknesses across batches.

---

## 🛠️ Tech Stack

<p align="center">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=nodejs,express,ts,postgres,prisma" alt="Backend Tech Stack" />
  </a>
</p>

- **Runtime Environment:** Node.js (v20+ / v24 LTS)
- **Framework:** Express.js 5.2
- **Language:** TypeScript 7 executed with `tsx`
- **Database & ORM:** PostgreSQL (Neon serverless or local) managed with Prisma v6.19
- **Validation:** Zod v4 schemas for request bodies, query strings, and path parameters
- **Authentication & Security:** HTTP-only JWT cookies, Helmet, CORS, BCrypt, `express-rate-limit`
- **AI SDK:** `@google/genai` v2.30
- **Media Asset Storage:** Cloudinary SDK v2
- **Email Delivery:** Brevo HTTP API with Nodemailer SMTP fallback

---

## 🏗️ Backend Architecture & Request Lifecycle

```mermaid
flowchart TD
    Req["Incoming HTTP Request"] --> Helmet["Helmet (Security Headers)"]
    Helmet --> Cors["CORS (Allowed FRONTEND_URL with Credentials)"]
    Cors --> RateLimiter["Express Rate Limiter"]
    RateLimiter --> CookieParser["Cookie Parser"]
    CookieParser --> Auth{"authenticate middleware"}
    
    Auth -- "Valid JWT in Cookie" --> RoleGate{"authorize(Role...) gate"}
    Auth -- "Invalid / Missing" --> Anonymous["Public Endpoints or 401"]
    
    RoleGate -- "Authorized" --> BranchScope["branchScope middleware (Tenant Isolation)"]
    RoleGate -- "Forbidden" --> Err403["403 Forbidden"]
    
    BranchScope --> Zod["Zod Validation Schema"]
    Zod -- "Invalid Payload" --> Err400["400 Validation Error"]
    Zod -- "Valid" --> Controller["Route Controller Action"]
    
    Controller --> AuditLog["Audit Logging Utility"]
    Controller --> Prisma["Prisma ORM Client v6"]
    Prisma --> Postgres[("PostgreSQL Database")]
    Controller -.-> Gemini["Google Gemini API (@google/genai)"]
    Controller -.-> Cloudinary["Cloudinary API"]
    Controller -.-> Brevo["Brevo HTTP / SMTP Mailer"]
```

---

## 🗄️ Database Schema & Models

The backend schema (`prisma/schema.prisma`) encompasses 43 normalized models organized into modular domains:

| Domain | Key Models | Purpose |
| :--- | :--- | :--- |
| **Tenancy & Identity** | `Branch`, `User`, `PasswordResetToken`, `GuardianLink` | Tenant partitioning, credentials, staff-provisioning, guardian linking |
| **Governance & Audit** | `AuditLog`, `GuardianInfoChangeLog` | System audit trail recording actor, entities, and 2-decimal fee diffs |
| **Academics** | `Subject`, `Chapter`, `Batch`, `Enrollment`, `RoutineSlot`, `Lecture` | Syllabus mapping, weekly routines, enrollments, online join windows |
| **Assessments** | `Test`, `Question`, `Option`, `StudentAnswer`, `TestAttempt`, `AttemptAnswer`, `Result` | Seed-shuffled MCQs, written submissions, autosave, offline ranks |
| **Financial Ledger** | `FeeCharge`, `FeeAdjustment`, `Payment`, `PaymentAllocation`, `PaymentReversal`, `ReceiptSequence`, `FeePayment` | Cent-for-cent ledger, gap-free receipt numbers, monthly dues, reversals |
| **Attendance** | `Attendance` | Daily status records (`PRESENT`, `ABSENT`, `LATE`), low-attendance reporting |
| **Homework & Files** | `Assignment`, `AssignmentSubmission`, `Attachment` | Assignment submissions, grading rubrics, signed Cloudinary download URLs |
| **Communications** | `Notice`, `Notification`, `Enquiry`, `EnquiryNote` | In-app alerts, admissions pipeline with atomic student conversion |
| **Public & Settings** | `BlogPost`, `Testimonial`, `ContactMessage`, `NewsletterSubscriber`, `FaqItem`, `CenterSettings` | Public landing content, branding customization, feature flags |
| **Report Cards** | `ReportPeriod`, `ReportRemark` | GPA calculations, grading scale evaluations, safe CSV exports |

---

## 📁 Folder Structure

```plaintext
backend/
├── prisma/
│   ├── schema.prisma           # Prisma schema definition (43 models & relations)
│   ├── migrations/             # SQL DDL migration files
│   └── seed-demo-content.ts    # Demo database seeding script
├── scripts/
│   ├── smoke.ts                # 74-check end-to-end smoke test suite
│   ├── branch-isolation.ts     # Cross-branch tenant isolation security suite
│   ├── role-matrix.ts          # 151-endpoint role authorization matrix audit
│   ├── reconcile-fees.ts       # Cent-for-cent financial ledger reconciliation
│   ├── check-deploy.ts         # Pre-deployment production security audit
│   └── init-center.ts          # Center initialization utility
├── src/
│   ├── config/                 # Environment variables and constants
│   ├── controllers/            # Request handlers (Auth, Batches, Fees, Tests, etc.)
│   ├── middleware/             # Authenticate, authorize, branchScope, noCache
│   ├── routes/                 # 36 Express router definitions
│   ├── utils/                  # Audit, JWT, Mailer, LLM, Prisma client singletons
│   ├── validators/             # Zod input validation schemas
│   └── index.ts                # Server bootstrap, Express app setup, and router mounting
├── dist/                       # Compiled TypeScript production output
├── tsconfig.json               # TypeScript compiler configuration
└── package.json                # Project dependencies and script runner commands
```

---

## 📋 Prerequisites

- **Node.js**: `v20.18.0` or higher (verified on `v24.15.0 LTS`)
- **npm**: `v10.x` or higher
- **PostgreSQL**: PostgreSQL 15+ database instance (or a [Neon](https://neon.tech) cloud database)
- **Git**

---

## 🚀 Installation & Setup

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and fill in your PostgreSQL credentials and JWT secret (see table below).*

---

## 🔐 Environment Variables

Configure the following variables in `backend/.env`:

| Variable | Description | Required | Safe Example / Default |
| :--- | :--- | :---: | :--- |
| `PORT` | HTTP server listening port | No | `5000` |
| `NODE_ENV` | Application environment mode (`development`, `production`, `test`) | No | `development` |
| `DATABASE_URL` | Pooled PostgreSQL connection URL (`?pgbouncer=true&connection_limit=5`) | **Yes** | `postgresql://user:pass@host:5432/eduflow?pgbouncer=true` |
| `DIRECT_URL` | Direct unpooled connection URL (required by Prisma for DDL migrations) | **Yes** | `postgresql://user:pass@host:5432/eduflow` |
| `JWT_SECRET` | Secret key for signing authentication cookies (min 32 characters) | **Yes** | `your-secure-random-32-char-secret-string` |
| `FRONTEND_URL` | Allowed origin for CORS headers | **Yes** | `http://localhost:3000` |
| `GEMINI_API_KEY` | Google Gemini API key for student AI tutor & admin insights | No | `AIzaSy...` (endpoints return 503 if omitted) |
| `LLM_MODEL` | Gemini model identifier | No | `gemini-3.5-flash-lite` |
| `LLM_DAILY_LIMIT`| In-memory daily request limit guard for AI chats | No | `200` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name for homework attachments | No | `your_cloud_name` |
| `CLOUDINARY_API_KEY` | Cloudinary API key | No | `your_api_key` |
| `CLOUDINARY_API_SECRET`| Cloudinary API secret | No | `your_api_secret` |
| `BREVO_API_KEY` | Brevo transactional email API key | No | `xkeysib-...` |
| `BREVO_SENDER_EMAIL` | Verified sender email address | No | `notifications@yourdomain.com` |
| `MAIL_STUB` | When `true`, stubs email delivery for local development without sending | No | `true` |
| `DEMO_MODE` | Enables demo login endpoints (`/api/auth/demo`) | No | `true` |
| `ALLOW_DEMO_SEED` | Required flag to permit demo seeding scripts | No | `true` |

---

## 💾 Database Migration & Seeding

1. **Generate Prisma Client and apply migrations:**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

2. **(Optional) Seed sample coaching cohorts, branches, and exams:**
   ```bash
   npm run seed:demo
   ```

3. **Inspect the database using Prisma Studio:**
   ```bash
   npm run prisma:studio
   # Studio available at http://localhost:5555
   ```

---

## 🏃 Running the Backend

### Development Mode (with hot-reload via `tsx`):
```bash
npm run dev
# Server running at http://localhost:5000
```

### Production Build & Execution:
```bash
npm run build
npm run start
```

---

## 🧪 Testing & Verification Suite

The backend repository includes an extensive automated verification suite:

```bash
# 1. Full End-to-End Smoke Test Suite (74 checks, 440+ assertions)
npm run test:smoke

# 2. Cross-Branch & Role Tenant Isolation Matrix (37 routes, 118 calls, 0 leaks)
npm run test:isolation

# 3. Role Authorization Matrix Audit (151 endpoints x 7 caller contexts)
npm run role-matrix

# 4. Cent-for-Cent Financial Ledger Balance Reconciliation
npx tsx scripts/reconcile-fees.ts

# 5. Production Pre-Deployment Verification Gate
npm run check:deploy
```

---

## 📡 API Reference

Below is a categorized reference of the core API endpoints:

| Domain | Method | Endpoint | Allowed Roles | Description |
| :--- | :---: | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/auth/login` | Public | Authenticates credentials and sets HTTP-only `token` cookie |
| | `POST` | `/api/auth/logout` | Public | Clears `token` cookie |
| | `GET` | `/api/auth/me` | Authenticated | Returns authenticated user profile |
| | `POST` | `/api/auth/change-password` | Authenticated | Changes password (requires current password verification) |
| | `POST` | `/api/auth/register` | `ADMIN`, `SUPER_ADMIN` | Staff provisioning for new users |
| **Users** | `GET` | `/api/users` | `ADMIN`, `TEACHER` | Lists users scoped to caller's branch |
| | `PATCH` | `/api/users/:userId/branch` | `SUPER_ADMIN` | Audited branch assignment update |
| | `POST` | `/api/users/:id/reset-password` | `ADMIN`, `SUPER_ADMIN` | Generates temporary password |
| | `POST` | `/api/users/import` | `ADMIN`, `SUPER_ADMIN` | Bulk CSV import with partial validation |
| **Batches** | `GET` | `/api/batches` | Role-Scoped | Lists batches in branch (or public catalog) |
| | `POST` | `/api/batches` | `ADMIN` | Creates new academic/admission batch |
| | `PATCH` | `/api/batches/:id/fee` | `ADMIN`, `ACCOUNTANT` | Updates monthly tuition fee with structured audit log |
| | `DELETE`| `/api/batches/:id` | `ADMIN` | Soft archives batch |
| **Exams** | `POST` | `/api/tests` | `ADMIN`, `TEACHER` | Creates MCQ, written, mixed, or offline paper exam |
| | `POST` | `/api/tests/:testId/start` | `STUDENT` | Begins timed attempt; applies deterministic seed shuffle |
| | `POST` | `/api/tests/:testId/autosave` | `STUDENT` | Periodic answer autosave during active exam |
| | `POST` | `/api/tests/:testId/submit` | `STUDENT` | Submits exam and triggers automated MCQ scoring |
| | `GET` | `/api/tests/:id/results` | `ADMIN`, `TEACHER` | Batch leaderboard with competition ranking ties |
| **Attendance**| `POST` | `/api/attendance` | `ADMIN`, `TEACHER` | Records batch attendance (`PRESENT`, `ABSENT`, `LATE`) |
| | `GET` | `/api/attendance/sheet` | `ADMIN`, `TEACHER` | Monthly attendance sheet matrix |
| | `GET` | `/api/attendance/low` | `ADMIN`, `TEACHER` | Identifies students below attendance thresholds |
| **Fees** | `POST` | `/api/fees/charges/generate` | `ADMIN`, `ACCOUNTANT` | Idempotent monthly tuition dues generator |
| | `POST` | `/api/fees/payments` | `ADMIN`, `ACCOUNTANT` | Records payment & generates gap-free receipt number |
| | `POST` | `/api/fees/payments/:id/reverse` | `ADMIN`, `ACCOUNTANT` | Reverses payment with mandatory administrative note |
| | `GET` | `/api/fees/reports/monthly` | `ADMIN`, `ACCOUNTANT` | Financial summary of collected revenue vs outstanding dues |
| **Admissions**| `POST` | `/api/enquiries` | Public / `ADMIN` | Captures admissions lead |
| | `POST` | `/api/enquiries/:id/convert` | `ADMIN` | Atomically creates Student, Guardian, Enrollment & Fee |
| **AI** | `POST` | `/api/ai/chat` | `STUDENT` | Student academic AI tutor chat (Gemini API) |
| | `GET` | `/api/ai/insights` | `ADMIN`, `SUPER_ADMIN` | Executive diagnostic insights on cohorts |

---

## 🔗 Frontend Integration

The backend is built to serve the independent [EduFlow Frontend Web Application](https://github.com/tasifhossan/eduflow-frontend).

### Cookie-Based Credentialing
- The backend transmits authenticated sessions via an HTTP-only JWT cookie named `token`.
- Browser clients communicating directly with the backend must send `credentials: 'include'`:
  ```ts
  fetch('http://localhost:5000/api/auth/me', {
    credentials: 'include',
  });
  ```
- In Next.js, configure a proxy rewrite in `next.config.ts` so that browser requests go to `/api/*` on the same origin, avoiding third-party cookie restrictions:
  ```ts
  // next.config.ts (in frontend repository)
  const nextConfig = {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: `${process.env.BACKEND_INTERNAL_URL || 'http://localhost:5000'}/api/:path*`,
        },
      ];
    },
  };
  ```

---

## 🤝 How to Contribute

1. Fork the repository (`https://github.com/tasifhossan/eduflow-backend/fork`).
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'feat: Add some AmazingFeature'`).
4. Ensure all gates pass:
   ```bash
   npx tsc --noEmit
   npm run test:smoke
   ```
5. Push to the branch (`git push origin feature/AmazingFeature`).
6. Open a Pull Request with a clear description and testing evidence.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## 📬 Contact

**Lead Developer:** [Tasif Hossan](https://github.com/tasifhossan)  
**Backend Repository:** [https://github.com/tasifhossan/eduflow-backend](https://github.com/tasifhossan/eduflow-backend)  
**Frontend Repository:** [https://github.com/tasifhossan/eduflow-frontend](https://github.com/tasifhossan/eduflow-frontend)
