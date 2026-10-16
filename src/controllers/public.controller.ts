import { Request, Response } from 'express';
import { Prisma, Role, BatchType } from '@prisma/client';
import prisma from '../utils/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import {
  publicBatchesQuerySchema,
  publicPaginationQuerySchema,
  batchSlugParamSchema,
} from '../validators/public.validator';

// In-memory cache for GET /stats (5 minutes)
interface CachedStats {
  data: {
    publishedBatches: number;
    branches: number;
    publicTeachers: number;
    activeStudents: number;
    averageRating: number;
  };
  expiresAt: number;
}

let cachedStats: CachedStats | null = null;
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Formats a list of routine slots into a concise schedule summary.
 */
function formatScheduleSummary(slots: { dayOfWeek: string; startTime: string; endTime: string }[]): string {
  if (!slots || slots.length === 0) return 'TBA';
  const dayAbbr: Record<string, string> = {
    SUNDAY: 'Sun',
    MONDAY: 'Mon',
    TUESDAY: 'Tue',
    WEDNESDAY: 'Wed',
    THURSDAY: 'Thu',
    FRIDAY: 'Fri',
    SATURDAY: 'Sat',
  };
  return slots
    .map((s) => `${dayAbbr[s.dayOfWeek] || s.dayOfWeek} ${s.startTime} - ${s.endTime}`)
    .join(', ');
}

/**
 * Masks full name to show first name and last initial only (e.g., "Arif Hossain" -> "Arif H.").
 */
function maskReviewerName(fullName: string): string {
  if (!fullName) return 'Anonymous';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstName} ${lastInitial}.`;
}

/**
 * GET /batches
 * Public listing of published batches with search, multi-field filters, and computed ratings.
 */
export async function getPublicBatches(req: Request, res: Response) {
  try {
    const parseResult = publicBatchesQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { q, subjectId, branchId, type, minFee, maxFee, minRating, sort, page, limit } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 24 });

    // Build Prisma where query
    const where: Prisma.BatchWhereInput = {
      isPublished: true,
      slug: { not: null },
    };

    if (subjectId) {
      where.subjectId = subjectId;
    }
    if (branchId) {
      where.branchId = branchId;
    }
    if (type) {
      where.type = type;
    }
    if (minFee !== undefined || maxFee !== undefined) {
      where.feeAmount = {};
      if (minFee !== undefined) where.feeAmount.gte = minFee;
      if (maxFee !== undefined) where.feeAmount.lte = maxFee;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { subject: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Retrieve matching published batches
    const candidateBatches = await prisma.batch.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        imageUrl: true,
        description: true,
        feeAmount: true,
        type: true,
        createdAt: true,
        subject: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        routineSlots: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (candidateBatches.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          pagination: buildMeta(0, page, take),
        },
      });
    }

    const batchIds = candidateBatches.map((b) => b.id);

    // Compute avgRating & reviewCount via a single groupBy on Review (avoid N+1)
    const reviewStats = await prisma.review.groupBy({
      by: ['batchId'],
      _avg: { rating: true },
      _count: { rating: true },
      where: { batchId: { in: batchIds } },
    });

    const ratingMap = new Map<string, { avgRating: number; reviewCount: number }>();
    for (const r of reviewStats) {
      ratingMap.set(r.batchId, {
        avgRating: r._avg.rating ? Number(r._avg.rating.toFixed(1)) : 0,
        reviewCount: r._count.rating || 0,
      });
    }

    // Attach computed metrics
    let items = candidateBatches.map((b) => {
      const stats = ratingMap.get(b.id) || { avgRating: 0, reviewCount: 0 };
      const desc = b.description
        ? b.description.length > 140
          ? `${b.description.slice(0, 137)}...`
          : b.description
        : null;

      return {
        id: b.id,
        slug: b.slug!,
        name: b.name,
        imageUrl: b.imageUrl,
        description: desc,
        subject: { id: b.subject.id, name: b.subject.name },
        branch: { id: b.branch.id, name: b.branch.name },
        fee: b.feeAmount,
        type: b.type,
        avgRating: stats.avgRating,
        reviewCount: stats.reviewCount,
        enrolledCount: b._count.enrollments,
        nextSchedule: formatScheduleSummary(b.routineSlots),
        createdAt: b.createdAt,
      };
    });

    // Filter by minRating if requested
    if (minRating !== undefined) {
      items = items.filter((item) => item.avgRating >= minRating);
    }

    // Sort items
    switch (sort) {
      case 'fee_asc':
        items.sort((a, b) => a.fee - b.fee);
        break;
      case 'fee_desc':
        items.sort((a, b) => b.fee - a.fee);
        break;
      case 'rating':
        items.sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount);
        break;
      case 'popular':
        items.sort((a, b) => b.enrolledCount - a.enrolledCount || b.reviewCount - a.reviewCount);
        break;
      case 'newest':
      default:
        items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
    }

    const total = items.length;
    const paginatedItems = items.slice(skip, skip + take).map(({ createdAt, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      data: {
        items: paginatedItems,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching public batches:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve batches',
    });
  }
}

/**
 * GET /batches/:slug
 * Full details of a published batch, public teacher profile, 10 masked reviews, rating breakdown, and related batches.
 */
export async function getPublicBatchBySlug(req: Request, res: Response) {
  try {
    const parseResult = batchSlugParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid slug parameter',
        data: parseResult.error.flatten(),
      });
    }

    const { slug } = parseResult.data;

    const batch = await prisma.batch.findUnique({
      where: { slug },
      include: {
        subject: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, address: true } },
        teacher: {
          select: {
            id: true,
            name: true,
            headline: true,
            bio: true,
            avatarUrl: true,
            isPublicProfile: true,
          },
        },
        routineSlots: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!batch || !batch.isPublished) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    // Load latest 10 reviews and rating breakdown
    const [latestReviews, reviewGroups, relatedBatches] = await Promise.all([
      prisma.review.findMany({
        where: { batchId: batch.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          student: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.review.groupBy({
        by: ['rating'],
        _count: { rating: true },
        where: { batchId: batch.id },
      }),
      prisma.batch.findMany({
        where: {
          subjectId: batch.subjectId,
          id: { not: batch.id },
          isPublished: true,
          slug: { not: null },
        },
        take: 4,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          imageUrl: true,
          feeAmount: true,
          type: true,
          branch: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
        },
      }),
    ]);

    const ratingBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalScore = 0;
    let reviewCount = 0;

    for (const group of reviewGroups) {
      const r = group.rating;
      const count = group._count.rating;
      if (r >= 1 && r <= 5) {
        ratingBreakdown[r] = count;
      }
      totalScore += r * count;
      reviewCount += count;
    }

    const avgRating = reviewCount > 0 ? Number((totalScore / reviewCount).toFixed(1)) : 0;

    const teacherInfo =
      batch.teacher && batch.teacher.isPublicProfile
        ? {
            id: batch.teacher.id,
            name: batch.teacher.name,
            headline: batch.teacher.headline,
            bio: batch.teacher.bio,
            avatarUrl: batch.teacher.avatarUrl,
          }
        : null;

    const reviewsFormatted = latestReviews.map((rev) => ({
      id: rev.id,
      rating: rev.rating,
      comment: rev.comment,
      createdAt: rev.createdAt,
      reviewerName: maskReviewerName(rev.student.name),
    }));

    const responseData = {
      id: batch.id,
      slug: batch.slug,
      name: batch.name,
      description: batch.description,
      imageUrl: batch.imageUrl,
      gallery: batch.gallery,
      highlights: batch.highlights,
      syllabus: batch.syllabus,
      fee: batch.feeAmount,
      feeType: batch.feeType,
      type: batch.type,
      classLevel: batch.classLevel,
      branch: batch.branch,
      subject: batch.subject,
      schedule: formatScheduleSummary(batch.routineSlots),
      enrolledCount: batch._count.enrollments,
      avgRating,
      reviewCount,
      ratingBreakdown,
      teacher: teacherInfo,
      reviews: reviewsFormatted,
      relatedBatches: relatedBatches.map((rb) => ({
        id: rb.id,
        slug: rb.slug!,
        name: rb.name,
        imageUrl: rb.imageUrl,
        fee: rb.feeAmount,
        type: rb.type,
        branch: rb.branch,
        subject: rb.subject,
      })),
    };

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Error fetching batch by slug:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve batch details',
    });
  }
}

/**
 * GET /filters
 * Aggregate distinct filters for published batches (subjects, branches, types, min/max fees).
 */
export async function getPublicFilters(req: Request, res: Response) {
  try {
    const [subjects, branches, feeAggregate] = await Promise.all([
      prisma.subject.findMany({
        where: {
          batches: {
            some: { isPublished: true, slug: { not: null } },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.branch.findMany({
        where: {
          batches: {
            some: { isPublished: true, slug: { not: null } },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.batch.aggregate({
        where: { isPublished: true, slug: { not: null } },
        _min: { feeAmount: true },
        _max: { feeAmount: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        subjects,
        branches,
        batchTypes: Object.values(BatchType),
        feeRange: {
          minFee: feeAggregate._min.feeAmount ?? 0,
          maxFee: feeAggregate._max.feeAmount ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching public filters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve filters',
    });
  }
}

/**
 * GET /stats
 * Public aggregate counters cached in memory for 5 minutes.
 */
export async function getPublicStats(req: Request, res: Response) {
  try {
    const now = Date.now();
    if (cachedStats && now < cachedStats.expiresAt) {
      return res.status(200).json({
        success: true,
        data: cachedStats.data,
      });
    }

    const [publishedBatches, branches, publicTeachers, activeStudents, ratingAgg] = await Promise.all([
      prisma.batch.count({ where: { isPublished: true, slug: { not: null } } }),
      prisma.branch.count(),
      prisma.user.count({ where: { role: Role.TEACHER, isPublicProfile: true } }),
      prisma.user.count({ where: { role: Role.STUDENT, enrollments: { some: { status: 'ACTIVE' } } } }),
      prisma.review.aggregate({ _avg: { rating: true } }),
    ]);

    const statsData = {
      publishedBatches,
      branches,
      publicTeachers,
      activeStudents,
      averageRating: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : 0,
    };

    cachedStats = {
      data: statsData,
      expiresAt: now + STATS_CACHE_TTL_MS,
    };

    return res.status(200).json({
      success: true,
      data: statsData,
    });
  } catch (error) {
    console.error('Error fetching public stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve stats',
    });
  }
}

/**
 * GET /branches
 * Paginated list of branches with active batch counts.
 */
export async function getPublicBranches(req: Request, res: Response) {
  try {
    const parseResult = publicPaginationQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 50 });

    const [total, branches] = await Promise.all([
      prisma.branch.count(),
      prisma.branch.findMany({
        skip,
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          address: true,
          _count: {
            select: {
              batches: { where: { isPublished: true, slug: { not: null } } },
            },
          },
        },
      }),
    ]);

    const items = branches.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      publishedBatchCount: b._count.batches,
    }));

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching public branches:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve branches',
    });
  }
}

/**
 * GET /teachers
 * Paginated list of public teacher profiles with subjects taught.
 */
export async function getPublicTeachers(req: Request, res: Response) {
  try {
    const parseResult = publicPaginationQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 50 });

    const where: Prisma.UserWhereInput = {
      role: Role.TEACHER,
      isPublicProfile: true,
    };

    const [total, teachers] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          headline: true,
          bio: true,
          avatarUrl: true,
          teachingBatches: {
            where: { isPublished: true },
            select: {
              subject: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const items = teachers.map((t) => {
      const subjectNames = Array.from(new Set(t.teachingBatches.map((tb) => tb.subject.name)));
      return {
        id: t.id,
        name: t.name,
        headline: t.headline,
        bio: t.bio,
        avatarUrl: t.avatarUrl,
        subjects: subjectNames,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching public teachers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve teachers',
    });
  }
}
