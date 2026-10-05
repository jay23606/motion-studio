// Keyframes on a clip: `kf: [{ t, x, y, s, r, o, ease }]`. `t` is seconds from the clip's start (from the end of its
// transition when it has one), `x`/`y` a shift in screen pixels, `s` the scale, `r` the rotation in degrees and `o`
// the opacity. `ease` is how the clip gets *to* that keyframe from the one before it. A property a keyframe leaves
// out keeps its neutral value. Shared with the editor at /lib/keyframes.mjs.

export const kfNeutral = { x: 0, y: 0, s: 1, r: 0, o: 1 };

// Easings by their GSAP name (the composition uses that), with the same curve in JS for the editor.
export const kfEases = {
  'power2.inOut': { label: 'Vloeiend', fn: p => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)) },
  none: { label: 'Lineair', fn: p => p },
  'power3.out': { label: 'Uitremmen', fn: p => 1 - (1 - p) ** 3 },
  'power3.in': { label: 'Optrekken', fn: p => p ** 3 },
  'back.out(1.7)': { label: 'Doorschieten', fn: p => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2 },
  'steps(1)': { label: 'Sprong', fn: p => (p >= 1 ? 1 : 0) }
};
export const kfDefaultEase = 'power2.inOut';
export const motionPresets = {
  zoom: { label: 'Rustig inzoomen', icon: 'zoom_in', poses: [{ s: 1 }, { s: 1.18 }] },
  rise: { label: 'Binnenvliegen', icon: 'north_east', poses: [{ x: -90, y: 60, o: 0 }, { x: 0, y: 0, o: 1 }] },
  pop: { label: 'Stuiteren', icon: 'animation', poses: [{ s: 0.65 }, { s: 1, ease: 'back.out(1.7)' }] },
  drift: { label: 'Zweven', icon: 'air', poses: [{ y: 0 }, { y: -35 }, { y: 0 }] },
  turn: { label: 'Draaien', icon: 'rotate_right', poses: [{ r: -8 }, { r: 8 }] }
};
export function presetKeyframes(id, duration) {
  const p = motionPresets[id];
  if (!p) return [];
  const d = Math.max(0.01, Number(duration) || 1);
  return p.poses.map((pose, i) => ({ t: +(d * i / (p.poses.length - 1)).toFixed(3), ...kfNeutral, ease: kfDefaultEase, ...pose }));
}
// Keep one pose per frame, including a neutral start when the first edit is later in the subject.
export function putKeyframe(list, t, pose, { anchor = false } = {}) {
  const ks = kfList(list).filter(k => Math.abs(k.t - t) >= 1 / 60);
  if (anchor && !ks.length && t > 1 / 60) ks.push({ t: 0, ...kfNeutral, ease: kfDefaultEase });
  ks.push({ t: +t.toFixed(3), ...kfFull(pose), ease: pose.ease || kfDefaultEase });
  return ks.sort((a, b) => a.t - b.t);
}
export function motionRange(v, kind, i = 0) {
  const end = v.outro === 'off' ? (v.dur ?? 15) : Math.min(v.end ?? 12.6, v.dur ?? 15);
  if (kind === 'device') return { start: 0, duration: end };
  if (kind === 'head') {
    const h = v.heads[i], next = v.heads.filter(n => n.t > h.t).sort((a, b) => a.t - b.t)[0];
    return { start: h.t, duration: Math.max(0.01, Math.min(end, next?.t ?? end) - h.t) };
  }
  const c = v[kind][i];
  return { start: c.start ?? c.t, duration: c.dur ?? Math.max(0.01, c.out - c.t) };
}
const easeFn = e => (kfEases[e] || kfEases[kfDefaultEase]).fn;

const num = (n, d) => (Number.isFinite(+n) && n !== null && n !== '' ? +n : d);

// A keyframe with every property filled in.
export const kfFull = k => ({ x: num(k.x, kfNeutral.x), y: num(k.y, kfNeutral.y), s: num(k.s, kfNeutral.s), r: num(k.r, kfNeutral.r), o: num(k.o, kfNeutral.o) });

// The keyframes of a clip, sorted, with times kept inside 0..max and junk dropped.
export function kfList(list, max = Infinity) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(k => k && Number.isFinite(+k.t))
    .map(k => ({ ...k, t: Math.max(0, Math.min(+k.t, max)) }))
    .sort((a, b) => a.t - b.t);
}

// The values at time `t` (seconds from the clip's start): before the first keyframe the first one holds, after the
// last one the last one holds, in between the eased mix of the two around it.
export function kfAt(list, t) {
  const ks = kfList(list);
  if (!ks.length) return { ...kfNeutral };
  if (t <= ks[0].t) return kfFull(ks[0]);
  for (let i = 1; i < ks.length; i++) {
    if (t > ks[i].t) continue;
    const a = kfFull(ks[i - 1]), b = kfFull(ks[i]), span = ks[i].t - ks[i - 1].t;
    const p = span > 0 ? easeFn(ks[i].ease)((t - ks[i - 1].t) / span) : 1;
    return Object.fromEntries(Object.keys(kfNeutral).map(key => [key, +(a[key] + (b[key] - a[key]) * p).toFixed(3)]));
  }
  return kfFull(ks[ks.length - 1]);
}

// GSAP properties of a keyframe.
const gsapProps = k => { const f = kfFull(k); return { x: f.x, y: f.y, scale: f.s, rotation: f.r, opacity: f.o }; };

// What the composition plays for one clip that starts at `base`: `set` (the first keyframe, applied at `base`) and
// one tween per pair of neighbouring keyframes. Empty when there are fewer than one keyframe.
export function kfPlan(list, base, max = Infinity) {
  const ks = kfList(list, max);
  if (!ks.length) return null;
  const at = t => +(base + t).toFixed(3);
  const segs = [];
  for (let i = 1; i < ks.length; i++) {
    const d = ks[i].t - ks[i - 1].t;
    if (d <= 0) continue;
    segs.push({ t: at(ks[i - 1].t), d: +d.toFixed(3), from: gsapProps(ks[i - 1]), to: gsapProps(ks[i]), ease: kfEases[ks[i].ease] ? ks[i].ease : kfDefaultEase });
  }
  return { set: gsapProps(ks[0]), setAt: at(0), segs };
}
