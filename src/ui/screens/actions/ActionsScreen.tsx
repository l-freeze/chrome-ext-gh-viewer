import { createSignal, For, Show } from "solid-js";
import { formatDate } from "../../format";
import { canTryDispatch, runBadge } from "../../../features/actions/workflow";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { useUi } from "../../app/context";
import type { DispatchTarget } from "./dispatch-state";
import type { RunCleanupState } from "./cleanup-state";
import type { WorkflowListState } from "./list-state";
import { RunCleanup } from "./RunCleanup";
import type { WorkflowArtifactsState } from "./artifacts-state";
import { WorkflowArtifacts } from "./WorkflowArtifacts";
import "./actions.css";

export function ActionsScreen(props: {
  state: WorkflowListState;
  cleanup: RunCleanupState;
  artifacts: WorkflowArtifactsState;
  repoCount: number;
  onRun: (target: DispatchTarget) => void;
}) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const [view, setView] = createSignal<"list" | "cleanup" | "artifacts">("list");

  return (
    <div class="workflows">
      <div class="segmented segmented--views" role="tablist" aria-label={t("tab.actions")}>
        <button type="button" role="tab" aria-selected={view() === "list"} onClick={() => setView("list")}>
          {t("workflows.view.list")}
        </button>
        <button type="button" role="tab" aria-selected={view() === "cleanup"} onClick={() => setView("cleanup")}>
          {t("workflows.view.cleanup")}
        </button>
        <button type="button" role="tab" aria-selected={view() === "artifacts"} onClick={() => setView("artifacts")}>
          {t("workflows.view.artifacts")}
        </button>
      </div>
      <Show when={view() === "artifacts"}>
        <WorkflowArtifacts state={props.artifacts} />
      </Show>
      <Show when={view() === "cleanup"}>
        <RunCleanup state={props.cleanup} repoCount={props.repoCount} />
      </Show>
      <Show when={view() === "list"}>
        <div class="filters" role="search">
          <label class="field field--grow">
            <span class="field__label">{t("workflows.filter.text")}</span>
            <input
              type="search"
              value={s.text()}
              placeholder={t("workflows.filter.textPlaceholder")}
              onInput={(e) => s.setText(e.currentTarget.value)}
            />
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              checked={s.hideDisabled()}
              onChange={(e) => s.setHideDisabled(e.currentTarget.checked)}
            />
            {t("workflows.hideDisabled")}
          </label>
          <p class="issues__count" role="status">
            <strong>{t("workflows.count", { count: s.count() })}</strong>{" "}
            <span class="muted">{t("workflows.inRepos", { count: s.groups().length })}</span>
          </p>
        </div>

        <Failures
          title={t("failures.title", { count: s.results.failures().length })}
          items={s.results.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
          operation="workflows.list"
        />

        <div class="table-wrap">
          <table class="table table--workflows">
            <thead>
              <tr>
                <th>{t("workflows.col.workflow")}</th>
                <th>{t("workflows.col.state")}</th>
                <th>{t("workflows.col.lastRun")}</th>
                <th class="col-run">
                  <span class="visually-hidden">{t("workflows.run")}</span>
                </th>
              </tr>
            </thead>
            <For each={s.groups()}>
              {(group) => (
                <tbody>
                  <tr class="group-row">
                    <th colspan="4" scope="rowgroup">
                      <a href={`https://github.com/${group.key}/actions`} target="_blank" rel="noreferrer">
                        <span class="muted">{group.repo.owner.login}/</span>
                        {group.repo.name}
                      </a>
                      <span class="group-row__count">{i18n.number(group.workflows.length)}</span>
                    </th>
                  </tr>
                  <For each={group.workflows}>
                    {({ workflow, lastRun }) => {
                      const badge = () => runBadge(lastRun);
                      return (
                        <tr classList={{ "row--disabled": workflow.state !== "active" }}>
                          <td class="cell-workflow">
                            <a href={workflow.htmlUrl} target="_blank" rel="noreferrer">
                              {workflow.name}
                            </a>
                            <span class="mono muted small"> {workflow.path}</span>
                          </td>
                          <td>
                            <span class="badge">
                              {workflow.state === "active"
                                ? t("workflows.state.active")
                                : t("workflows.state.disabled")}
                            </span>
                          </td>
                          <td>
                            <Show when={lastRun} fallback={<span class="muted">{t("workflows.noRuns")}</span>}>
                              {(run) => (
                                <div class="run-cell">
                                  <span class={`run-badge run-badge--${badge()}`}>
                                    {t(`workflows.badge.${badge()}`)}
                                  </span>
                                  <a class="muted small" href={run().htmlUrl} target="_blank" rel="noreferrer">
                                    {t("workflows.runMeta", {
                                      number: String(run().runNumber),
                                      branch: run().headBranch ?? "—",
                                      date: formatDate(run().createdAt) ?? "",
                                    })}
                                  </a>
                                </div>
                              )}
                            </Show>
                          </td>
                          <td class="col-run">
                            <Show when={canTryDispatch(workflow) && !group.repo.archived}>
                              <button
                                type="button"
                                class="button"
                                aria-label={t("workflows.runLabel", { name: workflow.name })}
                                onClick={() => props.onRun({ repo: group.repo, workflow })}
                              >
                                <Icon name="play" />
                                {t("workflows.run")}
                              </button>
                            </Show>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              )}
            </For>
          </table>
          <Show when={!s.results.progress() && s.groups().length === 0}>
            <p class="empty">{t("workflows.empty")}</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
