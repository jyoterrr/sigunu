import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Prisma's unique-constraint violation code. Used to detect "someone else locked first". */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
