import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ProductInput } from "@saha/shared";
import { Database } from "../database/database.service";
import { parseCatalogCsv } from "./csv";
@Injectable()
export class CatalogService {
  constructor(@Inject(Database) private readonly db: Database) {}
  private async protect<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException(
          "A product or variant already uses that SKU.",
        );
      throw e;
    }
  }
  list(userId: string, tenantId: string, q: string, page: number) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const where: Prisma.ProductWhereInput = {
        tenantId,
        ...(q
          ? {
              OR: ["sku", "nameEn", "nameSi", "nameTa"].map((field) => ({
                [field]: { contains: q, mode: "insensitive" },
              })),
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.product.findMany({
          where,
          include: { variants: { orderBy: { sku: "asc" } } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 25,
          skip: (page - 1) * 25,
        }),
        tx.product.count({ where }),
      ]);
      return { items, total, page, pages: Math.max(1, Math.ceil(total / 25)) };
    });
  }
  private async save(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: ProductInput,
    id?: string,
    merge = false,
  ) {
    if (
      id &&
      !(await tx.product.findUnique({
        where: { tenantId_id: { tenantId, id } },
      }))
    )
      throw new NotFoundException("Product not found.");
    const { variants, ...data } = input;
    const product = id
      ? await tx.product.update({
          where: { tenantId_id: { tenantId, id } },
          data,
        })
      : await tx.product.create({ data: { tenantId, ...data } });
    const keep: string[] = [];
    for (const variant of variants) {
      const { id: variantId, ...variantData } = variant;
      const existing = variantId
        ? await tx.productVariant.findUnique({
            where: { tenantId_id: { tenantId, id: variantId } },
          })
        : (merge || id)
          ? await tx.productVariant.findUnique({
              where: { tenantId_sku: { tenantId, sku: variant.sku } },
            })
          : null;
      if (
        (variantId && !existing) ||
        (existing && existing.productId !== product.id)
      )
        throw new BadRequestException(
          "Variant does not belong to this product.",
        );
      const saved = existing
        ? await tx.productVariant.update({
            where: { tenantId_id: { tenantId, id: existing.id } },
            data: variantData,
          })
        : await tx.productVariant.create({
            data: { tenantId, productId: product.id, ...variantData },
          });
      keep.push(saved.id);
    }
    if (!merge)
      await tx.productVariant.deleteMany({
        where: { tenantId, productId: product.id, id: { notIn: keep } },
      });
    return tx.product.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: product.id } },
      include: { variants: true },
    });
  }
  saveProduct(
    userId: string,
    tenantId: string,
    input: ProductInput,
    id?: string,
  ) {
    return this.protect(() =>
      this.db.forTenant(userId, tenantId, true, (tx) =>
        this.save(tx, tenantId, input, id),
      ),
    );
  }
  remove(userId: string, tenantId: string, id: string) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const result = await tx.product.deleteMany({ where: { tenantId, id } });
      if (!result.count) throw new NotFoundException("Product not found.");
      return { ok: true };
    });
  }
  preview(userId: string, tenantId: string, csv: string) {
    const products = parseCatalogCsv(csv);
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const existing = await tx.product.findMany({
        where: { tenantId, sku: { in: products.map((p) => p.sku) } },
        select: { sku: true },
      });
      return {
        products,
        productCount: products.length,
        variantCount: products.reduce((n, p) => n + p.variants.length, 0),
        creates: products.length - existing.length,
        updates: existing.length,
      };
    });
  }
  import(userId: string, tenantId: string, csv: string) {
    const products = parseCatalogCsv(csv);
    return this.protect(() =>
      this.db.forTenant(
        userId,
        tenantId,
        true,
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 2)`;
          for (const product of products) {
            const existing = await tx.product.findUnique({
              where: { tenantId_sku: { tenantId, sku: product.sku } },
            });
        await this.save(tx, tenantId, {...product, active: existing?.active ?? product.active}, existing?.id, true);
          }
          return {
            productCount: products.length,
            variantCount: products.reduce((n, p) => n + p.variants.length, 0),
          };
        },
        30000,
      ),
    );
  }
}
