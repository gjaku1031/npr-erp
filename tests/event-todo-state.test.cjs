const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const statePath = path.resolve(__dirname, '../lib/state.tsx');
const stateSource = fs.readFileSync(statePath, 'utf8');
let activeApi;
let activeToasts;

function loadStateModule() {
  const { outputText } = ts.transpileModule(stateSource, {
    fileName: statePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  });
  const mocks = {
    './api': {
      api: {
        get(...args) { return activeApi.get(...args); },
        post(...args) { return activeApi.post(...args); },
        del(...args) { return activeApi.del(...args); },
      },
      setAuthCtx() {},
    },
    './helpers': {
      classesForDate: () => [],
      isSpecialJournal: () => false,
      koDate: (value) => value,
      koDateFull: (value) => value,
      toast: (message) => activeToasts.push(message),
    },
    './counsel-sync': { runSequentialCounselRosterSync: async () => ({}) },
  };
  const originalLoad = Module._load;
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const compiled = new Module(statePath, module);
    compiled.filename = statePath;
    compiled.paths = Module._nodeModulePaths(path.dirname(statePath));
    compiled._compile(outputText, statePath);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const stateModule = loadStateModule();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createApp(events, post) {
  const calls = { posts: [], gets: 0, dels: 0 };
  activeToasts = [];
  activeApi = {
    get() { calls.gets += 1; return Promise.resolve({}); },
    del() { calls.dels += 1; return Promise.resolve({}); },
    post(url, body) {
      calls.posts.push({ url, body });
      return post(url, body, calls.posts.length - 1);
    },
  };
  let App;
  function Probe() {
    App = stateModule.useApp().App;
    return null;
  }
  renderToStaticMarkup(React.createElement(
    stateModule.AppProvider,
    null,
    React.createElement(Probe),
  ));
  App.ui = { role: 'teacher', tid: 'teacher-1' };
  App.state = { events };
  return { App, calls, toasts: activeToasts };
}

test('updateEventTodo accepts only an owned personal event and reflects it before the request completes', async () => {
  const save = deferred();
  const owned = { id: 'mine', type: 'personal', mine: true, descr: '[ ] 기존' };
  const foreign = { id: 'foreign', type: 'personal', mine: false, descr: '[ ] 남의 일정' };
  const team = { id: 'team', type: 'team_event', mine: true, descr: '[ ] 팀 일정' };
  const { App, calls } = createApp([owned, foreign, team], () => save.promise);

  assert.equal(await App.updateEventTodo('missing', '[x] 없음'), false);
  assert.equal(await App.updateEventTodo('foreign', '[x] 탈취'), false);
  assert.equal(await App.updateEventTodo('team', '[x] 팀'), false);
  assert.equal(calls.posts.length, 0);
  assert.equal(foreign.descr, '[ ] 남의 일정');
  assert.equal(team.descr, '[ ] 팀 일정');

  const pending = App.updateEventTodo('mine', '[x] 기존');
  assert.equal(owned.descr, '[x] 기존', '느린 저장을 기다리기 전에 화면 상태를 바꾼다');
  assert.deepEqual(calls.posts, [{
    url: '/api/events/mine/todo',
    body: { descr: '[x] 기존' },
  }]);
  save.resolve({ ok: true, event: { id: 'mine', descr: '[x] 기존' } });
  assert.equal(await pending, true);
  assert.equal(calls.gets, 0);
});

test('updates for the same event are serialized and coalesced through the last desired description', async () => {
  const first = deferred();
  const last = deferred();
  const event = { id: 'event with space', type: 'personal', mine: true, descr: 'confirmed' };
  const { App, calls } = createApp([event], (_url, _body, index) => {
    if (index === 0) return first.promise;
    if (index === 1) return last.promise;
    throw new Error('coalescing must not create a third request');
  });

  const one = App.updateEventTodo(event.id, 'first');
  const two = App.updateEventTodo(event.id, 'second');
  const three = App.updateEventTodo(event.id, 'third');
  assert.strictEqual(two, one);
  assert.strictEqual(three, one);
  assert.equal(event.descr, 'third');
  assert.equal(calls.posts.length, 1);

  first.resolve({ ok: true, event: { id: event.id, descr: 'first' } });
  await flush();
  assert.deepEqual(calls.posts, [
    { url: '/api/events/event%20with%20space/todo', body: { descr: 'first' } },
    { url: '/api/events/event%20with%20space/todo', body: { descr: 'third' } },
  ]);

  last.resolve({ ok: true, event: { id: event.id, descr: 'third' } });
  assert.equal(await one, true);
  assert.equal(event.descr, 'third');
  assert.equal(calls.gets, 0);
});

test('a failed queued save rolls the UI back to the last confirmed description without a full reload', async () => {
  const first = deferred();
  const failing = deferred();
  const event = { id: 'mine', type: 'personal', mine: true, descr: 'baseline' };
  const { App, calls, toasts } = createApp([event], (_url, _body, index) => index === 0 ? first.promise : failing.promise);

  const pending = App.updateEventTodo('mine', 'confirmed-one');
  App.updateEventTodo('mine', 'will-fail');
  first.resolve({ ok: true, event: { id: 'mine', descr: 'confirmed-one' } });
  await flush();
  assert.equal(calls.posts.length, 2);
  App.updateEventTodo('mine', 'coalesced-after-failure');
  assert.equal(event.descr, 'coalesced-after-failure');

  failing.reject(new Error('network unavailable'));
  assert.equal(await pending, false);
  assert.equal(event.descr, 'confirmed-one');
  assert.equal(calls.gets, 0, '실패 복구는 전체 state reload를 호출하지 않는다');
  assert.match(toasts.at(-1), /체크 저장 실패: network unavailable/);
});

test('createEvent returns a boolean promise and leaves the modal and state untouched until the API succeeds', async () => {
  const save = deferred();
  const initialEvents = [{ id: 'existing', type: 'personal', mine: true, descr: '기존' }];
  const { App, calls } = createApp(initialEvents, () => save.promise);
  const initialState = App.state;
  const modal = { type: 'eventCreate', dateInit: '2026-07-23' };
  const draft = {
    title: '오늘 일정',
    desc: '[ ] 전화',
    start: '2026-07-23',
    end: '2026-07-23',
    tag: '개인일정',
  };
  const draftSnapshot = structuredClone(draft);
  App.ui.modal = modal;

  const pending = App.createEvent('personal', draft);

  assert.equal(typeof pending?.then, 'function', 'createEvent는 Promise를 반환한다');
  assert.strictEqual(App.ui.modal, modal, '요청 중에는 호출부가 닫을 모달을 유지한다');
  assert.strictEqual(App.state, initialState, '요청 중에는 기존 상태를 교체하지 않는다');
  assert.deepEqual(draft, draftSnapshot, '요청 payload를 만들 때 입력을 변경하지 않는다');
  assert.deepEqual(calls.posts, [{
    url: '/api/events',
    body: {
      title: '오늘 일정',
      descr: '[ ] 전화',
      start: '2026-07-23',
      end: '2026-07-23',
      mode: 'personal',
      tag: '개인일정',
      tid: 'teacher-1',
      role: 'teacher',
    },
  }]);

  const foldedState = { events: [...initialEvents, { id: 'created' }] };
  save.resolve({ state: foldedState });
  assert.equal(await pending, true);
  assert.strictEqual(App.state, foldedState, '성공 응답을 받은 뒤에만 fold된 상태를 반영한다');
  assert.strictEqual(App.ui.modal, modal, '모달 닫기는 성공 boolean을 받은 호출부가 결정한다');
  assert.equal(calls.gets, 0);
});

test('createEvent and updateEvent return false without losing modal, state, or draft after API failure', async () => {
  const createFailure = deferred();
  const updateFailure = deferred();
  const event = { id: 'mine', type: 'personal', mine: true, descr: '기존 메모' };
  const { App, calls, toasts } = createApp([event], (_url, _body, index) => {
    if (index === 0) return createFailure.promise;
    if (index === 1) return updateFailure.promise;
    throw new Error('unexpected request');
  });
  const initialState = App.state;
  const modal = { type: 'eventCreate' };
  App.ui.modal = modal;

  const createDraft = {
    title: '실패해도 남을 새 일정', desc: '[ ] 다시 시도',
    start: '2026-07-23', end: '2026-07-23', tag: '개인일정',
  };
  const createSnapshot = structuredClone(createDraft);
  const creating = App.createEvent('personal', createDraft);
  assert.equal(typeof creating?.then, 'function');
  createFailure.reject(new Error('create offline'));
  assert.equal(await creating, false);
  assert.strictEqual(App.ui.modal, modal);
  assert.strictEqual(App.state, initialState);
  assert.deepEqual(createDraft, createSnapshot);

  const updateDraft = {
    title: '실패해도 남을 수정', desc: '[x] 수정 메모',
    start: '2026-07-24', end: '2026-07-25', tag: '개인일정',
  };
  const updateSnapshot = structuredClone(updateDraft);
  const updating = App.updateEvent('mine', 'personal', updateDraft);
  assert.equal(typeof updating?.then, 'function', 'updateEvent도 Promise를 반환한다');
  assert.strictEqual(App.ui.modal, modal);
  assert.strictEqual(App.state, initialState);
  updateFailure.reject(new Error('update offline'));
  assert.equal(await updating, false);
  assert.strictEqual(App.ui.modal, modal, '실패 시 재시도할 모달을 유지한다');
  assert.strictEqual(App.state, initialState, '실패 시 기존 화면 상태를 유지한다');
  assert.deepEqual(updateDraft, updateSnapshot, '실패 시 입력값을 보존한다');
  assert.equal(calls.gets, 0, '실패 뒤 reload로 입력 화면을 지연시키지 않는다');
  assert.match(toasts.at(-2), /오류: create offline/);
  assert.match(toasts.at(-1), /오류: update offline/);
});

test('updateEvent waits for a pending todo queue before sending the full event edit', async () => {
  const todoSave = deferred();
  const editSave = deferred();
  const event = { id: 'mine', type: 'personal', mine: true, descr: '[ ] 이전' };
  const { App, calls } = createApp([event], (url) => {
    if (url.endsWith('/todo')) return todoSave.promise;
    if (url.endsWith('/edit')) return editSave.promise;
    throw new Error(`unexpected request: ${url}`);
  });
  const draft = {
    title: '전체 수정', desc: '[x] 전체 수정 메모',
    start: '2026-07-24', end: '2026-07-25', tag: '개인일정',
  };

  const todoPending = App.updateEventTodo('mine', '[x] 먼저 저장');
  const editPending = App.updateEvent('mine', 'personal', draft);

  assert.equal(typeof editPending?.then, 'function');
  assert.deepEqual(calls.posts, [{
    url: '/api/events/mine/todo',
    body: { descr: '[x] 먼저 저장' },
  }], 'todo 확정 전에는 전체 edit 요청을 보내지 않는다');

  todoSave.resolve({ ok: true, event: { id: 'mine', descr: '[x] 먼저 저장' } });
  assert.equal(await todoPending, true);
  await flush();
  assert.deepEqual(calls.posts, [
    { url: '/api/events/mine/todo', body: { descr: '[x] 먼저 저장' } },
    {
      url: '/api/events/mine/edit',
      body: {
        title: '전체 수정',
        descr: '[x] 전체 수정 메모',
        start: '2026-07-24',
        end: '2026-07-25',
        mode: 'personal',
        tag: '개인일정',
      },
    },
  ]);

  const foldedState = { events: [{ ...event, descr: draft.desc, title: draft.title }] };
  editSave.resolve({ state: foldedState });
  assert.equal(await editPending, true);
  assert.strictEqual(App.state, foldedState);
  assert.equal(calls.gets, 0);
});

test('the narrow todo action does not consume folded state or call App.reload', () => {
  const start = stateSource.indexOf('App.updateEventTodo = function');
  const end = stateSource.indexOf('App.deleteEvent = async function', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const actionSource = stateSource.slice(start, end);
  assert.doesNotMatch(actionSource, /App\.reload\s*\(/);
  assert.doesNotMatch(actionSource, /\b(?:response|result|r)\.state\b/);
  assert.doesNotMatch(actionSource, /App\.state\s*=/);
  assert.match(actionSource, /event\.descr = queue\.desired/);
  assert.match(actionSource, /while \(active\.confirmed !== active\.desired\)/);
});
