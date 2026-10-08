import { Inject, Injectable } from "@nestjs/common";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { CrawlError, SafeFetcher, publicWebsiteUrl } from "./safe-fetch";
export type CrawledPage = { url: string; title: string; content: string };
export type CrawlConfig = {
  url: string;
  pageLimit: number;
  depthLimit: number;
};
export function extractPage(
  html: string,
  url: string,
): CrawledPage & { links: string[] } {
  const $ = load(html);
  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    new URL(url).pathname;
  $(
    'script,style,noscript,template,nav,header,footer,form,iframe,svg,[hidden],[aria-hidden="true"]',
  ).remove();
  const links = $("a[href]")
    .toArray()
    .map((element) => $(element).attr("href") ?? "");
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4,section,div").each((_i, element) => {
    $(element).append("\n");
  });
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const content = root
    .text()
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim()
    .slice(0, 20000);
  return { url, title: title.slice(0, 200), content, links };
}
@Injectable()
export class WebsiteCrawler {
  constructor(@Inject(SafeFetcher) private readonly fetcher: SafeFetcher) {}
  async crawl(
    config: CrawlConfig,
    onPage: (page: CrawledPage) => Promise<void>,
  ) {
    const root = publicWebsiteUrl(config.url);
    root.search = "";
    const robotsUrl = new URL("/robots.txt", root).href;
    const robotsResponse = await this.fetcher.fetch(robotsUrl, root.hostname);
    if (robotsResponse.status !== 404 && robotsResponse.status !== 200)
      throw new CrawlError("ROBOTS_UNAVAILABLE");
    const robots = robotsParser(
      robotsUrl,
      robotsResponse.status === 404 ? "" : robotsResponse.body,
    );
    const allowed = (url: string) => robots.isAllowed(url, "SahaBot") !== false;
    if (!allowed(root.href)) throw new CrawlError("ROBOTS_DISALLOWED");
    const crawlDelay = Math.max(
      500,
      (robots.getCrawlDelay("SahaBot") ?? 0) * 1000,
    );
    if (crawlDelay > 30000) throw new CrawlError("CRAWL_DELAY_TOO_LONG");
    const pending = [{ url: root.href, depth: 0 }];
    const visited = new Set<string>();
    const scheduled = new Set([root.href]);
    let pageCount = 0;
    let skippedCount = 0;
    const started = Date.now();
    while (pending.length && visited.size < config.pageLimit) {
      if (Date.now() - started > 120000) {
        skippedCount += pending.length;
        break;
      }
      const item = pending.shift()!;
      if (visited.has(item.url)) continue;
      visited.add(item.url);
      if (!allowed(item.url)) {
        skippedCount++;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, crawlDelay));
      try {
        const response = await this.fetcher.fetch(
          item.url,
          root.hostname,
          allowed,
        );
        if (
          response.status !== 200 ||
          !/text\/html|application\/xhtml\+xml/i.test(response.contentType)
        ) {
          skippedCount++;
          continue;
        }
        const page = extractPage(response.body, response.url);
        if (page.content) {
          await onPage(page);
          pageCount++;
        } else skippedCount++;
        if (item.depth < config.depthLimit)
          for (const href of page.links) {
            try {
              const link = publicWebsiteUrl(new URL(href, response.url).href);
              link.search = "";
              if (
                link.hostname !== root.hostname ||
                scheduled.has(link.href) ||
                scheduled.size >= config.pageLimit * 5
              )
                continue;
              scheduled.add(link.href);
              pending.push({ url: link.href, depth: item.depth + 1 });
            } catch {
              /* Unsafe, mail, anchor-only and non-HTTP links never enter the queue. */
            }
          }
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error; // Storage errors are retryable; do not report a successful crawl.
        if (item.depth === 0) throw error;
        skippedCount++;
      }
    }
    if (!pageCount) throw new CrawlError("NO_TEXT_CONTENT");
    return { pageCount, skippedCount };
  }
}
