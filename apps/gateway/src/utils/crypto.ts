import crypto from "crypto";

const getMasterKey = () => {
  const key = process.env.MASTER_KEY;
  if (!key || key.length !== 32) {
    throw new Error("MASTER_KEY environment variable must be exactly 32 bytes for AES-256-GCM.");
  }
  return Buffer.from(key, "utf-8");
};

export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Format: iv:encrypted:authTag
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptCredential(ciphertext: string): string {
  const [ivHex, encHex, authTagHex] = ciphertext.split(":");
  if (!ivHex || !encHex || !authTagHex) {
    throw new Error("Invalid ciphertext format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
