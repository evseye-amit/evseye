export declare const pinkridesStagingConfiguration: {
  featureOverrides: Array<{
    code: string;
    source: string;
    enabled: boolean;
    configuration: Record<string, unknown> | null;
  }>;
  paymentProviders: Array<{ environment: string }>;
  workflowOverrides: Array<{
    featureCode: string;
    configuration: Record<string, unknown>;
  }>;
  pricing: {
    setupDiscountPercent: string;
    vehicleDiscountPercent: string;
    setupDiscountValue: string;
    vehicleDiscountValue: string;
  };
};
