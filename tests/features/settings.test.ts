import { describe, expect, it } from "vitest";
import { createSettingsFeature } from "../../src/features/settings/compose";
import { activeCredentials, DuplicateTokenError, maskToken, missingScopes, type Credential } from "../../src/features/settings/credential";
import { createCredentialStorage } from "../../src/features/settings/gateways/storage";
import type { DeviceAuthorizer, TokenInspector } from "../../src/features/settings/ports";
import { memoryDriver } from "../../src/infrastructure/storage/drivers/memory";
import { ValidationError } from "../../src/lib/validation";

const credential = (id: string, o: Partial<Credential> = {}): Credential => ({
  id, source: "pat", token: `ghp_${id}`, kind: "classic-pat", login: "me", avatarUrl: "", scopes: ["repo", "read:org"], expiresAt: null, addedAt: "2026-10-30T00:00:00.000Z", ...o,
});

const inspector: TokenInspector = {
  async inspect(token) {
    return { kind: token.startsWith("github_pat_") ? "fine-grained-pat" : token.startsWith("gho_") ? "oauth" : "classic-pat", login: "me", avatarUrl: "a", scopes: null, expiresAt: null };
  },
};
const authorizer: DeviceAuthorizer = {
  requestCode: async () => ({ deviceCode: "d", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 }),
  pollToken: async () => "gho_new",
};
let n = 0;
const clock = { now: () => Date.parse("2026-11-01T00:00:00Z"), newId: () => `id${++n}` };

describe("認証情報のルール", () => {
  it("選んだ方式の認証情報だけを、全所有者に使えるものから返す", () => {
    const list = activeCredentials({
      method: "pat",
      credentials: [credential("fg", { kind: "fine-grained-pat", scopes: null }), credential("oauth", { source: "oauth", kind: "oauth" }), credential("classic")],
    });
    expect(list.map((c) => c.id)).toEqual(["classic", "fg"]);
  });

  it("不足スコープは上位スコープを考慮し、トークンは伏せて見せる", () => {
    expect(missingScopes({ scopes: ["repo", "admin:org", "project"] })).toEqual([]);
    expect(missingScopes({ scopes: ["public_repo"] })).toEqual(["repo", "read:org", "project"]);
    expect(missingScopes({ scopes: null })).toEqual([]);
    expect(maskToken("ghp_abcdefgh1234")).toBe("ghp_…1234");
    expect(maskToken("github_pat_11AAAA_zzzz9876")).toBe("github_pat_…9876");
  });
});

describe("設定の操作", () => {
  it("OAuth が使えないビルドでは PAT にする", async () => {
    const driver = memoryDriver();
    expect((await createSettingsFeature({ repository: createCredentialStorage(driver), inspector, authorizer, clock }).load()).method).toBe("oauth");
    const noOAuth = createSettingsFeature({ repository: createCredentialStorage(driver), inspector, authorizer: null, clock });
    expect((await noOAuth.load()).method).toBe("pat");
    expect(noOAuth.signIn).toBeNull();
  });

  it("PAT は入力を検証し、重複を断り、確認してから保存する", async () => {
    const f = createSettingsFeature({ repository: createCredentialStorage(memoryDriver()), inspector, authorizer, clock });
    await expect(f.addToken("  ")).rejects.toBeInstanceOf(ValidationError);
    await expect(f.addToken("ghp a")).rejects.toBeInstanceOf(ValidationError);
    const s = await f.addToken("  ghp_abc  ");
    expect(s.method).toBe("pat");
    expect(s.credentials.map((c) => [c.token, c.kind, c.source])).toEqual([["ghp_abc", "classic-pat", "pat"]]);
    await expect(f.addToken("ghp_abc")).rejects.toBeInstanceOf(DuplicateTokenError);
    expect((await f.load()).credentials).toHaveLength(1);
  });

  it("GitHub でログインすると OAuth の認証情報を 1 つだけ持つ", async () => {
    const f = createSettingsFeature({ repository: createCredentialStorage(memoryDriver()), inspector, authorizer, clock });
    const code = await f.signIn!.start();
    await f.signIn!.finish(code);
    const s = await f.signIn!.finish(code);
    expect(s.method).toBe("oauth");
    expect(s.credentials.filter((c) => c.source === "oauth")).toHaveLength(1);
  });

  it("壊れた保存データは読み出しで拒否する", async () => {
    const store = createCredentialStorage(memoryDriver({ auth: { method: "oauth", credentials: [{ id: 1 }] } }));
    await expect(store.load()).rejects.toBeInstanceOf(ValidationError);
  });
});
