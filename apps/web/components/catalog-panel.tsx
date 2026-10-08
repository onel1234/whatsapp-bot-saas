"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  Plus,
  Package,
  Search,
  Upload,
  ArrowRight,
  X,
  Check,
  Trash2,
  Pencil,
  Download,
} from "lucide-react";
import {
  lkrToMinor,
  type ProductRecord,
  type ProductInput,
} from "@saha/shared";
import { api } from "../lib/api";
type CatalogPage = {
  items: ProductRecord[];
  total: number;
  page: number;
  pages: number;
};
type VariantDraft = {
  id?: string;
  sku: string;
  price: string;
  stock: string;
  attributes: string;
  active: boolean;
};
type Preview = {
  products: ProductInput[];
  productCount: number;
  variantCount: number;
  creates: number;
  updates: number;
};
const money = (minor: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(
    minor / 100,
  );
const blankVariant = (): VariantDraft => ({
  sku: "",
  price: "",
  stock: "0",
  attributes: "{}",
  active: true,
});
export default function CatalogPanel({
  tenantId,
  owner,
}: {
  tenantId: string;
  owner: boolean;
}) {
  const [data, setData] = useState<CatalogPage>({
    items: [],
    total: 0,
    page: 1,
    pages: 1,
  });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProductRecord | null | undefined>(
    undefined,
  );
  const [variants, setVariants] = useState<VariantDraft[]>([blankVariant()]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleting, setDeleting] = useState<ProductRecord | null>(null);
  const path = `/tenants/${tenantId}/catalog`;
  async function refresh() {
    const result = await api<CatalogPage>(
      `${path}?page=${page}&q=${encodeURIComponent(search)}`,
    );
    setData(result);
  }
  useEffect(() => {
    let current = true;
    if (!owner) return;
    setLoading(true);
    api<CatalogPage>(`${path}?page=${page}&q=${encodeURIComponent(search)}`)
      .then((r) => {
        if (current) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, page, search, owner]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function open(product: ProductRecord | null) {
    setEditing(product);
    setVariants(
      product
        ? product.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            price: (v.priceMinor / 100).toFixed(2),
            stock: String(v.stock),
            attributes: JSON.stringify(v.attributes),
            active: v.active,
          }))
        : [blankVariant()],
    );
    setImporting(false);
    setError("");
    setNotice("");
  }
  function updateVariant(index: number, change: Partial<VariantDraft>) {
    setVariants((v) =>
      v.map((item, i) => (i === index ? { ...item, ...change } : item)),
    );
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void action(async () => {
      const sku = String(form.get("sku"));
      const payload = {
        sku,
        nameEn: String(form.get("nameEn")),
        nameSi: String(form.get("nameSi")),
        nameTa: String(form.get("nameTa")),
        description: String(form.get("description")),
        imageUrl: String(form.get("imageUrl")),
        active: form.has("active"),
        variants: variants.map((v) => {
          if (!/^\d+$/.test(v.stock))
            throw new Error("Stock must be a nonnegative whole number.");
          return {
            id: v.id,
            sku: v.sku || (variants.length === 1 ? sku : ""),
            priceMinor: lkrToMinor(v.price),
            stock: Number(v.stock),
            attributes: JSON.parse(v.attributes),
            active: v.active,
          };
        }),
      };
      await api(editing ? `${path}/${editing.id}/save` : path, payload);
      setEditing(undefined);
      await refresh();
      setNotice("Product saved. Prices and stock are now in your catalog.");
    });
  }
  if (!owner)
    return (
      <section className="card coming-card">
        <Package />
        <h2>Your owner manages the catalog.</h2>
        <p>Ask a workspace owner to add products, prices, and availability.</p>
      </section>
    );
  return (
    <section className="catalog-panel">
      <div className="panel-toolbar">
        <div>
          <h2>Your products, in one place.</h2>
          <p>
            Accurate prices. Clear availability. A catalog your customers can
            count on.
          </p>
        </div>
        <div className="toolbar-actions">
          <button
            className="button secondary"
            onClick={() => {
              setImporting(!importing);
              setEditing(undefined);
              setPreview(null);
              setError("");
            }}
          >
            <Upload size={15} />
            Import CSV
          </button>
          <button className="button primary" onClick={() => open(null)}>
            <Plus size={16} />
            Add product
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {editing !== undefined && (
        <section className="card product-editor">
          <div className="section-title">
            <h3>
              {editing ? "Edit product" : "A new addition to your catalog."}
            </h3>
            <button
              className="icon-button"
              aria-label="Close product editor"
              onClick={() => setEditing(undefined)}
            >
              <X size={18} />
            </button>
          </div>
          <form key={editing?.id ?? "new"} onSubmit={save}>
            <div className="form-grid">
              <label>
                Product name · English
                <input
                  name="nameEn"
                  defaultValue={editing?.nameEn}
                  required
                  maxLength={200}
                  placeholder="e.g. Ceylon black tea"
                />
              </label>
              <label>
                Product SKU
                <input
                  name="sku"
                  defaultValue={editing?.sku}
                  required
                  pattern={"[a-zA-Z0-9_\\-]+"}
                  maxLength={60}
                  placeholder="TEA-001"
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Product name · Sinhala
                <input
                  name="nameSi"
                  defaultValue={editing?.nameSi}
                  maxLength={200}
                  placeholder="Optional"
                />
              </label>
              <label>
                Product name · Tamil
                <input
                  name="nameTa"
                  defaultValue={editing?.nameTa}
                  maxLength={200}
                  placeholder="Optional"
                />
              </label>
            </div>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={editing?.description}
                maxLength={5000}
                rows={3}
                placeholder="What should customers know about this product?"
              />
            </label>
            <label>
              Image URL
              <input
                name="imageUrl"
                defaultValue={editing?.imageUrl}
                type="url"
                placeholder="https://your-website.lk/image.jpg"
              />
            </label>
            <label className="check-label">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              Product is available in the catalog
            </label>
            <div className="section-title variant-heading">
              <h3>Prices & variants</h3>
              <button
                type="button"
                className="text-button"
                onClick={() => setVariants((v) => [...v, blankVariant()])}
                disabled={variants.length >= 50}
              >
                <Plus size={14} />
                Add variant
              </button>
            </div>
            <p className="form-hint">
              Add a size or color as a variant. With one variant, its SKU can
              use the product SKU.
            </p>
            {variants.map((v, index) => (
              <div className="variant-editor" key={index}>
                <div className="variant-fields">
                  <label>
                    Variant SKU
                    <input
                      value={v.sku}
                      onChange={(e) =>
                        updateVariant(index, { sku: e.target.value })
                      }
                      required={variants.length > 1}
                      pattern={"[a-zA-Z0-9_\\-]+"}
                      maxLength={60}
                      placeholder={
                        variants.length === 1 ? "Use product SKU" : "TEA-100G"
                      }
                    />
                  </label>
                  <label>
                    Price · LKR
                    <input
                      value={v.price}
                      onChange={(e) =>
                        updateVariant(index, { price: e.target.value })
                      }
                      required
                      inputMode="decimal"
                      pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
                      placeholder="1250.00"
                    />
                  </label>
                  <label>
                    Stock
                    <input
                      value={v.stock}
                      onChange={(e) =>
                        updateVariant(index, { stock: e.target.value })
                      }
                      required
                      inputMode="numeric"
                      pattern="[0-9]+"
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove variant ${index + 1}`}
                    onClick={() =>
                      setVariants((items) =>
                        items.filter((_v, i) => i !== index),
                      )
                    }
                    disabled={variants.length === 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="variant-details">
                  <label>
                    Attributes
                    <input
                      value={v.attributes}
                      onChange={(e) =>
                        updateVariant(index, { attributes: e.target.value })
                      }
                      placeholder={'{"size":"100g"}'}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={v.active}
                      onChange={(e) =>
                        updateVariant(index, { active: e.target.checked })
                      }
                    />
                    Active variant
                  </label>
                </div>
              </div>
            ))}
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save product"}
              <Check size={16} />
            </button>
          </form>
        </section>
      )}
      {importing && (
        <section className="card import-card">
          <div className="section-title">
            <h3>Bring your catalog with you.</h3>
            <a className="text-button" href="/sample-catalog.csv" download>
              <Download size={14} />
              Sample CSV
            </a>
          </div>
          <p>
            One row per variant. Upload up to 500 rows, preview the changes,
            then import. Existing SKUs update prices and stock; other variants
            stay as they are.
          </p>
          <label>
            Choose a CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 500000) {
                  setError("Choose a CSV file smaller than 500 KB.");
                  return;
                }
                void file.text().then((text) => {
                  setCsv(text);
                  setPreview(null);
                  setError("");
                });
              }}
            />
          </label>
          <label>
            CSV contents
            <textarea
              rows={5}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
              placeholder="product_sku,variant_sku,name_en,price_lkr,stock"
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !csv.trim()}
            onClick={() =>
              void action(async () => {
                setPreview(
                  await api<Preview>(`${path}/import/preview`, { csv }),
                );
              })
            }
          >
            Preview import <ArrowRight size={15} />
          </button>
          {preview && (
            <div className="import-preview">
              <div className="import-summary">
                <strong>
                  {preview.productCount} products · {preview.variantCount}{" "}
                  variants
                </strong>
                <span>
                  {preview.creates} new · {preview.updates} existing products
                  updated
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Variant SKU</th>
                      <th>Price</th>
                      <th>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.slice(0, 10).flatMap((p) =>
                      p.variants.map((v) => (
                        <tr key={v.sku}>
                          <td>{p.nameEn}</td>
                          <td>{v.sku}</td>
                          <td>{money(v.priceMinor)}</td>
                          <td>{v.stock}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="form-hint">
                Showing the first 10 products. The full file was validated.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await api<{ productCount: number }>(
                      `${path}/import`,
                      { csv },
                    );
                    setImporting(false);
                    setPreview(null);
                    setCsv("");
                    await refresh();
                    setNotice(
                      `${result.productCount} products imported successfully.`,
                    );
                  })
                }
              >
                Confirm import <Check size={15} />
              </button>
            </div>
          )}
        </section>
      )}
      <section className="card catalog-list">
        <div className="list-header">
          <span>
            {data.total} product{data.total !== 1 ? "s" : ""}
          </span>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query);
              setPage(1);
            }}
          >
            <Search size={16} />
            <input
              aria-label="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names or SKUs"
            />
            <button className="button small secondary">Search</button>
          </form>
        </div>
        {loading ? (
          <div className="empty-state" role="status">
            Loading your catalog…
          </div>
        ) : data.items.length === 0 ? (
          <div className="empty-state">
            <div className="next-icon">
              <Package size={25} />
            </div>
            <h3>
              {search
                ? "No matching products."
                : "Your next bestseller starts here."}
            </h3>
            <p>
              {search
                ? "Try another name or SKU."
                : "Add your first product or bring in a CSV catalog."}
            </p>
            {!search && (
              <button className="button secondary" onClick={() => open(null)}>
                Add your first product <Plus size={15} />
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price · LKR</th>
                  <th>Availability</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="product-name">
                        <span className="product-letter">
                          {p.nameEn.charAt(0)}
                        </span>
                        <div>
                          <strong>{p.nameEn}</strong>
                          <small>
                            {p.sku} · {p.variants.length} variant
                            {p.variants.length !== 1 ? "s" : ""}
                          </small>
                          {(p.nameSi || p.nameTa) && (
                            <small>
                              {[p.nameSi, p.nameTa].filter(Boolean).join(" · ")}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {money(Math.min(...p.variants.map((v) => v.priceMinor)))}
                      {p.variants.length > 1 && (
                        <small className="cell-note">from</small>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          p.variants.reduce(
                            (n, v) => n + (v.active ? v.stock : 0),
                            0,
                          )
                            ? "stock-positive"
                            : "stock-zero"
                        }
                      >
                        {p.variants.reduce(
                          (n, v) => n + (v.active ? v.stock : 0),
                          0,
                        )}{" "}
                        in stock
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${p.active ? "" : "muted"}`}>
                        {p.active ? "Active" : "Hidden"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Edit ${p.nameEn}`}
                          onClick={() => open(p)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`Delete ${p.nameEn}`}
                          onClick={() => setDeleting(p)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            Page {data.page} of {data.pages}
          </span>
          <div>
            <button
              className="button small secondary"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="button small secondary"
              disabled={page >= data.pages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {deleting && (
        <div className="modal-backdrop">
          <section
            className="card confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-product-title"
          >
            <h2 id="delete-product-title">Remove {deleting.nameEn}?</h2>
            <p>This removes the product and its variants from your catalog.</p>
            <div className="toolbar-actions">
              <button
                className="button secondary"
                onClick={() => setDeleting(null)}
              >
                Keep product
              </button>
              <button
                className="button danger-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`${path}/${deleting.id}/delete`, {});
                    setDeleting(null);
                    await refresh();
                    setNotice("Product removed.");
                  })
                }
              >
                Remove product
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
