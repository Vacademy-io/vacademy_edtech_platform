/**
 * The learner's floating panel: their own camera preview and live score.
 * Inline styles only (the plugin ships as one JS file); the accent follows the
 * institute colour that the join URL injects as --color-primary.
 */
import * as React from "react";
import { useCallback, useSyncExternalStore } from "react";
import type { ActivenessController, ViewState } from "./controller";
import { LIVE_WINDOW_MS, type Reason } from "./meter";
import { problemHelp } from "./camera";

const ACCENT = "var(--color-primary, #0F70D7)";
const INK = "#1f2937";
const MUTED = "#6b7280";
const WIDTH = 248;

const scoreColor = (n: number | null) => (n === null ? MUTED : n >= 70 ? "#15803d" : n >= 40 ? "#b45309" : "#b91c1c");

const s = {
  root: {
    width: WIDTH,
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.4,
    color: INK,
    background: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
    userSelect: "none",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    cursor: "move",
  } as React.CSSProperties,
  title: { fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as React.CSSProperties,
  iconBtn: {
    border: "none",
    background: "transparent",
    color: MUTED,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 16,
    lineHeight: 1,
    padding: "2px 6px",
    borderRadius: 6,
  } as React.CSSProperties,
  body: { padding: "0 10px 10px" } as React.CSSProperties,
  preview: {
    position: "relative",
    width: "100%",
    height: 118,
    borderRadius: 8,
    overflow: "hidden",
    background: "#111827",
  } as React.CSSProperties,
  thumb: {
    position: "relative",
    width: 40,
    height: 30,
    borderRadius: 6,
    overflow: "hidden",
    background: "#111827",
    flex: "none",
  } as React.CSSProperties,
  overlay: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    padding: "4px 8px",
    borderRadius: 6,
    background: "rgba(17,24,39,0.78)",
    color: "#fff",
    fontSize: 12,
    textAlign: "center",
  } as React.CSSProperties,
  primary: {
    border: "none",
    borderRadius: 8,
    padding: "7px 12px",
    background: ACCENT,
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  } as React.CSSProperties,
  secondary: {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "6px 12px",
    background: "#fff",
    color: INK,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  } as React.CSSProperties,
  link: {
    border: "none",
    background: "transparent",
    color: MUTED,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    padding: 0,
    textDecoration: "underline",
  } as React.CSSProperties,
  note: { color: MUTED, fontSize: 11.5, marginTop: 8 } as React.CSSProperties,
  row: { display: "flex", gap: 8, marginTop: 10 } as React.CSSProperties,
};

const Dot = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    style={{ width: 8, height: 8, borderRadius: 4, background: on ? "#16a34a" : "#9ca3af", flex: "none" }}
  />
);

function Preview({ controller, small, state }: { controller: ActivenessController; small?: boolean; state: ViewState }) {
  // The controller owns the <video>; mount it into this box while we are rendered.
  const ref = useCallback((el: HTMLDivElement | null) => controller.attachPreview(el), [controller]);
  const note = state.phase !== "on" ? null : state.dark ? "Camera covered or too dark" : state.away ? "Away" : null;
  return (
    <div style={small ? s.thumb : s.preview}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {!small && note && <div style={s.overlay}>{note}</div>}
    </div>
  );
}

/** What the learner is told when the score is held down, with a fix they can act on. */
const REASONS: Record<Reason, { now: string; earlier: string; tip: string }> = {
  away: {
    now: "You're not in front of the camera",
    earlier: "You were away from the camera",
    tip: "Sit where the camera can see your face.",
  },
  dark: {
    now: "The camera can't see you",
    earlier: "The camera couldn't see you",
    tip: "It looks covered or the room is too dark — uncover it or turn on a light.",
  },
  side: {
    now: "Your head is turned away from the screen",
    earlier: "You were turned away from the screen",
    tip: "Face the class screen. If you already are, press the button below.",
  },
  down: {
    now: "You're looking down",
    earlier: "You were looking down",
    tip: "Writing notes is fine — it goes back up when you look at the screen.",
  },
  up: {
    now: "You're looking away from the screen",
    earlier: "You were looking away from the screen",
    tip: "Face the class screen. If you already are, press the button below.",
  },
  eyes: {
    now: "Your eyes have been closed for a few seconds",
    earlier: "Your eyes were closed for a few seconds",
    tip: "Stay with the class — it recovers as soon as you're back.",
  },
  hidden: {
    now: "The class tab is in the background",
    earlier: "The class tab was in the background",
    tip: "Keep this class tab open in front of you.",
  },
};

/** One-line version for the collapsed pill. */
const SHORT_REASON: Record<Reason, string> = {
  away: "Not in front of the camera",
  dark: "Camera can't see you",
  side: "Turned away from the screen",
  down: "Looking down",
  up: "Looking away",
  eyes: "Eyes closed",
  hidden: "Class tab in background",
};

/** A camera at an odd angle can read as "turned away" while the learner is facing the class. */
const CAN_RECALIBRATE: Reason[] = ["side", "up", "down"];

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: "#f3f4f6" }}>
      <div style={{ color: MUTED, fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, color: scoreColor(value) }}>
        {value === null ? "…" : `${value}%`}
      </div>
    </div>
  );
}

function OnBody({ controller, state }: { controller: ActivenessController; state: ViewState }) {
  const live = state.live;
  // Explain whenever the score is held down: right now, or by something still inside the window.
  const reason = live.reason && (live.reasonIsCurrent || (live.score !== null && live.score < 90)) ? live.reason : null;
  const text = reason ? REASONS[reason] : null;
  return (
    <div style={s.body}>
      <Preview controller={controller} state={state} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Stat label="Right now" value={live.score} />
        <Stat label="This class" value={state.session.score} />
      </div>
      {live.score === null || (state.calibrating && !text) ? (
        <div style={{ ...s.note, marginTop: 8 }}>Getting to know your normal position — look at the class for a few seconds…</div>
      ) : text ? (
        <div
          role="status"
          style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a" }}
        >
          <div style={{ fontWeight: 600, color: "#92400e" }}>
            {live.reasonIsCurrent ? text.now : `Lower because: ${text.earlier.charAt(0).toLowerCase()}${text.earlier.slice(1)}`}
          </div>
          <div style={{ color: "#78350f", fontSize: 12, marginTop: 2 }}>
            {live.reasonIsCurrent ? text.tip : `It recovers within ${LIVE_WINDOW_MS / 1000} seconds.`}
          </div>
          {reason && CAN_RECALIBRATE.includes(reason) && live.reasonIsCurrent && (
            <button
              type="button"
              style={{ ...s.secondary, marginTop: 8, padding: "4px 10px", fontSize: 12 }}
              onClick={controller.recalibrate}
            >
              I'm facing the screen — reset
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8, color: "#15803d", fontWeight: 600 }}>✓ You're attentive</div>
      )}
      {state.cameras.length > 1 && (
        <select
          aria-label="Camera"
          value={state.cameraId ?? ""}
          onChange={(e) => controller.switchCamera(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: "100%", marginTop: 8, fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db" }}
        >
          {state.cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <div style={s.note}>Turned on by your institute. Video never leaves this device.</div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" style={s.link} onClick={controller.stop}>
          Turn off for this class
        </button>
      </div>
    </div>
  );
}

export function Panel({ controller }: { controller: ActivenessController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { phase, collapsed } = state;

  if (collapsed) {
    return (
      <div style={s.root}>
        <div style={s.header}>
          {phase === "on" ? <Preview controller={controller} small state={state} /> : <Dot on={false} />}
          <span style={s.title}>
            {phase === "on" ? (
              <>
                Now <b style={{ color: scoreColor(state.live.score) }}>{state.live.score ?? "…"}</b>
                {" · "}Class <b style={{ color: scoreColor(state.session.score) }}>{state.session.score ?? "…"}</b>
                {state.live.reason && state.live.reasonIsCurrent && (
                  <span style={{ display: "block", color: "#92400e", fontSize: 11.5, fontWeight: 600 }}>
                    {SHORT_REASON[state.live.reason]}
                  </span>
                )}
              </>
            ) : phase === "problem" ? (
              "Activeness · needs attention"
            ) : (
              "Activeness score"
            )}
          </span>
          {phase === "off" ? (
            <button type="button" style={{ ...s.primary, padding: "4px 10px", fontSize: 12 }} onClick={controller.start}>
              Turn on
            </button>
          ) : (
            <button type="button" style={s.iconBtn} aria-label="Expand" onClick={() => controller.setCollapsed(false)}>
              ▢
            </button>
          )}
        </div>
      </div>
    );
  }

  const help = state.problem ? problemHelp(state.problem) : null;
  return (
    <div style={s.root}>
      <div style={s.header}>
        <Dot on={phase === "on"} />
        <span style={s.title}>Activeness score</span>
        <button type="button" style={s.iconBtn} aria-label="Minimise" onClick={() => controller.setCollapsed(true)}>
          –
        </button>
      </div>

      {phase === "starting" && (
        <div style={s.body}>
          <Preview controller={controller} state={state} />
          <div style={{ ...s.note, marginTop: 8 }}>
            {state.askingPermission
              ? "Your browser is asking to use the camera — choose Allow."
              : state.slowLoad
                ? "First-time setup — downloading the face model (about 10 MB)…"
                : "Starting camera…"}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" style={s.link} onClick={controller.stop}>
              Turn off for this class
            </button>
          </div>
        </div>
      )}

      {phase === "on" && <OnBody controller={controller} state={state} />}

      {phase === "off" && (
        <div style={s.body}>
          <div style={{ color: MUTED }}>The score is off for this class. Your camera is not in use.</div>
          <div style={s.row}>
            <button type="button" style={s.primary} onClick={controller.start}>
              Turn on
            </button>
          </div>
        </div>
      )}

      {phase === "problem" && help && (
        <div style={s.body}>
          <div style={{ fontWeight: 600 }}>{help.title}</div>
          <div style={{ color: MUTED, marginTop: 4 }}>{help.body}</div>
          <div style={s.row}>
            <button type="button" style={s.primary} onClick={controller.start}>
              Try again
            </button>
            <button type="button" style={s.secondary} onClick={controller.stop}>
              Turn off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
