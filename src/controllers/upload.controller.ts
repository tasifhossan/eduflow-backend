import { Request, Response } from 'express';
import cloudinary from '../utils/cloudinary';

export async function getSignedUploadParams(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = (req.query.folder as string) || 'eduflow_resources';
    const isBranding =
      folder.includes('branding') ||
      req.query.type === 'branding' ||
      folder.includes('logo') ||
      folder.includes('favicon');

    const paramsToSign: Record<string, any> = {
      timestamp,
      folder,
    };

    if (isBranding) {
      paramsToSign.allowed_formats = 'png,jpg,jpeg,webp';
      paramsToSign.max_bytes = 2 * 1024 * 1024; // 2MB max for branding
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
        allowed_formats: paramsToSign.allowed_formats,
        max_bytes: paramsToSign.max_bytes,
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
