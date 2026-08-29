// The single fetch wrapper shared by the three API clients (api.ts /
// classroomApi.ts / bookclubApi.ts): cookie auth outside Discord, Bearer
// token inside an Activity, one error shape everywhere.
import { getDiscordBearerToken } from "./discordAuthToken.js";

export type RequestOptions = RequestInit & {
  // Skip the default application/json content-type -- multipart bodies
  // (bookclub's PDF upload) must set their own boundary.
  json?: boolean;
  // Status codes whose body no caller reads (commands accepted for
  // async processing). Resolved as undefined instead of parsed. Each
  // client declares its own contract: post-api answers 202 with an
  // envelope the client historically discards, classroom/bookclub
  // answer 202 with a body callers do read.
  voidStatuses?: readonly number[];
};

export async function request<T>(baseUrl: string, path: string, init: RequestOptions = {}): Promise<T> {
  const { json = true, voidStatuses = [], ...fetchInit } = init;
  const bearer = getDiscordBearerToken();
  const res = await fetch(`${baseUrl}${path}`, {
    ...fetchInit,
    credentials: "include",
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...fetchInit.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (voidStatuses.includes(res.status)) return undefined as T;
  return res.json() as Promise<T>;
}