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
  socials: Record<string, unknown> | null;
  currency: string;
  currencySymbol: string;
  timezone: string;
  defaultLocale: string;
  features: {
    publicSite?: boolean;
    aiAssistant?: boolean;
    blog?: boolean;
    reviews?: boolean;
    testimonials?: boolean;
    newsletter?: boolean;
    showPoweredBy?: boolean;
    [key: string]: unknown;
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

export async function getPublicCenterSettings(forceRefresh = false): Promise<CenterPublicData> {
  const settings = await getCenterSettings(forceRefresh);
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
    socials: (settings.socials as Record<string, unknown>) || null,
    currency: settings.currency,
    currencySymbol: settings.currencySymbol,
    timezone: settings.timezone,
    defaultLocale: settings.defaultLocale,
    features: (settings.features as CenterPublicData['features']) || {},
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
  };
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}
