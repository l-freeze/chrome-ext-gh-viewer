import { createEffect, For, Show } from "solid-js";
import { runBadge } from "../../../features/actions/workflow";
import { isExpired } from "../../../features/artifacts/artifact";
import { useUi } from "../../app/context";
import { Icon } from "../../components/Icon";
import { downloadFailureText, errorText } from "../../errors";
import { formatBytes, formatDate } from "../../format";
import type { ArtifactPanelNotice, WorkflowArtifactsState } from "./artifacts-state";

/** 「アーティファクト」パネル: リポジトリ → ワークフロー → 実行ごとの成果物（閲覧とダウンロードのみ。削除は Artifacts のタブで行う） */
export function WorkflowArtifacts(props: { state: WorkflowArtifactsState }) {
  const deps = useUi();
  const { i18n } = deps;
  const { t } = i18n;
  const s = props.state;

  // 表示している間に、ワークフローが分からない古い実行を調べる
  createEffect(() => {
    if (s.unknownRuns().length > 0) void s.resolveUnknownRuns();
  });

  const noticeText = (n: ArtifactPanelNotice) => {
    switch (n.kind) {
      case "downloadStarted":
        return t("download.started", { name: n.name });
      case "downloadFailed":
        return t("download.failed", { name: n.name, reason: downloadFailureText(t, n.reason) });
      case "error":
        return errorText(t, n.error);
    }
  };

  return (
    <div class="workflow-artifacts">
      <div class="filters" role="search">
        <label class="field field--grow">
          <span class="field__label">{t("workflowArtifacts.filter")}</span>
          <input
            type="search"
            value={s.text()}
            placeholder={t("workflowArtifacts.filterPlaceholder")}
            onInput={(e) => s.setText(e.currentTarget.value)}
          />
        </label>
        <p class="issues__count" role="status">
          <strong>{t("workflowArtifacts.count", { count: s.count() })}</strong>{" "}
          <span class="muted">{t("issues.inRepos", { count: s.groups().length })}</span>
        </p>
      </div>
      <p class="muted small workflow-artifacts__note">
        {t("workflowArtifacts.note")}
        <Show when={s.resolving() > 0}> {t("workflowArtifacts.resolving", { count: s.resolving() })}</Show>
      </p>

      <Show when={s.notice()}>
        {(n) => (
          <div class="notice" classList={{ "notice--info": n().kind === "downloadStarted" }} role="status">
            <span>{noticeText(n())}</span>
            <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
              {t("action.close")}
            </button>
          </div>
        )}
      </Show>

      <For each={s.groups()}>
        {(group) => (
          <section class="wa-repo">
            <h3 class="wa-repo__title">
              <a href={`${group.repo.htmlUrl}/actions`} target="_blank" rel="noreferrer">
                <span class="muted">{group.repo.owner.login}/</span>
                {group.repo.name}
              </a>
            </h3>
            <For each={group.workflows}>
              {(workflow) => (
                <div class="wa-workflow">
                  <h4 class="wa-workflow__title">
                    <Show when={workflow.htmlUrl} fallback={<span>{workflow.name ?? t("workflowArtifacts.unknownWorkflow")}</span>}>
                      {(url) => (
                        <a href={url()} target="_blank" rel="noreferrer">
                          {workflow.name}
                        </a>
                      )}
                    </Show>
                  </h4>
                  <ul class="wa-runs">
                    <For each={workflow.runs}>
                      {(group) => (
                        <li class="wa-run">
                          <div class="wa-run__meta small">
                            <Show
                              when={group.run}
                              fallback={<span class="muted">{t("workflowArtifacts.unknownRun", { branch: group.artifacts[0]?.workflowRun?.headBranch ?? "—" })}</span>}
                            >
                              {(run) => (
                                <>
                                  <span class={`run-badge run-badge--${runBadge(run())}`}>{t(`workflows.badge.${runBadge(run())}`)}</span>
                                  <a class="muted" href={run().htmlUrl} target="_blank" rel="noreferrer">
                                    {t("workflows.runMeta", {
                                      number: String(run().runNumber),
                                      branch: run().headBranch ?? "—",
                                      date: formatDate(run().createdAt) ?? "",
                                    })}
                                  </a>
                                </>
                              )}
                            </Show>
                          </div>
                          <ul class="assets">
                            <For each={group.artifacts}>
                              {(artifact) => (
                                <li>
                                  <Show
                                    when={!isExpired(artifact, deps.manager.now())}
                                    fallback={
                                      <span class="asset asset--expired">
                                        <span class="asset__name">{artifact.name}</span>
                                        <span class="asset__meta">{t("workflowArtifacts.expired")}</span>
                                      </span>
                                    }
                                  >
                                    <button
                                      type="button"
                                      class="asset"
                                      aria-label={t("download.button", { name: artifact.name })}
                                      onClick={() => void s.download(artifact)}
                                    >
                                      <Icon name="download" size={14} />
                                      <span class="asset__name">{artifact.name}</span>
                                      <span class="asset__meta">{formatBytes(artifact.sizeInBytes, i18n.number)}</span>
                                    </button>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
      <Show when={s.groups().length === 0}>
        <p class="empty">{t("workflowArtifacts.empty")}</p>
      </Show>
    </div>
  );
}
