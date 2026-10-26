import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

export interface CenterPublicData {
  name: string;
  shortName: string;
  tagline: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string | null;
  address: string;
  officeHours: string | null;
  socials: Record<string, unknown> | null;
  currency: string;
  currencySymbol: string;
  timezone: string;
  defaultLocale: string;
  weekStartsOn: number;
  features: {
    publicSite?: boolean;
    aiAssistant?: boolean;
    blog?: boolean;
    reviews?: boolean;
    testimonials?: boolean;
    newsletter?: boolean;
    showPoweredBy?: boolean;
    lectures?: boolean;
    assignments?: boolean;
    onlineClasses?: boolean;
    [key: string]: unknown;
  };
  content: {
    hasPublishedBatches: boolean;
    hasTeachers: boolean;
    hasBlog: boolean;
    hasFaq: boolean;
    hasTestimonials: boolean;
    hasAbout: boolean;
  };
  homepage: {
    heroBadge?: string;
    heroPoints?: string[];
    heroTitle?: string;
    heroSubtitle?: string;
    heroImageUrl?: string | null;
    announcement?: {
      enabled: boolean;
      text: string;
      linkLabel?: string;
      linkUrl?: string | null;
    };
    highlights?: Array<{ label: string; value: string }>;
    whyChooseUs?: Array<{ title: string; description: string; icon: string }>;
    admissionSteps?: Array<{ title: string; description: string }>;
    showFees?: boolean;
    showPhotoGallery?: boolean;
  };
}

let cachedSettings: any = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getCenterSettings(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSettings && now < cacheExpiry) {
    return cachedSettings;
  }

  let settings = await prisma.centerSettings.findUnique({
    where: { key: 'center' },
  });

  if (!settings) {
    // If table exists but row is missing, upsert default singleton
    settings = await prisma.centerSettings.upsert({
      where: { key: 'center' },
      update: {},
      create: {
        key: 'center',
        name: 'Coaching Center',
        shortName: 'Center',
        tagline: '',
        primaryColor: '#4f46e5',
        contactEmail: '',
        contactPhone: '',
        whatsapp: null,
        address: '',
        socials: {},
        currency: 'BDT',
        currencySymbol: '৳',
        timezone: 'Asia/Dhaka',
        defaultLocale: 'en',
        academicYearStartMonth: 1,
        features: {
          publicSite: true,
          aiAssistant: true,
          blog: true,
          reviews: true,
          testimonials: true,
          newsletter: false,
          showPoweredBy: true,
          lectures: true,
          assignments: true,
          onlineClasses: true,
        },
        homepage: {
          heroBadge: '',
          heroPoints: [],
          heroTitle: '',
          heroSubtitle: '',
          heroImageUrl: null,
          announcement: { enabled: false, text: '', linkLabel: '', linkUrl: '' },
          highlights: [],
          whyChooseUs: [],
          admissionSteps: [],
          showFees: true,
          showPhotoGallery: true,
        },
      },
    });
  }

  cachedSettings = settings;
  cacheExpiry = now + CACHE_TTL_MS;
  return settings;
}

let cachedContent: CenterPublicData['content'] | null = null;
let contentCacheExpiry = 0;
const CONTENT_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getContentSummary(
  features: CenterPublicData['features'],
  about: Record<string, any> | null,
  forceRefresh = false
): Promise<CenterPublicData['content']> {
  const now = Date.now();
  if (!forceRefresh && cachedContent && now < contentCacheExpiry) {
    return cachedContent;
  }

  const publicSiteOn = features.publicSite !== false;

  const [batchCount, teacherCount, blogCount, faqCount, testimonialCount] = await Promise.all([
    prisma.batch.count({ where: { isPublished: true } }),
    prisma.user.count({ where: { role: 'TEACHER', isPublicProfile: true, isActive: true } }),
    prisma.blogPost.count({ where: { isPublished: true } }),
    prisma.faqItem.count(),
    prisma.testimonial.count(),
  ]);

  const hasAbout = publicSiteOn && Boolean(
    about && (
      (typeof about.body === 'string' && about.body.trim().length > 0) ||
      (typeof about.headline === 'string' && about.headline.trim().length > 0)
    )
  );

  const summary: CenterPublicData['content'] = {
    hasPublishedBatches: publicSiteOn && batchCount > 0,
    hasTeachers: publicSiteOn && teacherCount > 0,
    hasBlog: publicSiteOn && (features.blog !== false) && blogCount > 0,
    hasFaq: publicSiteOn && faqCount > 0,
    hasTestimonials: publicSiteOn && (features.testimonials !== false) && testimonialCount > 0,
    hasAbout,
  };

  cachedContent = summary;
  contentCacheExpiry = now + CONTENT_CACHE_TTL_MS;
  return summary;
}

export async function getPublicCenterSettings(forceRefresh = false): Promise<CenterPublicData> {
  const settings = await getCenterSettings(forceRefresh);
  const rawFeatures = (settings.features as Record<string, boolean>) || {};
  const features: CenterPublicData['features'] = {
    ...rawFeatures,
    lectures: rawFeatures.lectures !== false,
    assignments: rawFeatures.assignments !== false,
    onlineClasses: rawFeatures.onlineClasses !== false,
  };

  const content = await getContentSummary(
    features,
    settings.about as Record<string, any> | null,
    forceRefresh
  );

  return {
    name: settings.name,
    shortName: settings.shortName,
    tagline: settings.tagline,
    logoUrl: settings.logoUrl,
    faviconUrl: settings.faviconUrl,
    primaryColor: settings.primaryColor,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    whatsapp: settings.whatsapp,
    address: settings.address,
    officeHours: settings.officeHours ?? null,
    socials: (settings.socials as Record<string, unknown>) || null,
    currency: settings.currency,
    currencySymbol: settings.currencySymbol,
    timezone: settings.timezone,
    defaultLocale: settings.defaultLocale,
    weekStartsOn: settings.weekStartsOn ?? 6,
    features,
    homepage: (settings.homepage as CenterPublicData['homepage']) || {
      heroBadge: '',
      heroPoints: [],
      heroTitle: '',
      heroSubtitle: '',
      heroImageUrl: null,
      announcement: { enabled: false, text: '', linkLabel: '', linkUrl: '' },
      highlights: [],
      whyChooseUs: [],
      admissionSteps: [],
      showFees: true,
      showPhotoGallery: true,
    },
    content,
  };
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheExpiry = 0;
  cachedContent = null;
  contentCacheExpiry = 0;
}
