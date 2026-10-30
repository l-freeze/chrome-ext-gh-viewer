import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

// ツールバーのアイコンを押したら管理画面をタブで開く。開いていればそのタブに切り替える
export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL("/manager.html");
    const [existing] = await browser.tabs.query({ url: `${url}*` });
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) await browser.windows.update(existing.windowId, { focused: true });
      return;
    }
    await browser.tabs.create({ url });
  });
});
