// ビルド時に埋め込む設定。OAuth App の Client ID は .env.local などで WXT_GITHUB_CLIENT_ID に設定する。
// Client ID は秘密情報ではない（Device Flow では Client Secret を使わない）。

const clientId: unknown = import.meta.env.WXT_GITHUB_CLIENT_ID;

export const OAUTH_CLIENT_ID: string | null = typeof clientId === "string" && clientId.trim() ? clientId.trim() : null;
