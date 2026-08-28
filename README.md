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
- **Exam Grading Engine** — Instant MCQ evaluation with negative marking logic and subjective answer scoring.
- **Data Seeding & ORM** — Automated Prisma database seeding and migrations.

---

## Tech Stack  
**Backend:** Node.js · Express.js 5 · PostgreSQL (Neon) · Prisma ORM v6  
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
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:3000
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
