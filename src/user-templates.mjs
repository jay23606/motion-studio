// Project-local templates keep the edit and media references, with explicit replaceable fields.
const clone = v => JSON.parse(JSON.stringify(v));
const textPaths = v => [
  ...['overline', 'tagline'].filter(k => v[k]).map(k => ({ path: [k], label: k === 'overline' ? 'Bovenregel' : 'Afsluiting' })),
  ...(v.heads || []).map((h, i) => ({ path: ['heads', i, 'text'], label: `Tekst ${i + 1}` })),
  ...(v.chips || []).flatMap((c, i) => ['label', 'text'].filter(k => c[k] && !(k === 'text' && c.count != null)).map(k => ({ path: ['chips', i, k], label: `Callout ${i + 1} · ${k === 'label' ? 'label' : 'tekst'}` }))),
  ...(v.vo?.lines || []).map((l, i) => ({ path: ['vo', 'lines', i, 'text'], label: `Voice-over ${i + 1}` })),
  ...(v.subs || []).map((s, i) => ({ path: ['subs', i, 'text'], label: `Ondertitel ${i + 1}` }))
];
const read = (v, path) => path.reduce((o, k) => o?.[k], v);
export function templateFields(v) {
  return textPaths(v).map(f => ({ ...f, key: f.path.join('.'), type: 'text', value: String(read(v, f.path) || '') })).concat(
    [...new Set([...(v.clips || []), ...(v.clips2 || [])].map(c => c.src).filter(Boolean))].map((src, i) => ({ key: `media-${i}`, type: 'clip', label: `Clip ${i + 1}`, value: src }))
  );
}
export function makeTemplate(v, { name, description = '', fields } = {}) {
  if (!String(name || '').trim()) throw new Error('Geef de template een naam.');
  const spec = clone(v);
  delete spec.id;
  // A generated recording belongs to its original words. Keep the script, regenerate the voice later.
  if (spec.vo?.file) { if (spec.audio === spec.vo.file) delete spec.audio; delete spec.vo.file; }
  for (const l of spec.vo?.lines || []) { delete l.at; delete l.len; }
  const available = templateFields(spec);
  return { version: 1, name: String(name).trim().slice(0, 120), description: String(description).trim().slice(0, 500), spec,
    fields: available.filter(f => !fields || fields.includes(f.key)).map(({ key }) => key) };
}
export function templateSlots(t) { return templateFields(t.spec).filter(f => t.fields.includes(f.key)); }
export function useTemplate(t, values = {}, brand) {
  const spec = clone(t.spec);
  for (const f of templateSlots(t)) {
    if (!Object.hasOwn(values, f.key)) continue;
    const value = String(values[f.key]);
    if (f.type === 'clip') {
      for (const c of [...(spec.clips || []), ...(spec.clips2 || [])]) if (c.src === f.value) {
        c.src = value;
        if (value !== f.value) { c.media = 0; delete c.crop; }
      }
      spec.media = (spec.media || []).map(src => src === f.value ? value : src);
    } else {
      const obj = read(spec, f.path.slice(0, -1));
      obj[f.path.at(-1)] = value;
      if (f.path[0] === 'subs' && value !== f.value) delete obj.wo;
    }
  }
  if (brand) spec.brand = brand;
  return spec;
}
