import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate, templateSlots, useTemplate } from '../src/user-templates.mjs';

const source = () => ({ id: 'original', brand: 'brand', dur: 10, heads: [{ t: 0, text: 'Launch', kf: [{ t: 0, s: 1 }, { t: 2, s: 1.3 }] }],
  clips: [{ src: 'screen.mp4', start: 0, dur: 4, media: 3, crop: { x: 10 }, kf: [{ t: 0, x: 4 }] }],
  clips2: [{ src: 'screen.mp4', start: 4, dur: 3, media: 1 }], media: ['screen.mp4'],
  vo: { file: 'generated.wav', lines: [{ t: 0, text: 'Welcome', at: 1, len: 2 }] }, audio: 'generated.wav',
  subs: [{ t: 0, out: 2, text: 'Welcome', wo: [0] }] });

test('reusing a template replaces shared clips and chosen text without changing its source or motion', () => {
  const original = source(), t = makeTemplate(original, { name: 'Launch template', fields: ['heads.0.text', 'media-0', 'subs.0.text'] });
  const v = useTemplate(t, { 'heads.0.text': 'New launch', 'media-0': 'new.mp4', 'subs.0.text': 'Hello there', 'vo.lines.0.text': 'Ignored' }, 'other');
  assert.equal(v.heads[0].text, 'New launch'); assert.deepEqual(v.heads[0].kf, original.heads[0].kf);
  assert.equal(v.brand, 'other'); assert.equal(v.clips[0].src, 'new.mp4'); assert.equal(v.clips2[0].src, 'new.mp4');
  assert.equal(v.clips[0].media, 0); assert.equal(v.clips[0].crop, undefined); assert.deepEqual(v.clips[0].kf, original.clips[0].kf);
  assert.equal(v.subs[0].wo, undefined); assert.equal(v.vo.lines[0].text, 'Welcome');
  assert.equal(t.spec.heads[0].text, 'Launch'); assert.equal(original.audio, 'generated.wav');
  assert.equal(v.audio, undefined); assert.equal(v.vo.file, undefined); assert.equal(v.vo.lines[0].at, undefined);
  assert.deepEqual(templateSlots(t).map(f => f.key), ['heads.0.text', 'subs.0.text', 'media-0']);
});
test('unchanged sources retain their crop and trim; uploaded voice and music remain reusable', () => {
  const v = source(); v.audio = 'upload.wav'; v.music = { src: 'music.mp3', vol: 0.2 };
  const t = makeTemplate(v, { name: 'Demo' }); const copy = useTemplate(t, { 'media-0': 'screen.mp4' });
  assert.equal(copy.clips[0].media, 3); assert.deepEqual(copy.clips[0].crop, { x: 10 });
  assert.equal(copy.audio, 'upload.wav'); assert.deepEqual(copy.music, v.music);
  assert.throws(() => makeTemplate(v, { name: ' ' }), /naam/);
});
