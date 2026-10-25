export const ONLINE_CLASS_CONFIG = {
  JOIN_BEFORE_MINUTES: 30,
  JOIN_AFTER_MINUTES: 60,
} as const;

export const ATTACHMENT_CONFIG = {
  MAX_MATERIAL_BYTES: 15 * 1024 * 1024, // 15 MB
  MAX_SUBMISSION_BYTES: 10 * 1024 * 1024, // 10 MB
  ALLOWED_MATERIAL_FORMATS: [
    'pdf',
    'doc',
    'docx',
    'ppt',
    'pptx',
    'xls',
    'xlsx',
    'png',
    'jpg',
    'jpeg',
    'webp',
  ],
  ALLOWED_SUBMISSION_FORMATS: [
    'pdf',
    'doc',
    'docx',
    'png',
    'jpg',
    'jpeg',
    'webp',
  ],
  DOWNLOAD_URL_EXPIRES_IN_SECONDS: 300, // 5 minutes
} as const;

export const NOTIFICATION_CONFIG = {
  MAX_RECIPIENTS_PER_EVENT: 500,
} as const;
