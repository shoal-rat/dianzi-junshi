import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { database, ensureDir, now, personDir, uid } from "./db";
import type { ImageRef } from "../shared/domain";
import { msg } from "./messages";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** 看文件头判断真实格式，不信扩展名和浏览器给的类型。 */
export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length > 6 && String.fromCharCode(...bytes.slice(0, 4)) === "GIF8") return "image/gif";
  return null;
}

export function sha256(bytes: Uint8Array): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(bytes);
  return h.digest("hex");
}

export interface StoredImage {
  id: string;
  personId: string;
  file: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  origin: string;
  createdAt: string;
  duplicate?: boolean;
}

function rowToImage(r: any): StoredImage {
  return { id: r.id, personId: r.person_id, file: r.file, name: r.name, mediaType: r.media_type, bytes: r.bytes, sha256: r.sha256, origin: r.origin, createdAt: r.created_at };
}

export function saveImage(personId: string, bytes: Uint8Array, name: string, origin: "turn" | "import" | "feedback"): StoredImage {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(msg().imageTooBig(name));
  const mediaType = sniffImage(bytes);
  if (!mediaType) throw new Error(msg().imageUnknown(name));
  const hash = sha256(bytes);
  const existing = database().query("SELECT * FROM images WHERE person_id=? AND sha256=? LIMIT 1").get(personId, hash);
  if (existing) return { ...rowToImage(existing), duplicate: true };
  const id = uid();
  const dir = ensureDir(join(personDir(personId), "img"));
  const file = `${id}.${EXT[mediaType]}`;
  writeFileSync(join(dir, file), bytes, { mode: 0o600 });
  const safeName = (name || file).replace(/[\u0000-\u001f]/g, "").slice(0, 120);
  database().query(`INSERT INTO images(id,person_id,file,name,media_type,bytes,sha256,origin,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, personId, file, safeName, mediaType, bytes.length, hash, origin, now());
  return getImage(id)!;
}

export function getImage(id: string): StoredImage | null {
  const r = database().query("SELECT * FROM images WHERE id=?").get(id);
  return r ? rowToImage(r) : null;
}

export function imagePath(img: StoredImage): string {
  return join(personDir(img.personId), "img", img.file);
}

export function imageBytes(img: StoredImage): Uint8Array | null {
  const p = imagePath(img);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

export function imageRef(img: StoredImage): ImageRef {
  return { id: img.id, name: img.name, url: `/api/images/${img.id}` };
}

export function imagesFor(personId: string, ids: string[]): StoredImage[] {
  return ids.map(getImage).filter((x): x is StoredImage => Boolean(x && x.personId === personId));
}
