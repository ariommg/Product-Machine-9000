export type ProductSpecification = {
  name: string;
  source?: string;
  value: string;
};

/** Facts pulled out of a saved supplier page. Nothing here is customer-facing yet. */
export type ExtractedProductData = {
  description: string;
  extractionNotes: string[];
  imageUrls: string[];
  leadTime: string;
  minimumOrderQuantity: string;
  packageDimensions: string;
  packageWeight: string;
  sourceUrl: string;
  specifications: ProductSpecification[];
  supplierName: string;
  supplierPrice: string;
  supplierSku: string;
  title: string;
  videoUrls: string[];
};

/** The reviewed, approved product that becomes one Shopify CSV entry. */
export type ProductDraft = {
  description: string;
  handle: string;
  imageUrls: string[];
  seoDescription: string;
  seoTitle: string;
  sourceUrl: string;
  specifications: ProductSpecification[];
  title: string;
};
