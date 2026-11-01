import { describe, expect, it } from "vitest";
import { createPreferencesFeature } from "../../src/features/preferences/compose";
import { createDisplayPreferencesStorage } from "../../src/features/preferences/gateways/storage";
import { memoryDriver } from "../../src/infrastructure/storage/drivers/memory";

describe("表示の好み", () => {
  it("保存がなければ自動更新はオン。保存した値を読み戻せる", async () => {
    const f = createPreferencesFeature({ repository: createDisplayPreferencesStorage(memoryDriver()) });
    expect(await f.load()).toEqual({ autoRefresh: true });
    await f.save({ autoRefresh: false });
    expect(await f.load()).toEqual({ autoRefresh: false });
  });

  it("形の違う値は保存しない", async () => {
    const f = createPreferencesFeature({ repository: createDisplayPreferencesStorage(memoryDriver()) });
    await expect(f.save({ autoRefresh: "yes" } as never)).rejects.toThrow(/autoRefresh/);
  });
});
