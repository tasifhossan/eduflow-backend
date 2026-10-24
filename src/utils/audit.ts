import prisma from './prisma';

export interface CreateAuditLogParams {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  metadata?: Record<string, any> | null;
  ip?: string | null;
}

/**
 * Creates an audit log entry.
 * Guarantees zero sensitive fields (passwords, hashes, tokens) in metadata.
 */
export async function createAuditLog(params: CreateAuditLogParams, tx?: any): Promise<void> {
  try {
    const client = tx || prisma;

    let sanitizedMetadata: any = null;
    if (params.metadata && typeof params.metadata === 'object') {
      sanitizedMetadata = JSON.parse(JSON.stringify(params.metadata));
      const cleanKeys = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
          if (/password|hash|token|secret/i.test(k)) {
            delete obj[k];
          } else if (typeof obj[k] === 'object') {
            cleanKeys(obj[k]);
          }
        }
      };
      cleanKeys(sanitizedMetadata);
    }

    await client.auditLog.create({
      data: {
        actorId: params.actorId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId || null,
        branchId: params.branchId || null,
        metadata: sanitizedMetadata,
        ip: params.ip || null,
      },
    });
  } catch (err) {
    console.error('Failed to create audit log entry:', err);
  }
}
