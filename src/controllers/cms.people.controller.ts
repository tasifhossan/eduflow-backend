import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { ZodError } from 'zod';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import { buildMeta } from '../utils/pagination';
import { invalidateContentCaches } from '../utils/contentCaches';
import { checkCloudinaryImageUrl, changedFields } from '../utils/contentSanitize';
import {
  idParamSchema,
  teacherListQuerySchema,
  teacherPatchSchema,
  reviewListQuerySchema,
  reviewVisibilitySchema,
} from '../validators/cms.validator';

function invalid(res: Response, error: ZodError, message = 'Validation failed') {
  return res.status(400).json({ success: false, message, data: error.flatten() });
}
function notFound(res: Response, what: string) {
  return res.status(404).json({ success: false, message: `${what} not found` });
}
function fieldError(res: Response, field: string, reason: string) {
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    data: { formErrors: [], fieldErrors: { [field]: [reason] } },
  });
}
function serverError(res: Response, label: string, error: unknown) {
  console.error(`CMS ${label} error:`, error);
  return res.status(500).json({ success: false, message: `Failed to ${label}` });
}
async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  branchId: string | null,
  metadata: Record<string, unknown> = {}
) {
  await createAuditLog({
    actorId: req.user!.userId,
    action,
    entityType,
    entityId,
    branchId: branchId ?? req.user!.branchId,
    metadata: metadata as Record<string, any>,
    ip: req.ip,
  });
}

// ═══════════════════════════════ TEACHERS ═════════════════════════════════
const TEACHER_SELECT = {
  id: true,
  name: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  isActive: true,
  headline: true,
  bio: true,
  avatarUrl: true,
  qualifications: true,
  experienceYears: true,
  isPublicProfile: true,
  publicOrder: true,
  teachingBatches: {
    where: { archivedAt: null },
    select: { subject: { select: { name: true } } },
  },
} satisfies Prisma.UserSelect;

type TeacherRow = Prisma.UserGetPayload<{ select: typeof TEACHER_SELECT }>;

function shapeTeacher(t: TeacherRow) {
  const subjects = Array.from(new Set(t.teachingBatches.map((b) => b.subject.name))).sort();
  const hasHeadline = Boolean(t.headline && t.headline.trim());
  const hasBio = Boolean(t.bio && t.bio.trim());
  const hasAvatar = Boolean(t.avatarUrl);
  const hasQualifications = Boolean(t.qualifications && t.qualifications.trim());
  const hasExperience = t.experienceYears !== null;
  return {
    id: t.id,
    name: t.name,
    branchId: t.branchId,
    branch: t.branch,
    isActive: t.isActive,
    headline: t.headline,
    bio: t.bio,
    avatarUrl: t.avatarUrl,
    qualifications: t.qualifications,
    experienceYears: t.experienceYears,
    isPublicProfile: t.isPublicProfile,
    publicOrder: t.publicOrder,
    subjects,
    completeness: {
      hasHeadline,
      hasBio,
      hasAvatar,
      hasQualifications,
      hasExperience,
      canPublish: hasHeadline && hasBio,
      isComplete: hasHeadline && hasBio && hasAvatar && hasQualifications && hasExperience,
    },
  };
}

/** Branch scope applied server-side: ADMIN is pinned to own branch, SUPER_ADMIN sees all. */
function teacherScope(req: Request): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { role: Role.TEACHER };
  if (req.user!.role !== Role.SUPER_ADMIN) where.branchId = req.user!.branchId;
  return where;
}

export async function listTeachers(req: Request, res: Response) {
  try {
    const parsed = teacherListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error, 'Invalid query parameters');
    const { page, limit, q, isPublicProfile, branchId } = parsed.data;
    const where = teacherScope(req);
    // branchId filter is honoured only for SUPER_ADMIN; ADMIN is always pinned to own branch.
    if (req.user!.role === Role.SUPER_ADMIN && branchId) where.branchId = branchId;
    if (isPublicProfile) where.isPublicProfile = isPublicProfile === 'true';
    if (q) where.name = { contains: q, mode: 'insensitive' };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ publicOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: TEACHER_SELECT,
      }),
    ]);
    return res.status(200).json({
      success: true,
      data: { items: rows.map(shapeTeacher), pagination: buildMeta(total, page, limit) },
    });
  } catch (error) {
    return serverError(res, 'retrieve teachers', error);
  }
}

export async function updateTeacher(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = teacherPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;

    // Out-of-scope or non-teacher targets are indistinguishable from missing ones (404).
    const teacher = await prisma.user.findFirst({
      where: { ...teacherScope(req), id: p.data.id },
      select: TEACHER_SELECT,
    });
    if (!teacher) return notFound(res, 'Teacher');

    if (input.avatarUrl && input.avatarUrl !== teacher.avatarUrl) {
      const reason = checkCloudinaryImageUrl(input.avatarUrl);
      if (reason) return fieldError(res, 'avatarUrl', reason);
    }

    const finalPublic = input.isPublicProfile ?? teacher.isPublicProfile;
    const headline = input.headline !== undefined ? input.headline : teacher.headline;
    const bio = input.bio !== undefined ? input.bio : teacher.bio;
    if (finalPublic && !(headline && headline.trim() && bio && bio.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A public teacher profile requires a headline and a bio',
      });
    }

    const fields = changedFields(teacher, input);
    const updated = await prisma.user.update({
      where: { id: teacher.id },
      data: input,
      select: TEACHER_SELECT,
    });
    await audit(req, 'CMS_TEACHER_PROFILE_UPDATED', 'User', teacher.id, teacher.branchId, { fields });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Teacher profile updated', data: shapeTeacher(updated) });
  } catch (error) {
    return serverError(res, 'update teacher profile', error);
  }
}

// ═══════════════════════════════ REVIEWS ══════════════════════════════════
const REVIEW_SELECT = {
  id: true,
  batchId: true,
  batch: { select: { id: true, name: true, branchId: true } },
  student: { select: { id: true, name: true } },
  rating: true,
  comment: true,
  createdAt: true,
  isHidden: true,
  hiddenReason: true,
  hiddenAt: true,
  hiddenById: true,
} satisfies Prisma.ReviewSelect;

function reviewScope(req: Request): Prisma.ReviewWhereInput {
  if (req.user!.role === Role.SUPER_ADMIN) return {};
  return { batch: { branchId: req.user!.branchId } };
}

export async function listReviews(req: Request, res: Response) {
  try {
    const parsed = reviewListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error, 'Invalid query parameters');
    const { page, limit, hidden, batchId, rating } = parsed.data;
    const where: Prisma.ReviewWhereInput = { ...reviewScope(req) };
    if (hidden) where.isHidden = hidden === 'true';
    if (batchId) where.batchId = batchId;
    if (rating) where.rating = rating;
    const [total, items] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: REVIEW_SELECT,
      }),
    ]);
    return res.status(200).json({ success: true, data: { items, pagination: buildMeta(total, page, limit) } });
  } catch (error) {
    return serverError(res, 'retrieve reviews', error);
  }
}

export async function setReviewVisibility(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = reviewVisibilitySchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const { isHidden, reason } = parsed.data;

    const review = await prisma.review.findFirst({
      where: { ...reviewScope(req), id: p.data.id },
      select: { id: true, isHidden: true, batch: { select: { branchId: true } } },
    });
    if (!review) return notFound(res, 'Review');

    const updated = await prisma.review.update({
      where: { id: review.id },
      data: isHidden
        ? { isHidden: true, hiddenById: req.user!.userId, hiddenReason: reason ?? null, hiddenAt: new Date() }
        : { isHidden: false, hiddenById: null, hiddenReason: null, hiddenAt: null },
      select: REVIEW_SELECT,
    });
    await audit(req, 'CMS_REVIEW_VISIBILITY_CHANGED', 'Review', review.id, review.batch.branchId, {
      isHidden,
      fields: reason !== undefined ? ['isHidden', 'hiddenReason'] : ['isHidden'],
    });
    invalidateContentCaches();
    return res.status(200).json({
      success: true,
      message: isHidden ? 'Review hidden from the public site' : 'Review is visible again',
      data: updated,
    });
  } catch (error) {
    return serverError(res, 'update review visibility', error);
  }
}

// ═══════════════════════════════ SUMMARY ══════════════════════════════════
export async function getCmsSummary(req: Request, res: Response) {
  try {
    const now = new Date();
    const [
      blogDraft,
      blogScheduled,
      blogPublished,
      faqDraft,
      faqPublished,
      testimonialDraft,
      testimonialPublished,
      hiddenReviews,
      publicTeachers,
      totalTeachers,
    ] = await Promise.all([
      prisma.blogPost.count({ where: { OR: [{ isPublished: false }, { isPublished: true, publishedAt: null }] } }),
      prisma.blogPost.count({ where: { isPublished: true, publishedAt: { gt: now } } }),
      prisma.blogPost.count({ where: { isPublished: true, publishedAt: { lte: now } } }),
      prisma.faqItem.count({ where: { isPublished: false } }),
      prisma.faqItem.count({ where: { isPublished: true } }),
      prisma.testimonial.count({ where: { isPublished: false } }),
      prisma.testimonial.count({ where: { isPublished: true } }),
      prisma.review.count({ where: { ...reviewScope(req), isHidden: true } }),
      prisma.user.count({ where: { ...teacherScope(req), isPublicProfile: true } }),
      prisma.user.count({ where: teacherScope(req) }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        blog: { draft: blogDraft, scheduled: blogScheduled, published: blogPublished },
        faq: { draft: faqDraft, scheduled: 0, published: faqPublished },
        testimonials: { draft: testimonialDraft, scheduled: 0, published: testimonialPublished },
        hiddenReviews,
        teachers: { public: publicTeachers, total: totalTeachers },
      },
    });
  } catch (error) {
    return serverError(res, 'retrieve CMS summary', error);
  }
}
