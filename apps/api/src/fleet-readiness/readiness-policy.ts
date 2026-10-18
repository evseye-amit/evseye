import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const items = [
  ['IDENTITY', 'Vehicle/chassis, model and hub match'],
  ['COMPONENTS', 'Installed components and serial numbers match'],
  ['BODY', 'Body, panels and mirrors'],
  ['TYRES', 'Tyres and wheels'],
  ['BRAKES', 'Front and rear brakes'],
  ['STEERING', 'Steering and suspension'],
  ['LIGHTS', 'Lights, indicators and horn'],
  ['DASHBOARD', 'Dashboard and warning indicators'],
  ['WIRING', 'Wiring and connectors'],
  ['BATTERY_MOUNTING', 'Battery mounting and connectors'],
  ['CHARGING', 'Charging check'],
  ['KEYS', 'Keys'],
  ['OPERATIONAL_TEST', 'Operational test'],
].map(([code, label]) => ({ code, label, required: true, allowNA: false }));
export const policySchema = z
  .object({
    independentReview: z.boolean(),
    minBatteryCount: z.number().int().min(1).max(8),
    requireController: z.boolean(),
    iotRequired: z.boolean(),
    items: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z0-9_]{1,60}$/),
            label: z.string().trim().min(1).max(180),
            required: z.boolean(),
            allowNA: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    photoTypes: z
      .array(z.string().regex(/^[A-Z0-9_]{1,60}$/))
      .min(1)
      .max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.items.map((item) => item.code)).size !== value.items.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Checklist codes must be unique.',
      });
    if (new Set(value.photoTypes).size !== value.photoTypes.length)
      ctx.addIssue({ code: 'custom', message: 'Photo slots must be unique.' });
    for (const required of items)
      if (
        !value.items.some(
          (item) =>
            item.code === required.code && item.required && !item.allowNA,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: `Required safety check cannot be removed: ${required.code}`,
        });
    for (const photo of ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD'])
      if (!value.photoTypes.includes(photo))
        ctx.addIssue({
          code: 'custom',
          message: `Required photo cannot be removed: ${photo}`,
        });
  });
export type ReadinessPolicy = z.infer<typeof policySchema>;
export const defaultPolicy: ReadinessPolicy = {
  independentReview: true,
  minBatteryCount: 1,
  requireController: true,
  iotRequired: false,
  items,
  photoTypes: ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD'],
};
export const reasonSchema = z.string().trim().min(1).max(500);
export const modeSchema = z.enum([
  'SIMPLE',
  'ONBOARDING_EVIDENCE',
  'PREPARATION_QC',
]);
export const resultSchema = z.record(
  z.string(),
  z
    .object({
      result: z.enum(['PASS', 'FAIL', 'NA']),
      notes: z.string().trim().max(1000).default(''),
    })
    .strict(),
);
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      message: result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    });
  return result.data;
}
