import { extractDocument, MAX_UPLOAD_BYTES } from "../../../lib/documents";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!["127.0.0.1:4317", "localhost:4317"].includes(host) || (origin && origin !== `http://${host}`) || !request.headers.get("content-type")?.startsWith("multipart/form-data")) return json({ ok: false, reason: "Upload rejected." }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64_000) return json({ ok: false, reason: "The file is larger than 10 MB." }, 413);
  let file: FormDataEntryValue | null;
  try { file = (await request.formData()).get("file"); } catch { return json({ ok: false, reason: "Upload could not be read." }, 400); }
  if (!(file instanceof File)) return json({ ok: false, reason: "No file was uploaded." }, 400);
  const result = await extractDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  return json(result, result.ok ? 200 : 422);
}
