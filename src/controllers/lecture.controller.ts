import { Request, Response } from 'express';
import { Role, EnrollmentStatus, DayOfWeek, LectureStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  createLectureSchema,
  updateLectureSchema,
  completeLectureSchema,
  cancelLectureSchema,
  generateLecturesSchema,
} from '../validators/lecture.validator';
import { parsePagination, buildMeta } from '../utils/pagination';
import { createAuditLog } from '../utils/audit';
import { getCenterSettings } from '../services/settings.service';
import { localTimeToUtc } from '../utils/timezone';
import { ONLINE_CLASS_CONFIG } from '../config/academics.config';
import { sendAcademicNotification } from '../services/notification.service';

const DAY_OF_WEEK_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

async function getLectureOverlapWarnings(
  batchId: string,
  teacherId: string,
  startsAt: Date,
  endsAt: Date,
  excludeLectureId?: string
) {
  const clashingLectures = await prisma.lecture.findMany({
    where: {
      status: { not: LectureStatus.CANCELLED },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeLectureId ? { id: { not: excludeLectureId } } : {}),
      OR: [{ teacherId }, { batchId }],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      batchId: true,
      teacherId: true,
      status: true,
    },
  });

  const teacherClashes = clashingLectures.filter((l) => l.teacherId === teacherId);
  const batchClashes = clashingLectures.filter((l) => l.batchId === batchId);

  return {
    hasOverlap: clashingLectures.length > 0,
    teacherClashes,
    batchClashes,
  };
}

export async function createLecture(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createLectureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      batchId,
      subjectId,
      chapterId,
      teacherId,
      routineSlotId,
      title,
      plannedTopics,
      startsAt,
      endsAt,
      isPublished,
      notify,
      onlineProvider,
      onlineUrl,
      onlinePasscode,
    } = parseResult.data;

    // Check batch and scoping
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { branch: true },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (req.user.role === Role.ADMIN && batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Batch belongs to another branch',
      });
    }

    if (req.user.role === Role.TEACHER) {
      if (batch.teacherId !== req.user.userId && teacherId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only schedule lectures for your assigned batches',
        });
      }
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Students and guardians cannot create lectures',
      });
    }

    // Verify teacher exists in branch
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
    });
    if (!teacher || (req.user.role !== Role.SUPER_ADMIN && teacher.branchId !== batch.branchId)) {
      return res.status(400).json({
        success: false,
        message: 'Assigned teacher not found or belongs to another branch',
      });
    }

    // Verify subject
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return res.status(400).json({
        success: false,
        message: 'Subject not found',
      });
    }

    // Verify chapter if provided
    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapter || chapter.subjectId !== subjectId) {
        return res.status(400).json({
          success: false,
          message: 'Chapter not found or does not belong to specified subject',
        });
      }
    }

    // Verify routineSlot if provided
    if (routineSlotId) {
      const slot = await prisma.routineSlot.findUnique({
        where: { id: routineSlotId },
      });
      if (!slot || slot.batchId !== batchId) {
        return res.status(400).json({
          success: false,
          message: 'Routine slot not found or does not belong to this batch',
        });
      }
    }

    const settings = await getCenterSettings();
    const features = (settings.features as Record<string, boolean>) || {};
    const onlineClassesAllowed = features.onlineClasses !== false;

    const startsAtDate = new Date(startsAt);
    const endsAtDate = new Date(endsAt);

    // Check overlap warnings
    const warnings = await getLectureOverlapWarnings(batchId, teacherId, startsAtDate, endsAtDate);

    const lecture = await prisma.lecture.create({
      data: {
        batchId,
        subjectId,
        chapterId: chapterId || null,
        teacherId,
        routineSlotId: routineSlotId || null,
        title: title || null,
        plannedTopics,
        startsAt: startsAtDate,
        endsAt: endsAtDate,
        isPublished: isPublished || false,
        status: LectureStatus.PLANNED,
        onlineProvider: onlineClassesAllowed ? onlineProvider || null : null,
        onlineUrl: onlineClassesAllowed ? onlineUrl || null : null,
        onlinePasscode: onlineClassesAllowed ? onlinePasscode || null : null,
        createdById: req.user.userId,
      },
      select: {
        id: true,
        batchId: true,
        subjectId: true,
        chapterId: true,
        teacherId: true,
        routineSlotId: true,
        title: true,
        plannedTopics: true,
        startsAt: true,
        endsAt: true,
        status: true,
        isPublished: true,
        onlineProvider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'LECTURE_CREATE',
      entityType: 'Lecture',
      entityId: lecture.id,
      branchId: batch.branchId,
      metadata: {
        id: lecture.id,
        batchId,
        startsAt: startsAtDate.toISOString(),
        endsAt: endsAtDate.toISOString(),
        isPublished: lecture.isPublished,
      },
    });

    if (lecture.isPublished && notify) {
      sendAcademicNotification({
        type: 'LECTURE_PUBLISHED',
        title: `New Lecture Scheduled: ${lecture.title || batch.name}`,
        body: `A new lecture has been scheduled on ${startsAtDate.toLocaleDateString()}. Topic: ${plannedTopics}`,
        batchId,
        entityType: 'Lecture',
        entityId: lecture.id,
        emailSubject: `New Lecture Scheduled: ${lecture.title || batch.name}`,
        emailBodyHtml: `A new lecture has been scheduled for your batch on <strong>${startsAtDate.toUTCString()}</strong>.<br/>Topics: ${plannedTopics}`,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Lecture created successfully',
      data: lecture,
      warnings: warnings.hasOverlap
        ? { teacherClashes: warnings.teacherClashes, batchClashes: warnings.batchClashes }
        : undefined,
    });
  } catch (error) {
    console.error('Create lecture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error creating lecture',
    });
  }
}

export async function updateLecture(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
      },
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    // Scoping
    if (req.user.role === Role.ADMIN && lecture.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Lecture belongs to another branch',
      });
    }

    if (req.user.role === Role.TEACHER) {
      if (lecture.teacherId !== req.user.userId && lecture.batch.teacherId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update lectures you teach',
        });
      }
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Students and guardians cannot update lectures',
      });
    }

    const parseResult = updateLectureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;
    const updateData: Prisma.LectureUpdateInput = {};
    const changedFields: string[] = [];

    const newStartsAt = data.startsAt ? new Date(data.startsAt) : lecture.startsAt;
    const newEndsAt = data.endsAt ? new Date(data.endsAt) : lecture.endsAt;
    const newTeacherId = data.teacherId || lecture.teacherId;

    let isRescheduled = false;
    if (
      (data.startsAt && newStartsAt.getTime() !== lecture.startsAt.getTime()) ||
      (data.endsAt && newEndsAt.getTime() !== lecture.endsAt.getTime())
    ) {
      isRescheduled = true;
      updateData.startsAt = newStartsAt;
      updateData.endsAt = newEndsAt;
      updateData.rescheduledAt = new Date();
      changedFields.push('startsAt', 'endsAt', 'rescheduledAt');
    }

    if (data.subjectId !== undefined) {
      updateData.subject = { connect: { id: data.subjectId } };
      changedFields.push('subjectId');
    }
    if (data.chapterId !== undefined) {
      updateData.chapter = data.chapterId ? { connect: { id: data.chapterId } } : { disconnect: true };
      changedFields.push('chapterId');
    }
    if (data.teacherId !== undefined) {
      updateData.teacher = { connect: { id: data.teacherId } };
      changedFields.push('teacherId');
    }
    if (data.title !== undefined) {
      updateData.title = data.title;
      changedFields.push('title');
    }
    if (data.plannedTopics !== undefined) {
      updateData.plannedTopics = data.plannedTopics;
      changedFields.push('plannedTopics');
    }
    if (data.coveredTopics !== undefined) {
      updateData.coveredTopics = data.coveredTopics;
      changedFields.push('coveredTopics');
    }
    if (data.homeworkNote !== undefined) {
      updateData.homeworkNote = data.homeworkNote;
      changedFields.push('homeworkNote');
    }

    const settings = await getCenterSettings();
    const features = (settings.features as Record<string, boolean>) || {};
    const onlineClassesAllowed = features.onlineClasses !== false;

    if (onlineClassesAllowed) {
      if (data.onlineProvider !== undefined) {
        updateData.onlineProvider = data.onlineProvider;
        changedFields.push('onlineProvider');
      }
      if (data.onlineUrl !== undefined) {
        updateData.onlineUrl = data.onlineUrl;
        changedFields.push('onlineUrl');
      }
      if (data.onlinePasscode !== undefined) {
        updateData.onlinePasscode = data.onlinePasscode;
        changedFields.push('onlinePasscode');
      }
    }

    const isNewlyPublished = !lecture.isPublished && data.isPublished === true;
    if (data.isPublished !== undefined) {
      updateData.isPublished = data.isPublished;
      changedFields.push('isPublished');
    }

    const warnings = await getLectureOverlapWarnings(
      lecture.batchId,
      newTeacherId,
      newStartsAt,
      newEndsAt,
      lecture.id
    );

    const updatedLecture = await prisma.lecture.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        batchId: true,
        subjectId: true,
        chapterId: true,
        teacherId: true,
        routineSlotId: true,
        title: true,
        plannedTopics: true,
        coveredTopics: true,
        homeworkNote: true,
        startsAt: true,
        endsAt: true,
        status: true,
        rescheduledAt: true,
        isPublished: true,
        onlineProvider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: isRescheduled ? 'LECTURE_RESCHEDULE' : 'LECTURE_UPDATE',
      entityType: 'Lecture',
      entityId: lecture.id,
      branchId: lecture.batch.branchId,
      metadata: {
        id: lecture.id,
        changedFields,
        isRescheduled,
      },
    });

    // Notifications
    if (isRescheduled && (lecture.isPublished || updatedLecture.isPublished)) {
      sendAcademicNotification({
        type: 'LECTURE_RESCHEDULED',
        title: `Lecture Rescheduled: ${updatedLecture.title || lecture.batch.name}`,
        body: `The lecture has been rescheduled to ${newStartsAt.toLocaleDateString()} at ${newStartsAt.toLocaleTimeString()}.`,
        batchId: lecture.batchId,
        entityType: 'Lecture',
        entityId: lecture.id,
        emailSubject: `Lecture Rescheduled: ${updatedLecture.title || lecture.batch.name}`,
        emailBodyHtml: `The lecture has been rescheduled to <strong>${newStartsAt.toUTCString()}</strong>.`,
      });
    } else if (isNewlyPublished && data.notify !== false) {
      sendAcademicNotification({
        type: 'LECTURE_PUBLISHED',
        title: `Lecture Published: ${updatedLecture.title || lecture.batch.name}`,
        body: `A lecture has been published for ${newStartsAt.toLocaleDateString()}. Topic: ${updatedLecture.plannedTopics}`,
        batchId: lecture.batchId,
        entityType: 'Lecture',
        entityId: lecture.id,
        emailSubject: `Lecture Published: ${updatedLecture.title || lecture.batch.name}`,
        emailBodyHtml: `A lecture has been published for your batch on <strong>${newStartsAt.toUTCString()}</strong>.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lecture updated successfully',
      data: updatedLecture,
      warnings: warnings.hasOverlap
        ? { teacherClashes: warnings.teacherClashes, batchClashes: warnings.batchClashes }
        : undefined,
    });
  } catch (error) {
    console.error('Update lecture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating lecture',
    });
  }
}

export async function completeLecture(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      include: {
        batch: { select: { branchId: true, teacherId: true } },
      },
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    if (req.user.role === Role.ADMIN && lecture.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch lecture',
      });
    }

    if (req.user.role === Role.TEACHER && lecture.teacherId !== req.user.userId && lecture.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only complete lectures you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    if (lecture.status === LectureStatus.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: 'Lecture is already marked as completed',
      });
    }

    if (lecture.status === LectureStatus.CANCELLED) {
      return res.status(400).json({
        success: false,
        message: 'Cancelled lecture cannot be completed',
      });
    }

    const parseResult = completeLectureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { coveredTopics, homeworkNote } = parseResult.data;

    const updated = await prisma.lecture.update({
      where: { id },
      data: {
        status: LectureStatus.COMPLETED,
        coveredTopics,
        homeworkNote: homeworkNote || null,
      },
      select: {
        id: true,
        batchId: true,
        status: true,
        coveredTopics: true,
        homeworkNote: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'LECTURE_COMPLETE',
      entityType: 'Lecture',
      entityId: lecture.id,
      branchId: lecture.batch.branchId,
      metadata: {
        id: lecture.id,
        status: LectureStatus.COMPLETED,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Lecture completed successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Complete lecture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error completing lecture',
    });
  }
}

export async function cancelLecture(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
      },
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    if (req.user.role === Role.ADMIN && lecture.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch lecture',
      });
    }

    if (req.user.role === Role.TEACHER && lecture.teacherId !== req.user.userId && lecture.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only cancel lectures you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    const parseResult = cancelLectureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { reason } = parseResult.data;

    const updated = await prisma.lecture.update({
      where: { id },
      data: {
        status: LectureStatus.CANCELLED,
        cancelReason: reason,
      },
      select: {
        id: true,
        batchId: true,
        status: true,
        cancelReason: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'LECTURE_CANCEL',
      entityType: 'Lecture',
      entityId: lecture.id,
      branchId: lecture.batch.branchId,
      metadata: {
        id: lecture.id,
        status: LectureStatus.CANCELLED,
      },
    });

    if (lecture.isPublished) {
      sendAcademicNotification({
        type: 'LECTURE_CANCELLED',
        title: `Lecture Cancelled: ${lecture.title || lecture.batch.name}`,
        body: `The lecture scheduled for ${lecture.startsAt.toLocaleDateString()} has been cancelled. Reason: ${reason}`,
        batchId: lecture.batchId,
        entityType: 'Lecture',
        entityId: lecture.id,
        emailSubject: `Lecture Cancelled: ${lecture.title || lecture.batch.name}`,
        emailBodyHtml: `The lecture scheduled on <strong>${lecture.startsAt.toUTCString()}</strong> has been cancelled.<br/>Reason: ${reason}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lecture cancelled successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Cancel lecture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error cancelling lecture',
    });
  }
}

export async function deleteLecture(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      include: {
        batch: { select: { branchId: true } },
        _count: {
          select: {
            attachments: true,
            assignments: true,
          },
        },
      },
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    if (req.user.role === Role.ADMIN && lecture.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch lecture',
      });
    }

    if (req.user.role === Role.TEACHER && lecture.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete lectures you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    // Must be PLANNED, unpublished, and have no attachments or assignments
    if (
      lecture.status !== LectureStatus.PLANNED ||
      lecture.isPublished ||
      lecture._count.attachments > 0 ||
      lecture._count.assignments > 0
    ) {
      return res.status(409).json({
        success: false,
        message:
          'Cannot delete lecture that is published, completed, or contains attachments/assignments. Please cancel the lecture instead.',
      });
    }

    await prisma.lecture.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'LECTURE_DELETE',
      entityType: 'Lecture',
      entityId: lecture.id,
      branchId: lecture.batch.branchId,
      metadata: {
        id: lecture.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Lecture deleted successfully',
    });
  } catch (error) {
    console.error('Delete lecture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error deleting lecture',
    });
  }
}

export async function generateLectures(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        routineSlots: true,
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (req.user.role === Role.ADMIN && batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Batch belongs to another branch',
      });
    }

    if (req.user.role === Role.TEACHER && batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only generate lectures for batches you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    if (!batch.teacherId) {
      return res.status(400).json({
        success: false,
        message: 'Batch has no assigned teacher. Cannot generate lectures without a teacher.',
      });
    }

    const parseResult = generateLecturesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { from, to, dryRun } = parseResult.data;
    const settings = await getCenterSettings();
    const timeZone = settings.timezone || 'Asia/Dhaka';

    const startDate = new Date(from.slice(0, 10));
    const endDate = new Date(to.slice(0, 10));

    // Slots grouped by day of week
    const slots = batch.routineSlots;
    if (slots.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No routine slots configured for this batch',
        data: {
          createdCount: 0,
          skippedCount: 0,
          created: [],
          skipped: [],
        },
      });
    }

    const slotsByDay = new Map<DayOfWeek, typeof slots>();
    for (const slot of slots) {
      const arr = slotsByDay.get(slot.dayOfWeek) || [];
      arr.push(slot);
      slotsByDay.set(slot.dayOfWeek, arr);
    }

    const candidateLectures: Array<{
      batchId: string;
      subjectId: string;
      teacherId: string;
      routineSlotId: string;
      title: string;
      plannedTopics: string;
      startsAt: Date;
      endsAt: Date;
      status: LectureStatus;
      isPublished: boolean;
      createdById: string;
    }> = [];

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayOfWeekNum = currentDate.getDay();
      const dayOfWeekEnum = DAY_OF_WEEK_MAP[dayOfWeekNum];
      const daySlots = slotsByDay.get(dayOfWeekEnum);

      if (daySlots && daySlots.length > 0) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        for (const slot of daySlots) {
          const startsAt = localTimeToUtc(dateStr, slot.startTime, timeZone);
          const endsAt = localTimeToUtc(dateStr, slot.endTime, timeZone);

          candidateLectures.push({
            batchId: batch.id,
            subjectId: batch.subjectId,
            teacherId: batch.teacherId,
            routineSlotId: slot.id,
            title: `Routine Lecture (${slot.startTime} - ${slot.endTime})`,
            plannedTopics: `Routine class on ${dayOfWeekEnum} (${slot.startTime} - ${slot.endTime})`,
            startsAt,
            endsAt,
            status: LectureStatus.PLANNED,
            isPublished: false,
            createdById: req.user.userId,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Check existing (routineSlotId, startsAt) to be idempotent
    const existingSlots = await prisma.lecture.findMany({
      where: {
        batchId: batch.id,
        routineSlotId: { in: slots.map((s) => s.id) },
        startsAt: {
          gte: new Date(startDate.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(endDate.getTime() + 48 * 60 * 60 * 1000),
        },
      },
      select: {
        routineSlotId: true,
        startsAt: true,
      },
    });

    const existingSet = new Set(
      existingSlots.map((e) => `${e.routineSlotId}_${e.startsAt.toISOString()}`)
    );

    const toCreate = candidateLectures.filter(
      (c) => !existingSet.has(`${c.routineSlotId}_${c.startsAt.toISOString()}`)
    );
    const toSkip = candidateLectures.filter((c) =>
      existingSet.has(`${c.routineSlotId}_${c.startsAt.toISOString()}`)
    );

    if (dryRun) {
      return res.status(200).json({
        success: true,
        message: 'Dry run completed',
        data: {
          dryRun: true,
          createdCount: toCreate.length,
          skippedCount: toSkip.length,
          wouldCreate: toCreate.map((l) => ({
            routineSlotId: l.routineSlotId,
            startsAt: l.startsAt.toISOString(),
            endsAt: l.endsAt.toISOString(),
          })),
          wouldSkip: toSkip.map((l) => ({
            routineSlotId: l.routineSlotId,
            startsAt: l.startsAt.toISOString(),
            endsAt: l.endsAt.toISOString(),
          })),
        },
      });
    }

    if (toCreate.length > 0) {
      await prisma.lecture.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'LECTURE_GENERATE',
      entityType: 'Lecture',
      branchId: batch.branchId,
      metadata: {
        batchId,
        createdCount: toCreate.length,
        skippedCount: toSkip.length,
        dryRun: false,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Generated ${toCreate.length} lectures (${toSkip.length} skipped as already existing)`,
      data: {
        createdCount: toCreate.length,
        skippedCount: toSkip.length,
      },
    });
  } catch (error) {
    console.error('Generate lectures error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error generating lectures',
    });
  }
}

export async function getLectures(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { page, limit, skip, take } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const where: Prisma.LectureWhereInput = {};

    // Branch scoping
    if (req.user.role === Role.ADMIN) {
      where.batch = { branchId: req.user.branchId };
    } else if (req.user.role === Role.TEACHER) {
      where.OR = [
        { teacherId: req.user.userId },
        { batch: { teacherId: req.user.userId } },
      ];
    } else if (req.user.role === Role.STUDENT) {
      // Must be published and have ACTIVE enrollment
      where.isPublished = true;
      where.batch = {
        enrollments: {
          some: {
            studentId: req.user.userId,
            status: EnrollmentStatus.ACTIVE,
          },
        },
      };
    } else if (req.user.role === Role.GUARDIAN) {
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: 'studentId query parameter is required for guardians',
        });
      }

      // Verify guardian link
      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: {
            guardianId: req.user.userId,
            studentId,
          },
        },
      });

      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not linked to this student',
        });
      }

      where.isPublished = true;
      where.batch = {
        enrollments: {
          some: {
            studentId,
            status: EnrollmentStatus.ACTIVE,
          },
        },
      };
    }

    // Query filters
    if (req.query.batchId) {
      where.batchId = req.query.batchId as string;
    }
    if (req.query.teacherId) {
      where.teacherId = req.query.teacherId as string;
    }
    if (req.query.subjectId) {
      where.subjectId = req.query.subjectId as string;
    }
    if (req.query.status) {
      where.status = req.query.status as LectureStatus;
    }
    if (req.query.from || req.query.to) {
      where.startsAt = {};
      if (req.query.from) {
        where.startsAt.gte = new Date(req.query.from as string);
      }
      if (req.query.to) {
        where.startsAt.lte = new Date(req.query.to as string);
      }
    }

    const [items, total] = await Promise.all([
      prisma.lecture.findMany({
        where,
        // List responses NEVER include onlineUrl or onlinePasscode
        select: {
          id: true,
          batchId: true,
          subjectId: true,
          chapterId: true,
          teacherId: true,
          routineSlotId: true,
          title: true,
          plannedTopics: true,
          coveredTopics: true,
          homeworkNote: true,
          startsAt: true,
          endsAt: true,
          status: true,
          rescheduledAt: true,
          isPublished: true,
          onlineProvider: true,
          createdAt: true,
          updatedAt: true,
          subject: { select: { id: true, name: true } },
          chapter: { select: { id: true, name: true } },
          teacher: { select: { id: true, name: true } },
          batch: { select: { id: true, name: true, branchId: true } },
        },
        orderBy: { startsAt: 'asc' },
        skip,
        take,
      }),
      prisma.lecture.count({ where }),
    ]);

    const meta = buildMeta(total, page, limit);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: meta,
      },
    });
  } catch (error) {
    console.error('Get lectures error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving lectures',
    });
  }
}

export async function getLectureById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
        subject: { select: { id: true, name: true } },
        chapter: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
        attachments: {
          select: {
            id: true,
            title: true,
            kind: true,
            url: true, // Only for LINK attachments
            format: true,
            bytes: true,
            originalName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    const user = req.user;

    // Scoping
    if (user.role === Role.ADMIN && lecture.batch.branchId !== user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch lecture',
      });
    }

    if (user.role === Role.TEACHER) {
      if (lecture.teacherId !== user.userId && lecture.batch.teacherId !== user.userId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only view lectures you teach',
        });
      }
    }

    if (user.role === Role.STUDENT) {
      if (!lecture.isPublished) {
        return res.status(404).json({
          success: false,
          message: 'Lecture not found or access denied',
        });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId: user.userId,
            batchId: lecture.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Active batch enrollment required',
        });
      }
    }

    if (user.role === Role.GUARDIAN) {
      if (!lecture.isPublished) {
        return res.status(404).json({
          success: false,
          message: 'Lecture not found or access denied',
        });
      }
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: 'studentId query parameter is required for guardians',
        });
      }
      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: {
            guardianId: user.userId,
            studentId,
          },
        },
      });
      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not linked to this student',
        });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId,
            batchId: lecture.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Student has no active enrollment in this batch',
        });
      }
    }

    const settings = await getCenterSettings();
    const features = (settings.features as Record<string, boolean>) || {};
    const onlineClassesAllowed = features.onlineClasses !== false;

    // Online class visibility rule
    let onlineUrl: string | null = null;
    let onlinePasscode: string | null = null;
    let canJoinNow = false;
    let joinOpensAt: string | null = null;

    if (onlineClassesAllowed && lecture.onlineUrl) {
      const isStaff = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN || user.role === Role.TEACHER;
      if (isStaff) {
        onlineUrl = lecture.onlineUrl;
        onlinePasscode = lecture.onlinePasscode;
        canJoinNow = true;
      } else if (user.role === Role.STUDENT && lecture.status !== LectureStatus.CANCELLED) {
        const now = Date.now();
        const joinOpensTime = lecture.startsAt.getTime() - ONLINE_CLASS_CONFIG.JOIN_BEFORE_MINUTES * 60 * 1000;
        const joinClosesTime = lecture.endsAt.getTime() + ONLINE_CLASS_CONFIG.JOIN_AFTER_MINUTES * 60 * 1000;

        joinOpensAt = new Date(joinOpensTime).toISOString();

        if (now >= joinOpensTime && now <= joinClosesTime) {
          canJoinNow = true;
          onlineUrl = lecture.onlineUrl;
          onlinePasscode = lecture.onlinePasscode;
        } else {
          canJoinNow = false;
        }
      }
      // GUARDIANs never receive the onlineUrl or onlinePasscode
    }

    // Attachments: omit url for FILE attachments
    const safeAttachments = lecture.attachments.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      url: a.kind === 'LINK' ? a.url : null,
      format: a.format,
      bytes: a.bytes,
      originalName: a.originalName,
      createdAt: a.createdAt,
    }));

    const responseData: Record<string, any> = {
      id: lecture.id,
      batchId: lecture.batchId,
      subjectId: lecture.subjectId,
      chapterId: lecture.chapterId,
      teacherId: lecture.teacherId,
      routineSlotId: lecture.routineSlotId,
      title: lecture.title,
      plannedTopics: lecture.plannedTopics,
      coveredTopics: lecture.coveredTopics,
      homeworkNote: lecture.homeworkNote,
      startsAt: lecture.startsAt,
      endsAt: lecture.endsAt,
      status: lecture.status,
      cancelReason: lecture.cancelReason,
      rescheduledAt: lecture.rescheduledAt,
      isPublished: lecture.isPublished,
      createdAt: lecture.createdAt,
      updatedAt: lecture.updatedAt,
      batch: lecture.batch,
      subject: lecture.subject,
      chapter: lecture.chapter,
      teacher: lecture.teacher,
      attachments: safeAttachments,
    };

    if (onlineClassesAllowed) {
      responseData.onlineProvider = lecture.onlineProvider;
      if (user.role === Role.STUDENT) {
        responseData.canJoinNow = canJoinNow;
        responseData.joinOpensAt = joinOpensAt;
      }
      if (onlineUrl !== null) {
        responseData.onlineUrl = onlineUrl;
      }
      if (onlinePasscode !== null) {
        responseData.onlinePasscode = onlinePasscode;
      }
    }

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Get lecture by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving lecture',
    });
  }
}

export async function getSyllabusProgress(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        subject: {
          include: {
            chapters: true,
          },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    const user = req.user;
    const isStaff = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN || user.role === Role.TEACHER;

    if (user.role === Role.ADMIN && batch.branchId !== user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch batch',
      });
    }

    if (user.role === Role.STUDENT) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId: user.userId,
            batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Active batch enrollment required',
        });
      }
    }

    if (user.role === Role.GUARDIAN) {
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: 'studentId query parameter is required for guardians',
        });
      }
      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: {
            guardianId: user.userId,
            studentId,
          },
        },
      });
      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Guardian is not linked to this student',
        });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId,
            batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Student has no active enrollment in this batch',
        });
      }
    }

    // Filter completed lectures: students and guardians count only published COMPLETED lectures
    const lectureWhere: Prisma.LectureWhereInput = {
      batchId,
      status: LectureStatus.COMPLETED,
      chapterId: { not: null },
    };
    if (!isStaff) {
      lectureWhere.isPublished = true;
    }

    const completedLectures = await prisma.lecture.findMany({
      where: lectureWhere,
      select: {
        chapterId: true,
        endsAt: true,
      },
      orderBy: { endsAt: 'desc' },
    });

    const chapterLastCovered = new Map<string, Date>();
    for (const l of completedLectures) {
      if (l.chapterId && !chapterLastCovered.has(l.chapterId)) {
        chapterLastCovered.set(l.chapterId, l.endsAt);
      }
    }

    const chapters = batch.subject.chapters;
    let coveredCount = 0;

    const chapterProgress = chapters.map((c) => {
      const lastCoveredAt = chapterLastCovered.get(c.id) || null;
      const covered = lastCoveredAt !== null;
      if (covered) coveredCount++;
      return {
        id: c.id,
        name: c.name,
        covered,
        lastCoveredAt,
      };
    });

    const percent = chapters.length > 0 ? Math.round((coveredCount / chapters.length) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        batchId: batch.id,
        batchName: batch.name,
        subject: {
          id: batch.subject.id,
          name: batch.subject.name,
          totalChapters: chapters.length,
          coveredChapters: coveredCount,
          percent,
          chapters: chapterProgress,
        },
      },
    });
  } catch (error) {
    console.error('Get syllabus progress error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error calculating syllabus progress',
    });
  }
}
