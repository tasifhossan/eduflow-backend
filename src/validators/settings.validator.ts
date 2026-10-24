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
      })
      .partial()
      .optional(),
  })
  .strict();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
