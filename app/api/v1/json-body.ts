export class JsonBodyError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(status: 400 | 413 | 415, message: string) {
    super(message);
    this.status = status;
  }
}

function isJsonMediaType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json"
    || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

export async function readBoundedJson(request: Request, byteLimit: number): Promise<unknown> {
  if (!isJsonMediaType(request.headers.get("content-type"))) {
    throw new JsonBodyError(415, "JSON 요청만 지원합니다.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > byteLimit) {
    throw new JsonBodyError(413, "요청 본문이 너무 큽니다.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError(400, "요청 형식을 확인해 주세요.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > byteLimit) {
        await reader.cancel().catch(() => undefined);
        throw new JsonBodyError(413, "요청 본문이 너무 큽니다.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw new JsonBodyError(400, "요청 형식을 확인해 주세요.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JsonBodyError(400, "요청 형식을 확인해 주세요.");
  }
}
