import { EnrollmentStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { sendEmail } from '../utils/mailer';
import { escapeHtml } from '../utils/escapeHtml';
import { NOTIFICATION_CONFIG } from '../config/academics.config';

export const NOTIFICATION_TYPE_WHITELIST = [
  'LECTURE_PUBLISHED',
  'LECTURE_RESCHEDULED',
  'LECTURE_CANCELLED',
  'ASSIGNMENT_PUBLISHED',
  'SUBMISSION_GRADED',
] as const;

export type AcademicNotificationType = typeof NOTIFICATION_TYPE_WHITELIST[number];

export interface SendAcademicNotificationParams {
  type: AcademicNotificationType;
  title: string;
  body: string;
  batchId: string;
  studentId?: string; // If targeting a single student + their guardians (e.g. grading)
  entityType?: 'Lecture' | 'Assignment' | 'AssignmentSubmission';
  entityId?: string;
  emailSubject: string;
  emailBodyHtml: string;
}

/**
 * Dispatches notifications in-app via database createMany and sends
 * asynchronous email notifications to users who have notifyByEmail = true.
 * Guaranteed non-blocking and never throws.
 */
export async function sendAcademicNotification(params: SendAcademicNotificationParams): Promise<void> {
  try {
    // Collect recipient users
    let recipientUsers: Array<{ id: string; email: string | null; notifyByEmail: boolean }> = [];

    if (params.studentId) {
      // Single student + linked guardians
      const student = await prisma.user.findUnique({
        where: { id: params.studentId },
        select: { id: true, email: true, notifyByEmail: true },
      });

      const guardianLinks = await prisma.guardianLink.findMany({
        where: { studentId: params.studentId },
        select: {
          guardian: {
            select: { id: true, email: true, notifyByEmail: true },
          },
        },
      });

      if (student) {
        recipientUsers.push(student);
      }
      for (const gl of guardianLinks) {
        if (gl.guardian) {
          recipientUsers.push(gl.guardian);
        }
      }
    } else {
      // All ACTIVE enrolled students in batch + their linked guardians
      const enrollments = await prisma.enrollment.findMany({
        where: {
          batchId: params.batchId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: {
          studentId: true,
          student: {
            select: { id: true, email: true, notifyByEmail: true },
          },
        },
      });

      const studentIds = enrollments.map((e) => e.studentId);
      for (const e of enrollments) {
        if (e.student) {
          recipientUsers.push(e.student);
        }
      }

      if (studentIds.length > 0) {
        const guardianLinks = await prisma.guardianLink.findMany({
          where: { studentId: { in: studentIds } },
          select: {
            guardian: {
              select: { id: true, email: true, notifyByEmail: true },
            },
          },
        });

        for (const gl of guardianLinks) {
          if (gl.guardian) {
            recipientUsers.push(gl.guardian);
          }
        }
      }
    }

    // Deduplicate recipients by ID
    const userMap = new Map<string, { id: string; email: string | null; notifyByEmail: boolean }>();
    for (const u of recipientUsers) {
      if (!userMap.has(u.id)) {
        userMap.set(u.id, u);
      }
    }

    // Cap recipients at 500 per event
    const uniqueRecipients = Array.from(userMap.values()).slice(
      0,
      NOTIFICATION_CONFIG.MAX_RECIPIENTS_PER_EVENT
    );

    if (uniqueRecipients.length === 0) {
      return;
    }

    // Insert database notifications
    const notifData = uniqueRecipients.map((u) => ({
      userId: u.id,
      type: params.type,
      title: params.title,
      body: params.body,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
    }));

    await prisma.notification.createMany({
      data: notifData,
    });

    // Asynchronous non-blocking email dispatch
    const emailRecipients = uniqueRecipients
      .filter((u) => u.email && u.notifyByEmail !== false)
      .map((u) => u.email as string);

    if (emailRecipients.length > 0) {
      // Fire-and-forget; never await or block response
      setImmediate(async () => {
        try {
          const safeHtml = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.5;">
              <h2 style="color: #4f46e5;">${escapeHtml(params.title)}</h2>
              <p>${params.emailBodyHtml}</p>
              <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              <p style="font-size: 12px; color: #6b7280;">
                You received this email because email notifications are enabled for your EduFlow account.
                You can change this in your profile settings.
              </p>
            </div>
          `;
          await sendEmail(emailRecipients, params.emailSubject, safeHtml);
        } catch (mailErr) {
          console.error('[notification.service] Async email delivery error:', mailErr);
        }
      });
    }
  } catch (error) {
    console.error('[notification.service] Error dispatching academic notification:', error);
  }
}
