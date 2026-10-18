import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkflowResolverService } from '../workflow/workflow-resolver.service.js';
import { translatedProperty, type ApiLocale } from '../common/locale.js';

export const LOGIN_APP_ROLES = {
  RIDER_APP: [UserRole.RIDER],
  CLIENT_PANEL: [UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER, UserRole.TEAM_LEAD, UserRole.KYC_OPERATOR, UserRole.RFD_MANAGER, UserRole.QC_MANAGER],
  FLEET_MANAGER_APP: [UserRole.FLEET_MANAGER],
  TEAM_LEADER_APP: [UserRole.TEAM_LEAD],
} as const;
export type LoginAppCode = keyof typeof LOGIN_APP_ROLES;

@Injectable()
export class LoginFlowService {
  constructor(private readonly prisma: PrismaService, private readonly workflows: WorkflowResolverService) {}

  isAppCode(value: string): value is LoginAppCode { return Object.hasOwn(LOGIN_APP_ROLES, value); }
  roleAllowed(appCode: LoginAppCode, role: UserRole): boolean {
    return (LOGIN_APP_ROLES[appCode] as readonly UserRole[]).includes(role);
  }

  async resolve(companyCode: string, appCode: string, locale: ApiLocale = 'en') {
    if (!this.isAppCode(appCode)) throw new BadRequestException('Unsupported application.');
    const client = await this.prisma.client.findFirst({
      where: { OR: [{ companyCode }, { slug: companyCode }], isActive: true,
        status: { notIn: ['DRAFT', 'SUSPENDED'] } }, select: { id: true, requestedLocales: true },
    });
    if (!client) throw new NotFoundException('Workspace unavailable.');
    if (!client.requestedLocales.includes(locale)) locale = 'en';
    const resolved = await this.workflows.resolve(client.id, 'LOGIN', appCode);
    const features = resolved.components;
    const codes = new Set(features.map(({ featureCode }) => featureCode));
    if (!codes.has('CAPTURE_MOBILE_NUMBER') || !codes.has('CAPTURE_LOGIN_OTP') || !codes.has('SEND_OTP_VIA_SMS'))
      throw new NotFoundException('No supported login method is configured for this workspace.');
    const publicFields = features
      .filter(({ featureCode }) => featureCode === 'CAPTURE_MOBILE_NUMBER' || featureCode === 'CAPTURE_LOGIN_OTP')
      .map(({ featureCode, step, order, configuration, componentType, featureVersion }) => ({
        featureCode, featureVersion, stepCode: step.code, order,
        label: translatedProperty(String(configuration.label ?? (featureCode === 'CAPTURE_MOBILE_NUMBER' ? 'Mobile number' : 'Six-digit OTP')),
          configuration.translations, locale, 'label'),
        placeholder: translatedProperty(String(configuration.placeholder ?? (featureCode === 'CAPTURE_MOBILE_NUMBER' ? '10-digit mobile number' : '')),
          configuration.translations, locale, 'placeholder'),
        fieldType: componentType === 'FIELD' ? (featureCode === 'CAPTURE_MOBILE_NUMBER' ? 'MOBILE' : 'OTP_DIGIT_INPUT') : componentType,
        required: true,
      }));
    const steps = [...new Map(features.map(({ step }) => [step.code, step])).values()]
      .map((step) => ({ code: step.code, name: translatedProperty(step.name, step.translations, locale, 'displayName'), order: step.order,
        fields: publicFields.filter((field) => field.stepCode === step.code) }))
      .filter((step) => step.fields.length > 0)
      .sort((a, b) => a.order - b.order);
    return { appCode, version: resolved.version, packageVersion: resolved.packageVersion,
      rendererSchemaVersion: 1, steps, methods: ['SMS_OTP'] as const };
  }
}
