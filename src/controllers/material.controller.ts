import { Request, Response } from 'express';
import { Role, EnrollmentStatus, Prisma, AttachmentKind, StudyMaterialType } from '@prisma/client';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import { escapeHtml } from '../utils/escapeHtml';
import { sendAcademicNotification } from '../services/notification.service';
import { verifyCloudinaryAsset, safelyDeleteCloudinaryAsset } from './attachment.controller';
import {
  createMaterialSchema,
  updateMaterialSchema,
  publishMaterialSchema,
  reorderMaterialsSchema,
  copyMaterialSchema,
  materialQuerySchema,
} from '../validators/material.validator';

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

interface MaterialAttachmentRecord {
  id: string;
  materialId?: string;
  kind: AttachmentKind;
  title: string;
  url?: string | null;
  publicId?: string | null;
  resourceType?: string | null;
  format?: string | null;
  bytes?: number | null;
  originalName?: string | null;
  uploadedById?: string;
  createdAt?: Date | null;
}

interface MaterialRecordInput {
  id: string;
  branchId: string;
  batchId: string;
  subjectId: string;
  chapterId?: string | null;
  lectureId?: string | null;
  title: string;
  description?: string | null;
  type: StudyMaterialType;
  isPublished: boolean;
  availableFrom?: Date | string | null;
  sortOrder: number;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  chapter?: { id: string; name: string } | null;
  lecture?: { id: string; title: string | null } | null;
  subject?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  attachments?: MaterialAttachmentRecord[];
}

interface VerifiedAttachmentData {
  kind: AttachmentKind;
  title: string;
  url: string | null;
  publicId: string | null;
  resourceType: string | null;
  format: string | null;
  bytes: number | null;
  originalName: string | null;
  uploadedById: string;
}

export type SanitizedMaterial = ReturnType<typeof sanitizeMaterial>;

/**
 * Sanitizes a StudyMaterial model for API responses.
 * Never exposes FILE publicId or internal secrets.
 */
export function sanitizeMaterial(mat: MaterialRecordInput) {
  const isNew = Boolean(
    mat.isPublished &&
      mat.createdAt &&
      Date.now() - new Date(mat.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000
  );

  return {
    id: mat.id,
    branchId: mat.branchId,
    batchId: mat.batchId,
    subjectId: mat.subjectId,
    chapterId: mat.chapterId,
    lectureId: mat.lectureId,
    title: mat.title,
    description: mat.description,
    type: mat.type,
    isPublished: mat.isPublished,
    availableFrom:
      mat.availableFrom instanceof Date
        ? mat.availableFrom.toISOString()
        : mat.availableFrom
          ? String(mat.availableFrom)
          : null,
    sortOrder: mat.sortOrder,
    createdAt:
      mat.createdAt instanceof Date
        ? mat.createdAt.toISOString()
        : mat.createdAt
          ? String(mat.createdAt)
          : null,
    updatedAt:
      mat.updatedAt instanceof Date
        ? mat.updatedAt.toISOString()
        : mat.updatedAt
          ? String(mat.updatedAt)
          : null,
    isNew,
    chapter: mat.chapter ? { id: mat.chapter.id, name: mat.chapter.name } : null,
    lecture: mat.lecture ? { id: mat.lecture.id, title: mat.lecture.title } : null,
    subject: mat.subject ? { id: mat.subject.id, name: mat.subject.name } : null,
    createdBy: mat.createdBy ? { id: mat.createdBy.id, name: mat.createdBy.name } : null,
    attachments: (mat.attachments || []).map((att: MaterialAttachmentRecord) => ({
      id: att.id,
      materialId: att.materialId,
      kind: att.kind,
      title: att.title,
      url: att.kind === 'LINK' ? att.url : undefined,
      format: att.format,
      bytes: att.bytes,
      originalName: att.originalName,
      createdAt:
        att.createdAt instanceof Date
          ? att.createdAt.toISOString()
          : att.createdAt
            ? String(att.createdAt)
            : null,
    })),
  };
}

/**
 * Helper to check caller's batch access for staff mutations.
 */
async function getStaffBatchOrReject(batchId: string, req: Request, res: Response) {
  const user = req.user!;
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      name: true,
      branchId: true,
      subjectId: true,
      teacherId: true,
      archivedAt: true,
    },
  });

  if (!batch) {
    res.status(404).json({ success: false, message: 'Batch not found' });
    return null;
  }

  if (user.role === Role.SUPER_ADMIN) {
    // Super admin has full access across all branches
  } else if (user.role === Role.ADMIN) {
    if (batch.branchId !== user.branchId) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return null;
    }
  } else if (user.role === Role.TEACHER) {
    if (batch.branchId !== user.branchId || batch.teacherId !== user.userId) {
      res.status(403).json({ success: false, message: 'Forbidden: You can only manage materials in your assigned batches' });
      return null;
    }
  } else {
    res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    return null;
  }

  if (batch.archivedAt) {
    res.status(400).json({ success: false, message: 'Cannot modify materials in an archived batch' });
    return null;
  }

  return batch;
}

export async function createMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const parseResult = createMaterialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;
    const batch = await getStaffBatchOrReject(data.batchId, req, res);
    if (!batch) return;

    if (data.chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: data.chapterId },
        select: { id: true, subjectId: true },
      });
      if (!chapter) {
        return res.status(404).json({ success: false, message: 'Chapter not found' });
      }
      if (chapter.subjectId !== batch.subjectId) {
        return res.status(400).json({ success: false, message: 'Chapter does not belong to this batch subject' });
      }
    }

    if (data.lectureId) {
      const lecture = await prisma.lecture.findUnique({
        where: { id: data.lectureId },
        select: { id: true, batchId: true },
      });
      if (!lecture) {
        return res.status(404).json({ success: false, message: 'Lecture not found' });
      }
      if (lecture.batchId !== batch.id) {
        return res.status(400).json({ success: false, message: 'Lecture does not belong to this batch' });
      }
    }

    // Verify attachments
    const verifiedAttachments: Array<{
      kind: 'FILE' | 'LINK';
      title: string;
      url: string | null;
      publicId: string | null;
      resourceType: string | null;
      format: string | null;
      bytes: number | null;
      originalName: string | null;
      uploadedById: string;
    }> = [];

    if (data.attachments && data.attachments.length > 0) {
      for (const att of data.attachments) {
        if (att.kind === 'FILE') {
          if (!att.publicId) {
            return res.status(400).json({ success: false, message: 'FILE attachment must include publicId' });
          }
          try {
            const assetInfo = await verifyCloudinaryAsset(
              att.publicId,
              'material',
              batch.branchId,
              att.resourceType,
              att.format,
              att.bytes
            );
            verifiedAttachments.push({
              kind: 'FILE',
              title: att.title,
              url: null,
              publicId: att.publicId,
              resourceType: assetInfo.resourceType,
              format: assetInfo.format,
              bytes: assetInfo.bytes,
              originalName: att.originalName || null,
              uploadedById: req.user.userId,
            });
          } catch (err: unknown) {
            return res.status(400).json({
              success: false,
              message: `Attachment verification failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          verifiedAttachments.push({
            kind: 'LINK',
            title: att.title,
            url: att.url || null,
            publicId: null,
            resourceType: null,
            format: null,
            bytes: null,
            originalName: null,
            uploadedById: req.user.userId,
          });
        }
      }
    }

    // Determine sortOrder
    const maxSort = await prisma.studyMaterial.findFirst({
      where: { batchId: batch.id, chapterId: data.chapterId || null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSort?.sortOrder ?? -1) + 1;

    const isPublished = Boolean(data.publish);

    const material = await prisma.studyMaterial.create({
      data: {
        branchId: batch.branchId,
        batchId: batch.id,
        subjectId: batch.subjectId,
        chapterId: data.chapterId || null,
        lectureId: data.lectureId || null,
        title: data.title,
        description: data.description || null,
        type: data.type,
        isPublished,
        availableFrom: data.availableFrom ? new Date(data.availableFrom) : null,
        sortOrder: nextSortOrder,
        createdById: req.user.userId,
        attachments: {
          create: verifiedAttachments,
        },
      },
      include: {
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_CREATE',
      entityType: 'StudyMaterial',
      entityId: material.id,
      branchId: batch.branchId,
      metadata: {
        materialId: material.id,
        batchId: batch.id,
        title: material.title,
        type: material.type,
        isPublished: material.isPublished,
      },
    });

    if (isPublished && data.notify) {
      await sendAcademicNotification({
        type: 'MATERIAL_PUBLISHED',
        title: `New Study Material: ${material.title}`,
        body: `New material "${material.title}" has been published in ${batch.name}.`,
        batchId: batch.id,
        entityType: 'StudyMaterial',
        entityId: material.id,
        emailSubject: `[EduFlow] New Study Material: ${material.title}`,
        emailBodyHtml: `A new study material <strong>${escapeHtml(material.title)}</strong> has been published for your class in <strong>${escapeHtml(batch.name)}</strong>. Please log in to your student portal to access it.`,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Material created successfully',
      data: sanitizeMaterial(material),
    });
  } catch (error) {
    console.error('Create material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error creating material' });
  }
}

export async function updateMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            name: true,
            branchId: true,
            subjectId: true,
            teacherId: true,
            archivedAt: true,
          },
        },
        attachments: true,
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const batch = await getStaffBatchOrReject(material.batchId, req, res);
    if (!batch) return;

    const parseResult = updateMaterialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;

    if (data.chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: data.chapterId },
        select: { id: true, subjectId: true },
      });
      if (!chapter) {
        return res.status(404).json({ success: false, message: 'Chapter not found' });
      }
      if (chapter.subjectId !== batch.subjectId) {
        return res.status(400).json({ success: false, message: 'Chapter does not belong to this batch subject' });
      }
    }

    if (data.lectureId) {
      const lecture = await prisma.lecture.findUnique({
        where: { id: data.lectureId },
        select: { id: true, batchId: true },
      });
      if (!lecture) {
        return res.status(404).json({ success: false, message: 'Lecture not found' });
      }
      if (lecture.batchId !== batch.id) {
        return res.status(400).json({ success: false, message: 'Lecture does not belong to this batch' });
      }
    }

    const willPublish = data.isPublished === true && !material.isPublished;

    // Handle attachments replacement if provided
    let updatedAttachmentsCreate:
      | Prisma.MaterialAttachmentUpdateManyWithoutMaterialNestedInput
      | undefined = undefined;
    if (data.attachments !== undefined) {
      // Find removed attachments to clean up Cloudinary assets
      const newPublicIds = new Set(
        data.attachments.filter((a) => a.kind === 'FILE' && a.publicId).map((a) => a.publicId as string)
      );

      for (const oldAtt of material.attachments) {
        if (oldAtt.kind === 'FILE' && oldAtt.publicId && !newPublicIds.has(oldAtt.publicId)) {
          await safelyDeleteCloudinaryAsset(oldAtt.publicId, oldAtt.resourceType, undefined, oldAtt.id);
        }
      }

      await prisma.materialAttachment.deleteMany({
        where: { materialId: material.id },
      });

      const verifiedAttachments: VerifiedAttachmentData[] = [];
      for (const att of data.attachments) {
        if (att.kind === 'FILE') {
          if (!att.publicId) {
            return res.status(400).json({ success: false, message: 'FILE attachment must include publicId' });
          }
          try {
            const assetInfo = await verifyCloudinaryAsset(
              att.publicId,
              'material',
              batch.branchId,
              att.resourceType,
              att.format,
              att.bytes
            );
            verifiedAttachments.push({
              kind: 'FILE',
              title: att.title,
              url: null,
              publicId: att.publicId,
              resourceType: assetInfo.resourceType,
              format: assetInfo.format,
              bytes: assetInfo.bytes,
              originalName: att.originalName || null,
              uploadedById: req.user.userId,
            });
          } catch (err: unknown) {
            return res.status(400).json({
              success: false,
              message: `Attachment verification failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          verifiedAttachments.push({
            kind: 'LINK',
            title: att.title,
            url: att.url || null,
            publicId: null,
            resourceType: null,
            format: null,
            bytes: null,
            originalName: null,
            uploadedById: req.user.userId,
          });
        }
      }

      updatedAttachmentsCreate = { create: verifiedAttachments };
    }

    const updated = await prisma.studyMaterial.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.chapterId !== undefined ? { chapterId: data.chapterId } : {}),
        ...(data.lectureId !== undefined ? { lectureId: data.lectureId } : {}),
        ...(data.availableFrom !== undefined
          ? { availableFrom: data.availableFrom ? new Date(data.availableFrom) : null }
          : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
        updatedById: req.user.userId,
        ...(updatedAttachmentsCreate ? { attachments: updatedAttachmentsCreate } : {}),
      },
      include: {
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_UPDATE',
      entityType: 'StudyMaterial',
      entityId: updated.id,
      branchId: batch.branchId,
      metadata: {
        materialId: updated.id,
        batchId: batch.id,
        updatedFields: Object.keys(data),
      },
    });

    if (willPublish && data.notify) {
      await sendAcademicNotification({
        type: 'MATERIAL_PUBLISHED',
        title: `New Study Material: ${updated.title}`,
        body: `New material "${updated.title}" has been published in ${batch.name}.`,
        batchId: batch.id,
        entityType: 'StudyMaterial',
        entityId: updated.id,
        emailSubject: `[EduFlow] New Study Material: ${updated.title}`,
        emailBodyHtml: `A new study material <strong>${escapeHtml(updated.title)}</strong> has been published for your class in <strong>${escapeHtml(batch.name)}</strong>. Please log in to your student portal to access it.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Material updated successfully',
      data: sanitizeMaterial(updated),
    });
  } catch (error) {
    console.error('Update material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error updating material' });
  }
}

export async function deleteMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            branchId: true,
            teacherId: true,
            archivedAt: true,
          },
        },
        attachments: true,
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const batch = await getStaffBatchOrReject(material.batchId, req, res);
    if (!batch) return;

    // Delete Cloudinary assets safely (only if no other attachment references them)
    for (const att of material.attachments) {
      if (att.kind === 'FILE' && att.publicId) {
        await safelyDeleteCloudinaryAsset(att.publicId, att.resourceType, undefined, att.id);
      }
    }

    await prisma.studyMaterial.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_DELETE',
      entityType: 'StudyMaterial',
      entityId: material.id,
      branchId: batch.branchId,
      metadata: {
        materialId: material.id,
        batchId: batch.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Material deleted successfully',
    });
  } catch (error) {
    console.error('Delete material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error deleting material' });
  }
}

export async function publishMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            name: true,
            branchId: true,
            teacherId: true,
            archivedAt: true,
          },
        },
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const batch = await getStaffBatchOrReject(material.batchId, req, res);
    if (!batch) return;

    const parseResult = publishMaterialSchema.safeParse(req.body);
    const notify = parseResult.success ? parseResult.data.notify : false;

    const updated = await prisma.studyMaterial.update({
      where: { id },
      data: {
        isPublished: true,
        updatedById: req.user.userId,
      },
      include: {
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_PUBLISH',
      entityType: 'StudyMaterial',
      entityId: updated.id,
      branchId: batch.branchId,
      metadata: {
        materialId: updated.id,
        batchId: batch.id,
      },
    });

    if (notify) {
      await sendAcademicNotification({
        type: 'MATERIAL_PUBLISHED',
        title: `New Study Material: ${updated.title}`,
        body: `New material "${updated.title}" has been published in ${batch.name}.`,
        batchId: batch.id,
        entityType: 'StudyMaterial',
        entityId: updated.id,
        emailSubject: `[EduFlow] New Study Material: ${updated.title}`,
        emailBodyHtml: `A new study material <strong>${escapeHtml(updated.title)}</strong> has been published for your class in <strong>${escapeHtml(batch.name)}</strong>. Please log in to your student portal to access it.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Material published successfully',
      data: sanitizeMaterial(updated),
    });
  } catch (error) {
    console.error('Publish material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error publishing material' });
  }
}

export async function unpublishMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            branchId: true,
            teacherId: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const batch = await getStaffBatchOrReject(material.batchId, req, res);
    if (!batch) return;

    const updated = await prisma.studyMaterial.update({
      where: { id },
      data: {
        isPublished: false,
        updatedById: req.user.userId,
      },
      include: {
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_UNPUBLISH',
      entityType: 'StudyMaterial',
      entityId: updated.id,
      branchId: batch.branchId,
      metadata: {
        materialId: updated.id,
        batchId: batch.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Material unpublished successfully',
      data: sanitizeMaterial(updated),
    });
  } catch (error) {
    console.error('Unpublish material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error unpublishing material' });
  }
}

export async function reorderMaterials(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const batchId = getParam(req.params.batchId);
    const batch = await getStaffBatchOrReject(batchId, req, res);
    if (!batch) return;

    const parseResult = reorderMaterialsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { ids } = parseResult.data;

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.studyMaterial.updateMany({
          where: { id, batchId: batch.id },
          data: { sortOrder: index },
        })
      )
    );

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_REORDER',
      entityType: 'StudyMaterial',
      branchId: batch.branchId,
      metadata: {
        batchId: batch.id,
        count: ids.length,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Materials reordered successfully',
    });
  } catch (error) {
    console.error('Reorder materials error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error reordering materials' });
  }
}

export async function copyMaterial(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            branchId: true,
            teacherId: true,
            subjectId: true,
            archivedAt: true,
          },
        },
        attachments: true,
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const sourceBatch = await getStaffBatchOrReject(material.batchId, req, res);
    if (!sourceBatch) return;

    const parseResult = copyMaterialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { batchIds } = parseResult.data;
    const targetBatches = await prisma.batch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        branchId: true,
        teacherId: true,
        subjectId: true,
        archivedAt: true,
      },
    });

    if (targetBatches.length !== batchIds.length) {
      return res.status(404).json({ success: false, message: 'One or more target batches not found' });
    }

    // Validate each target batch
    for (const tb of targetBatches) {
      if (tb.branchId !== sourceBatch.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Cannot copy materials to a batch in another branch',
        });
      }
      if (req.user.role === Role.TEACHER && tb.teacherId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'Teachers can only copy materials into their own assigned batches',
        });
      }
      if (tb.archivedAt) {
        return res.status(400).json({
          success: false,
          message: `Target batch ${tb.id} is archived`,
        });
      }
    }

    const copiedMaterials: SanitizedMaterial[] = [];
    const userId = req.user.userId;

    for (const tb of targetBatches) {
      // If subject matches, keep chapterId; if subject differs, set to null
      const chapterId = tb.subjectId === material.subjectId ? material.chapterId : null;
      // Lecture is specific to source batch, so set lectureId to null
      const lectureId = null;

      const maxSort = await prisma.studyMaterial.findFirst({
        where: { batchId: tb.id, chapterId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const nextSortOrder = (maxSort?.sortOrder ?? -1) + 1;

      const newMat = await prisma.studyMaterial.create({
        data: {
          branchId: tb.branchId,
          batchId: tb.id,
          subjectId: tb.subjectId,
          chapterId,
          lectureId,
          title: material.title,
          description: material.description,
          type: material.type,
          isPublished: material.isPublished,
          availableFrom: material.availableFrom,
          sortOrder: nextSortOrder,
          createdById: userId,
          attachments: {
            create: material.attachments.map((att: MaterialAttachmentRecord) => ({
              kind: att.kind,
              title: att.title,
              url: att.url,
              publicId: att.publicId,
              resourceType: att.resourceType,
              format: att.format,
              bytes: att.bytes,
              originalName: att.originalName,
              uploadedById: userId,
            })),
          },
        },
        include: {
          chapter: { select: { id: true, name: true } },
          lecture: { select: { id: true, title: true } },
          subject: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          attachments: true,
        },
      });

      copiedMaterials.push(sanitizeMaterial(newMat));
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'STUDY_MATERIAL_COPY',
      entityType: 'StudyMaterial',
      entityId: material.id,
      branchId: sourceBatch.branchId,
      metadata: {
        sourceMaterialId: material.id,
        sourceBatchId: sourceBatch.id,
        targetBatchIds: batchIds,
        count: copiedMaterials.length,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Material copied successfully',
      data: {
        copiedCount: copiedMaterials.length,
        materials: copiedMaterials,
      },
    });
  } catch (error) {
    console.error('Copy material error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error copying material' });
  }
}

/**
 * Authorization helper for reading batch materials.
 */
async function authorizeBatchRead(batchId: string, req: Request, res: Response) {
  const user = req.user!;
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      branchId: true,
      subjectId: true,
      teacherId: true,
      archivedAt: true,
    },
  });

  if (!batch) {
    res.status(404).json({ success: false, message: 'Batch not found' });
    return null;
  }

  if (user.role === Role.SUPER_ADMIN) {
    return { batch, isStaff: true };
  }

  if (user.role === Role.ADMIN) {
    if (batch.branchId !== user.branchId) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return null;
    }
    return { batch, isStaff: true };
  }

  if (user.role === Role.TEACHER) {
    if (batch.branchId !== user.branchId || batch.teacherId !== user.userId) {
      res.status(403).json({ success: false, message: 'Forbidden: Access denied to this batch' });
      return null;
    }
    return { batch, isStaff: true };
  }

  if (user.role === Role.STUDENT) {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: {
          studentId: user.userId,
          batchId: batch.id,
        },
      },
    });
    if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
      res.status(403).json({ success: false, message: 'Forbidden: You are not actively enrolled in this batch' });
      return null;
    }
    return { batch, isStaff: false };
  }

  if (user.role === Role.GUARDIAN) {
    const studentId = req.query.studentId as string;
    if (!studentId) {
      res.status(400).json({ success: false, message: 'studentId query parameter is required for guardian access' });
      return null;
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
      res.status(403).json({ success: false, message: 'Forbidden: Not linked to this student' });
      return null;
    }
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: {
          studentId,
          batchId: batch.id,
        },
      },
    });
    if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
      res.status(403).json({ success: false, message: 'Forbidden: Student is not actively enrolled in this batch' });
      return null;
    }
    return { batch, isStaff: false };
  }

  res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
  return null;
}

export async function getMaterialsByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const batchId = getParam(req.params.batchId);
    const auth = await authorizeBatchRead(batchId, req, res);
    if (!auth) return;

    const parseResult = materialQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { chapterId, type, q, status, page, limit } = parseResult.data;
    const { isStaff, batch } = auth;

    const where: Prisma.StudyMaterialWhereInput = {
      batchId: batch.id,
    };

    if (!isStaff) {
      where.isPublished = true;
      where.OR = [{ availableFrom: null }, { availableFrom: { lte: new Date() } }];
    } else {
      if (status === 'published') {
        where.isPublished = true;
      } else if (status === 'draft') {
        where.isPublished = false;
      }
    }

    if (chapterId) {
      where.chapterId = chapterId;
    }

    if (type) {
      where.type = type;
    }

    if (q) {
      const qConditions = [
        { title: { contains: q, mode: 'insensitive' as const } },
        { description: { contains: q, mode: 'insensitive' as const } },
      ];
      if (Array.isArray(where.AND)) {
        where.AND.push({ OR: qConditions });
      } else if (where.AND) {
        where.AND = [where.AND, { OR: qConditions }];
      } else {
        where.AND = [{ OR: qConditions }];
      }
    }

    // Base where for grouped chapter counts (includes all items matching role visibility)
    const baseCountWhere: Prisma.StudyMaterialWhereInput = { batchId: batch.id };
    if (!isStaff) {
      baseCountWhere.isPublished = true;
      baseCountWhere.OR = [{ availableFrom: null }, { availableFrom: { lte: new Date() } }];
    }

    const [allForCounts, total, materials] = await Promise.all([
      prisma.studyMaterial.findMany({
        where: baseCountWhere,
        select: { chapterId: true },
      }),
      prisma.studyMaterial.count({ where }),
      prisma.studyMaterial.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          chapter: { select: { id: true, name: true } },
          lecture: { select: { id: true, title: true } },
          subject: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          attachments: true,
        },
      }),
    ]);

    const chapterCounts: Record<string, number> = {};
    for (const m of allForCounts) {
      const k = m.chapterId || 'uncategorized';
      chapterCounts[k] = (chapterCounts[k] || 0) + 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        items: materials.map(sanitizeMaterial),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        chapterCounts,
      },
    });
  } catch (error) {
    console.error('Get materials by batch error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving materials' });
  }
}

export async function getMaterialById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            branchId: true,
            teacherId: true,
          },
        },
        chapter: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const user = req.user;
    if (user.role === Role.SUPER_ADMIN) {
      // Allowed
    } else if (user.role === Role.ADMIN) {
      if (material.branchId !== user.branchId) {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
    } else if (user.role === Role.TEACHER) {
      if (material.branchId !== user.branchId || material.batch.teacherId !== user.userId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this material' });
      }
    } else if (user.role === Role.STUDENT) {
      const isAvailable = !material.availableFrom || material.availableFrom <= new Date();
      if (!material.isPublished || !isAvailable) {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId: user.userId,
            batchId: material.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({ success: false, message: 'Forbidden: You are not actively enrolled in this batch' });
      }
    } else if (user.role === Role.GUARDIAN) {
      const isAvailable = !material.availableFrom || material.availableFrom <= new Date();
      if (!material.isPublished || !isAvailable) {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({ success: false, message: 'studentId query parameter is required for guardian access' });
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
        return res.status(403).json({ success: false, message: 'Forbidden: Not linked to this student' });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId,
            batchId: material.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({ success: false, message: 'Forbidden: Student is not actively enrolled in this batch' });
      }
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    return res.status(200).json({
      success: true,
      data: sanitizeMaterial(material),
    });
  } catch (error) {
    console.error('Get material by id error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving material' });
  }
}

export async function getBatchMaterialsSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const batchId = getParam(req.params.batchId);
    const auth = await authorizeBatchRead(batchId, req, res);
    if (!auth) return;

    const { isStaff, batch } = auth;

    const [chapters, materials] = await Promise.all([
      prisma.chapter.findMany({
        where: { subjectId: batch.subjectId },
        select: { id: true, name: true, position: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.studyMaterial.findMany({
        where: {
          batchId: batch.id,
          ...(!isStaff
            ? {
                isPublished: true,
                OR: [{ availableFrom: null }, { availableFrom: { lte: new Date() } }],
              }
            : {}),
        },
        select: {
          id: true,
          chapterId: true,
          type: true,
          isPublished: true,
        },
      }),
    ]);

    // Group materials by chapter
    const summaryMap = new Map<
      string | null,
      {
        chapterId: string | null;
        chapterName: string | null;
        total: number;
        drafts: number;
        byType: Record<string, number>;
      }
    >();

    for (const ch of chapters) {
      summaryMap.set(ch.id, {
        chapterId: ch.id,
        chapterName: ch.name,
        total: 0,
        drafts: 0,
        byType: {},
      });
    }

    // Include uncategorized entry
    summaryMap.set(null, {
      chapterId: null,
      chapterName: 'Uncategorized',
      total: 0,
      drafts: 0,
      byType: {},
    });

    for (const m of materials) {
      const target = summaryMap.get(m.chapterId) || summaryMap.get(null)!;
      target.total += 1;
      if (!m.isPublished && isStaff) {
        target.drafts += 1;
      }
      target.byType[m.type] = (target.byType[m.type] || 0) + 1;
    }

    const chapterList = Array.from(summaryMap.values()).filter(
      (entry) => entry.chapterId !== null || entry.total > 0
    );

    return res.status(200).json({
      success: true,
      data: {
        chapters: chapterList,
        totalMaterials: materials.length,
      },
    });
  } catch (error) {
    console.error('Get batch materials summary error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving materials summary' });
  }
}

export async function getMaterialAccessLogs(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const id = getParam(req.params.id);
    const material = await prisma.studyMaterial.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            branchId: true,
            teacherId: true,
          },
        },
      },
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const user = req.user;
    let isStaff = false;

    if (user.role === Role.SUPER_ADMIN) {
      isStaff = true;
    } else if (user.role === Role.ADMIN) {
      if (material.branchId === user.branchId) {
        isStaff = true;
      }
    } else if (user.role === Role.TEACHER) {
      if (material.branchId === user.branchId && material.batch.teacherId === user.userId) {
        isStaff = true;
      }
    }

    if (!isStaff) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only authorized teachers and administrators can view material access logs',
      });
    }

    const [enrollments, accessLogs] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          batchId: material.batchId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: {
          studentId: true,
          student: {
            select: {
              id: true,
              name: true,
              studentCode: true,
              email: true,
            },
          },
        },
        orderBy: { student: { name: 'asc' } },
      }),
      prisma.materialAccess.findMany({
        where: { materialId: material.id },
      }),
    ]);

    const accessMap = new Map(accessLogs.map((a) => [a.studentId, a]));

    const result = enrollments.map((e) => {
      const log = accessMap.get(e.studentId);
      return {
        studentId: e.student.id,
        studentName: e.student.name,
        studentCode: e.student.studentCode,
        studentEmail: e.student.email,
        opened: Boolean(log && log.accessCount > 0),
        firstAccessAt: log ? log.firstAccessAt.toISOString() : null,
        lastAccessAt: log ? log.lastAccessAt.toISOString() : null,
        accessCount: log ? log.accessCount : 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Get material access logs error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving access logs' });
  }
}
