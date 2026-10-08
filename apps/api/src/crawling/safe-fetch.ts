import { Injectable } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
export class CrawlError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export type FetchResult = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};
export function publicWebsiteUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CrawlError("INVALID_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new CrawlError("UNSAFE_URL");
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    host === "localhost" ||
    (!host.includes(".") && !host.includes(":")) ||
    /\.(localhost|local|internal|test)$/.test(host)
  )
    throw new CrawlError("PRIVATE_DESTINATION");
  if (ipaddr.isValid(host) && !isPublicAddress(host))
    throw new CrawlError("PRIVATE_DESTINATION");
  url.hash = "";
  return url;
}
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublicAddress(
  hostname: string,
  resolver = lookup,
): Promise<LookupAddress> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: LookupAddress[];
  try {
    addresses = ipaddr.isValid(host)
      ? [
          {
            address: host,
            family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6,
          },
        ]
      : await Promise.race([
          resolver(host, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new CrawlError("DNS_TIMEOUT")),
              5000,
            );
          }),
        ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new CrawlError("PRIVATE_DESTINATION");
  return addresses[0];
}
@Injectable()
export class SafeFetcher {
  async fetch(
    value: string,
    hostname: string,
    allowed: (url: string) => boolean = () => true,
  ): Promise<FetchResult> {
    let url = publicWebsiteUrl(value);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (url.hostname !== hostname)
        throw new CrawlError("OFF_DOMAIN_REDIRECT");
      if (!allowed(url.href)) throw new CrawlError("ROBOTS_DISALLOWED");
      const address = await resolvePublicAddress(url.hostname);
      const result = await this.request(url, address);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location || redirects === 3)
          throw new CrawlError("REDIRECT_LIMIT");
        url = publicWebsiteUrl(new URL(result.location, url).href);
        continue;
      }
      return {
        url: url.href,
        status: result.status,
        contentType: result.contentType,
        body: result.body,
      };
    }
    throw new CrawlError("REDIRECT_LIMIT");
  }
  private request(
    url: URL,
    address: LookupAddress,
  ): Promise<FetchResult & { location?: string }> {
    return new Promise((resolve, reject) => {
      // Connect to the vetted IP while retaining the original Host and TLS server name.
      // No second DNS lookup is possible, including under DNS rebinding.
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          headers: {
            "User-Agent": "SahaBot/0.2",
            Accept: "text/html,text/plain",
            "Accept-Encoding": "identity",
          },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          let bytes = 0;
          if (
            res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity"
          ) {
            res.destroy();
            reject(new CrawlError("UNSUPPORTED_ENCODING"));
            return;
          }
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) {
              res.destroy(new CrawlError("PAGE_TOO_LARGE"));
              return;
            }
            parts.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              url: url.href,
              status: res.statusCode ?? 0,
              body: Buffer.concat(parts).toString("utf8"),
              contentType: res.headers["content-type"] ?? "",
              location: res.headers.location,
            }),
          );
        },
      );
      const timeout = setTimeout(
        () => req.destroy(new CrawlError("FETCH_TIMEOUT")),
        10000,
      );
      req.once("error", (error) =>
        reject(
          error instanceof CrawlError ? error : new CrawlError("FETCH_FAILED"),
        ),
      );
      req.once("close", () => clearTimeout(timeout));
      req.end();
    });
  }
}
