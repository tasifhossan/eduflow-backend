import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Returns the email addresses to notify for a given student:
 * - The student's own email
 * - Any guardian(s) linked via GuardianLink (with an active portal account)
 * The list is deduped before returning.
 */
export async function getRecipientEmails(studentId: string): Promise<string[]> {
  const [student, guardianLinks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { email: true },
    }),
    prisma.guardianLink.findMany({
      where: { studentId },
      select: {
        guardian: {
          select: { email: true },
        },
      },
    }),
  ]);

  const emails: string[] = [];

  if (student?.email) {
    emails.push(student.email);
  }

  for (const link of guardianLinks) {
    if (link.guardian.email) {
      emails.push(link.guardian.email);
    }
  }

  // Dedupe
  return [...new Set(emails)];
}
