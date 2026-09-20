-- Store the catalog discount percentage used to calculate a Feature Add-On's sale price.
ALTER TABLE "FeatureAddOn"
ADD COLUMN "discount" DECIMAL(5,2) NOT NULL DEFAULT 0;
