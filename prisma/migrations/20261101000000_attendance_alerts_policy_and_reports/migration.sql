-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "alertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CenterSettings" ADD COLUMN "attendancePolicy" JSONB NOT NULL DEFAULT '{"alertOnLate":false,"lowThresholdPercent":75,"editWindowDays":7}';

