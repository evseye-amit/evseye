import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const reason = z.string().trim().min(1).max(500);
export const money = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
export const penaltyMoney = money.refine(
  (v) => Number(v) > 0,
  'Penalty amount must be greater than zero.',
);
export const referenceFields = {
  name: z.string().trim().min(1).max(180),
  baseRate: money,
  gstPercent: z
    .string()
    .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
    .refine((v) => Number(v) <= 100, 'GST must be between 0 and 100.'),
  hsnCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
  unit: z.string().trim().min(1).max(30),
  vehicleTypeIds: z.array(z.string().uuid()).max(100),
};
export const createMasterSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_-]{1,59}$/),
    ...referenceFields,
    unit: referenceFields.unit.default('PIECE'),
    vehicleTypeIds: referenceFields.vehicleTypeIds.default([]),
    isActive: z.boolean().default(true),
  })
  .strict();
export const patchMasterSchema = z
  .object({
    name: referenceFields.name.optional(),
    baseRate: money.optional(),
    gstPercent: referenceFields.gstPercent.optional(),
    hsnCode: referenceFields.hsnCode.optional(),
    unit: referenceFields.unit.optional(),
    vehicleTypeIds: referenceFields.vehicleTypeIds.optional(),
    isActive: z.boolean().optional(),
    expectedVersion: z.number().int().min(1),
    reason,
  })
  .strict();
export const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).optional(),
    status: z
      .enum(['ALL', 'ACTIVE', 'INACTIVE', 'UNCONFIGURED'])
      .default('ALL'),
    origin: z.enum(['ALL', 'MASTER', 'CLIENT', 'NON_SPARE']).default('ALL'),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  return result.data;
}
