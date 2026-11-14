import { z } from 'zod';

/**
 * Plain text with a small markdown subset (## / ### headings, lists, bold, italic, https links).
 * Anything that looks like HTML or a script vector is rejected (not silently stripped).
 */

const HTML_TAG = /<\/?[a-zA-Z!?]/;
const EVENT_ATTR = /\bon[a-z]{3,20}\s*=/i;
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript)\s*:/i;
const DATA_URI = /\bdata\s*:\s*(?:text|image|application|audio|video)\b/i;
const NUMERIC_ENTITY = /&#x?[0-9a-f]+;?/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MD_LINK = /\]\(\s*([^)\s]*)[^)]*\)/g;

export function findUnsafeTextReason(value: string): string | null {
  if (CONTROL_CHARS.test(value)) return 'contains control characters';
  if (HTML_TAG.test(value)) return 'HTML is not allowed';
  if (EVENT_ATTR.test(value)) return 'event attributes are not allowed';
  if (DANGEROUS_SCHEME.test(value)) return 'javascript: links are not allowed';
  if (DATA_URI.test(value)) return 'data: links are not allowed';
  if (NUMERIC_ENTITY.test(value)) return 'numeric HTML entities are not allowed';
  let m: RegExpExecArray | null;
  MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(value)) !== null) {
    if (!/^https:\/\//i.test(m[1])) return 'only https links are allowed';
  }
  return null;
}

/** Zod string that is trimmed, length-bounded and free of HTML/script vectors. */
export function safeText(max: number, opts: { min?: number; multiline?: boolean } = {}) {
  const min = opts.min ?? 0;
  return z
    .string()
    .trim()
    .min(min, min > 0 ? `Must be at least ${min} character(s)` : undefined)
    .max(max, `Must be at most ${max} characters`)
    .superRefine((val, ctx) => {
      if (!opts.multiline && /[\r\n]/.test(val)) {
        ctx.addIssue({ code: 'custom', message: 'Must be a single line' });
        return;
      }
      const reason = findUnsafeTextReason(val);
      if (reason) ctx.addIssue({ code: 'custom', message: `Unsafe content: ${reason}` });
    });
}

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain only lowercase letters, digits and single hyphens');

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || 'post';
}

/**
 * Image URLs must live under https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/.
 * Returns null when valid, otherwise a short reason.
 */
export function checkCloudinaryImageUrl(url: string): string | null {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return 'Image uploads are not configured on this server';
  if (url.length > 500) return 'URL is too long';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }
  if (parsed.protocol !== 'https:') return 'Image URL must use https';
  if (parsed.hostname !== 'res.cloudinary.com') return 'Image must be hosted on Cloudinary';
  if (parsed.username || parsed.password) return 'Invalid image URL';
  if (!parsed.pathname.startsWith(`/${cloud}/`)) return 'Image must belong to this center\'s Cloudinary account';
  return null;
}

/** Plain-shape image URL for Zod; the host policy is enforced only when the value changes. */
export const imageUrlField = z.string().trim().max(500).url('Invalid URL').nullable();

const FIELD_MARKER = /[^a-zA-Z0-9_.]/g;

/** Names of fields that actually differ (audit metadata must never carry the text itself). */
export function changedFields<T extends Record<string, unknown>>(
  before: Record<string, any>,
  patch: T
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) continue;
    const a = before[key];
    const b = patch[key];
    const same =
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) out.push(key.replace(FIELD_MARKER, ''));
  }
  return out;
}
