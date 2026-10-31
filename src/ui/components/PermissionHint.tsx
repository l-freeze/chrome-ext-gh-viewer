import { For, Show } from "solid-js";
import type { GitHubApiError } from "../../api/errors";
import { describePermission, permissionHint, type Operation } from "../../domain/permissions";
import { useDeps } from "../state/context";
import { Icon } from "./Icon";

const FINE_GRAINED_SETTINGS_URL = "https://github.com/settings/personal-access-tokens";
const CLASSIC_SETTINGS_URL = "https://github.com/settings/tokens";

/** 権限不足が原因でありうるエラーのとき、必要な権限を箇条書きで示す */
export function PermissionHint(props: { error: GitHubApiError; operation: Operation }) {
  const { t } = useDeps().i18n;
  const hint = () => permissionHint(props.error, props.operation);

  return (
    <Show when={hint()}>
      {(h) => (
        <div class="permission-hint">
          <p class="permission-hint__title">
            {h().fromGitHub ? t("permissions.titleFromGitHub") : t("permissions.title")}
          </p>
          <div class="permission-hint__group">
            <p>
              {t("permissions.fineGrained")}{" "}
              <a href={FINE_GRAINED_SETTINGS_URL} target="_blank" rel="noreferrer" class="small">
                {t("permissions.openSettings")} <Icon name="external" size={12} />
              </a>
            </p>
            <Show
              when={h().fineGrained.length > 1}
              fallback={<PermissionList permissions={h().fineGrained[0] ?? []} />}
            >
              <p class="muted small">{t("permissions.anyOf")}</p>
              <ol>
                <For each={h().fineGrained}>
                  {(set) => (
                    <li>
                      <PermissionList permissions={set} />
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </div>
          <Show when={h().classic.length > 0}>
            <div class="permission-hint__group">
              <p>
                {t("permissions.classic")}{" "}
                <a href={CLASSIC_SETTINGS_URL} target="_blank" rel="noreferrer" class="small">
                  {t("permissions.openSettings")} <Icon name="external" size={12} />
                </a>
              </p>
              <Show
                when={h().fromGitHub && h().classic.length > 1}
                fallback={
                  <ul>
                    <For each={h().classic}>{(s) => <li class="mono">{s}</li>}</For>
                  </ul>
                }
              >
                <p class="muted small">{t("permissions.anyScope")}</p>
                <ul>
                  <For each={h().classic}>{(s) => <li class="mono">{s}</li>}</For>
                </ul>
              </Show>
            </div>
          </Show>
          <p class="muted small">{t("permissions.orgNote")}</p>
        </div>
      )}
    </Show>
  );

  function PermissionList(p: { permissions: string[] }) {
    return (
      <ul>
        <For each={p.permissions}>
          {(permission) => {
            const d = describePermission(permission);
            return (
              <li>
                <strong>{d.name}</strong>: {t(`permissions.level.${d.level}`)}
              </li>
            );
          }}
        </For>
      </ul>
    );
  }
}
