const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
}

const mappingSource = source('components/screens/LeadMapping.tsx');
const stateSource = source('lib/state.tsx');
const apiSource = source('pages/api/[[...slug]].ts');
const storeSource = source('src/api/store.service.ts');

test('manual class selection stores ERP special categories in period-gated groups', () => {
  assert.match(storeSource, /cls\.topName === '특강' && cls\.dayGroup === 'M'/);
  assert.match(storeSource, /cls\.topName === '특강' && cls\.dayGroup === 'T'/);
  assert.match(mappingSource, /const specialToday = isSpecialJournal\(S, S\.today\)/);
  assert.doesNotMatch(mappingSource, /정규 반 동기화/);
});

test('special-class synchronization remains blocked on both client and server when the period is off', () => {
  assert.match(stateSource, /if \(!App\.state\?\.settings\?\.specialPeriodEnabled\) throw new Error\('특강기간을 먼저 켜 주세요\.'\)/);
  assert.match(apiSource, /if \(!setting\.enabled\) throw new HttpError\(400, '특강기간을 먼저 켜 주세요\.'\)/);
});
