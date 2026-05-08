export type MultipartFile = {
  fieldName: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

export type MultipartForm = {
  fields: Map<string, string>;
  files: MultipartFile[];
};

export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartForm {
  const boundary = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary.");

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, delimiter).slice(1, -1);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];

  for (const rawPart of parts) {
    const part = trimPart(rawPart);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.subarray(0, headerEnd).toString("utf8");
    const data = part.subarray(headerEnd + 4);
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const fieldName = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentTypeMatch = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();

    if (!fieldName) continue;
    if (filename) {
      files.push({
        fieldName,
        filename,
        contentType: contentTypeMatch ?? "application/octet-stream",
        data,
      });
    } else {
      fields.set(fieldName, data.toString("utf8"));
    }
  }

  return { fields, files };
}

function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
}

function trimPart(part: Buffer): Buffer {
  let start = 0;
  let end = part.length;
  if (part.subarray(0, 2).toString() === "\r\n") start = 2;
  if (part.subarray(end - 2).toString() === "\r\n") end -= 2;
  return part.subarray(start, end);
}
