# EduFlow API Contract & Frontend Integration Guide

This document specifies the REST API contract for the EduFlow platform, providing frontend developers with all endpoint definitions, authentication conventions, payload requirements, and real response structures.

---

## 1. Frontend Integration Notes

### Cookie-Based Authentication
- The backend uses HTTP-only JWT cookies named `token`.
- All requests from web clients (browser fetch, axios, SWR, React Query) that communicate with authenticated endpoints **must** include credentials:
  ```ts
  // Native fetch example:
  fetch('/api/auth/me', {
    credentials: 'include',
  });

  // Axios example:
  axios.defaults.withCredentials = true;
  ```
- Cross-origin requests in development (`localhost:3000` to `localhost:5000`) must ensure `withCredentials: true` or `credentials: 'include'`. The backend responds with `Access-Control-Allow-Credentials: true` and mirrors allowed origins.

### Next.js API Rewrite Configuration
To simplify cookie handling, prevent CORS issues, and avoid cross-site cookie restrictions in modern browsers, configure a Next.js rewrite in `next.config.js` or `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
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

export default nextConfig;
```

### Required Frontend Environment Variables
Configure the following in `.env.local` for Next.js:
- `NEXT_PUBLIC_API_URL`: `http://localhost:5000/api` (or `/api` when rewrites are enabled)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID for frontend GIS button (`@react-oauth/google`)
- `NEXT_PUBLIC_APP_NAME`: `EduFlow`

### Standard Pagination Response Structure
All paginated endpoints across `/api/public/batches`, `/api/public/teachers`, and `/api/tables/*` return data using a unified envelope:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "total": 42,
      "page": 1,
      "limit": 10,
      "totalPages": 5
    }
  }
}
```

---

## 2. Public API Endpoints

### GET /api/public/batches
Search and filter published batches for the public course directory.

- **Auth**: None (Public)
- **Query Parameters**:
  - `page` (integer, optional, default: `1`)
  - `limit` (integer, optional, default: `10`, clamped to max `24`)
  - `q` (string, optional, search batch name, description, subject name)
  - `subjectId` (string cuid, optional)
  - `branchId` (string cuid, optional)
  - `type` (`ACADEMIC` | `ADMISSION`, optional)
  - `minFee` (number >= 0, optional)
  - `maxFee` (number >= 0, optional)
  - `minRating` (number 1-5, optional)
  - `sortBy` (`name-asc` | `name-desc` | `fee-asc` | `fee-desc` | `rating-desc` | `newest`, optional, default: `newest`)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cmvb9ltq00003ujig78p4m1b8",
        "name": "HSC 2025 Physics 1st Paper Intensive",
        "slug": "hsc-2025-physics-1st-paper-intensive",
        "type": "ACADEMIC",
        "classLevel": "HSC-1st-Year",
        "feeType": "MONTHLY",
        "feeAmount": 2500,
        "description": "Comprehensive HSC Physics course covering complete syllabus with weekly exams.",
        "imageUrl": "https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=600&q=80",
        "syllabus": ["Vector", "Motion in Straight Line", "Work, Energy & Power"],
        "highlights": ["Weekly MCQ & Written Tests", "OMR Evaluation", "Doubt Solving"],
        "subject": { "id": "cmvb9ltq00001ujig45m2z911", "name": "Physics" },
        "branch": { "id": "cmvb9ltpw0000ujigmsn02iy0", "name": "Mirpur Main Branch", "address": "Mirpur-10, Dhaka" },
        "teacher": { "id": "cmvb9ltpx0002ujigabc44123", "name": "Prof. Abul Kashem", "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80" },
        "stats": {
          "enrolledCount": 45,
          "reviewCount": 8,
          "averageRating": 4.8
        }
      }
    ],
    "pagination": {
      "total": 16,
      "page": 1,
      "limit": 10,
      "totalPages": 2
    }
  }
}
```
- **Error Codes**: `400 Bad Request` (invalid sort option, negative fee).

---

### GET /api/public/batches/:slug
Retrieve full public details for a single batch by URL slug.

- **Auth**: None (Public)
- **Path Parameters**: `slug` (string)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "id": "cmvb9ltq00003ujig78p4m1b8",
    "name": "HSC 2025 Physics 1st Paper Intensive",
    "slug": "hsc-2025-physics-1st-paper-intensive",
    "type": "ACADEMIC",
    "feeAmount": 2500,
    "feeType": "MONTHLY",
    "description": "Comprehensive HSC Physics course covering complete syllabus.",
    "imageUrl": "https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=600&q=80",
    "syllabus": ["Vector", "Dynamics", "Work & Power"],
    "highlights": ["Weekly Tests", "Class Notes"],
    "subject": { "name": "Physics" },
    "branch": { "name": "Mirpur Main Branch", "address": "Mirpur-10, Dhaka" },
    "teacher": { "name": "Prof. Abul Kashem", "avatarUrl": "https://images.unsplash.com/..." },
    "routineSlots": [
      { "dayOfWeek": "SUNDAY", "startTime": "16:00", "endTime": "17:30" },
      { "dayOfWeek": "TUESDAY", "startTime": "16:00", "endTime": "17:30" }
    ],
    "stats": {
      "enrolledCount": 45,
      "reviewCount": 8,
      "averageRating": 4.8
    }
  }
}
```
- **Security Guard**: Does NOT return student emails, phones, or private payment data.
- **Error Codes**: `404 Not Found` (unknown slug or unpublished batch).

---

### GET /api/public/filters
Fetch filter facet values for building search sidebars.

- **Auth**: None (Public)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "subjects": [{ "id": "cmvb...", "name": "Physics" }],
    "branches": [{ "id": "cmvb...", "name": "Mirpur Main Branch" }],
    "types": ["ACADEMIC", "ADMISSION"],
    "feeRange": { "min": 1500, "max": 4500 }
  }
}
```

---

### GET /api/public/stats
Public impact metrics for landing page social proof.

- **Auth**: None (Public)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "activeStudents": 520,
    "totalBatches": 16,
    "verifiedTeachers": 8,
    "averageSuccessRate": 94.6
  }
}
```

---

### GET /api/public/branches
List active branches with contact addresses.

- **Auth**: None (Public)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "cmvb9ltpw0000ujigmsn02iy0",
      "name": "Mirpur Main Branch",
      "address": "Plot 12, Road 4, Section 10, Mirpur, Dhaka-1216"
    }
  ]
}
```

---

### GET /api/public/teachers
List faculty profiles marked as public.

- **Auth**: None (Public)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cmvb9ltpx0002ujigabc44123",
        "name": "Prof. Abul Kashem",
        "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
        "headline": "Lead Physics Instructor | Ex-Notre Dame College",
        "bio": "20+ years of teaching excellence in HSC & Engineering admission physics.",
        "branch": { "name": "Mirpur Main Branch" }
      }
    ],
    "pagination": { "total": 8, "page": 1, "limit": 10, "totalPages": 1 }
  }
}
```

---

## 3. Content API Endpoints

### GET /api/content/blog & GET /api/content/blog/:slug
- **Auth**: None (Public)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cmvb...",
        "title": "Mastering Vector Calculus for HSC Physics",
        "slug": "mastering-vector-calculus-hsc-physics",
        "excerpt": "A step-by-step breakdown of vector products and application formulas.",
        "coverImage": "https://images.unsplash.com/...",
        "publishedAt": "2026-09-15T10:00:00.000Z",
        "author": { "name": "Prof. Abul Kashem" }
      }
    ]
  }
}
```

---

### GET /api/content/testimonials & GET /api/content/faq
- **Auth**: None (Public)
- **Success Response (200)**: Returns active student testimonials and categorized FAQ items.

---

### POST /api/content/batches/:batchId/reviews
Submit a rating and review for a course.

- **Auth**: Required (`STUDENT` enrolled in the specified batch)
- **Request Body**:
```json
{
  "rating": 5,
  "comment": "Outstanding teaching methodology and high quality problem sets!"
}
```
- **Success Response (201)**:
```json
{
  "success": true,
  "data": {
    "id": "cmvb...",
    "rating": 5,
    "comment": "Outstanding teaching methodology...",
    "createdAt": "2026-10-18T00:00:00.000Z"
  }
}
```
- **Error Codes**:
  - `403 Forbidden`: Student not enrolled in this batch.
  - `409 Conflict`: Review already submitted for this batch (1 review per student per batch).

---

### POST /api/content/contact
Submit inquiries through the contact form.

- **Auth**: None (Public, rate limited to 5 submissions/hour/IP)
- **Request Body**:
```json
{
  "name": "Tanvir Ahmed",
  "email": "tanvir@example.com",
  "phone": "01711223344",
  "message": "Interested in admission coaching starting next month.",
  "website": ""
}
```
- **Honeypot Guard**: If the `website` field is filled out, the backend returns `200 OK` silently but discards the message without saving to the database.
- **Error Codes**: `400 Bad Request` (invalid email or missing message), `429 Too Many Requests` (exceeded 5/hour).

---

### POST /api/content/newsletter
Subscribe to email updates.

- **Auth**: None (Public)
- **Request Body**:
```json
{ "email": "subscriber@example.com" }
```
- **Idempotency**: Subscribing twice returns identical `200 OK` responses without duplicate database records.

---

## 4. Authentication API Endpoints

### POST /api/auth/register
Create a new student or guardian account.

- **Auth**: None (or `SUPER_ADMIN` to create administrators)
- **Request Body**:
```json
{
  "name": "Rahim Khan",
  "email": "rahim.student@example.com",
  "password": "StrongPassword123!",
  "role": "STUDENT",
  "branchId": "cmvb9ltpw0000ujigmsn02iy0"
}
```
- **Success Response (201)**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "cmvb...",
      "name": "Rahim Khan",
      "email": "rahim.student@example.com",
      "role": "STUDENT",
      "branchId": "cmvb9ltpw0000ujigmsn02iy0"
    }
  }
}
```
- **Security Rule**: Does NOT return a Set-Cookie header (requires explicit login). Privilege escalation (`SUPER_ADMIN` or unauthorized `ADMIN` creation) returns `400 Bad Request`.

---

### POST /api/auth/login
Authenticate with email and password.

- **Auth**: None (Rate limited: 10 attempts per 15 minutes per IP)
- **Request Body**:
```json
{
  "email": "student@demo.eduflow.local",
  "password": "Password123!"
}
```
- **Success Response (200)**:
  - Sets `Set-Cookie: token=<jwt>; HttpOnly; SameSite=Lax; Path=/`
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "cmvb...",
      "name": "Demo Student",
      "email": "student@demo.eduflow.local",
      "role": "STUDENT",
      "branchId": "cmvb..."
    }
  }
}
```
- **Error Codes**: `401 Unauthorized` (invalid credentials), `429 Too Many Requests` (brute force lockout on 11th attempt).

---

### POST /api/auth/demo
Instant one-click demo login for authorized roles when `DEMO_MODE=true`.

- **Auth**: None (Disabled in production; disabled when `DEMO_MODE!=true`)
- **Request Body**:
```json
{ "role": "ADMIN" }
```
*(Allowed roles: `ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN`. `SUPER_ADMIN` is never allowed).*
- **Success Response (200)**: Sets auth cookie and returns demo profile.
- **Error Codes**: `400 Bad Request` (unauthorized role), `404 Not Found` (when DEMO_MODE is not true).

---

### POST /api/auth/google
Authenticate via Google Identity Services ID token.

- **Auth**: None
- **Request Body**:
```json
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI..." }
```
- **Success Response (200)**: Sets auth cookie and returns user profile. Automatically provisions account if not previously registered.
- **Error Codes**: `400 Bad Request` (missing idToken), `401 Unauthorized` (invalid/expired Google token).

---

### GET /api/auth/me
Verify active session and retrieve authenticated profile.

- **Auth**: Required (`Cookie: token=...`)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "cmvb9ltpw0000ujigmsn02iy0",
      "name": "Demo Admin",
      "email": "admin@demo.eduflow.local",
      "role": "ADMIN",
      "branchId": "cmvb9ltpw0000ujigmsn02iy0"
    }
  }
}
```
- **Error Codes**: `401 Unauthorized` (missing, invalid, or deleted user's token).

---

## 5. Tables API Endpoints (Data Grids)

All table endpoints are multi-tenant branch-scoped:
- `SUPER_ADMIN`: sees all rows; optional `branchId` filter.
- `ADMIN` & `TEACHER`: strictly isolated to own branch.
- `STUDENT`: strictly sees own rows only.
- `GUARDIAN`: strictly sees linked students' rows only.

### Endpoints
- `GET /api/tables/users` (ADMIN, SUPER_ADMIN)
- `GET /api/tables/students` (ADMIN, TEACHER, SUPER_ADMIN)
- `GET /api/tables/payments` (ALL authenticated roles)
- `GET /api/tables/attendance` (ALL authenticated roles)
- `GET /api/tables/results` (ALL authenticated roles)
- `GET /api/tables/batches` (ALL authenticated roles)
- `GET /api/tables/notices` (ALL authenticated roles)

### Common Query Parameters
- `page` (default: 1)
- `limit` (default: 10, max: 100)
- `q` (search string)
- `sortBy` (whitelisted column name)
- `sortOrder` (`asc` | `desc`)
- Entity-specific filters: `status`, `batchId`, `startDate`, `endDate`, `role`.

---

## 6. Charts API Endpoints (Dashboards)

Branch-scoped dashboard metrics and aggregate charts:

| Endpoint | Allowed Roles | Description |
|---|---|---|
| `GET /api/charts/revenue-monthly` | `ADMIN`, `SUPER_ADMIN` | 12-month rolling revenue breakdown |
| `GET /api/charts/fee-status` | `ADMIN`, `SUPER_ADMIN` | Due, Partial, and Paid fee distribution |
| `GET /api/charts/attendance-trend` | `ADMIN`, `TEACHER`, `SUPER_ADMIN` | Daily/weekly attendance percentages |
| `GET /api/charts/enrollment-stats` | `ADMIN`, `SUPER_ADMIN` | Monthly enrollment acquisition counts |
| `GET /api/charts/batch-occupancy` | `ADMIN`, `TEACHER`, `SUPER_ADMIN` | Enrolled count per active batch |
| `GET /api/charts/score-distribution` | `ADMIN`, `TEACHER`, `SUPER_ADMIN` | Grade and score bell curves |
| `GET /api/charts/my-attendance` | `STUDENT`, `GUARDIAN` | Personal student attendance rate |
| `GET /api/charts/my-scores` | `STUDENT`, `GUARDIAN` | Personal exam score history over time |

---

## 7. Profile API Endpoints (`/api/me`)

### GET /api/me
Retrieve current user profile with role-specific associations.

---

### PATCH /api/me
Update personal profile details.
- **Request Body**:
```json
{
  "name": "Updated Name",
  "phone": "01700112233",
  "bio": "Passionate learner"
}
```
- **Security Guard**: Fields `email`, `role`, and `branchId` are **strictly ignored** and cannot be changed via this route.

---

### PATCH /api/me/password
Change account password securely.
- **Request Body**:
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "SecureNewPassword456!"
}
```
- **Error Codes**: `400 Bad Request` (weak password, regex validation failed), `401 Unauthorized` (incorrect current password).

---

## 8. AI API Endpoints

### POST /api/ai/chat
Public conversational assistant grounded strictly in EduFlow database records.

- **Auth**: None (Public; in-memory concurrency limiter: 2, daily quota guard)
- **Request Body**:
```json
{
  "messages": [
    { "role": "user", "content": "What batches are currently enrolling in Mirpur branch?" }
  ]
}
```
- **Input Validation**: Maximum 10 messages, max 500 characters per message.
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "message": "At our Mirpur Main Branch, we have active batches for HSC 2025 Physics and Chemistry. Would you like to view the routine or fee structure?"
  }
}
```
- **Error Codes**:
  - `400 Bad Request`: Validation failure (>10 messages or >500 chars).
  - `429 Too Many Requests`: `{"success":false,"message":"The assistant is busy right now. Please try again in a few minutes."}` (quota limit hit).
  - `503 Service Unavailable`: `{"success":false,"message":"AI assistant is currently unavailable. Please check our FAQ or contact our branch office."}`.

---

### GET /api/ai/insights
Administrative operational anomaly detection with AI executive summary.

- **Auth**: Required (`ADMIN`, `SUPER_ADMIN`)
- **Success Response (200)**:
```json
{
  "success": true,
  "data": {
    "summary": "Attendance across Mirpur batches showed a 12% improvement this week. Noticeable fee dues observed in Batch HSC-P1.",
    "anomalies": [
      {
        "type": "ATTENDANCE_DROP",
        "severity": "MEDIUM",
        "batchName": "HSC 2025 Physics",
        "description": "Attendance dropped below 75% on Thursday"
      }
    ]
  }
}
```
- **Privacy Assurance**: Anonymized data only. No names, phone numbers, emails, or user IDs are transmitted to the LLM.
- **Error Codes**: `401 Unauthorized` (no auth), `403 Forbidden` (`STUDENT`, `GUARDIAN`).
