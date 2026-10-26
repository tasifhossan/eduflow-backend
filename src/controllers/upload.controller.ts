import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import cloudinary from '../utils/cloudinary';
import { uploadSignatureSchema } from '../validators/upload.validator';
import { ATTACHMENT_CONFIG } from '../config/academics.config';

export async function getSignedUploadParams(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const payload = {
      ...req.query,
      ...req.body,
    };

    const parseResult = uploadSignatureSchema.safeParse(payload);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { purpose, folder: customFolder, type: legacyType } = parseResult.data;
    const branchId = req.user.branchId;
    const userRole = req.user.role;

    const timestamp = Math.round(new Date().getTime() / 1000);

    let folder = customFolder || 'eduflow_resources';
    let isPrivate = false;
    let allowedFormats: string | undefined;
    let maxBytes: number | undefined;

    if (purpose === 'material') {
      if (userRole === Role.STUDENT || userRole === Role.GUARDIAN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to upload material assets',
        });
      }
      folder = `eduflow/material/${branchId}`;
      isPrivate = true;
      allowedFormats = ATTACHMENT_CONFIG.ALLOWED_MATERIAL_FORMATS.join(',');
      maxBytes = ATTACHMENT_CONFIG.MAX_MATERIAL_BYTES;
    } else if (purpose === 'submission') {
      if (userRole === Role.GUARDIAN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Guardians cannot upload submission assets',
        });
      }
      folder = `eduflow/submission/${branchId}`;
      isPrivate = true;
      allowedFormats = ATTACHMENT_CONFIG.ALLOWED_SUBMISSION_FORMATS.join(',');
      maxBytes = ATTACHMENT_CONFIG.MAX_SUBMISSION_BYTES;
    } else if (purpose === 'branding' || legacyType === 'branding' || folder.includes('branding')) {
      if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Only administrators can upload branding assets',
        });
      }
      folder = `eduflow/branding/${branchId}`;
      allowedFormats = 'png,jpg,jpeg,webp';
      maxBytes = 2 * 1024 * 1024;
    }

    const paramsToSign: Record<string, any> = {
      timestamp,
      folder,
    };

    if (isPrivate) {
      paramsToSign.type = 'authenticated';
    }

    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary API secret is not configured',
      });
    }

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return res.status(200).json({
      success: true,
      message: 'Upload signature generated successfully',
      data: {
        signature,
        timestamp,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        folder,
        type: isPrivate ? 'authenticated' : undefined,
        allowed_formats: allowedFormats,
        allowedFormats: allowedFormats ? allowedFormats.split(',') : undefined,
        max_bytes: maxBytes,
        maxBytes: maxBytes,
      },
    });
  } catch (error) {
    console.error('Error generating Cloudinary upload signature:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error generating upload signature',
    });
  }
}
