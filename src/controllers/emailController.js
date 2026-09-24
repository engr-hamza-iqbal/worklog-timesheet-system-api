import prisma from '../config/db.js';
import { sendSuccess, sendError } from '../utils/response.js';

export async function handleGetEmailLogs(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const { emailType, status, search } = req.query;

    const where = {
      ...(emailType ? { emailType } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { recipientEmail: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, logs] = await Promise.all([
      prisma.emailLog.count({ where }),
      prisma.emailLog.findMany({
        where,
        include: {
          recipientUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return sendSuccess(
      res,
      {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      'Email logs retrieved.'
    );
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}
