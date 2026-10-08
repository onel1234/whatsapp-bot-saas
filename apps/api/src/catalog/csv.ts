import { BadRequestException } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { productSchema, lkrToMinor, type ProductInput } from "@saha/shared";
const columns = [
  "product_sku",
  "variant_sku",
  "name_en",
  "name_si",
  "name_ta",
  "description",
  "price_lkr",
  "stock",
  "attributes_json",
  "image_url",
  "active",
];
export function parseCatalogCsv(csv: string): ProductInput[] {
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, {
      bom: true,
      columns: (header: string[]) => {
        if (
          new Set(header).size !== header.length ||
          header.some((h) => !columns.includes(h)) ||
          ![
            "product_sku",
            "variant_sku",
            "name_en",
            "price_lkr",
            "stock",
          ].every((h) => header.includes(h))
        )
          throw new Error("Invalid columns");
        return header;
      },
      skip_empty_lines: true,
      trim: true,
      max_record_size: 20000,
    }) as Record<string, string>[];
  } catch {
    throw new BadRequestException(
      "Invalid CSV. Use the sample column headings and quote fields containing commas.",
    );
  }
  if (!rows.length || rows.length > 500)
    throw new BadRequestException(
      "Import between 1 and 500 variant rows at a time.",
    );
  const products = new Map<string, ProductInput>();
  const variantSkus = new Set<string>();
  rows.forEach((row, index) => {
    try {
      if (!/^\d{1,7}$/.test(row.stock))
        throw new Error("Stock must be a whole number.");
      if (row.active && !["true", "false"].includes(row.active.toLowerCase()))
        throw new Error("Active must be true or false.");
      const variant = {
        sku: row.variant_sku,
        priceMinor: lkrToMinor(row.price_lkr),
        stock: Number(row.stock),
        attributes: row.attributes_json ? JSON.parse(row.attributes_json) : {},
        active: row.active?.toLowerCase() !== "false",
      };
      const candidate = productSchema.parse({
        sku: row.product_sku,
        nameEn: row.name_en,
        nameSi: row.name_si ?? "",
        nameTa: row.name_ta ?? "",
        description: row.description ?? "",
        imageUrl: row.image_url ?? "",
        active: true,
        variants: [variant],
      });
      if (variantSkus.has(candidate.variants[0].sku))
        throw new Error("Duplicate variant SKU.");
      variantSkus.add(candidate.variants[0].sku);
      const existing = products.get(candidate.sku);
      if (existing) {
        const first = { ...existing, variants: undefined };
        const second = { ...candidate, variants: undefined };
        if (JSON.stringify(first) !== JSON.stringify(second))
          throw new Error(
            "Rows for the same product must have matching names, description and image.",
          );
        existing.variants.push(candidate.variants[0]);
        if (existing.variants.length > 50)
          throw new Error("A product can have at most 50 variants.");
      } else products.set(candidate.sku, candidate);
    } catch (error) {
      const reason =
        error instanceof Error && !("issues" in error)
          ? error.message
          : "Check names, SKUs, price, stock, image URL and attributes.";
      throw new BadRequestException(`CSV row ${index + 2}: ${reason}`);
    }
  });
  return [...products.values()];
}
