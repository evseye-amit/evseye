import { PhotoSubjectType, PhotoWorkflowType } from '@prisma/client';

export const paymentPhotoTypes = {
  DEPLOYMENT: PhotoSubjectType.OTHER,
  COLLECTION: PhotoSubjectType.COLLECTION,
  AUTOPAY: PhotoSubjectType.AUTOPAY,
  RECEIVED: PhotoSubjectType.OTHER,
} as const;
export type PaymentSource = keyof typeof paymentPhotoTypes;
export const paymentPhotoSubject = (source: string): PhotoSubjectType | undefined => Object.hasOwn(paymentPhotoTypes, source) ? paymentPhotoTypes[source as PaymentSource] : undefined;
export const isPaymentPhoto = (workflow: PhotoWorkflowType, subject: PhotoSubjectType) => workflow === PhotoWorkflowType.PAYMENT && Object.values(paymentPhotoTypes).includes(subject as typeof paymentPhotoTypes[PaymentSource]);
