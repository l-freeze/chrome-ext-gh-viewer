import { For, Show, type JSX } from "solid-js";
import type { Owner } from "../../../features/workspace/repository";
import { GitHubApiError } from "../../../integrations/github/errors";
import { permissionHint } from "../../../integrations/github/permissions";
import { useUi } from "../../app/context";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";

const FINE_GRAINED_SETTINGS_URL = "https://github.com/settings/personal-access-tokens";
const CLASSIC_SETTINGS_URL = "https://github.com/settings/tokens";
const CLASSIC_NEW_URL = "https://github.com/settings/tokens/new?scopes=read:project,repo&description=GitHub%20Viewer%20(projects)";

/** 文言の中の `…` をコードとして表示する */
function withCode(text: string): JSX.Element {
  return text.split("`").map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part));
}

/**
 * プロジェクトを読めない・動かせないときの権限の案内。持ち主が個人アカウントか Organization かで出し分ける。
 * 個人アカウントのプロジェクトは Fine-grained PAT では扱えない（GitHub が対応していない）ので、Classic PAT を案内する。
 * GitHub が応答で必要な権限を教えてくれたときは、その内容も合わせて出す
 */
export function ProjectAccessHint(props: { error: unknown; owner: Pick<Owner, "login" | "type">; action: "read" | "move" }) {
  const { t } = useUi().i18n;
  const operation = () => (props.action === "read" ? "projects.list" : "projects.move");
  const hint = () => (props.error instanceof GitHubApiError ? permissionHint(props.error, operation()) : null);
  const personal = () => props.owner.type !== "Organization";

  return (
    <Show when={hint()}>
      {(h) => (
        <>
          <div class="permission-hint project-access">
            <Show
              when={personal()}
              fallback={
                <>
                  <p class="permission-hint__title">
                    {props.action === "read" ? t("projectAccess.org.read") : t("projectAccess.org.move")}
                  </p>
                  <ul>
                    <li>{withCode(t(props.action === "read" ? "projectAccess.org.fineGrained" : "projectAccess.org.fineGrainedMove", { owner: props.owner.login }))}</li>
                    <li>{withCode(t(props.action === "read" ? "projectAccess.org.classic" : "projectAccess.org.classicMove"))}</li>
                  </ul>
                  <p class="muted small">{t("projectAccess.org.note")}</p>
                  <p class="small">
                    <a href={FINE_GRAINED_SETTINGS_URL} target="_blank" rel="noreferrer">
                      {t("projectAccess.editFineGrained")} <Icon name="external" size={12} />
                    </a>{" "}
                    <a href={CLASSIC_SETTINGS_URL} target="_blank" rel="noreferrer">
                      {t("projectAccess.editClassic")} <Icon name="external" size={12} />
                    </a>
                  </p>
                </>
              }
            >
              <p class="permission-hint__title">{t("projectAccess.user.unsupported")}</p>
              <p>{t(props.action === "read" ? "projectAccess.user.addClassic" : "projectAccess.user.moveClassic")}</p>
              <ul>
                <For each={props.action === "read" ? (["projectAccess.user.scopes", "projectAccess.user.repo"] as const) : (["projectAccess.user.moveScope", "projectAccess.user.repo"] as const)}>
                  {(key) => <li>{withCode(t(key))}</li>}
                </For>
              </ul>
              <p class="small">
                <a href={CLASSIC_NEW_URL} target="_blank" rel="noreferrer">
                  {t("projectAccess.createClassic")} <Icon name="external" size={12} />
                </a>
              </p>
            </Show>
          </div>
          <Show when={h().fromGitHub}>
            <PermissionHint error={props.error} operation={operation()} />
          </Show>
        </>
      )}
    </Show>
  );
}
