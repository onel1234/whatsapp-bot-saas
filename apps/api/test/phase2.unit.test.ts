import { describe, it, expect, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { parseCatalogCsv } from "../src/catalog/csv";
import { productSchema, lkrToMinor, websiteSchema } from "@saha/shared";
import {
  DevelopmentEmbeddingProvider,
  chunkText,
  vectorLiteral,
} from "../src/embeddings/provider";
import {
  SafeFetcher,
  publicWebsiteUrl,
  isPublicAddress,
  resolvePublicAddress,
  type FetchResult,
} from "../src/crawling/safe-fetch";
import { WebsiteCrawler, extractPage } from "../src/crawling/crawler";
describe("catalog validation and import", () => {
  it("bounds stalled DNS resolution", async () => {
    vi.useFakeTimers();
    try {
      const result = resolvePublicAddress(
        "shop.example.com",
        (() =>
          new Promise(() => {})) as typeof import("node:dns/promises").lookup,
      );
      const assertion = expect(result).rejects.toThrow("DNS_TIMEOUT");
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps prices in exact minor units and refuses invalid amounts and stock", () => {
    expect(lkrToMinor("1999.99")).toBe(199999);
    expect(lkrToMinor("0.10")).toBe(10);
    for (const price of ["-1", "1.234", "1e3", "NaN", "1,000.00"])
      expect(() => lkrToMinor(price)).toThrow();
    expect(
      productSchema.safeParse({
        sku: "TEA",
        nameEn: "Tea",
        variants: [{ sku: "TEA", priceMinor: 1.5, stock: 2 }],
      }).success,
    ).toBe(false);
  });
  it("handles BOM, quoted multilingual names, and multiple variants", () => {
    const products = parseCatalogCsv(
      '\ufeffproduct_sku,variant_sku,name_en,name_si,name_ta,price_lkr,stock,attributes_json\nTEA,TEA-S,"Tea, Ceylon",තේ,தேநீர்,10.05,4,"{""size"":""small""}"\nTEA,TEA-L,"Tea, Ceylon",තේ,தேநீர்,20,7,"{""size"":""large""}"',
    );
    expect(products).toHaveLength(1);
    expect(products[0].variants).toHaveLength(2);
    expect(products[0].variants[0].priceMinor).toBe(1005);
    expect(products[0].nameSi).toBe("තේ");
  });
  it("rejects duplicate headers/SKUs, inconsistent product metadata and malformed rows", () => {
    const header = "product_sku,variant_sku,name_en,price_lkr,stock\n";
    for (const csv of [
      header + "A,X,Tea,10,1\nB,X,Coffee,10,1",
      header + "A,X,Tea,10,1\nA,Y,Coffee,10,1",
      header + "A,X,Tea,10,-1",
      "product_sku,variant_sku,name_en,name_en,price_lkr,stock\nA,X,Tea,Tea,10,1",
      header,
    ])
      expect(() => parseCatalogCsv(csv)).toThrow();
  });
});
describe("crawl network boundaries", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks private or reserved address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("blocks credential URLs, non-HTTP protocols, custom ports and encoded loopback", () => {
    for (const url of [
      "http://localhost",
      "http://2130706433",
      "http://0x7f000001",
      "http://[::1]",
      "http://8.8.8.8:1234",
      "https://user:password@example.com",
      "file:///etc/passwd",
    ])
      expect(() => publicWebsiteUrl(url)).toThrow();
    expect(publicWebsiteUrl("https://example.com/path#fragment").href).toBe(
      "https://example.com/path",
    );
    expect(
      websiteSchema.safeParse({ url: "https://example.com", pageLimit: 51 })
        .success,
    ).toBe(false);
  });
  it("rejects a DNS answer set containing a private address, including rebinding", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolvePublicAddress("example.com", resolver)).rejects.toThrow(
      "PRIVATE_DESTINATION",
    );
    resolver.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    expect((await resolvePublicAddress("example.com", resolver)).address).toBe(
      "8.8.8.8",
    );
    resolver.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(resolvePublicAddress("example.com", resolver)).rejects.toThrow(
      "PRIVATE_DESTINATION",
    );
  });
  it("rechecks redirect destinations and robots paths before requesting them", async () => {
    const fetcher = new SafeFetcher();
    const transport = vi.spyOn(
      fetcher as unknown as {
        request: (
          url: URL,
          address: LookupAddress,
        ) => Promise<FetchResult & { location?: string }>;
      },
      "request",
    );
    transport.mockResolvedValue({
      url: "",
      status: 302,
      contentType: "",
      body: "",
      location: "http://127.0.0.1/admin",
    });
    await expect(fetcher.fetch("https://8.8.8.8", "8.8.8.8")).rejects.toThrow(
      "PRIVATE_DESTINATION",
    );
    transport.mockResolvedValue({
      url: "",
      status: 302,
      contentType: "",
      body: "",
      location: "https://example.com",
    });
    await expect(fetcher.fetch("https://8.8.8.8", "8.8.8.8")).rejects.toThrow(
      "OFF_DOMAIN_REDIRECT",
    );
    transport.mockResolvedValue({
      url: "",
      status: 302,
      contentType: "",
      body: "",
      location: "/private",
    });
    await expect(
      fetcher.fetch(
        "https://8.8.8.8",
        "8.8.8.8",
        (url) => !url.includes("/private"),
      ),
    ).rejects.toThrow("ROBOTS_DISALLOWED");
  });
});
describe("bounded, reviewed knowledge extraction", () => {
  it("extracts plain content and omits scripts, navigation and hidden text", () => {
    const result = extractPage(
      '<title>Delivery</title><nav>Ignore this navigation</nav><main><h1>Delivery</h1><p>Colombo only</p><script>stealSecrets()</script><span hidden>hidden text</span><a href="/faq">FAQ</a></main>',
      "https://shop.example.com",
    );
    expect(result.content).toContain("Colombo only");
    expect(result.content).not.toContain("stealSecrets");
    expect(result.content).not.toContain("hidden text");
    expect(result.links).toEqual(["/faq"]);
  });
  it("respects robots, same-host links, depth, and page limits", async () => {
    const urls: string[] = [];
    const fetcher = {
      fetch: vi.fn(async (url: string) => {
        urls.push(url);
        if (url.endsWith("/robots.txt"))
          return {
            url,
            status: 200,
            contentType: "text/plain",
            body: "User-agent: *\nDisallow: /private",
          };
        return {
          url,
          status: 200,
          contentType: "text/html",
          body: '<main><p>Useful business details</p><a href="/private">Private</a><a href="/faq">FAQ</a><a href="https://offsite.example.com/">Offsite</a><a href="/more">More</a></main>',
        };
      }),
    } as unknown as SafeFetcher;
    const pages: string[] = [];
    const result = await new WebsiteCrawler(fetcher).crawl(
      { url: "https://shop.example.com/", pageLimit: 3, depthLimit: 1 },
      async (p) => {
        pages.push(p.url);
      },
    );
    expect(pages).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/faq",
    ]);
    expect(
      urls.some(
        (u) =>
          u.includes("offsite") ||
          u.endsWith("/private") ||
          u.endsWith("/more"),
      ),
    ).toBe(false);
    expect(result.skippedCount).toBe(1);
  });
  it("fails closed when robots cannot be read or forbids the root", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://shop.example.com/robots.txt",
      status: 403,
      contentType: "text/plain",
      body: "",
    });
    const crawler = new WebsiteCrawler({ fetch } as unknown as SafeFetcher);
    await expect(
      crawler.crawl(
        { url: "https://shop.example.com/", pageLimit: 5, depthLimit: 2 },
        async () => {},
      ),
    ).rejects.toThrow("ROBOTS_UNAVAILABLE");
    fetch.mockResolvedValue({
      url: "https://shop.example.com/robots.txt",
      status: 200,
      contentType: "text/plain",
      body: "User-agent: *\nDisallow: /",
    });
    await expect(
      crawler.crawl(
        { url: "https://shop.example.com/", pageLimit: 5, depthLimit: 2 },
        async () => {},
      ),
    ).rejects.toThrow("ROBOTS_DISALLOWED");
  });
  it("chunks Unicode without breaking code points and generates deterministic normalized vectors", async () => {
    const chunks = chunkText("සිංහල தமிழ் 🌿 ".repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("\ufffd"))).toBe(false);
    const provider = new DevelopmentEmbeddingProvider();
    const a = await provider.embed("delivery Colombo");
    expect(a).toEqual(await provider.embed("delivery Colombo"));
    expect(a).toHaveLength(64);
    expect(a.reduce((n, v) => n + v * v, 0)).toBeCloseTo(1);
    expect(() => vectorLiteral([NaN], 1)).toThrow();
    expect(() => chunkText("text", 1, 1)).toThrow();
  });
});
