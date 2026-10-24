const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');

// 실제 인증 모듈과 실제 Store·DB로 라우터의 권한 경계를 검증한다. 다른 라우트 테스트는 인증을 대신하므로
// 세션 쿠키·역할 판단·출처 검사·비밀번호 해시는 이 파일이 맡는다.
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, jsx: ts.JsxEmit.React },
  });
  module._compile(outputText, filename);
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const base = path.join(root, request.slice(2));
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.APP_SECRET = 'auth-session-test-secret';
process.env.SEED_MODE = 'clean';
process.env.APP_TODAY = '2026-07-22';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'lead-password';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');
const { hashPassword, verifyPassword, isPasswordHash } = require('../src/auth/password.ts');
const { createSessionToken, verifySessionToken, SESSION_TTL_SECONDS } = require('../src/auth/session.ts');
const { resolveActor, assertSameOrigin, LoginThrottle } = require('../src/auth/index.ts');

let activeBackend;
const backendModule = require('../src/backend.ts');
backendModule.backend = () => activeBackend;
const handler = require('../pages/api/[[...slug]].ts').default;

function createHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-auth-test-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(dir);
    db = new DbService();
    db.init();
  } finally {
    process.chdir(previousCwd);
  }
  const store = new StoreService(db);
  store.createTeacher('Teacher One', 'teacher-1', 'teacher-one-pw');
  store.createTeacher('Teacher Two', 'teacher-2', 'teacher-two-pw');
  activeBackend = { db, store, ttt: {}, specialTtt: {} };
  return {
    db,
    store,
    close() {
      try { db.db.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function call({ method = 'GET', slug, query = {}, body, cookie, origin, host = 'app.test' }) {
  const response = {
    statusCode: 0,
    payload: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
  };
  const headers = { host };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  await handler({ method, query: { slug, ...query }, body: body ?? {}, headers }, response);
  return response;
}

async function login(id, pw) {
  const response = await call({ method: 'POST', slug: ['login'], body: { id, pw } });
  assert.equal(response.statusCode, 201, JSON.stringify(response.payload));
  return { response, cookie: String(response.headers['set-cookie']).split(';')[0] };
}

test('passwords are stored as scrypt hashes and only scrypt hashes verify', () => {
  const hash = hashPassword('secret-1');
  assert.ok(isPasswordHash(hash));
  assert.notEqual(hash, hashPassword('secret-1'), 'each hash uses its own salt');
  assert.deepEqual(verifyPassword(hash, 'secret-1'), { ok: true, needsRehash: false });
  assert.equal(verifyPassword(hash, 'secret-2').ok, false);
  assert.equal(verifyPassword('not-a-hash', 'not-a-hash').ok, false, 'only scrypt hashes can match');
  assert.equal(verifyPassword('', '').ok, false, 'an empty stored value never matches');
  const salt = Buffer.alloc(16, 7);
  const lighter = ['scrypt', 1024, 8, 1, salt.toString('base64'),
    crypto.scryptSync('secret-1', salt, 64, { N: 1024, r: 8, p: 1 }).toString('base64')].join('$');
  assert.deepEqual(verifyPassword(lighter, 'secret-1'), { ok: true, needsRehash: true }, 'a hash made with other parameters asks for a new hash');
  assert.equal(verifyPassword(lighter, 'secret-2').ok, false);
});

test('session tokens reject tampering, foreign signatures and expiry', () => {
  const now = Date.parse('2026-07-22T00:00:00Z');
  const token = createSessionToken('teacher', 'teacher-1', now);
  assert.deepEqual(verifySessionToken(token, now + 1000), {
    kind: 'teacher', tid: 'teacher-1', exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  });
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ kind: 'lead', tid: 'admin', exp: Math.floor(now / 1000) + 3600 })).toString('base64url');
  assert.equal(verifySessionToken(`${forged}.${signature}`, now), null, 'a changed payload fails the signature');
  assert.equal(verifySessionToken(`${payload}.${'A'.repeat(43)}`, now), null);
  assert.equal(verifySessionToken(token, now + (SESSION_TTL_SECONDS + 1) * 1000), null, 'expired');
  assert.equal(verifySessionToken('not-a-token', now), null);
});

test('the actor comes from the session and the requested role is limited to the account permissions', () => {
  const h = createHarness();
  try {
    const cookie = `npr_session=${createSessionToken('teacher', 'teacher-1')}`;
    assert.equal(resolveActor({ headers: {} }, h.store), null, 'no cookie, no actor');
    assert.deepEqual(
      resolveActor({ headers: { cookie }, query: { role: 'lead', tid: 'admin' } }, h.store),
      { role: 'teacher', tid: 'teacher-1' },
      'role=lead and tid=admin in the request do not change who is acting',
    );
    h.store.setTeacherLead('teacher-1', true);
    assert.deepEqual(resolveActor({ headers: { cookie }, query: { role: 'teacher' } }, h.store), { role: 'teacher', tid: 'teacher-1' });
    assert.deepEqual(resolveActor({ headers: { cookie }, query: { role: 'lead' } }, h.store), { role: 'lead', tid: 'teacher-1' });
    h.store.setTeacherLead('teacher-1', false);
    assert.deepEqual(
      resolveActor({ headers: { cookie }, query: { role: 'lead' } }, h.store),
      { role: 'teacher', tid: 'teacher-1' },
      'a revoked lead permission applies to the very next request',
    );
    h.store.deleteTeacher('teacher-1');
    assert.equal(resolveActor({ headers: { cookie } }, h.store), null, 'a deleted account loses its session');
  } finally {
    h.close();
  }
});

test('state-changing requests from another origin are rejected', () => {
  assert.doesNotThrow(() => assertSameOrigin({ method: 'GET', headers: { origin: 'https://evil.test', host: 'app.test' } }));
  assert.doesNotThrow(() => assertSameOrigin({ method: 'POST', headers: { origin: 'https://app.test', host: 'app.test' } }));
  assert.throws(() => assertSameOrigin({ method: 'POST', headers: { origin: 'https://evil.test', host: 'app.test' } }), (e) => e.status === 403);
  assert.throws(() => assertSameOrigin({ method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site', host: 'app.test' } }), (e) => e.status === 403);
  assert.throws(() => assertSameOrigin({ method: 'POST', headers: { origin: 'null', host: 'app.test' } }), (e) => e.status === 403);
});

test('repeated login failures for one address and id are blocked for the window', () => {
  const throttle = new LoginThrottle(3, 1000);
  const key = throttle.key({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } }, 'Admin');
  assert.equal(key, '10.0.0.1|admin');
  for (let i = 0; i < 3; i += 1) { throttle.assertAllowed(key, 0); throttle.recordFailure(key, 0); }
  assert.throws(() => throttle.assertAllowed(key, 10), (e) => e.status === 429);
  assert.doesNotThrow(() => throttle.assertAllowed(key, 1011), 'the block ends after the window');
  throttle.recordFailure(key, 1011);
  throttle.reset(key);
  assert.doesNotThrow(() => throttle.assertAllowed(key, 1012));
});

test('login issues an HttpOnly SameSite cookie and private routes need it', async () => {
  const h = createHarness();
  try {
    const anonymous = await call({ slug: ['state'], query: { role: 'lead', tid: 'admin' } });
    assert.equal(anonymous.statusCode, 401, 'role and tid alone are not a login');

    const wrong = await call({ method: 'POST', slug: ['login'], body: { id: 'admin', pw: 'nope' } });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.headers['set-cookie'], undefined);

    const { response, cookie } = await login('admin', 'lead-password');
    assert.match(response.headers['set-cookie'], /^npr_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
    assert.equal(response.payload.accountKind, undefined, 'the account kind stays inside the cookie');
    assert.equal(response.payload.role, 'lead');

    const state = await call({ slug: ['state'], query: { role: 'lead' }, cookie });
    assert.equal(state.statusCode, 200);
    assert.equal(state.payload.me.tid, 'admin');

    const logout = await call({ method: 'POST', slug: ['logout'], cookie });
    assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  } finally {
    h.close();
  }
});

test('a teacher session cannot act as the lead or as another teacher', async () => {
  const h = createHarness();
  try {
    const { cookie } = await login('teacher-1', 'teacher-one-pw');
    const forged = await call({ slug: ['state'], query: { role: 'lead', tid: 'admin' }, cookie });
    assert.equal(forged.statusCode, 200);
    assert.equal(forged.payload.role, 'teacher');
    assert.equal(forged.payload.me.tid, 'teacher-1');

    const notice = await call({ method: 'POST', slug: ['notices'], body: { text: 'x', role: 'lead' }, cookie });
    assert.equal(notice.statusCode, 403);
    const setting = await call({ method: 'POST', slug: ['settings'], body: { key: 'wtest_m', value: '1' }, cookie });
    assert.equal(setting.statusCode, 403);
    const teacherAdmin = await call({ method: 'POST', slug: ['teachers', 'teacher-2', 'password'], body: { pw: 'x' }, cookie });
    assert.equal(teacherAdmin.statusCode, 403);

    const leadCookie = (await login('admin', 'lead-password')).cookie;
    const created = await call({
      method: 'POST', slug: ['tasks'], cookie: leadCookie,
      body: { title: '업무', tag: '행정', start: '2026-07-20', due: '2026-07-25', all: true, role: 'lead' },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.payload));
    const taskId = created.payload.id;
    const createdByTeacher = await call({
      method: 'POST', slug: ['tasks'], cookie,
      body: { title: '업무', tag: '행정', start: '2026-07-20', due: '2026-07-25', all: true },
    });
    assert.equal(createdByTeacher.statusCode, 403);

    const other = await call({ method: 'POST', slug: ['tasks', taskId, 'status'], body: { teacher: 'Teacher Two', status: 'done' }, cookie });
    assert.equal(other.statusCode, 403, 'a teacher cannot mark another teacher’s task');
    const own = await call({ method: 'POST', slug: ['tasks', taskId, 'status'], body: { teacher: 'Teacher One', status: 'done' }, cookie });
    assert.equal(own.statusCode, 201);

    const otherReport = await call({ slug: ['reports', encodeURIComponent('Teacher Two'), '2026-07-22'], cookie });
    assert.equal(otherReport.statusCode, 403);
    const confirm = await call({ method: 'POST', slug: ['reports', encodeURIComponent('Teacher One'), '2026-07-22', 'confirm'], cookie });
    assert.equal(confirm.statusCode, 403, 'confirming a report is lead-only');
  } finally {
    h.close();
  }
});

test('a session cookie sent from another origin cannot change state', async () => {
  const h = createHarness();
  try {
    const { cookie } = await login('admin', 'lead-password');
    const crossSite = await call({ method: 'POST', slug: ['notices'], body: { text: 'x' }, cookie, origin: 'https://evil.test' });
    assert.equal(crossSite.statusCode, 403);
    const sameSite = await call({ method: 'POST', slug: ['notices'], body: { text: 'x' }, cookie, origin: 'http://app.test' });
    assert.equal(sameSite.statusCode, 201);
  } finally {
    h.close();
  }
});

test('stored passwords are hashes, including passwords a lead sets for a teacher', async () => {
  const h = createHarness();
  try {
    for (const row of h.db.db.prepare('SELECT pw FROM teachers UNION ALL SELECT pw FROM lead_account').all()) {
      assert.ok(isPasswordHash(row.pw), 'every stored password is a hash');
    }
    h.store.setTeacherPassword('teacher-1', 'set-by-lead-1');
    assert.ok(isPasswordHash(h.db.db.prepare('SELECT pw FROM teachers WHERE tid=?').get('teacher-1').pw));
    await login('teacher-1', 'set-by-lead-1');
  } finally {
    h.close();
  }
});
