import { PhotoEntityType } from '@prisma/client';
export const paymentPhotoTypes = {
  DEPLOYMENT: PhotoEntityType.PAYMENT_DEPLOYMENT,
  COLLECTION: PhotoEntityType.PAYMENT_COLLECTION,
  AUTOPAY: PhotoEntityType.PAYMENT_AUTOPAY,
  RECEIVED: PhotoEntityType.PAYMENT_RECEIVED,
} as const;
export type PaymentSource = keyof typeof paymentPhotoTypes;
export const isPaymentPhoto = (type: PhotoEntityType | string) => Object.values(paymentPhotoTypes).includes(type as typeof paymentPhotoTypes[PaymentSource]);
