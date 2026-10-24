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
        name: 'EduFlow Coaching',
        shortName: 'EduFlow',
        tagline: 'Modern Coaching Center Management Platform',
        primaryColor: '#4f46e5',
        contactEmail: 'contact@eduflow.local',
        contactPhone: '01700000000',
        address: 'Dhaka, Bangladesh',
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
          newsletter: true,
          showPoweredBy: true,
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
  };
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}
