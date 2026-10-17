export function normalizeUploadFilename(name: string) {
  if (!name) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}
