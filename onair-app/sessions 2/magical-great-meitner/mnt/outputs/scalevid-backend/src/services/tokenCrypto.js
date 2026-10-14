// Chiffrement symétrique (AES-256-GCM) des tokens OAuth avant stockage en base.
// Les access/refresh tokens YouTube et TikTok sont des secrets : ne JAMAIS les
// stocker en clair, même dans une base de données privée.

const crypto = require('crypto');
const config = require('../config');

function getKey() {
  // Dérive une clé de 32 octets à partir de TOKEN_ENCRYPTION_KEY (peu importe sa longueur réelle).
  return crypto.createHash('sha256').update(String(config.tokenEncryptionKey)).digest();
}

function encrypt(plainText) {
  if (plainText == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (payload == null) return null;
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
