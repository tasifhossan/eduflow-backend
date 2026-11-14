import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { ZodError } from 'zod';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import { buildMeta } from '../utils/pagination';
import { invalidateContentCaches } from '../utils/contentCaches';
import { blogStatus } from '../utils/contentVisibility';
import { checkCloudinaryImageUrl, changedFields, slugify } from '../utils/contentSanitize';
import {
  idParamSchema,
  blogListQuerySchema,
  blogCreateSchema,
  blogUpdateSchema,
  blogPublishSchema,
  faqListQuerySchema,
  faqCreateSchema,
  faqUpdateSchema,
  orderSchema,
  emptyBodySchema,
  testimonialListQuerySchema,
  testimonialCreateSchema,
  testimonialUpdateSchema,
  featuredSchema,
} from '../validators/cms.validator';

// ── helpers ────────────────────────────────────────────────────────────────
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
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
/** Audit entry: ids + changed field NAMES only, never the text. */
async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
) {
  await createAuditLog({
    actorId: req.user!.userId,
    action,
    entityType,
    entityId,
    branchId: req.user!.branchId,
    metadata: metadata as Record<string, any>,
    ip: req.ip,
  });
}
function containsInsensitive(q: string) {
  return { contains: q, mode: 'insensitive' as const };
}

// ═══════════════════════════════ BLOG ═════════════════════════════════════
const BLOG_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  category: true,
  coverImage: true,
  authorName: true,
  isPublished: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.BlogPostSelect;

const BLOG_DETAIL_SELECT = { ...BLOG_SELECT, content: true } satisfies Prisma.BlogPostSelect;

function withStatus<T extends { isPublished: boolean; publishedAt: Date | null }>(post: T) {
  return { ...post, status: blogStatus(post) };
}

async function uniqueSlug(base: string): Promise<string> {
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const exists = await prisma.blogPost.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function missingForPublish(post: { title: string; excerpt: string | null; content: string; category: string }) {
  const missing: string[] = [];
  if (!post.title.trim()) missing.push('title');
  if (!post.excerpt || !post.excerpt.trim()) missing.push('excerpt');
  if (!post.content.trim()) missing.push('content');
  if (!post.category.trim()) missing.push('category');
  return missing;
}

export async function listBlogPosts(req: Request, res: Response) {
  try {
    const parsed = blogListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error, 'Invalid query parameters');
    const { page, limit, status, q, category } = parsed.data;
    const now = new Date();
    const and: Prisma.BlogPostWhereInput[] = [];
    if (status === 'draft') {
      and.push({ OR: [{ isPublished: false }, { isPublished: true, publishedAt: null }] });
    } else if (status === 'scheduled') {
      and.push({ isPublished: true, publishedAt: { gt: now } });
    } else if (status === 'published') {
      and.push({ isPublished: true, publishedAt: { lte: now } });
    }
    if (category) and.push({ category: { equals: category, mode: 'insensitive' } });
    if (q) {
      and.push({ OR: [{ title: containsInsensitive(q) }, { excerpt: containsInsensitive(q) }, { slug: containsInsensitive(q) }] });
    }
    const where: Prisma.BlogPostWhereInput = and.length ? { AND: and } : {};
    const [total, items] = await Promise.all([
      prisma.blogPost.count({ where }),
      prisma.blogPost.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: BLOG_SELECT,
      }),
    ]);
    return res.status(200).json({
      success: true,
      data: { items: items.map(withStatus), pagination: buildMeta(total, page, limit) },
    });
  } catch (error) {
    return serverError(res, 'retrieve blog posts', error);
  }
}

export async function getBlogPost(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const post = await prisma.blogPost.findUnique({ where: { id: p.data.id }, select: BLOG_DETAIL_SELECT });
    if (!post) return notFound(res, 'Blog post');
    return res.status(200).json({ success: true, data: withStatus(post) });
  } catch (error) {
    return serverError(res, 'retrieve blog post', error);
  }
}

export async function createBlogPost(req: Request, res: Response) {
  try {
    const parsed = blogCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;
    if (input.coverImage) {
      const reason = checkCloudinaryImageUrl(input.coverImage);
      if (reason) return fieldError(res, 'coverImage', reason);
    }
    const author = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });

    let slug: string;
    if (input.slug) {
      const taken = await prisma.blogPost.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (taken) return res.status(409).json({ success: false, message: 'Slug is already in use' });
      slug = input.slug;
    } else {
      slug = await uniqueSlug(slugify(input.title));
    }

    const post = await prisma.blogPost.create({
      data: {
        slug,
        title: input.title,
        excerpt: input.excerpt ?? null,
        content: input.content ?? '',
        category: input.category ?? '',
        coverImage: input.coverImage ?? null,
        authorName: author?.name ?? 'Staff',
        isPublished: false,
        publishedAt: null,
        updatedById: req.user!.userId,
      },
      select: BLOG_DETAIL_SELECT,
    });
    await audit(req, 'CMS_BLOG_CREATED', 'BlogPost', post.id, { fields: Object.keys(input) });
    invalidateContentCaches();
    return res.status(201).json({ success: true, message: 'Blog post created', data: withStatus(post) });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ success: false, message: 'Slug is already in use' });
    return serverError(res, 'create blog post', error);
  }
}

export async function updateBlogPost(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = blogUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;

    const post = await prisma.blogPost.findUnique({ where: { id: p.data.id }, select: BLOG_DETAIL_SELECT });
    if (!post) return notFound(res, 'Blog post');

    if (input.slug !== undefined && input.slug !== post.slug) {
      if (post.publishedAt !== null) {
        return res.status(409).json({ success: false, message: 'Slug cannot be changed after the first publish' });
      }
      const taken = await prisma.blogPost.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (taken) return res.status(409).json({ success: false, message: 'Slug is already in use' });
    }
    if (input.coverImage && input.coverImage !== post.coverImage) {
      const reason = checkCloudinaryImageUrl(input.coverImage);
      if (reason) return fieldError(res, 'coverImage', reason);
    }
    if (post.isPublished) {
      const merged = {
        title: input.title ?? post.title,
        excerpt: input.excerpt ?? post.excerpt,
        content: input.content ?? post.content,
        category: input.category ?? post.category,
      };
      const missing = missingForPublish(merged);
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: `A published post requires: ${missing.join(', ')}. Unpublish it first to clear these fields.`,
        });
      }
    }

    const fields = changedFields(post, input);
    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { ...input, updatedById: req.user!.userId },
      select: BLOG_DETAIL_SELECT,
    });
    await audit(req, 'CMS_BLOG_UPDATED', 'BlogPost', post.id, { fields });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Blog post updated', data: withStatus(updated) });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ success: false, message: 'Slug is already in use' });
    return serverError(res, 'update blog post', error);
  }
}

export async function publishBlogPost(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = blogPublishSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);

    const post = await prisma.blogPost.findUnique({ where: { id: p.data.id }, select: BLOG_DETAIL_SELECT });
    if (!post) return notFound(res, 'Blog post');

    const missing = missingForPublish(post);
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Publishing requires: ${missing.join(', ')}` });
    }

    const now = new Date();
    let requested: Date | null = null;
    if (parsed.data.publishedAt) {
      requested = new Date(parsed.data.publishedAt);
      if (requested.getTime() < now.getTime() - 60_000) {
        return fieldError(res, 'publishedAt', 'publishedAt must be now or in the future');
      }
    }
    if (post.isPublished && !requested) {
      return res.status(200).json({ success: true, message: 'Blog post is already published', data: withStatus(post) });
    }
    const publishedAt = requested ?? post.publishedAt ?? now;

    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { isPublished: true, publishedAt, updatedById: req.user!.userId },
      select: BLOG_DETAIL_SELECT,
    });
    const scheduled = publishedAt.getTime() > now.getTime();
    await audit(req, 'CMS_BLOG_PUBLISHED', 'BlogPost', post.id, { scheduled });
    invalidateContentCaches();
    return res.status(200).json({
      success: true,
      message: scheduled ? 'Blog post scheduled' : 'Blog post published',
      data: withStatus(updated),
    });
  } catch (error) {
    return serverError(res, 'publish blog post', error);
  }
}

export async function unpublishBlogPost(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const post = await prisma.blogPost.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!post) return notFound(res, 'Blog post');
    // publishedAt is kept so the slug stays locked after the first publish.
    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { isPublished: false, updatedById: req.user!.userId },
      select: BLOG_DETAIL_SELECT,
    });
    await audit(req, 'CMS_BLOG_UNPUBLISHED', 'BlogPost', post.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Blog post unpublished', data: withStatus(updated) });
  } catch (error) {
    return serverError(res, 'unpublish blog post', error);
  }
}

export async function deleteBlogPost(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const post = await prisma.blogPost.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!post) return notFound(res, 'Blog post');
    await prisma.blogPost.delete({ where: { id: post.id } });
    await audit(req, 'CMS_BLOG_DELETED', 'BlogPost', post.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Blog post deleted' });
  } catch (error) {
    return serverError(res, 'delete blog post', error);
  }
}

// ═══════════════════════════════ FAQ ══════════════════════════════════════
const FAQ_SELECT = {
  id: true,
  question: true,
  answer: true,
  category: true,
  sortOrder: true,
  isPublished: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.FaqItemSelect;

export const FAQ_SUGGESTIONS: readonly string[] = [
  'What are the admission requirements?',
  'How can I apply for admission?',
  'What documents are needed for admission?',
  'Is there an admission test or interview?',
  'What is the fee structure?',
  'Are there any scholarships or fee waivers?',
  'When do new batches start?',
  'Can I change my batch after admission?',
  'What is the refund policy if I withdraw?',
  'Can I attend a demo class before enrolling?',
];
const FAQ_SUGGESTION_CATEGORY = 'Admission';

export async function listFaq(req: Request, res: Response) {
  try {
    const parsed = faqListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error, 'Invalid query parameters');
    const { page, limit, status, category, q } = parsed.data;
    const where: Prisma.FaqItemWhereInput = {};
    if (status) where.isPublished = status === 'published';
    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (q) where.OR = [{ question: containsInsensitive(q) }, { answer: containsInsensitive(q) }];
    const [total, items] = await Promise.all([
      prisma.faqItem.count({ where }),
      prisma.faqItem.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: FAQ_SELECT,
      }),
    ]);
    return res.status(200).json({ success: true, data: { items, pagination: buildMeta(total, page, limit) } });
  } catch (error) {
    return serverError(res, 'retrieve FAQ items', error);
  }
}

export async function createFaq(req: Request, res: Response) {
  try {
    const parsed = faqCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;
    const max = await prisma.faqItem.aggregate({ _max: { sortOrder: true } });
    const item = await prisma.faqItem.create({
      data: {
        question: input.question,
        answer: input.answer ?? '',
        category: input.category ?? 'General',
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        isPublished: false,
        updatedById: req.user!.userId,
      },
      select: FAQ_SELECT,
    });
    await audit(req, 'CMS_FAQ_CREATED', 'FaqItem', item.id, { fields: Object.keys(input) });
    invalidateContentCaches();
    return res.status(201).json({ success: true, message: 'FAQ item created as draft', data: item });
  } catch (error) {
    return serverError(res, 'create FAQ item', error);
  }
}

export async function updateFaq(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = faqUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;
    const item = await prisma.faqItem.findUnique({ where: { id: p.data.id }, select: FAQ_SELECT });
    if (!item) return notFound(res, 'FAQ item');
    if (item.isPublished && input.answer !== undefined && input.answer.trim() === '') {
      return fieldError(res, 'answer', 'A published FAQ item needs an answer. Unpublish it first.');
    }
    const fields = changedFields(item, input);
    const updated = await prisma.faqItem.update({
      where: { id: item.id },
      data: { ...input, updatedById: req.user!.userId },
      select: FAQ_SELECT,
    });
    await audit(req, 'CMS_FAQ_UPDATED', 'FaqItem', item.id, { fields });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'FAQ item updated', data: updated });
  } catch (error) {
    return serverError(res, 'update FAQ item', error);
  }
}

export async function reorderFaq(req: Request, res: Response) {
  try {
    const parsed = orderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const { ids } = parsed.data;
    const found = await prisma.faqItem.count({ where: { id: { in: ids } } });
    if (found !== ids.length) return notFound(res, 'One or more FAQ items');
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.faqItem.update({ where: { id }, data: { sortOrder: index, updatedById: req.user!.userId } })
      )
    );
    await audit(req, 'CMS_FAQ_REORDERED', 'FaqItem', null, { ids });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'FAQ order updated', data: { count: ids.length } });
  } catch (error) {
    return serverError(res, 'reorder FAQ items', error);
  }
}

export async function publishFaq(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.faqItem.findUnique({ where: { id: p.data.id }, select: FAQ_SELECT });
    if (!item) return notFound(res, 'FAQ item');
    if (!item.answer.trim()) {
      return res.status(400).json({ success: false, message: 'Publishing requires a non-empty answer' });
    }
    const updated = await prisma.faqItem.update({
      where: { id: item.id },
      data: { isPublished: true, updatedById: req.user!.userId },
      select: FAQ_SELECT,
    });
    await audit(req, 'CMS_FAQ_PUBLISHED', 'FaqItem', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'FAQ item published', data: updated });
  } catch (error) {
    return serverError(res, 'publish FAQ item', error);
  }
}

export async function unpublishFaq(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.faqItem.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!item) return notFound(res, 'FAQ item');
    const updated = await prisma.faqItem.update({
      where: { id: item.id },
      data: { isPublished: false, updatedById: req.user!.userId },
      select: FAQ_SELECT,
    });
    await audit(req, 'CMS_FAQ_UNPUBLISHED', 'FaqItem', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'FAQ item unpublished', data: updated });
  } catch (error) {
    return serverError(res, 'unpublish FAQ item', error);
  }
}

export async function deleteFaq(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.faqItem.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!item) return notFound(res, 'FAQ item');
    await prisma.faqItem.delete({ where: { id: item.id } });
    await audit(req, 'CMS_FAQ_DELETED', 'FaqItem', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'FAQ item deleted' });
  } catch (error) {
    return serverError(res, 'delete FAQ item', error);
  }
}

/** Inserts the fixed list of common admission questions as unpublished drafts with EMPTY answers. */
export async function createFaqSuggestions(req: Request, res: Response) {
  try {
    const parsed = emptyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const existing = await prisma.faqItem.findMany({ select: { question: true } });
    const have = new Set(existing.map((e) => e.question.trim().toLowerCase()));
    const toCreate = FAQ_SUGGESTIONS.filter((q) => !have.has(q.trim().toLowerCase()));
    let created: string[] = [];
    if (toCreate.length > 0) {
      const max = await prisma.faqItem.aggregate({ _max: { sortOrder: true } });
      const base = (max._max.sortOrder ?? -1) + 1;
      const rows = await prisma.$transaction(
        toCreate.map((question, i) =>
          prisma.faqItem.create({
            data: {
              question,
              answer: '',
              category: FAQ_SUGGESTION_CATEGORY,
              sortOrder: base + i,
              isPublished: false,
              updatedById: req.user!.userId,
            },
            select: { id: true },
          })
        )
      );
      created = rows.map((r) => r.id);
    }
    await audit(req, 'CMS_FAQ_SUGGESTIONS_ADDED', 'FaqItem', null, { ids: created });
    if (created.length) invalidateContentCaches();
    return res.status(200).json({
      success: true,
      message: created.length ? `${created.length} draft question(s) added` : 'All suggested questions already exist',
      data: { created: created.length, skipped: FAQ_SUGGESTIONS.length - created.length, ids: created },
    });
  } catch (error) {
    return serverError(res, 'add suggested FAQ items', error);
  }
}

// ═══════════════════════════ TESTIMONIALS ═════════════════════════════════
const TESTIMONIAL_SELECT = {
  id: true,
  name: true,
  roleTitle: true,
  content: true,
  avatarUrl: true,
  rating: true,
  isFeatured: true,
  isPublished: true,
  hasConsent: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.TestimonialSelect;

export async function listTestimonials(req: Request, res: Response) {
  try {
    const parsed = testimonialListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error, 'Invalid query parameters');
    const { page, limit, status, q } = parsed.data;
    const where: Prisma.TestimonialWhereInput = {};
    if (status) where.isPublished = status === 'published';
    if (q) where.OR = [{ name: containsInsensitive(q) }, { content: containsInsensitive(q) }];
    const [total, items] = await Promise.all([
      prisma.testimonial.count({ where }),
      prisma.testimonial.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        select: TESTIMONIAL_SELECT,
      }),
    ]);
    return res.status(200).json({ success: true, data: { items, pagination: buildMeta(total, page, limit) } });
  } catch (error) {
    return serverError(res, 'retrieve testimonials', error);
  }
}

export async function createTestimonial(req: Request, res: Response) {
  try {
    const parsed = testimonialCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;
    if (input.avatarUrl) {
      const reason = checkCloudinaryImageUrl(input.avatarUrl);
      if (reason) return fieldError(res, 'avatarUrl', reason);
    }
    const max = await prisma.testimonial.aggregate({ _max: { sortOrder: true } });
    const item = await prisma.testimonial.create({
      data: {
        name: input.name,
        roleTitle: input.roleTitle,
        content: input.content,
        rating: input.rating ?? 5,
        avatarUrl: input.avatarUrl ?? null,
        hasConsent: input.hasConsent ?? false,
        isPublished: false,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        updatedById: req.user!.userId,
      },
      select: TESTIMONIAL_SELECT,
    });
    await audit(req, 'CMS_TESTIMONIAL_CREATED', 'Testimonial', item.id, { fields: Object.keys(input) });
    invalidateContentCaches();
    return res.status(201).json({ success: true, message: 'Testimonial created as draft', data: item });
  } catch (error) {
    return serverError(res, 'create testimonial', error);
  }
}

export async function updateTestimonial(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = testimonialUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = parsed.data;
    const item = await prisma.testimonial.findUnique({ where: { id: p.data.id }, select: TESTIMONIAL_SELECT });
    if (!item) return notFound(res, 'Testimonial');
    if (input.avatarUrl && input.avatarUrl !== item.avatarUrl) {
      const reason = checkCloudinaryImageUrl(input.avatarUrl);
      if (reason) return fieldError(res, 'avatarUrl', reason);
    }
    const data: Prisma.TestimonialUpdateInput = { ...input, updatedById: req.user!.userId };
    const fields = changedFields(item, input);
    // Withdrawing consent takes a published testimonial offline immediately.
    if (input.hasConsent === false && item.isPublished) {
      data.isPublished = false;
      fields.push('isPublished');
    }
    const updated = await prisma.testimonial.update({ where: { id: item.id }, data, select: TESTIMONIAL_SELECT });
    await audit(req, 'CMS_TESTIMONIAL_UPDATED', 'Testimonial', item.id, { fields });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial updated', data: updated });
  } catch (error) {
    return serverError(res, 'update testimonial', error);
  }
}

export async function reorderTestimonials(req: Request, res: Response) {
  try {
    const parsed = orderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const { ids } = parsed.data;
    const found = await prisma.testimonial.count({ where: { id: { in: ids } } });
    if (found !== ids.length) return notFound(res, 'One or more testimonials');
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.testimonial.update({ where: { id }, data: { sortOrder: index, updatedById: req.user!.userId } })
      )
    );
    await audit(req, 'CMS_TESTIMONIAL_REORDERED', 'Testimonial', null, { ids });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial order updated', data: { count: ids.length } });
  } catch (error) {
    return serverError(res, 'reorder testimonials', error);
  }
}

export async function publishTestimonial(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.testimonial.findUnique({ where: { id: p.data.id }, select: TESTIMONIAL_SELECT });
    if (!item) return notFound(res, 'Testimonial');
    if (!item.hasConsent) {
      return res.status(400).json({ success: false, message: 'Publishing requires the person\'s consent (hasConsent = true)' });
    }
    const updated = await prisma.testimonial.update({
      where: { id: item.id },
      data: { isPublished: true, updatedById: req.user!.userId },
      select: TESTIMONIAL_SELECT,
    });
    await audit(req, 'CMS_TESTIMONIAL_PUBLISHED', 'Testimonial', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial published', data: updated });
  } catch (error) {
    return serverError(res, 'publish testimonial', error);
  }
}

export async function unpublishTestimonial(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.testimonial.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!item) return notFound(res, 'Testimonial');
    const updated = await prisma.testimonial.update({
      where: { id: item.id },
      data: { isPublished: false, updatedById: req.user!.userId },
      select: TESTIMONIAL_SELECT,
    });
    await audit(req, 'CMS_TESTIMONIAL_UNPUBLISHED', 'Testimonial', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial unpublished', data: updated });
  } catch (error) {
    return serverError(res, 'unpublish testimonial', error);
  }
}

export async function deleteTestimonial(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const item = await prisma.testimonial.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!item) return notFound(res, 'Testimonial');
    await prisma.testimonial.delete({ where: { id: item.id } });
    await audit(req, 'CMS_TESTIMONIAL_DELETED', 'Testimonial', item.id);
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial deleted' });
  } catch (error) {
    return serverError(res, 'delete testimonial', error);
  }
}

export async function setTestimonialFeatured(req: Request, res: Response) {
  try {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return invalid(res, p.error, 'Invalid ID');
    const parsed = featuredSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const item = await prisma.testimonial.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!item) return notFound(res, 'Testimonial');
    const updated = await prisma.testimonial.update({
      where: { id: item.id },
      data: { isFeatured: parsed.data.isFeatured, updatedById: req.user!.userId },
      select: TESTIMONIAL_SELECT,
    });
    await audit(req, 'CMS_TESTIMONIAL_FEATURED', 'Testimonial', item.id, { fields: ['isFeatured'], isFeatured: parsed.data.isFeatured });
    invalidateContentCaches();
    return res.status(200).json({ success: true, message: 'Testimonial updated', data: updated });
  } catch (error) {
    return serverError(res, 'update testimonial', error);
  }
}

// Role constants reused by the router
export const CMS_STAFF = [Role.ADMIN, Role.SUPER_ADMIN] as const;
