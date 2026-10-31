// Run: node --test src/meter.test.ts  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivenessMeter, LIVE_WINDOW_MS, combine, emptyTotals } from "./meter.ts";

const ON = { face: true, facing: true, eyesOpen: true };
const LOOKING_AWAY = { face: true, facing: false, eyesOpen: true };
const DOZING = { face: true, facing: true, eyesOpen: false };
const EMPTY = { face: false, facing: false, eyesOpen: false };

test("no samples = no score", () => {
  const m = new ActivenessMeter();
  assert.deepEqual(m.session(), { score: null, onScreen: null, attention: null });
  assert.equal(m.live(0).score, null);
  assert.equal(m.live(0).reason, null);
});

test("fully attentive = 100", () => {
  const m = new ActivenessMeter();
  for (let i = 0; i < 10; i += 1) m.addSample(i * 1000, ON, 1000);
  assert.deepEqual(m.session(), { score: 100, onScreen: 100, attention: 100 });
});

test("present but looking away halves the score", () => {
  const m = new ActivenessMeter();
  for (let i = 0; i < 10; i += 1) m.addSample(i * 1000, LOOKING_AWAY, 1000);
  assert.deepEqual(m.session(), { score: 50, onScreen: 100, attention: 0 });
});

test("dozing counts as present, not attentive", () => {
  const m = new ActivenessMeter();
  m.addSample(0, ON, 1000);
  m.addSample(1000, DOZING, 1000);
  assert.deepEqual(m.session(), { score: 75, onScreen: 100, attention: 50 });
});

test("samples are weighted by the time they cover", () => {
  const m = new ActivenessMeter();
  m.addSample(0, ON, 3000);
  m.addSample(3000, EMPTY, 1000);
  assert.equal(m.session().onScreen, 75);
  assert.equal(m.totals.awayMs, 1000);
});

test("background-tab time counts against both parts", () => {
  const m = new ActivenessMeter();
  m.addSample(0, ON, 60_000);
  m.addHidden(120_000, 60_000);
  assert.deepEqual(m.session(), { score: 50, onScreen: 50, attention: 50 });
  assert.equal(m.totals.trackedMs, 120_000);
});

test("right now only looks at the last LIVE_WINDOW_MS", () => {
  const m = new ActivenessMeter();
  for (let t = 0; t < 600_000; t += 1000) m.addSample(t, EMPTY, 1000);
  for (let t = 600_000; t < 600_000 + LIVE_WINDOW_MS + 1000; t += 1000) m.addSample(t, ON, 1000);
  assert.equal(m.live(600_000 + LIVE_WINDOW_MS).score, 100);
  assert.ok((m.session().score ?? 100) < 40);
});

test("resumes from persisted totals and ignores junk", () => {
  const saved = { ...emptyTotals(), trackedMs: 10_000, faceMs: 10_000, attentiveMs: 5_000, awayCount: 2 };
  const m = new ActivenessMeter(saved);
  assert.deepEqual(m.session(), { score: 75, onScreen: 100, attention: 50 });
  assert.equal(m.totals.awayCount, 2);
  saved.trackedMs = 0; // the meter keeps its own copy
  assert.equal(m.totals.trackedMs, 10_000);
  assert.deepEqual(new ActivenessMeter({ trackedMs: "x" }).totals, emptyTotals());
  assert.deepEqual(new ActivenessMeter({ ...emptyTotals(), faceMs: -1 }).totals, emptyTotals());
});

test("combine needs both parts", () => {
  assert.equal(combine(null, 50), null);
  assert.equal(combine(90, 70), 80);
});

test("reason: the latest reading wins while it is not attentive", () => {
  const m = new ActivenessMeter();
  m.addSample(0, EMPTY, 5000);
  m.addSample(5000, { ...LOOKING_AWAY, turn: "down" }, 1000);
  const l = m.live(6000);
  assert.equal(l.reason, "down");
  assert.equal(l.reasonIsCurrent, true);
});

test("reason: once attentive again, the biggest loss in the window explains a low score", () => {
  const m = new ActivenessMeter();
  m.addSample(0, { ...EMPTY, dark: true }, 8000);
  m.addSample(8000, DOZING, 2000);
  m.addSample(10_000, ON, 1000);
  const l = m.live(11_000);
  assert.equal(l.reason, "dark");
  assert.equal(l.reasonIsCurrent, false);
});

test("reason: every kind is classified", () => {
  const m = new ActivenessMeter();
  const cases: [Parameters<ActivenessMeter["addSample"]>[1], string][] = [
    [EMPTY, "away"],
    [{ ...EMPTY, dark: true }, "dark"],
    [{ ...LOOKING_AWAY, turn: "side" }, "side"],
    [{ ...LOOKING_AWAY, turn: "up" }, "up"],
    [LOOKING_AWAY, "side"],
    [DOZING, "eyes"],
  ];
  cases.forEach(([s, want], i) => {
    m.addSample(i * 1000, s, 1000);
    assert.equal(m.live(i * 1000).reason, want);
  });
  m.addHidden(10_000, 3000);
  assert.equal(m.live(10_000).reason, "hidden");
  m.addSample(11_000, ON, 1000);
  assert.equal(m.live(11_000).reasonIsCurrent, false);
});

test("resetLive clears right now but keeps the class totals", () => {
  const m = new ActivenessMeter();
  m.addSample(0, LOOKING_AWAY, 10_000);
  m.resetLive();
  m.addSample(10_000, ON, 1000);
  assert.equal(m.live(11_000).score, 100);
  assert.equal(m.session().score, 55);
});
