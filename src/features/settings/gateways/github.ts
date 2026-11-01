import type { DeviceFlow } from "../../../integrations/github/device-flow";
import type { GitHubHttp } from "../../../integrations/github/http";
import { inspectToken } from "../../../integrations/github/user";
import type { DeviceAuthorizer, TokenInspector } from "../ports";

/** httpFor: トークンから、そのトークンで呼ぶクライアントを作る */
export function createGitHubTokenInspector(httpFor: (token: string) => GitHubHttp): TokenInspector {
  return {
    async inspect(token) {
      const info = await inspectToken(httpFor(token), token);
      return { kind: info.kind, login: info.user.login, avatarUrl: info.user.avatar_url, scopes: info.scopes, expiresAt: info.expiresAt };
    },
  };
}

export function createGitHubDeviceAuthorizer(flow: DeviceFlow): DeviceAuthorizer {
  return {
    requestCode: (signal) => flow.requestCode(undefined, signal),
    pollToken: async (code, signal) => (await flow.pollToken(code, signal)).accessToken,
  };
}
