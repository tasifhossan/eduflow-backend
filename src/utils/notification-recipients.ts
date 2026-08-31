import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface RecipientUser {
  id: string;
  name: string;
  email: string | null;
}

export interface NotificationRecipients {
  student: RecipientUser | null;
  guardians: RecipientUser[];
}

/**
 * Returns structured recipient data for a given student:
 * - student: student info (id, name, email) if email exists
 * - guardians: list of linked guardian info (id, name, email) with active emails
 */
export async function getNotificationRecipients(studentId: string): Promise<NotificationRecipients> {
  const [student, guardianLinks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, email: true },
    }),
    prisma.guardianLink.findMany({
      where: { studentId },
      select: {
        guardian: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
  ]);

  const guardians = guardianLinks
    .map((link) => link.guardian)
    .filter((g) => g.email !== null);

  return {
    student: student?.email ? student : null,
    guardians,
  };
}

/**
 * Legacy helper for getting deduplicated list of email addresses.
 */
export async function getRecipientEmails(studentId: string): Promise<string[]> {
  const recipients = await getNotificationRecipients(studentId);
  const emails: string[] = [];

  if (recipients.student?.email) {
    emails.push(recipients.student.email);
  }

  for (const g of recipients.guardians) {
    if (g.email) {
      emails.push(g.email);
    }
  }

  return [...new Set(emails)];
}
