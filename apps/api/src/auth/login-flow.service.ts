import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FeatureCategory, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const LOGIN_APP_ROLES = {
  RIDER_APP: [UserRole.RIDER],
  CLIENT_PANEL: [UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER, UserRole.TEAM_LEAD, UserRole.KYC_OPERATOR],
  FLEET_MANAGER_APP: [UserRole.FLEET_MANAGER],
  TEAM_LEADER_APP: [UserRole.TEAM_LEAD],
} as const;

export type LoginAppCode = keyof typeof LOGIN_APP_ROLES;
type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};

@Injectable()
export class LoginFlowService {
  constructor(private readonly prisma: PrismaService) {}

  isAppCode(value: string): value is LoginAppCode {
    return Object.hasOwn(LOGIN_APP_ROLES, value);
  }

  roleAllowed(appCode: LoginAppCode, role: UserRole): boolean {
    return (LOGIN_APP_ROLES[appCode] as readonly UserRole[]).includes(role);
  }

  async resolve(companyCode: string, appCode: string) {
    if (!this.isAppCode(appCode)) throw new BadRequestException('Unsupported application.');
    const client = await this.prisma.client.findFirst({
      where: { OR: [{ companyCode }, { slug: companyCode }], isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Workspace unavailable.');
    const now = new Date();
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { clientId: client.id, status: 'ACTIVE', startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }], package: { isActive: true } },
      orderBy: { startDate: 'desc' },
      include: { package: { include: { features: {
        where: { isIncluded: true, feature: { isActive: true, category: FeatureCategory.LOGIN, featureStep: { isActive: true } } },
        include: { feature: { include: { featureStep: true } } },
      } } } },
    });
    if (!subscription) throw new NotFoundException('Login is unavailable for this workspace.');
    const features = subscription.package.features
      .filter(({ feature, configuration }) => {
        const scope = record(configuration).loginAppCodes ?? record(feature.configuration).loginAppCodes;
        return scope === undefined || (Array.isArray(scope) && scope.includes(appCode));
      })
      .map(({ feature, configuration, displayOrder }) => ({
        code: feature.code,
        stepCode: feature.featureStep?.code ?? 'LOGIN',
        stepName: feature.featureStep?.displayName ?? 'Login',
        stepOrder: feature.featureStep?.displayOrder ?? 0,
        order: displayOrder || feature.displayOrder,
        configuration: { ...record(feature.configuration), ...record(configuration) },
      }))
      .filter(({ configuration }) => configuration.enabled !== false)
      .sort((a, b) => a.order - b.order);
    const codes = new Set(features.map(({ code }) => code));
    if (!codes.has('CAPTURE_MOBILE_NUMBER') || !codes.has('CAPTURE_LOGIN_OTP') || !codes.has('SEND_OTP_VIA_SMS')) {
      throw new NotFoundException('No supported login method is configured for this workspace.');
    }
    const fields = features.filter(({ code }) => code === 'CAPTURE_MOBILE_NUMBER' || code === 'CAPTURE_LOGIN_OTP');
    const publicFields = fields.map(({ code, stepCode, order, configuration }) => ({
      featureCode: code,
      stepCode,
      order,
      label: String(configuration.label ?? (code === 'CAPTURE_MOBILE_NUMBER' ? 'Mobile number' : 'Six-digit OTP')),
      placeholder: String(configuration.placeholder ?? (code === 'CAPTURE_MOBILE_NUMBER' ? '10-digit mobile number' : '')),
      fieldType: code === 'CAPTURE_MOBILE_NUMBER' ? 'MOBILE' : 'OTP_DIGIT_INPUT',
      required: true,
    }));
    const version = createHash('sha256').update(JSON.stringify({ appCode, features })).digest('hex').slice(0, 16);
    const steps = [...new Map(features.map(({ stepCode, stepName, stepOrder }) => [stepCode, { code: stepCode, name: stepName, order: stepOrder }])).values()]
      .map((step) => ({ ...step, fields: publicFields.filter((field) => field.stepCode === step.code) }))
      .filter((step) => step.fields.length > 0)
      .sort((a, b) => a.order - b.order);
    return { appCode, version, steps, methods: ['SMS_OTP'] as const };
  }
}
