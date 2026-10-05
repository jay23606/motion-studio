import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep the real ~/.motion-studio out of it: settings go to a throwaway home.
const home = mkdtempSync(join(tmpdir(), 'ms-home-'));
process.env.HOME = process.env.USERPROFILE = home;
const { startServer } = await import('../src/server.mjs');

test('templates survive reopening, create independent videos, validate missing media and trash only the template', async () => {
  const { createWorkspace } = await import('../src/workspace.mjs');
  const { writeFileSync, existsSync } = await import('node:fs');
  const dir = join(home, 'templates'); createWorkspace(dir, 'Templates');
  writeFileSync(join(dir, 'assets/clips/a.png'), 'image'); writeFileSync(join(dir, 'assets/clips/b.png'), 'image');
  const first = await startServer({ port: 0, workspace: dir });
  const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const result = await post(`${first.url}/api/templates`, { id: 'launch', name: 'Launch', spec: { dur: 4, heads: [{ t: 0, text: 'Original' }], clips: [{ src: 'a.png', start: 0, dur: 3, kf: [{ t: 0, s: 1 }, { t: 2, s: 1.2 }] }] } });
    assert.equal(result.status, 201);
    assert.equal((await post(`${first.url}/api/templates`, { id: '../escape', name: 'Bad', spec: {} })).status, 400);
  } finally { await new Promise(ok => first.server.close(ok)); }
  const reopened = await startServer({ port: 0, workspace: dir });
  try {
    const { templates } = await (await fetch(`${reopened.url}/api/state`)).json(); assert.equal(templates[0].name, 'Launch');
    const result = await post(`${reopened.url}/api/videos`, { id: 'new-launch', template: 'launch', values: { 'heads.0.text': 'New', 'media-0': 'b.png' }, brand: 'brand' });
    assert.equal(result.status, 200); const v = await result.json(); assert.equal(v.clips[0].src, 'b.png'); assert.equal(v.heads[0].text, 'New'); assert.equal(v.clips[0].kf[1].s, 1.2);
    const missing = await post(`${reopened.url}/api/videos`, { id: 'bad-launch', template: 'launch', values: { 'media-0': 'missing.png' } }); assert.equal(missing.status, 400);
    assert.equal((await post(`${reopened.url}/api/templates/launch`, { name: 'Renamed', description: 'Test' }, 'PUT')).status, 200);
    assert.equal((await (await fetch(`${reopened.url}/api/templates/launch`)).json()).spec.heads[0].text, 'Original');
    assert.equal((await fetch(`${reopened.url}/api/templates/launch`, { method: 'DELETE' })).status, 200);
    assert.ok(existsSync(join(dir, 'assets/clips/a.png'))); assert.ok(existsSync(join(dir, 'specs/new-launch.json')));
    assert.equal((await fetch(`${reopened.url}/api/templates/launch`)).status, 404);
  } finally { await new Promise(ok => reopened.server.close(ok)); }
});

test('takes the next port in the list when the first is busy', async () => {
  const busy = createServer();
  await new Promise(ok => busy.listen(0, '127.0.0.1', ok));
  const taken = busy.address().port;
  const { server, port } = await startServer({ port: [taken, 0], workspace: join(home, 'none') });
  try {
    assert.notEqual(port, taken);
    assert.ok(port > 0);
  } finally {
    server.close(); busy.close();
  }
});

test('previews load GSAP from the app, not from a CDN, so they work offline', async () => {
  const { createWorkspace } = await import('../src/workspace.mjs');
  const dir = join(home, 'offline');
  createWorkspace(dir, 'Offline');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'specs', 'demo.json'), JSON.stringify({ brand: 'brand', heads: [{ t: 0, text: 'Hi' }], clips: [] }));
  const { server, url } = await startServer({ port: 0, workspace: dir });
  try {
    const page = await (await fetch(`${url}/preview/demo/`)).text();
    assert.doesNotMatch(page, /<script src="https?:/, 'no scripts from the network');
    assert.match(page, /<script src="gsap\.min\.js">/);
    const gsap = await fetch(`${url}/preview/demo/gsap.min.js`);
    assert.equal(gsap.status, 200);
    assert.match(await gsap.text(), /GSAP 3\./);
  } finally {
    server.close();
  }
});

test('projects: taken off the list, or moved to the bin, and the open one gives way to the next', async () => {
  const { createWorkspace } = await import('../src/workspace.mjs');
  const { existsSync } = await import('node:fs');
  const a = join(home, 'proj-a'), b = join(home, 'proj-b'), c = join(home, 'proj-c');
  for (const [d, n] of [[a, 'A'], [b, 'B'], [c, 'C']]) createWorkspace(d, n);
  const trashed = [];
  const { server, url } = await startServer({ port: 0, workspace: a, trash: async p => { trashed.push(p); } });
  const post = (path, body) => fetch(`${url}/api/workspace/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const d of [b, c, a]) await post('open', { path: d }); // recents: a, c, b
    let st = await (await post('remove', { path: b })).json();
    assert.ok(!st.settings.recents.includes(b), 'b is off the list');
    assert.ok(existsSync(b), 'and its folder is still there');
    assert.equal(st.canTrash, true);
    // Removing the open project opens the next one on the list.
    st = await (await post('remove', { path: a })).json();
    assert.equal(st.workspace.path, c);
    // A folder that is not on the list is refused, and so is trashing one that is not a project.
    assert.equal((await post('remove', { path: join(home, 'elsewhere') })).status, 400);
    // Trash: the folder goes to the bin through the app's function and leaves the list.
    st = await (await post('remove', { path: c, trash: true })).json();
    assert.deepEqual(trashed, [c]);
    assert.ok(!st.settings.recents.includes(c));
    assert.notEqual(st.workspace?.path, c);
  } finally { server.close(); }
  // Without a trash function (a browser, not the app) trashing is refused and nothing is removed.
  const again = await startServer({ port: 0, workspace: c });
  try {
    await fetch(`${again.url}/api/workspace/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: c }) });
    const r = await fetch(`${again.url}/api/workspace/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: c, trash: true }) });
    assert.equal(r.status, 400);
    assert.ok(existsSync(c));
  } finally { again.server.close(); }
});
