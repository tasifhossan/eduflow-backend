# ⚙️ EduFlow — Backend API Service  
Express.js & TypeScript REST API service for EduFlow.

---

## Table of Contents

- [About the Project](#about-the-project)
- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Dependencies](#dependencies)
- [Installation️ & Setup](#installation--setup)
- [Folder Structure](#folder-structure)
- [Contributions](#contributions)
- [How to Contribute](#how-to-contribute)
- [License](#license)
- [Contact](#contact)

---

## About the Project 
The EduFlow Backend API handles core business logic, database transactions, role-based authentication, automated exam evaluation, and multi-tenant data isolation.

---

## Project Overview  
Serves high-performance JSON endpoints for the EduFlow web client, managing branch scoping, batch allocations, attendance validation, and Prisma ORM PostgreSQL schema migrations.

---

## Key Features  
- **Role-Based Middleware** — Strict permissions for `ADMIN`, `TEACHER`, `STUDENT`, and `GUARDIAN`.
- **Automated Email Notification Engine** — Immediate transactional email notifications for attendance alerts (`ABSENT`/`LATE`), fee dues/partial payment updates, and test results using Brevo HTTP API with Nodemailer fallback.
- **Guardian Link & Profile Sync** — Transactional sync of guardian contact info to student records, audit trail change logs (`GuardianInfoChangeLog`), and edit protections.
- **Exam Grading Engine** — Instant MCQ evaluation with negative marking logic, subjective written answer scoring, and manual offline test score entry.
- **Data Seeding & ORM** — Automated Prisma database seeding and PostgreSQL migrations.

---

## Tech Stack  
**Backend:** Node.js · Express.js 5 · PostgreSQL (Neon) · Prisma ORM v6  
**Services:** Brevo HTTP API · Nodemailer · Cloudinary  
**Tools:** Git · VS Code · JWT · Cookie-Parser · Zod · Bcrypt

---

## Dependencies  

```json
{
  "express": "^5.2.1",
  "@prisma/client": "^6.19.3",
  "jsonwebtoken": "^9.0.3",
  "cookie-parser": "^1.4.7",
  "bcrypt": "^6.0.0",
  "nodemailer": "^6.10.0",
  "@types/nodemailer": "^6.4.17",
  "zod": "^4.4.3",
  "cors": "^2.8.6"
}
```

---

## Installation️ & Setup
1. Install dependencies:

```bash
cd backend
npm install
```

2. Set up environment variables in `backend/.env`:

```env
PORT=5000
DATABASE_URL=your_postgresql_database_url
DIRECT_URL=your_direct_postgresql_database_url
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:3000

# Email Notifications (Brevo HTTP API or SMTP)
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender_email@example.com

# SMTP Fallback (e.g. Mailtrap for local dev)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_pass
SMTP_FROM="EduFlow <noreply@eduflow.app>"
```

3. Run migrations and dev server:

```bash
npx prisma migrate dev
npm run db:seed
npm run dev
```

---

## Folder Structure

```plaintext
backend/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── controllers/
│   ├── middlewares/
│   ├── routes/
│   ├── utils/
│   │   ├── mailer.ts
│   │   └── notification-recipients.ts
│   └── index.ts
└── package.json
```

---

## Contributions
Developed by Tasif Hossan.

| Name            | Role                | Contributions                            |  
|-----------------|---------------------|------------------------------------------|  
| Tasif Hossan    | Lead Developer      | Backend Architecture & Prisma Schema     |  

---

## How to Contribute

- Fork the Project
- Create a branch (`git checkout -b feature/AmazingFeature`)
- Commit changes (`git commit -m 'Add some AmazingFeature'`)
- Push the branch (`git push origin feature/AmazingFeature`)
- Open a Pull Request

---

## License
Distributed under the MIT License. See `LICENSE` for more information.

---

## Contact

**Portfolio:** [Tasif Hossan](https://tasif-portfolio.vercel.app/)  
**LinkedIn:** [Tasif Hossan](https://www.linkedin.com/in/tasifhossan/)  
**GitHub:** [@tasifhossan](https://github.com/tasifhossan)
