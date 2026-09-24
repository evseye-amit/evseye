-- Development cleanup: the former global Feature Add-On catalogue is no
-- longer a source of client entitlements. Remove its configuration and all
-- purchase-derived credits/history; package allowances and client features
-- remain untouched.
DELETE FROM "FeatureUsageLedger"
WHERE "sourceType" = 'FEATURE_ADDON';

DELETE FROM "FeatureCreditLot"
WHERE "sourceType" = 'FEATURE_ADDON';

DELETE FROM "ClientFeatureAddOnPurchase";
DELETE FROM "PackageFeatureAddOn";
DELETE FROM "FeatureAddOn";
