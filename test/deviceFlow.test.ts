import { describe, expect, it } from "vitest";
import { DeviceFlow, DeviceFlowError } from "../src/api/deviceFlow";
import type { DeviceCode } from "../src/api/types";
import { json, mockFetch, recordingSleep, type Handler } from "./helpers";

function setup(handler: Handler) {
  const { fetch, calls } = mockFetch(handler);
  const { sleep, waits } = recordingSleep();
  let clock = 0;
  // sleep した分だけ時計を進める
  const flow = new DeviceFlow({
    clientId: "Iv1.test",
    fetch,
    sleep: async (ms, signal) => {
      await sleep(ms, signal);
      clock += ms;
    },
    now: () => clock,
  });
  return { flow, calls, waits };
}

const code: DeviceCode = {
  deviceCode: "dev123",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
};

async function errorOf(p: Promise<unknown>): Promise<DeviceFlowError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DeviceFlowError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("DeviceFlow.requestCode", () => {
  it("client_id とスコープを送ってコードを受け取る", async () => {
    const { flow, calls } = setup(() =>
      json({
        device_code: "dev123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );
    expect(await flow.requestCode()).toEqual(code);
    const call = calls[0]!;
    expect(call.url.toString()).toBe("https://github.com/login/device/code");
    expect(call.method).toBe("POST");
    expect(call.headers.get("accept")).toBe("application/json");
    expect(Object.fromEntries(new URLSearchParams(call.body!))).toEqual({ client_id: "Iv1.test", scope: "repo read:org" });
  });

  it("Device Flow が無効な App なら disabled", async () => {
    const { flow } = setup(() => json({ error: "device_flow_disabled", error_description: "Device Flow must be explicitly enabled" }, { status: 400 }));
    const err = await errorOf(flow.requestCode());
    expect(err.kind).toBe("disabled");
    expect(err.code).toBe("device_flow_disabled");
  });

  it("JSON でない応答は unexpected", async () => {
    const { flow } = setup(() => new Response("<html>", { status: 500 }));
    expect((await errorOf(flow.requestCode())).kind).toBe("unexpected");
  });
});

describe("DeviceFlow.pollToken", () => {
  it("pending と slow_down を経てトークンを受け取り、間隔を守る", async () => {
    const responses = [
      { error: "authorization_pending" },
      { error: "slow_down", interval: 10 },
      { error: "slow_down" },
      { access_token: "gho_abc", token_type: "bearer", scope: "repo,read:org" },
    ];
    const { flow, calls, waits } = setup(() => json(responses.shift()));
    const token = await flow.pollToken(code);
    expect(token).toEqual({ accessToken: "gho_abc", tokenType: "bearer", scopes: ["repo", "read:org"] });
    expect(waits).toEqual([5000, 5000, 10_000, 15_000]);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body!))).toEqual({
      client_id: "Iv1.test",
      device_code: "dev123",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
  });

  it("利用者がキャンセルしたら access_denied", async () => {
    const { flow } = setup(() => json({ error: "access_denied" }));
    expect((await errorOf(flow.pollToken(code))).kind).toBe("access_denied");
  });

  it("有効期限を過ぎたら問い合わせずに expired", async () => {
    const { flow, calls } = setup(() => json({ error: "authorization_pending" }));
    const err = await errorOf(flow.pollToken({ ...code, expiresIn: 12, interval: 5 }));
    expect(err.kind).toBe("expired");
    // 5 秒後・10 秒後に問い合わせ、15 秒後は期限切れ
    expect(calls).toHaveLength(2);
  });

  it("中断されたら aborted", async () => {
    const { flow } = setup(() => json({ error: "authorization_pending" }));
    const ac = new AbortController();
    ac.abort();
    expect((await errorOf(flow.pollToken(code, ac.signal))).kind).toBe("aborted");
  });
});
