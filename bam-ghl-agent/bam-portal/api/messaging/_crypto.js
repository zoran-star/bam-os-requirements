// App-layer secret encryption for messaging credentials (Twilio auth token / API
// secret). AES-256-GCM. The key comes from env MESSAGING_ENC_KEY (accepts 64-hex,
// 32-byte base64, or any string -> sha256 to 32 bytes). Ciphertext is stored as
// base64(iv[12] | tag[16] | ciphertext) in client_twilio_config.*_enc columns.
import crypto from "node:crypto";

function key() {
  const raw = (process.env.MESSAGING_ENC_KEY || "").trim();
  if (!raw) throw new Error("MESSAGING_ENC_KEY not set");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch (_) { /* not base64 */ }
  return crypto.createHash("sha256").update(raw).digest(); // 32 bytes
}

export function encryptSecret(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
