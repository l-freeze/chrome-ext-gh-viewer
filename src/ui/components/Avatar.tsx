import { createSignal, Show } from "solid-js";

/** 画像が読めなければ頭文字を表示する */
export function Avatar(props: { src: string; login: string; size?: number }) {
  const [failed, setFailed] = createSignal(false);
  const size = () => props.size ?? 20;
  return (
    <span class="avatar" aria-hidden="true" style={{ width: `${size()}px`, height: `${size()}px`, "font-size": `${size() * 0.5}px` }}>
      <Show when={!failed() && props.src} fallback={props.login.slice(0, 1).toUpperCase()}>
        <img src={props.src} alt="" width={size()} height={size()} loading="lazy" onError={() => setFailed(true)} />
      </Show>
    </span>
  );
}
