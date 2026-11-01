import { GitHubHttp } from "../src/integrations/github/http";
import type { Sleep } from "../src/lib/time";

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** 呼び出しを記録し、handler の返すレスポンスを返す fetch */
export function mockFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** 待たずに、待とうとした時間だけ記録する sleep */
export function recordingSleep() {
  const waits: number[] = [];
  const sleep: Sleep = async (ms, signal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    waits.push(ms);
  };
  return { sleep, waits };
}

/** 偽の fetch につないだ GitHubHttp */
export function testHttp(handler: Handler, extra: { now?: () => number; maxRetryWaitSec?: number } = {}) {
  const { fetch, calls } = mockFetch(handler);
  const { sleep, waits } = recordingSleep();
  const http = new GitHubHttp({ token: "ghp_test", fetch, sleep, ...extra });
  return { http, calls, waits };
}

// --- フィクスチャ ---------------------------------------------------------

export function rawUser(login: string, type = "User", id = 1) {
  return { login, id, type, avatar_url: `https://avatars.example/${login}`, html_url: `https://github.com/${login}` };
}

export function rawRepo(owner: string, name: string, ownerType = "User", id = 100) {
  return {
    id,
    name,
    full_name: `${owner}/${name}`,
    owner: rawUser(owner, ownerType),
    private: true,
    archived: false,
    html_url: `https://github.com/${owner}/${name}`,
    pushed_at: "2026-10-01T00:00:00Z",
  };
}

export function rawArtifact(id: number, name = `build-${id}`) {
  return {
    id,
    node_id: `MDg6QXJ0aWZhY3Q${id}`,
    name,
    size_in_bytes: 1024 * id,
    url: `https://api.github.com/repos/o/r/actions/artifacts/${id}`,
    archive_download_url: `https://api.github.com/repos/o/r/actions/artifacts/${id}/zip`,
    expired: false,
    created_at: "2026-09-01T00:00:00Z",
    expires_at: "2026-11-30T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    digest: "sha256:abc",
    workflow_run: { id: 9, repository_id: 100, head_repository_id: 100, head_branch: "main", head_sha: "deadbeef" },
  };
}

export function rawIssue(id: number, owner = "acme", repo = "web", extra: Record<string, unknown> = {}) {
  return {
    id,
    number: id,
    title: `Issue ${id}`,
    state: "open",
    state_reason: null,
    html_url: `https://github.com/${owner}/${repo}/issues/${id}`,
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    user: rawUser("alice"),
    labels: [{ id: 1, name: "bug", color: "d73a4a", description: "Something isn't working" }],
    assignees: [rawUser("bob")],
    comments: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    closed_at: null,
    ...extra,
  };
}
