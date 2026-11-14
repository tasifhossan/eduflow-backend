import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Single source of truth for "what is publicly visible".
 * A blog post is visible only when isPublished AND publishedAt <= now
 * (future publishedAt = scheduled, no job runner needed).
 */
export function blogVisibleWhere(now: Date = new Date()): Prisma.BlogPostWhereInput {
  return { isPublished: true, publishedAt: { lte: now } };
}

export const faqVisibleWhere: Prisma.FaqItemWhereInput = { isPublished: true };

export const testimonialVisibleWhere: Prisma.TestimonialWhereInput = {
  isPublished: true,
  hasConsent: true,
};

/** Reviews hidden by staff are excluded from every public list and aggregate. */
export const reviewVisibleWhere: Prisma.ReviewWhereInput = { isHidden: false };

export type BlogStatus = 'draft' | 'scheduled' | 'published';

export function blogStatus(
  post: { isPublished: boolean; publishedAt: Date | null },
  now: Date = new Date()
): BlogStatus {
  if (!post.isPublished || !post.publishedAt) return 'draft';
  return post.publishedAt.getTime() > now.getTime() ? 'scheduled' : 'published';
}

/**
 * Milliseconds until the next scheduled post becomes visible (null when none).
 * Used to cap in-memory public caches so scheduling stays accurate without a job runner.
 */
export async function msUntilNextScheduledPost(now: Date = new Date()): Promise<number | null> {
  const next = await prisma.blogPost.findFirst({
    where: { isPublished: true, publishedAt: { gt: now } },
    orderBy: { publishedAt: 'asc' },
    select: { publishedAt: true },
  });
  if (!next?.publishedAt) return null;
  return Math.max(0, next.publishedAt.getTime() - now.getTime());
}
