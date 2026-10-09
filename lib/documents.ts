import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { LIMITS } from "./contracts.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED = [".pdf", ".docx", ".txt", ".md", ".markdown", ".csv"] as const;
export type Extracted = { ok: true; text: string } | { ok: false; reason: string };

const reject = (reason: string): Extracted => ({ ok: false, reason });
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .doc/.xls/.ppt

function decodeText(bytes: Uint8Array): string | null {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return null; }
}

// Turns an uploaded file into the exact text that will be compared and quoted.
// Anything that cannot be read faithfully is rejected rather than guessed at.
export async function extractDocument(name: string, bytes: Uint8Array): Promise<Extracted> {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (bytes.byteLength === 0) return reject("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return reject("The file is larger than 10 MB.");
  if (ext === ".doc" || startsWith(bytes, OLE)) return reject("Old Word (.doc) files and password-protected Office files are not supported. Save it as an unprotected .docx or PDF and try again.");

  let text: string;
  if (ext === ".pdf") {
    if (!startsWith(bytes, PDF)) return reject("This file is named .pdf but is not a valid PDF.");
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch (cause) {
      const message = cause instanceof Error ? cause.name + cause.message : "";
      return reject(/password/i.test(message) ? "This PDF is password-protected. Remove the password and try again." : "This PDF could not be read. It may be damaged.");
    }
    if (!text.trim()) return reject("This PDF has no selectable text. It is probably a scan or image; export it with text, or paste the text instead.");
  } else if (ext === ".docx") {
    if (!startsWith(bytes, ZIP)) return reject("This file is named .docx but is not a valid Word document.");
    try { text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value; }
    catch { return reject("This Word document could not be read. It may be damaged or password-protected."); }
  } else if ([".txt", ".md", ".markdown", ".csv"].includes(ext)) {
    const decoded = decodeText(bytes);
    if (decoded === null || decoded.includes("\u0000")) return reject("This text file is not valid UTF-8 text. Re-save it as UTF-8 and try again.");
    text = decoded;
  } else {
    return reject(`Unsupported file type. Upload ${ACCEPTED.join(", ")}.`);
  }

  text = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return reject("No readable text was found in this file.");
  if (/\p{Surrogate}/u.test(text)) return reject("This file contains damaged characters and could not be read reliably.");
  if (text.length > LIMITS.source) return reject(`This file has ${text.length.toLocaleString("en")} characters of text; the limit is ${LIMITS.source.toLocaleString("en")}. Trim it and try again.`);
  return { ok: true, text };
}
