import { z } from 'zod';

const httpsUrlSchema = z
  .string()
  .trim()
  .refine((val) => val === '' || /^https:\/\/[^\s$.?#].[^\s]*$/i.test(val), {
    message: 'Must be a valid secure HTTPS URL',
  })
  .optional()
  .nullable();

const phoneSchema = z
  .string()
  .trim()
  .refine((val) => val === '' || /^(?:\+8801|01)\d{9}$/.test(val) || /^\+[1-9]\d{6,14}$/.test(val), {
    message: 'Must be a valid Bangladeshi or E.164 phone number',
  });

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9A-Fa-f]{6})$/, {
    message: 'Primary color must be a 6-digit hex code in #RRGGBB format',
  });

const controlCharRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const htmlTagRegex = /<[^>]+>/;

export const plainText = (maxLen: number) =>
  z
    .string()
    .trim()
    .max(maxLen, `Must not exceed ${maxLen} characters`)
    .refine((val) => !controlCharRegex.test(val), {
      message: 'Control characters are not allowed',
    })
    .refine((val) => !htmlTagRegex.test(val), {
      message: 'HTML tags are not allowed',
    });

export const aboutSchema = z
  .object({
    headline: plainText(90).optional().nullable(),
    body: plainText(4000).optional().nullable(),
    mission: plainText(400).optional().nullable(),
    vision: plainText(400).optional().nullable(),
    facilities: z.array(plainText(60)).max(8, 'Maximum 8 facilities allowed').optional().nullable(),
  })
  .strict();

export const legalSchema = z
  .object({
    privacyText: plainText(20000).optional().nullable(),
    termsText: plainText(20000).optional().nullable(),
    updatedOn: z
      .string()
      .trim()
      .refine((val) => val === '' || !isNaN(Date.parse(val)), {
        message: 'Must be a valid ISO date',
      })
      .optional()
      .nullable(),
  })
  .strict();

export const LUCIDE_ICON_WHITELIST = [
  'BookOpen',
  'GraduationCap',
  'Award',
  'Users',
  'Clock',
  'CheckCircle',
  'CheckCircle2',
  'Star',
  'Shield',
  'ShieldCheck',
  'Sparkles',
  'Target',
  'Compass',
  'Lightbulb',
  'Smile',
  'Heart',
  'TrendingUp',
  'Zap',
  'HelpCircle',
  'FileText',
  'Calendar',
  'MapPin',
  'Brain',
  'Layers',
  'Flame',
  'Trophy',
  'BadgeCheck',
] as const;

export const homepageSchema = z
  .object({
    heroBadge: z.string().trim().max(40).optional(),
    heroPoints: z.array(z.string().trim().max(30)).max(3).optional(),
    heroTitle: z.string().trim().max(90).optional(),
    heroSubtitle: z.string().trim().max(220).optional(),
    heroImageUrl: httpsUrlSchema,
    announcement: z
      .object({
        enabled: z.boolean().default(false),
        text: z.string().trim().max(160).default(''),
        linkLabel: z.string().trim().max(40).optional(),
        linkUrl: z
          .string()
          .trim()
          .refine((val) => val === '' || val.startsWith('/') || /^https:\/\//i.test(val), {
            message: 'Must be a relative URL starting with / or an HTTPS URL',
          })
          .optional()
          .nullable(),
      })
      .optional(),
    highlights: z
      .array(
        z.object({
          label: z.string().trim().max(40),
          value: z.string().trim().max(40),
        })
      )
      .max(4)
      .optional(),
    whyChooseUs: z
      .array(
        z.object({
          title: z.string().trim().max(60),
          description: z.string().trim().max(220),
          icon: z.enum(LUCIDE_ICON_WHITELIST),
        })
      )
      .max(6)
      .optional(),
    admissionSteps: z
      .array(
        z.object({
          title: z.string().trim().max(60),
          description: z.string().trim().max(220),
        })
      )
      .max(5)
      .optional(),
    showFees: z.boolean().optional(),
    showPhotoGallery: z.boolean().optional(),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    shortName: z.string().trim().min(2).max(50).optional(),
    tagline: z.string().trim().min(2).max(200).optional(),
    logoUrl: httpsUrlSchema,
    faviconUrl: httpsUrlSchema,
    primaryColor: hexColorSchema.optional(),
    contactEmail: z.string().trim().email().optional(),
    contactPhone: phoneSchema.optional(),
    whatsapp: phoneSchema.optional().nullable(),
    address: z.string().trim().min(2).max(250).optional(),
    socials: z
      .object({
        facebook: httpsUrlSchema,
        youtube: httpsUrlSchema,
        instagram: httpsUrlSchema,
        linkedin: httpsUrlSchema,
        website: httpsUrlSchema,
      })
      .partial()
      .optional()
      .nullable(),
    currency: z.string().trim().min(1).max(10).optional(),
    currencySymbol: z.string().trim().min(1).max(5).optional(),
    timezone: z.string().trim().min(1).max(50).optional(),
    defaultLocale: z.enum(['en', 'bn']).optional(),
    academicYearStartMonth: z.number().int().min(1).max(12).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    feeDueDay: z.number().int().min(1).max(28).optional(),
    receiptHeader: z.string().trim().max(500).optional().nullable(),
    receiptFooter: z.string().trim().max(500).optional().nullable(),
    features: z
      .object({
        publicSite: z.boolean().optional(),
        aiAssistant: z.boolean().optional(),
        blog: z.boolean().optional(),
        reviews: z.boolean().optional(),
        testimonials: z.boolean().optional(),
        newsletter: z.boolean().optional(),
        showPoweredBy: z.boolean().optional(),
        lectures: z.boolean().optional(),
        assignments: z.boolean().optional(),
        onlineClasses: z.boolean().optional(),
      })
      .partial()
      .optional(),
    homepage: homepageSchema.partial().optional(),
    officeHours: plainText(120).optional().nullable(),
    about: aboutSchema.partial().optional().nullable(),
    legal: legalSchema.partial().optional().nullable(),
  })
  .strict();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
