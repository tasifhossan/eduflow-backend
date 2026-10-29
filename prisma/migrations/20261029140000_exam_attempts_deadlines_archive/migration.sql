-- 1. Create AttemptStatus enum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');

-- 2. Alter Test with window, shuffle flags, and archive timestamp
ALTER TABLE "Test" ADD COLUMN "windowEndsAt" TIMESTAMP(3);
ALTER TABLE "Test" ADD COLUMN "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Test" ADD COLUMN "shuffleOptions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Test" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Test_archivedAt_idx" ON "Test"("archivedAt");

-- 3. Alter Batch with archive timestamp
ALTER TABLE "Batch" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Batch_archivedAt_idx" ON "Batch"("archivedAt");

-- 4. Create TestAttempt table
CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "seed" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "submittedAt" TIMESTAMP(3),
    "extendedMinutes" INTEGER NOT NULL DEFAULT 0,
    "extendedById" TEXT,
    "extendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TestAttempt_testId_studentId_key" ON "TestAttempt"("testId", "studentId");
CREATE INDEX "TestAttempt_testId_status_idx" ON "TestAttempt"("testId", "status");
CREATE INDEX "TestAttempt_studentId_idx" ON "TestAttempt"("studentId");

-- 5. Create AttemptAnswer table
CREATE TABLE "AttemptAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "optionId" TEXT,
    "textAnswer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttemptAnswer_attemptId_questionId_key" ON "AttemptAnswer"("attemptId", "questionId");
CREATE INDEX "AttemptAnswer_attemptId_idx" ON "AttemptAnswer"("attemptId");
CREATE INDEX "AttemptAnswer_questionId_idx" ON "AttemptAnswer"("questionId");
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "chk_attempt_answer_choice_or_text"
    CHECK (("optionId" IS NOT NULL AND "textAnswer" IS NULL) OR ("optionId" IS NULL AND "textAnswer" IS NOT NULL));

-- 6. Alter Result table
ALTER TABLE "Result" ADD COLUMN "attemptId" TEXT;
ALTER TABLE "Result" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Result_attemptId_key" ON "Result"("attemptId");

-- 7. Add Foreign Key constraints
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_extendedById_fkey" FOREIGN KEY ("extendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Result" ADD CONSTRAINT "Result_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

