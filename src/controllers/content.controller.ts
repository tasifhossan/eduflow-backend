import { Request, Response } from 'express';
import { Prisma, Role, ContactMessageStatus, EnquiryStage } from '@prisma/client';
import prisma from '../utils/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import {
  blogQuerySchema,
  blogSlugParamSchema,
  faqQuerySchema,
  batchIdParamSchema,
  reviewIdParamSchema,
  reviewPaginationQuerySchema,
  createReviewSchema,
  updateReviewSchema,
  createContactMessageSchema,
  contactQuerySchema,
  contactIdParamSchema,
  updateContactStatusSchema,
  newsletterSubscribeSchema,
} from '../validators/content.validator';
import { normalizePhone } from '../utils/phone';

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
 * GET /blog
 * Paginated list of published blog posts (newest first).
 */
export async function getBlogPosts(req: Request, res: Response) {
  try {
    const parseResult = blogQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blog query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, category, q } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 9, maxLimit: 50 });

    const where: Prisma.BlogPostWhereInput = {
      isPublished: true,
    };

    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, posts] = await Promise.all([
      prisma.blogPost.count({ where }),
      prisma.blogPost.findMany({
        where,
        skip,
        take,
        orderBy: [
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          coverImage: true,
          category: true,
          authorName: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: posts,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve blog posts',
    });
  }
}

/**
 * GET /blog/:slug
 * Retrieves a single published blog post by slug.
 */
export async function getBlogPostBySlug(req: Request, res: Response) {
  try {
    const parseResult = blogSlugParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blog slug parameter',
        data: parseResult.error.flatten(),
      });
    }

    const { slug } = parseResult.data;
    const post = await prisma.blogPost.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        content: true,
        coverImage: true,
        category: true,
        authorName: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!post || !post.isPublished) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found',
      });
    }

    const relatedSelect = {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImage: true,
      category: true,
      authorName: true,
      publishedAt: true,
      createdAt: true,
    };

    let relatedPosts = await prisma.blogPost.findMany({
      where: {
        isPublished: true,
        id: { not: post.id },
        category: { equals: post.category, mode: 'insensitive' },
      },
      take: 3,
      orderBy: [
        { publishedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      select: relatedSelect,
    });

    if (relatedPosts.length < 3) {
      const excludedIds = [post.id, ...relatedPosts.map((p) => p.id)];
      const fallbackPosts = await prisma.blogPost.findMany({
        where: {
          isPublished: true,
          id: { notIn: excludedIds },
        },
        take: 3 - relatedPosts.length,
        orderBy: [
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: relatedSelect,
      });
      relatedPosts = [...relatedPosts, ...fallbackPosts];
    }

    return res.status(200).json({
      success: true,
      data: {
        ...post,
        relatedPosts,
      },
    });
  } catch (error) {
    console.error('Error fetching blog post by slug:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve blog post',
    });
  }
}

/**
 * GET /testimonials
 * Public testimonials list with featured ones first.
 */
export async function getTestimonials(req: Request, res: Response) {
  try {
    const testimonials = await prisma.testimonial.findMany({
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        name: true,
        roleTitle: true,
        content: true,
        avatarUrl: true,
        rating: true,
        isFeatured: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: testimonials,
    });
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve testimonials',
    });
  }
}

/**
 * GET /faq
 * Frequently asked questions, optionally filtered by category and ordered by sortOrder.
 */
export async function getFaqItems(req: Request, res: Response) {
  try {
    const parseResult = faqQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid FAQ query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { category } = parseResult.data;
    const where: Prisma.FaqItemWhereInput = {};
    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    const items = await prisma.faqItem.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        sortOrder: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Error fetching FAQ items:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQ items',
    });
  }
}

/**
 * GET /batches/:batchId/reviews
 * Public paginated reviews for a batch, displaying reviewer masked names.
 */
export async function getBatchReviews(req: Request, res: Response) {
  try {
    const paramResult = batchIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid batch ID',
        data: paramResult.error.flatten(),
      });
    }

    const queryResult = reviewPaginationQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review pagination parameters',
        data: queryResult.error.flatten(),
      });
    }

    const { batchId } = paramResult.data;
    const { page, limit } = queryResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 10, maxLimit: 50 });

    const [total, reviews] = await Promise.all([
      prisma.review.count({ where: { batchId } }),
      prisma.review.findMany({
        where: { batchId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          batchId: true,
          rating: true,
          comment: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    const items = reviews.map((r) => ({
      id: r.id,
      batchId: r.batchId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      student: {
        id: r.student.id,
        name: maskReviewerName(r.student.name),
        avatarUrl: r.student.avatarUrl,
      },
    }));

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching batch reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve reviews',
    });
  }
}

/**
 * POST /batches/:batchId/reviews
 * STUDENT only: submits a review if the student has an active/existing enrollment in the batch.
 * Enforces one review per student per batch (409 if duplicate).
 */
export async function createBatchReview(req: Request, res: Response) {
  try {
    const paramResult = batchIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid batch ID',
        data: paramResult.error.flatten(),
      });
    }

    const bodyResult = createReviewSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { batchId } = paramResult.data;
    const { rating, comment } = bodyResult.data;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Check batch existence
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    // Verify student enrollment in the batch
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        batchId,
        studentId: userId,
      },
      select: { id: true },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: 'You must have an enrollment in this batch to submit a review',
      });
    }

    // Check for duplicate review
    const existingReview = await prisma.review.findUnique({
      where: {
        batchId_studentId: {
          batchId,
          studentId: userId,
        },
      },
      select: { id: true },
    });

    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a review for this batch',
      });
    }

    const review = await prisma.review.create({
      data: {
        batchId,
        studentId: userId,
        rating,
        comment: comment ?? null,
      },
      select: {
        id: true,
        batchId: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: review,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a review for this batch',
      });
    }
    console.error('Error creating batch review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit review',
    });
  }
}

/**
 * PATCH /reviews/:id
 * Allows the review's author to update rating and/or comment.
 */
export async function updateReview(req: Request, res: Response) {
  try {
    const paramResult = reviewIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID',
        data: paramResult.error.flatten(),
      });
    }

    const bodyResult = updateReviewSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const { rating, comment } = bodyResult.data;
    const userId = req.user?.userId;

    const review = await prisma.review.findUnique({
      where: { id },
      select: { id: true, studentId: true },
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (review.studentId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own review',
      });
    }

    const updated = await prisma.review.update({
      where: { id },
      data: {
        ...(rating !== undefined ? { rating } : {}),
        ...(comment !== undefined ? { comment: comment ?? null } : {}),
      },
      select: {
        id: true,
        batchId: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Review updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update review',
    });
  }
}

/**
 * DELETE /reviews/:id
 * Allows the review's author to delete their review.
 */
export async function deleteReview(req: Request, res: Response) {
  try {
    const paramResult = reviewIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID',
        data: paramResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const userId = req.user?.userId;

    const review = await prisma.review.findUnique({
      where: { id },
      select: { id: true, studentId: true },
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (review.studentId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own review',
      });
    }

    await prisma.review.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete review',
    });
  }
}

/**
 * POST /contact
 * Submits a contact inquiry. Honeypot field "website" silently succeeds without persisting.
 */
export async function submitContactMessage(req: Request, res: Response) {
  try {
    const parseResult = createContactMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      name,
      email,
      phone,
      subject,
      message,
      interestedBatchId,
      interestedGrade,
      preferredBranchId,
      guardianName,
      source,
      website,
    } = parseResult.data;

    // Honeypot check: If filled, silently succeed without saving
    if (website && website.trim().length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Message sent successfully',
      });
    }

    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const batchIdToSet = interestedBatchId && interestedBatchId.trim().length > 0 ? interestedBatchId.trim() : null;

    let validatedBatchId: string | null = null;
    let batchBranchId: string | null = null;
    if (batchIdToSet) {
      const publishedBatch = await prisma.batch.findFirst({
        where: {
          id: batchIdToSet,
          isPublished: true,
        },
        select: { id: true, branchId: true },
      });
      if (publishedBatch) {
        validatedBatchId = publishedBatch.id;
        batchBranchId = publishedBatch.branchId;
      }
    }

    let validatedPreferredBranchId: string | null = null;
    if (preferredBranchId && preferredBranchId.trim().length > 0) {
      const branchExists = await prisma.branch.findUnique({
        where: { id: preferredBranchId.trim() },
        select: { id: true },
      });
      if (branchExists) {
        validatedPreferredBranchId = branchExists.id;
      }
    }

    // Branch rule: branchId = the interested batch's branch, else preferredBranchId, else null;
    // When the center has exactly one branch, set it automatically.
    let branchIdToSet: string | null = null;
    if (batchBranchId) {
      branchIdToSet = batchBranchId;
    } else if (validatedPreferredBranchId) {
      branchIdToSet = validatedPreferredBranchId;
    } else {
      const branchCount = await prisma.branch.count();
      if (branchCount === 1) {
        const singleBranch = await prisma.branch.findFirst({ select: { id: true } });
        if (singleBranch) {
          branchIdToSet = singleBranch.id;
        }
      }
    }

    await prisma.contactMessage.create({
      data: {
        name: name.trim(),
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone: normalizedPhone,
        subject: subject && subject.trim().length > 0 ? subject.trim() : 'Enquiry',
        message: message && message.trim().length > 0 ? message.trim() : null,
        interestedBatchId: validatedBatchId,
        interestedGrade: interestedGrade && interestedGrade.trim().length > 0 ? interestedGrade.trim() : null,
        preferredBranchId: validatedPreferredBranchId,
        branchId: branchIdToSet,
        guardianName: guardianName && guardianName.trim().length > 0 ? guardianName.trim() : null,
        source: source || 'WEBSITE',
        status: ContactMessageStatus.NEW,
        stage: EnquiryStage.NEW,
      },
      select: {
        id: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully',
    });
  } catch (error) {
    console.error('Error submitting contact message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
    });
  }
}

/**
 * GET /contact
 * SUPER_ADMIN & ADMIN list of contact messages/enquiries, filterable by status.
 * ADMIN is scoped to their branch's batches; unassigned enquiries are visible to SUPER_ADMIN only.
 */
export async function getContactMessages(req: Request, res: Response) {
  try {
    const parseResult = contactQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, status } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 15, maxLimit: 50 });

    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    const where: Prisma.ContactMessageWhereInput = {};
    if (status) {
      where.status = status;
    }

    if (userRole === Role.ADMIN) {
      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Admin is not associated with any branch',
        });
      }
      where.OR = [
        { branchId: userBranchId },
        { interestedBatch: { branchId: userBranchId } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          subject: true,
          message: true,
          interestedBatchId: true,
          interestedBatch: {
            select: {
              id: true,
              name: true,
              branchId: true,
              branch: { select: { id: true, name: true } },
            },
          },
          interestedGrade: true,
          source: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching contact messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve contact messages',
    });
  }
}

/**
 * PATCH /contact/:id/status
 * SUPER_ADMIN only: updates the processing status of a contact message.
 */
export async function updateContactMessageStatus(req: Request, res: Response) {
  try {
    const paramResult = contactIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact message ID',
        data: paramResult.error.flatten(),
      });
    }

    const bodyResult = updateContactStatusSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const { status } = bodyResult.data;

    const existing = await prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found',
      });
    }

    const updated = await prisma.contactMessage.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Contact message status updated',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating contact message status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update contact message status',
    });
  }
}

/**
 * POST /newsletter
 * Subscribes an email to the newsletter. Idempotent: returns 200 without disclosing whether
 * the email was already subscribed. Does not send emails.
 */
export async function subscribeNewsletter(req: Request, res: Response) {
  try {
    const parseResult = newsletterSubscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { email } = parseResult.data;

    await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    return res.status(200).json({
      success: true,
      message: 'Successfully subscribed to the newsletter',
    });
  } catch (error) {
    console.error('Error subscribing to newsletter:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to subscribe to newsletter',
    });
  }
}
