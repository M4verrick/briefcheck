import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractDocument } from "../lib/documents";

const enc = (s: string) => new TextEncoder().encode(s);

// Minimal one-page PDF with real text operators and a correct xref table.
function pdf(lines: string[]): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) '`).join(" ")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc(out);
}

// Minimal .docx: a zip with content types, package rels and one paragraph per line.
function docx(paragraphs: string[]): Uint8Array {
  const files: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  };
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content); const data = deflateRawSync(raw); const nameBuf = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data); central.push(dir, nameBuf); offset += 30 + nameBuf.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0); const n = Object.keys(files).length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}
function crc32(buf: Buffer) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }

describe("document upload extraction", () => {
  it("reads text from a PDF", async () => {
    const result = await extractDocument("brief.pdf", pdf(["Booking form required.", "Launch on 20 October."]));
    expect(result.ok).toBe(true); if (result.ok) { expect(result.text).toContain("Booking form required."); expect(result.text).toContain("Launch on 20 October."); }
  });
  it("reads paragraphs from a DOCX", async () => {
    expect(await extractDocument("plan.DOCX", docx(["Email signup.", "Launch on 27 October."]))).toEqual({ ok: true, text: "Email signup.\n\nLaunch on 27 October." });
  });
  it("reads UTF-8 text, strips the BOM and normalises line endings", async () => {
    expect(await extractDocument("notes.txt", new Uint8Array([0xef, 0xbb, 0xbf, ...enc("Café 😀\r\nLine two\r\n")]))).toEqual({ ok: true, text: "Café 😀\nLine two" });
  });
  it.each([
    ["empty.txt", new Uint8Array(), "empty"],
    ["latin1.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "UTF-8"],
    ["binary.txt", enc("a\u0000b"), "UTF-8"],
    ["fake.pdf", enc("hello"), "not a valid PDF"],
    ["broken.pdf", enc("%PDF-1.4 garbage"), "could not be read"],
    ["blank.pdf", pdf([]), "no selectable text"],
    ["fake.docx", enc("hello"), "not a valid Word"],
    ["broken.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "could not be read"],
    ["old.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]), ".doc"],
    ["image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "Unsupported file type"],
    ["noext", enc("text"), "Unsupported file type"],
    ["whitespace.md", enc(" \n\t\n"), "No readable text"],
    ["huge.txt", enc("x".repeat(16_001)), "limit is 16,000"],
  ])("rejects %s", async (name, bytes, reason) => {
    const result = await extractDocument(name, bytes);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.reason).toContain(reason);
  });
});
