import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import {
  getCenterSettings,
  getPublicCenterSettings,
  invalidateSettingsCache,
} from '../services/settings.service';
import { updateSettingsSchema } from '../validators/settings.validator';
import { createAuditLog } from '../utils/audit';

export async function getPublicCenter(_req: Request, res: Response) {
  try {
    const data = await getPublicCenterSettings();
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching public center settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve center settings',
    });
  }
}

export async function getSettings(_req: Request, res: Response) {
  try {
    const data = await getCenterSettings();
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching admin center settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve system settings',
    });
  }
}

export async function updateSettings(req: Request, res: Response) {
  try {
    const parseResult = updateSettingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed for center settings',
        errors: parseResult.error.flatten(),
      });
    }

    const currentSettings = await getCenterSettings();
    const updateData: Record<string, unknown> = { ...parseResult.data };

    // Deep merge features object if provided
    if (parseResult.data.features) {
      const existingFeatures = (currentSettings.features as Record<string, unknown>) || {};
      updateData.features = {
        ...existingFeatures,
        ...parseResult.data.features,
      };
    }

    // Deep merge socials object if provided
    if (parseResult.data.socials !== undefined) {
      if (parseResult.data.socials === null) {
        updateData.socials = null;
      } else {
        const existingSocials = (currentSettings.socials as Record<string, unknown>) || {};
        updateData.socials = {
          ...existingSocials,
          ...parseResult.data.socials,
        };
      }
    }

    const updated = await prisma.centerSettings.update({
      where: { key: 'center' },
      data: updateData as any,
    });

    invalidateSettingsCache();

    // Audit log: record changed field names only (never values or secrets)
    await createAuditLog({
      actorId: req.user?.userId,
      action: 'SETTINGS_UPDATED',
      entityType: 'CenterSettings',
      entityId: updated.id,
      metadata: {
        changedFields: Object.keys(parseResult.data),
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Center settings updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating center settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating settings',
    });
  }
}
