import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

function keys(): Record<string, string> {
  const parsed: unknown = JSON.parse(
    process.env.CHANNEL_ENCRYPTION_KEYS ?? "{}",
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("CHANNEL_KEYS_INVALID");
  return parsed as Record<string, string>;
}
function key(version: string) {
  const encoded = keys()[version];
  if (typeof encoded !== "string" || !/^[a-fA-F0-9]{64}$/.test(encoded))
    throw new Error("CHANNEL_KEY_UNAVAILABLE");
  return Buffer.from(encoded, "hex");
}
// Tenant, connection and purpose are authenticated along with the ciphertext.
export function encrypt(value: string, context: string) {
  const version = process.env.CHANNEL_ENCRYPTION_KEY_VERSION ?? "v1";
  if (!/^[a-zA-Z0-9_-]{1,30}$/.test(version))
    throw new Error("CHANNEL_KEY_VERSION_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(version), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string, context: string) {
  const parts = value.split(".");
  if (parts.length !== 4) throw new Error("CHANNEL_CIPHERTEXT_INVALID");
  const [version, iv, tag, payload] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(version),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export function verifySignature(raw: Buffer, header: unknown, secret: string) {
  if (
    !secret ||
    typeof header !== "string" ||
    !/^sha256=[a-fA-F0-9]{64}$/.test(header)
  )
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), "hex"));
}
export function sameSecret(one: unknown, two: string) {
  if (!two || typeof one !== "string") return false;
  const a = Buffer.from(one),
    b = Buffer.from(two);
  return a.length === b.length && timingSafeEqual(a, b);
}
