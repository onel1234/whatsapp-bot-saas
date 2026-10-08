export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: data === undefined ? "GET" : "POST",
    credentials: "include",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response
    .json()
    .catch(() => ({ message: "The service could not complete this request." }));
  if (!response.ok)
    throw new ApiError(result.message ?? "Request failed.", response.status);
  return result as T;
}
