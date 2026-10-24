import { PrismaClient } from '@prisma/client';

/**
 * Generates a unique, non-reusable student code formatted as:
 * <BRANCHCODE>-<YY>-<4-digit sequence>
 * Example: DHN-26-0001
 */
export async function generateStudentCode(
  tx: any,
  branchId: string,
  date: Date = new Date()
): Promise<string> {
  const branch = await tx.branch.findUnique({
    where: { id: branchId },
    select: { code: true, name: true },
  });

  let branchCode = branch?.code;
  if (!branchCode) {
    branchCode = (branch?.name || 'GEN')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'STDN';
  }

  const yy = String(date.getFullYear()).slice(-2);
  const prefix = `${branchCode}-${yy}-`;

  // Find latest student with this prefix
  const latestStudent = await tx.user.findFirst({
    where: {
      studentCode: {
        startsWith: prefix,
      },
    },
    select: { studentCode: true },
    orderBy: { studentCode: 'desc' },
  });

  let nextSeq = 1;
  if (latestStudent?.studentCode) {
    const parts = latestStudent.studentCode.split('-');
    const currentSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  const paddedSeq = String(nextSeq).padStart(4, '0');
  return `${prefix}${paddedSeq}`;
}
