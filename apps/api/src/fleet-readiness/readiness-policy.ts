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
export const stageDefinitionSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),
    name: z.string().trim().min(1).max(100),
    component: z.enum(['NONE', 'BATTERY', 'CONTROLLER', 'IOT']),
    dependencies: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/)).max(20),
    hubIds: z.array(z.string().uuid()).max(100).default([]),
    vehicleTypeIds: z.array(z.string().uuid()).max(100).default([]),
    verificationRequired: z.boolean(),
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
      .max(40),
    photoTypes: z
      .array(z.string().regex(/^[A-Z0-9_]{1,60}$/))
      .min(1)
      .max(20),
  })
  .strict();
export type StageDefinition = z.infer<typeof stageDefinitionSchema>;
export const defaultStages: StageDefinition[] = [
  {
    code: 'INTAKE',
    name: 'Basic vehicle intake',
    component: 'NONE',
    dependencies: [],
    hubIds: [],
    vehicleTypeIds: [],
    verificationRequired: false,
    items: [
      {
        code: 'IDENTITY',
        label: 'Confirm vehicle identity and basic condition',
        required: true,
        allowNA: false,
      },
    ],
    photoTypes: ['FRONT', 'CHASSIS'],
  },
  ...(['BATTERY', 'CONTROLLER'] as const).map((component) => ({
    code: component,
    name:
      component === 'BATTERY'
        ? 'Battery installation / confirmation'
        : 'Controller installation / confirmation',
    component,
    dependencies: ['INTAKE'],
    hubIds: [],
    vehicleTypeIds: [],
    verificationRequired: false,
    items: [
      {
        code: 'INSTALLATION',
        label: 'Installed component and serial confirmed',
        required: true,
        allowNA: false,
      },
    ],
    photoTypes: ['INSTALLATION', 'LABEL'],
  })),
];
export function validateStages(stages: StageDefinition[]) {
  const map = new Map(stages.map((s) => [s.code, s]));
  if (map.size !== stages.length)
    throw new BadRequestException('Stage codes must be unique.');
  const visited = new Set<string>(),
    active = new Set<string>();
  const visit = (code: string) => {
    if (active.has(code))
      throw new BadRequestException(
        'Stage dependencies cannot contain a cycle.',
      );
    if (visited.has(code)) return;
    const stage = map.get(code);
    if (!stage)
      throw new BadRequestException('Unknown stage dependency: ' + code);
    if (
      new Set(stage.items.map((i) => i.code)).size !== stage.items.length ||
      new Set(stage.photoTypes).size !== stage.photoTypes.length ||
      new Set(stage.dependencies).size !== stage.dependencies.length
    )
      throw new BadRequestException(
        'Duplicate stage checklist, photo or dependency.',
      );
    active.add(code);
    stage.dependencies.forEach(visit);
    active.delete(code);
    visited.add(code);
  };
  stages.forEach((s) => visit(s.code));
  for (const stage of stages)
    for (const code of stage.dependencies) {
      const dependency = map.get(code)!;
      for (const key of ['hubIds', 'vehicleTypeIds'] as const)
        if (
          dependency[key].length &&
          (!stage[key].length ||
            stage[key].some((id) => !dependency[key].includes(id)))
        )
          throw new BadRequestException(
            'A prerequisite must apply to every hub and vehicle type of its dependent stage.',
          );
    }
}
export const policySchema = z
  .object({
    stages: z.array(stageDefinitionSchema).max(20).default([]),
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
  stages: [],
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
  'STAGED_PREPARATION_QC',
]);
export type FleetReadinessMode = z.infer<typeof modeSchema>;
export type VehicleReadinessBlockerCode =
  | 'STATUS'
  | 'ADMIN_DISABLED'
  | 'ACTIVATION_INCOMPLETE'
  | 'PREPARATION_QC_REQUIRED'
  | 'UNFINISHED_ALLOCATION';
export type VehicleReadinessBlocker = {
  code: VehicleReadinessBlockerCode;
  message: string;
};
export type VehicleReadinessReport = {
  ready: boolean;
  blockers: VehicleReadinessBlocker[];
  nextStep: string;
};
export type VehicleReadinessInput = {
  operatingMode: FleetReadinessMode;
  status: string;
  allocationEnabled: boolean;
  onboardingStatus: string;
  readinessApprovedPreparationId: string | null;
  unfinishedAllocationCount: number;
};

const qcModes: FleetReadinessMode[] = [
  'PREPARATION_QC',
  'STAGED_PREPARATION_QC',
];
const readyNextStep = 'Use the Fleet Manager app to allocate this scooter.';

export function vehicleReadiness(
  input: VehicleReadinessInput,
): VehicleReadinessReport {
  const blockers: VehicleReadinessBlocker[] = [];
  let nextStep = readyNextStep;
  const add = (
    code: VehicleReadinessBlockerCode,
    message: string,
    step: string,
  ) => {
    if (blockers.length === 0) nextStep = step;
    blockers.push({ code, message });
  };

  if (input.status !== 'AVAILABLE') {
    const step =
      input.status === 'IN_TRANSIT'
        ? 'Mark the scooter received.'
        : input.status === 'PENDING_ACTIVATION'
          ? 'Complete fleet activation.'
          : input.status === 'INSPECTION_PENDING' &&
              qcModes.includes(input.operatingMode)
            ? 'Complete preparation and QC approval.'
            : `Resolve the scooter's ${input.status} state before allocation.`;
    add('STATUS', `Scooter status is ${input.status}.`, step);
  }
  if (!input.allocationEnabled)
    add(
      'ADMIN_DISABLED',
      'Allocation is administratively disabled.',
      'Enable allocation for this scooter.',
    );
  if (input.onboardingStatus !== 'ACTIVE')
    add(
      'ACTIVATION_INCOMPLETE',
      'Fleet activation is incomplete.',
      'Complete fleet activation.',
    );
  if (
    qcModes.includes(input.operatingMode) &&
    !input.readinessApprovedPreparationId
  )
    add(
      'PREPARATION_QC_REQUIRED',
      'Preparation and QC approval are required.',
      'Complete preparation and QC approval.',
    );
  if (input.unfinishedAllocationCount > 0)
    add(
      'UNFINISHED_ALLOCATION',
      'Scooter has an unfinished allocation.',
      'Finish the current allocation workflow.',
    );

  return { ready: blockers.length === 0, blockers, nextStep };
}
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
