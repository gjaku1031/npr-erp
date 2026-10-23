const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText, file);

const {
  countCounselWriteMatches,
  reconcileCounselWrite,
  writeCounselVerified,
} = require('../src/ttt/counsel-write.ts');
const { TttCounselWriteIndeterminateError } = require('../src/ttt/ttt.records.ts');

const account = { id: 'teacher', pw: 'secret' };

function counselEvidenceRow(overrides = {}) {
  return {
    scode: 'S1',
    student: 'Student',
    topic: 'Special counsel',
    body: 'Exact body',
    date: '2026-07-22',
    ...overrides,
  };
}

/**
 * 외부 ERP 포트의 가짜 구현. 첫 읽기는 저장 전 목록, 이후 읽기는 afterSequence(또는 afterRows)를 차례로 돌려준다.
 * 저장 요청과 목록 읽기 횟수를 세어, 규칙이 저장 요청을 반복하지 않는지 확인한다.
 */
function fakeGateway({
  afterRows = [],
  afterSequence,
  failAfterRead = false,
  includeInitialBeforeRead = true,
  postResponse = { sessionExpired: false, notice: '' },
  postError,
} = {}) {
  let evidenceReads = 0;
  let writePosts = 0;
  const beforeRows = [counselEvidenceRow()];
  return {
    stats: () => ({ evidenceReads, writePosts }),
    gateway: {
      async resolveClassCode(_account, className) {
        return className === 'Special Class' ? 'C1' : null;
      },
      async listCounselEvidence(_account, classCode, filter) {
        assert.equal(classCode, 'C1');
        assert.deepEqual(filter, { scode: 'S1', date: '2026-07-22' });
        evidenceReads += 1;
        const isInitialBeforeRead = includeInitialBeforeRead && evidenceReads === 1;
        if (failAfterRead && !isInitialBeforeRead) throw new Error('simulated read-back failure');
        const readIndex = evidenceReads - (includeInitialBeforeRead ? 2 : 1);
        const selected = isInitialBeforeRead
          ? beforeRows
          : afterSequence?.[Math.min(Math.max(readIndex, 0), afterSequence.length - 1)] ?? afterRows;
        if (selected instanceof Error) throw selected;
        return selected;
      },
      async postCounsel(_account, input) {
        writePosts += 1;
        assert.equal(input.classCode, 'C1');
        if (postError) throw postError;
        return postResponse;
      },
    },
  };
}

const args = {
  scode: 'S1',
  sname: 'Student',
  className: 'Special Class',
  subject: 'Special counsel',
  content: 'Exact body',
  date: '2026-07-22',
};
const longArgs = { ...args, content: '1234567890 and the remaining private counsel body' };

test('counsel write accepts the observed 9-to-10-character body preview only when the matching row count increases', async () => {
  assert.equal(countCounselWriteMatches([
    counselEvidenceRow(),
    counselEvidenceRow({ body: 'different' }),
    counselEvidenceRow({ date: '2026-07-21' }),
  ], args, args.date), 1);
  assert.equal(countCounselWriteMatches([
    counselEvidenceRow({ body: '1234567890' }),
    counselEvidenceRow({ body: '123456789' }),
    counselEvidenceRow({ body: '12345678' }), // 운영에서 관측한 9자보다 짧은 앞부분은 거부
    counselEvidenceRow({ body: '12345678X' }),
    counselEvidenceRow({ body: '123456789X' }),
  ], longArgs, args.date), 2);

  const fake = fakeGateway({ afterRows: [counselEvidenceRow(), counselEvidenceRow()] });
  const result = await writeCounselVerified(fake.gateway, account, args, { delaysMs: [0] });
  assert.deepEqual(result, {
    ok: true,
    verified: true,
    verification: 'read-after-write-count-increased',
    beforeCount: 1,
    afterCount: 2,
    writeDate: '2026-07-22',
  });
  assert.deepEqual(fake.stats(), { evidenceReads: 2, writePosts: 1 });
});

test('counsel write keeps polling after a transient read error and confirms a delayed truncated preview', async () => {
  const fake = fakeGateway({
    afterSequence: [
      new Error('transient read failure'),
      [counselEvidenceRow({ body: '1234567890' })],
    ],
  });
  const result = await writeCounselVerified(fake.gateway, account, longArgs, { delaysMs: [0, 0] });
  assert.equal(result.verified, true);
  assert.equal(result.beforeCount, 0);
  assert.equal(result.afterCount, 1);
  assert.equal(result.writeDate, '2026-07-22');
  assert.deepEqual(fake.stats(), { evidenceReads: 3, writePosts: 1 });
});

test('counsel before-post hook is awaited after the initial read and blocks the post when persistence fails', async () => {
  const fake = fakeGateway({ afterRows: [counselEvidenceRow(), counselEvidenceRow()] });
  const persistenceError = new Error('simulated attempt persistence failure');
  let hookEvidence;
  await assert.rejects(
    writeCounselVerified(fake.gateway, account, args, {
      delaysMs: [0],
      onBeforePost: async (evidence) => {
        await Promise.resolve();
        hookEvidence = evidence;
        assert.deepEqual(fake.stats(), { evidenceReads: 1, writePosts: 0 });
        throw persistenceError;
      },
    }),
    (error) => error === persistenceError,
  );
  assert.deepEqual(hookEvidence, { beforeCount: 1, writeDate: '2026-07-22' });
  assert.deepEqual(fake.stats(), { evidenceReads: 1, writePosts: 0 });
});

test('an expired-session response after the post is indeterminate and is never treated as a safe retry', async () => {
  const fake = fakeGateway({ postResponse: { sessionExpired: true, notice: '' } });
  await assert.rejects(
    writeCounselVerified(fake.gateway, account, args, { delaysMs: [0] }),
    (error) => error instanceof TttCounselWriteIndeterminateError
      && error.beforeCount === 1
      && error.writeDate === '2026-07-22',
  );
  assert.deepEqual(fake.stats(), { evidenceReads: 1, writePosts: 1 });
});

test('a post whose delivery is unknown is indeterminate and is not resent', async () => {
  const fake = fakeGateway({ postError: new Error('socket hang up') });
  await assert.rejects(
    writeCounselVerified(fake.gateway, account, args, { delaysMs: [0] }),
    (error) => error instanceof TttCounselWriteIndeterminateError && error.beforeCount === 1,
  );
  assert.deepEqual(fake.stats(), { evidenceReads: 1, writePosts: 1 });
});

test('counsel reconcile is read-only and can confirm a previously indeterminate write', async () => {
  const fake = fakeGateway({
    includeInitialBeforeRead: false,
    afterRows: [counselEvidenceRow({ body: '123456789' })],
  });
  const result = await reconcileCounselWrite(fake.gateway, account, longArgs, 0, longArgs.date, { delaysMs: [0] });
  assert.deepEqual(result, {
    confirmed: true,
    verification: 'read-after-write-count-increased',
    beforeCount: 0,
    afterCount: 1,
    writeDate: '2026-07-22',
  });
  assert.deepEqual(fake.stats(), { evidenceReads: 1, writePosts: 0 });
});

test('counsel write is indeterminate and never reports success when post-write read-back fails', async () => {
  const fake = fakeGateway({ afterRows: [], failAfterRead: true });
  let caught;
  try {
    await writeCounselVerified(fake.gateway, account, args, { delaysMs: [0] });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TttCounselWriteIndeterminateError);
  assert.equal(caught.beforeCount, 1);
  assert.equal(caught.afterCount, 1);
  assert.equal(caught.writeDate, '2026-07-22');
  assert.deepEqual(fake.stats(), { evidenceReads: 2, writePosts: 1 });
});

test('an unsupported counsel kind is rejected before any read or post', async () => {
  const fake = fakeGateway();
  await assert.rejects(
    writeCounselVerified(fake.gateway, account, { ...args, kind: 'unknown' }, { delaysMs: [0] }),
    /지원하지 않는/,
  );
  assert.deepEqual(fake.stats(), { evidenceReads: 0, writePosts: 0 });
});
