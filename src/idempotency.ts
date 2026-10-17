export function shouldReleaseIdempotencyKey(response: Pick<Response, "ok">) {
  return response.ok;
}
