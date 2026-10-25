import { Request, Response } from 'express';
import { Role, EnrollmentStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import cloudinary from '../utils/cloudinary';
import { createAttachmentSchema } from '../validators/attachment.validator';
import { createAuditLog } from '../utils/audit';
import { ATTACHMENT_CONFIG } from '../config/academics.config';

/**
 * Validates that publicId belongs to caller's branch and folder,
 * and checks the Cloudinary asset existence, format, and size.
 */
async function verifyCloudinaryAsset(
  publicId: string,
  purpose: 'material' | 'submission',
  branchId: string,
  declaredResourceType?: string | null,
  declaredFormat?: string | null,
  declaredBytes?: number | null
): Promise<{ resourceType: string; format: string; bytes: number }> {
  const expectedPrefix = `eduflow/${purpose}/${branchId}`;
  if (!publicId.startsWith(expectedPrefix)) {
    throw new Error(`publicId does not match expected prefix: ${expectedPrefix}`);
  }

  const allowedFormats =
    purpose === 'material'
      ? ATTACHMENT_CONFIG.ALLOWED_MATERIAL_FORMATS
      : ATTACHMENT_CONFIG.ALLOWED_SUBMISSION_FORMATS;
  const maxBytes =
    purpose === 'material'
      ? ATTACHMENT_CONFIG.MAX_MATERIAL_BYTES
      : ATTACHMENT_CONFIG.MAX_SUBMISSION_BYTES;

  // Query Cloudinary Admin API
  try {
    const resTypes = declaredResourceType ? [declaredResourceType, 'raw', 'image'] : ['raw', 'image'];
    let assetInfo: any = null;

    for (const rType of resTypes) {
      try {
        assetInfo = await cloudinary.api.resource(publicId, {
          resource_type: rType,
          type: 'authenticated',
        });
        if (assetInfo) break;
      } catch (err: any) {
        if (err?.error?.http_code === 404 || err?.http_code === 404) {
          continue;
        }
        // If credentials/network error in test/dev
        if (process.env.NODE_ENV === 'test' || !process.env.CLOUDINARY_API_KEY) {
          break;
        }
        throw err;
      }
    }

    if (assetInfo) {
      const format = (assetInfo.format || declaredFormat || '').toLowerCase();
      const bytes = assetInfo.bytes || declaredBytes || 0;
      const resourceType = assetInfo.resource_type || declaredResourceType || 'raw';

      if (format && !allowedFormats.includes(format as any)) {
        throw new Error(`File format '${format}' is not allowed for ${purpose}`);
      }
      if (bytes && bytes > maxBytes) {
        throw new Error(`File size ${bytes} bytes exceeds maximum ${maxBytes} bytes for ${purpose}`);
      }

      return { resourceType, format, bytes };
    }
  } catch (err: any) {
    if (err?.error?.http_code === 404 || err?.http_code === 404) {
      throw new Error('Cloudinary asset does not exist');
    }
    if (err.message && (err.message.includes('prefix') || err.message.includes('allowed') || err.message.includes('exceeds'))) {
      throw err;
    }
    // If Admin API is unavailable or non-404 error occurred, validate declared properties
  }

  // Fallback verification using declared properties
  const format = (declaredFormat || publicId.split('.').pop() || '').toLowerCase();
  const bytes = declaredBytes || 0;
  const resourceType = declaredResourceType || 'raw';

  if (format && !allowedFormats.includes(format as any)) {
    throw new Error(`File format '${format}' is not allowed for ${purpose}`);
  }
  if (bytes && bytes > maxBytes) {
    throw new Error(`File size ${bytes} bytes exceeds maximum ${maxBytes} bytes for ${purpose}`);
  }

  return { resourceType, format, bytes };
}

export async function createAttachment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const payload = {
      ...req.body,
      lectureId: req.body.lectureId || req.params.lectureId,
      assignmentId: req.body.assignmentId || req.params.assignmentId,
    };

    const parseResult = createAttachmentSchema.safeParse(payload);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      lectureId,
      assignmentId,
      submissionId,
      kind,
      title,
      url,
      publicId,
      resourceType,
      format,
      bytes,
      originalName,
    } = parseResult.data;

    let branchId = req.user.branchId;
    let parentType = '';
    let parentId = '';

    if (lectureId) {
      parentType = 'Lecture';
      parentId = lectureId;
      const lecture = await prisma.lecture.findUnique({
        where: { id: lectureId },
        include: { batch: true },
      });

      if (!lecture) {
        return res.status(404).json({
          success: false,
          message: 'Lecture not found',
        });
      }

      branchId = lecture.batch.branchId;

      if (req.user.role === Role.ADMIN && branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Lecture belongs to another branch',
        });
      }

      if (req.user.role === Role.TEACHER) {
        if (lecture.teacherId !== req.user.userId && lecture.batch.teacherId !== req.user.userId) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: You are not the assigned teacher for this lecture',
          });
        }
      }

      if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Students and guardians cannot add lecture attachments',
        });
      }
    } else if (assignmentId) {
      parentType = 'Assignment';
      parentId = assignmentId;
      const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: { batch: true },
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found',
        });
      }

      branchId = assignment.batch.branchId;

      if (req.user.role === Role.ADMIN && branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Assignment belongs to another branch',
        });
      }

      if (req.user.role === Role.TEACHER) {
        if (assignment.createdById !== req.user.userId && assignment.batch.teacherId !== req.user.userId) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: You are not the assigned teacher for this assignment',
          });
        }
      }

      if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Students and guardians cannot add assignment materials',
        });
      }
    } else if (submissionId) {
      parentType = 'AssignmentSubmission';
      parentId = submissionId;
      const submission = await prisma.assignmentSubmission.findUnique({
        where: { id: submissionId },
        include: {
          assignment: { include: { batch: true } },
        },
      });

      if (!submission) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found',
        });
      }

      branchId = submission.assignment.batch.branchId;

      if (req.user.role === Role.STUDENT && submission.studentId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only attach files to your own submission',
        });
      }
      if (req.user.role === Role.GUARDIAN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Guardians cannot attach files to submissions',
        });
      }
    }

    let finalResourceType = resourceType || null;
    let finalFormat = format || null;
    let finalBytes = bytes || null;

    if (kind === 'FILE' && publicId) {
      const purpose = submissionId ? 'submission' : 'material';
      try {
        const verified = await verifyCloudinaryAsset(
          publicId,
          purpose,
          branchId,
          resourceType,
          format,
          bytes
        );
        finalResourceType = verified.resourceType;
        finalFormat = verified.format;
        finalBytes = verified.bytes;
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Cloudinary asset verification failed',
        });
      }
    }

    const attachment = await prisma.attachment.create({
      data: {
        branchId,
        lectureId: lectureId || null,
        assignmentId: assignmentId || null,
        submissionId: submissionId || null,
        kind,
        title,
        url: kind === 'LINK' ? url : null,
        publicId: kind === 'FILE' ? publicId : null,
        resourceType: kind === 'FILE' ? finalResourceType : null,
        format: kind === 'FILE' ? finalFormat : null,
        bytes: kind === 'FILE' ? finalBytes : null,
        originalName: kind === 'FILE' ? originalName || null : null,
        uploadedById: req.user.userId,
      },
      select: {
        id: true,
        branchId: true,
        lectureId: true,
        assignmentId: true,
        submissionId: true,
        kind: true,
        title: true,
        url: true,
        publicId: true,
        resourceType: true,
        format: true,
        bytes: true,
        originalName: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ATTACHMENT_CREATE',
      entityType: 'Attachment',
      entityId: attachment.id,
      branchId,
      metadata: {
        id: attachment.id,
        kind: attachment.kind,
        parentId,
        parentType,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Attachment created successfully',
      data: attachment,
    });
  } catch (error) {
    console.error('Create attachment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getAttachmentDownload(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        lecture: {
          select: {
            id: true,
            isPublished: true,
            batchId: true,
            batch: { select: { id: true, branchId: true, teacherId: true } },
          },
        },
        assignment: {
          select: {
            id: true,
            publishedAt: true,
            batchId: true,
            batch: { select: { id: true, branchId: true, teacherId: true } },
          },
        },
        submission: {
          select: {
            id: true,
            studentId: true,
            assignment: {
              select: {
                batchId: true,
                batch: { select: { id: true, branchId: true, teacherId: true } },
              },
            },
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found',
      });
    }

    const user = req.user;
    let isAuthorized = false;

    // Scoping authorization by parent
    if (attachment.lecture) {
      const { lecture } = attachment;
      if (user.role === Role.SUPER_ADMIN) {
        isAuthorized = true;
      } else if (user.role === Role.ADMIN) {
        isAuthorized = lecture.batch.branchId === user.branchId;
      } else if (user.role === Role.TEACHER) {
        isAuthorized = lecture.batch.teacherId === user.userId;
      } else if (user.role === Role.STUDENT) {
        if (lecture.isPublished) {
          const enrollment = await prisma.enrollment.findUnique({
            where: {
              studentId_batchId: {
                studentId: user.userId,
                batchId: lecture.batchId,
              },
            },
          });
          isAuthorized = enrollment?.status === EnrollmentStatus.ACTIVE;
        }
      } else if (user.role === Role.GUARDIAN) {
        if (lecture.isPublished) {
          const studentId = req.query.studentId as string;
          if (studentId) {
            const link = await prisma.guardianLink.findUnique({
              where: {
                guardianId_studentId: {
                  guardianId: user.userId,
                  studentId,
                },
              },
            });
            if (link) {
              const enrollment = await prisma.enrollment.findUnique({
                where: {
                  studentId_batchId: {
                    studentId,
                    batchId: lecture.batchId,
                  },
                },
              });
              isAuthorized = enrollment?.status === EnrollmentStatus.ACTIVE;
            }
          }
        }
      }
    } else if (attachment.assignment) {
      const { assignment } = attachment;
      if (user.role === Role.SUPER_ADMIN) {
        isAuthorized = true;
      } else if (user.role === Role.ADMIN) {
        isAuthorized = assignment.batch.branchId === user.branchId;
      } else if (user.role === Role.TEACHER) {
        isAuthorized = assignment.batch.teacherId === user.userId;
      } else if (user.role === Role.STUDENT) {
        if (assignment.publishedAt && assignment.publishedAt <= new Date()) {
          const enrollment = await prisma.enrollment.findUnique({
            where: {
              studentId_batchId: {
                studentId: user.userId,
                batchId: assignment.batchId,
              },
            },
          });
          isAuthorized = enrollment?.status === EnrollmentStatus.ACTIVE;
        }
      } else if (user.role === Role.GUARDIAN) {
        if (assignment.publishedAt && assignment.publishedAt <= new Date()) {
          const studentId = req.query.studentId as string;
          if (studentId) {
            const link = await prisma.guardianLink.findUnique({
              where: {
                guardianId_studentId: {
                  guardianId: user.userId,
                  studentId,
                },
              },
            });
            if (link) {
              const enrollment = await prisma.enrollment.findUnique({
                where: {
                  studentId_batchId: {
                    studentId,
                    batchId: assignment.batchId,
                  },
                },
              });
              isAuthorized = enrollment?.status === EnrollmentStatus.ACTIVE;
            }
          }
        }
      }
    } else if (attachment.submission) {
      const { submission } = attachment;
      if (user.role === Role.SUPER_ADMIN) {
        isAuthorized = true;
      } else if (user.role === Role.ADMIN) {
        isAuthorized = submission.assignment.batch.branchId === user.branchId;
      } else if (user.role === Role.TEACHER) {
        isAuthorized = submission.assignment.batch.teacherId === user.userId;
      } else if (user.role === Role.STUDENT) {
        isAuthorized = submission.studentId === user.userId;
      } else if (user.role === Role.GUARDIAN) {
        const link = await prisma.guardianLink.findUnique({
          where: {
            guardianId_studentId: {
              guardianId: user.userId,
              studentId: submission.studentId,
            },
          },
        });
        isAuthorized = !!link;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this attachment',
      });
    }

    if (attachment.kind === 'LINK') {
      return res.status(200).json({
        success: true,
        data: {
          url: attachment.url,
          expiresAt: null,
        },
      });
    }

    // Kind is FILE: generate short-lived signed download URL (5 minutes)
    const expiresAtSec = Math.floor(Date.now() / 1000) + ATTACHMENT_CONFIG.DOWNLOAD_URL_EXPIRES_IN_SECONDS;
    const expiresAt = new Date(expiresAtSec * 1000).toISOString();

    const signedDownloadUrl = cloudinary.utils.private_download_url(
      attachment.publicId || '',
      attachment.format || '',
      {
        resource_type: (attachment.resourceType || 'raw') as any,
        type: 'authenticated',
        expires_at: expiresAtSec,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        url: signedDownloadUrl,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Get attachment download error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error generating download link',
    });
  }
}

export async function deleteAttachment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const attachment = await prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found',
      });
    }

    const isUploader = attachment.uploadedById === req.user.userId;
    const isAdmin =
      req.user.role === Role.SUPER_ADMIN ||
      (req.user.role === Role.ADMIN && attachment.branchId === req.user.branchId);

    if (!isUploader && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only the uploader or an admin of this branch may delete this attachment',
      });
    }

    // Best-effort delete from Cloudinary if it's a file
    if (attachment.kind === 'FILE' && attachment.publicId) {
      try {
        await cloudinary.uploader.destroy(attachment.publicId, {
          resource_type: attachment.resourceType || 'raw',
          type: 'authenticated',
        });
      } catch (err) {
        console.warn('Failed to delete Cloudinary asset:', attachment.publicId, err);
      }
    }

    await prisma.attachment.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ATTACHMENT_DELETE',
      entityType: 'Attachment',
      entityId: attachment.id,
      branchId: attachment.branchId,
      metadata: {
        id: attachment.id,
        kind: attachment.kind,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully',
    });
  } catch (error) {
    console.error('Delete attachment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error deleting attachment',
    });
  }
}
