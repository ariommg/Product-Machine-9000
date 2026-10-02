export type ProductSpecification = {
  name: string;
  source?: string;
  value: string;
};

export type VariantOptionValue = {
  /** Supplier hex code for colour swatches without a picture, otherwise "". */
  hexColor: string;
  id: string;
  /** Full-size swatch picture, used as the image-generation reference. */
  imageUrl: string;
  name: string;
  /** Small swatch picture, for the UI and for AI naming. */
  thumbnailUrl: string;
};

export type VariantOption = {
  id: string;
  name: string;
  values: VariantOptionValue[];
  /**
   * The option the supplier shows as pictures or colour swatches. It is the one
   * that changes how the product looks, so it is the one images are generated for.
   * Decided from the supplier's own display type, never from the option's name.
   */
  visual: boolean;
};

/** One combination the supplier actually sells, keyed by option id to value id. */
export type VariantCombination = Record<string, string>;

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
  /** Combinations that exist. Empty means every combination is assumed to exist. */
  variantCombinations: VariantCombination[];
  /** Only options with at least two values. Single-value options are not a choice. */
  variantOptions: VariantOption[];
  videoUrls: string[];
};

export type DraftVariant = {
  /** Variant image URL, or "" when that colour has no approved hero. */
  imageUrl: string;
  /** One Swedish value per option, in the same order as ProductDraft.options. */
  optionValues: string[];
};

/** The reviewed, approved product that becomes one Shopify CSV entry. */
export type ProductDraft = {
  description: string;
  handle: string;
  imageUrls: string[];
  /** Approved option names, Option1 to Option3. Empty for a single-variant product. */
  options: string[];
  seoDescription: string;
  seoTitle: string;
  sourceUrl: string;
  specifications: ProductSpecification[];
  title: string;
  variants: DraftVariant[];
};
