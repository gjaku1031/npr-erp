import { encrypt } from '../ttt/crypto';

type Database = any; // libSQL(better-sqlite3 호환) 핸들

/**
 * 깨끗한 부트스트랩 — 로그인용 팀장 계정 + 기본 태그만. 데모/목데이터 없음.
 * 배포(운영) 기본값. 새로 바로 사용할 수 있는 빈 상태.
 */
export function bootstrapClean(db: Database): boolean {
  const has = db.prepare('SELECT COUNT(*) c FROM lead_account').get() as { c: number };
  if (has.c > 0) return false; // 이미 부트스트랩됨 → 원격 동기화 push 불필요
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO lead_account(id,pw,name) VALUES(?,?,?)').run(
      process.env.LEAD_ID || 'admin', process.env.LEAD_PW || '1234', process.env.LEAD_NAME || '팀장',
    );
    // 업무 생성에 필요한 기본 태그(설정성 기본값)
    const tags: [string, string, string, number][] = [
      ['채점', '올리브', '✏️', 1], ['상담', '블루', '💬', 2], ['특강 상담', '올리브', '✦', 3],
      ['교재', '옐로', '📚', 4], ['행정', '#2c3d5e', '📋', 5], ['행사', '#2f9e44', '📣', 6],
    ];
    const ins = db.prepare('INSERT INTO tags(name,color,emoji,sort) VALUES(?,?,?,?)');
    for (const t of tags) ins.run(...t);
  });
  tx();
  return true;
}

/**
 * 디자인 프로토타입(업무일지 시스템.dc.html)의 초기 상태와 동일한 시드.
 * 날짜는 2026년 7월 기준(오늘=2026-07-11 토)으로 ISO 저장.
 * 반 이름은 디자인 샘플(중등부) 그대로 — 실제 초등부 반은 '강사 현황' 화면에서 교체.
 */
export function seedIfEmpty(db: Database): boolean {
  const n = db.prepare('SELECT COUNT(*) c FROM teachers').get() as { c: number };
  if (n.c > 0) return false;

  const tx = db.transaction(() => {
    // ── 팀장 계정 ── (teachers는 비었지만 lead_account가 이미 있는 경우에도 안전하게 재시드)
    db.prepare('INSERT OR IGNORE INTO lead_account(id,pw,name) VALUES(?,?,?)').run('admin', '1234', '김도현');

    // ── 강사 ──
    const teachers: [string, string, any, number][] = [
      ['kim.mj', '김민지', { 월수금반: ['고1-C'], 화목토반: [] }, 1],
      ['park.sj', '박서준', { 월수금반: ['중2-C'], 화목토반: ['고2-B'] }, 2],
      ['lee.he', '이하은', { 월수금반: ['중3-A'], 화목토반: ['중2-B', '중1-D'] }, 3],
      ['choi.jw', '최지우', { 월수금반: ['중1-B'], 화목토반: [] }, 4],
      ['jung.di', '정다인', { 월수금반: [], 화목토반: ['중3-C'] }, 5],
      ['han.dy', '한도윤', { 월수금반: ['고2-A'], 화목토반: [] }, 6],
      ['song.yr', '송예린', { 월수금반: [], 화목토반: ['중1-A'] }, 7],
      ['oh.jh', '오지호', { 월수금반: [], 화목토반: [] }, 8],
      ['moon.gy', '문가영', { 월수금반: ['중3-B'], 화목토반: [] }, 9],
      ['lim.jh', '임재현', { 월수금반: [], 화목토반: ['고1-B'] }, 10],
    ];
    const insT = db.prepare('INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)');
    for (const [tid, name, classes, sort] of teachers) insT.run(tid, name, '1234', JSON.stringify(classes), sort);
    // 데모 강사는 모의 ERP 계정을 미리 연결해 반 불러오기·출결·상담 조회를 바로 시험할 수 있게 한다.
    const demoErpPassword = encrypt('demo');
    const linkErp = db.prepare('UPDATE teachers SET ttt_id=?, ttt_pw=? WHERE tid=?');
    for (const [tid] of teachers) linkErp.run(tid, demoErpPassword, tid);

    // ── 태그 ──
    const tags: [string, string, string, number][] = [
      ['채점', '올리브', '✏️', 1],
      ['상담', '블루', '💬', 2],
      ['특강 상담', '올리브', '✦', 3],
      ['교재', '옐로', '📚', 4],
      ['행정', '#2c3d5e', '📋', 5],
      ['행사', '#2f9e44', '📣', 6],
    ];
    const insTag = db.prepare('INSERT INTO tags(name,color,emoji,sort) VALUES(?,?,?,?)');
    for (const t of tags) insTag.run(...t);

    // ── 업무 ──
    const insTask = db.prepare(
      `INSERT INTO tasks(id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,counsel,archived,links,atts,created_at,sort)
       VALUES(@id,@title,@descr,@tag,@start_date,@due_date,@scope,@report_req,@attach_req,@counsel,@archived,@links,@atts,@created_at,@sort)`,
    );
    const tasks = [
      {
        id: 't1', title: '7월 모의고사 채점 및 성적 입력',
        descr: '채점 후 통통통 성적 입력까지 완료해 주세요. 서술형 문항은 첨부된 채점 기준을 따릅니다.',
        tag: '채점', start_date: '2026-07-08', due_date: '2026-07-13', scope: '"all"',
        report_req: 1, attach_req: 0, archived: 0,
        links: JSON.stringify([{ label: '성적 입력 시트', url: 'https://docs.google.com/spreadsheets/d/np-score-2026' }]),
        atts: JSON.stringify(['7월모의고사_채점기준.pdf']), created_at: '2026-07-08', sort: 1,
      },
      {
        id: 't2', title: '여름특강 교재 재고 확인',
        descr: '담당 반 교재 잔여 수량을 세어 시트에 입력해 주세요. 부족분은 12일까지 주문 예정입니다.',
        tag: '교재', start_date: '2026-07-10', due_date: '2026-07-17', scope: '"all"',
        report_req: 0, attach_req: 1, archived: 0,
        links: JSON.stringify([{ label: '재고 입력 시트', url: 'https://docs.google.com/spreadsheets/d/np-stock-2026' }]),
        atts: '[]', created_at: '2026-07-10', sort: 2,
      },
      {
        id: 't3', title: '신규 상담 대기자 연락',
        descr: '배정된 상담 대기 학부모에게 전화해 상담 일정을 확정해 주세요.',
        tag: '상담', start_date: '2026-07-09', due_date: '2026-07-12',
        scope: JSON.stringify(['김민지', '박서준', '이하은']),
        report_req: 0, attach_req: 0, archived: 0, links: '[]', atts: '[]', created_at: '2026-07-09', sort: 3,
      },
      {
        id: 't4', title: '학부모 간담회 좌석 배치안',
        descr: '간담회장 좌석 배치 초안을 작성해 공유해 주세요.',
        tag: '행사', start_date: '2026-07-13', due_date: '2026-07-20',
        scope: JSON.stringify(['최지우', '정다인']),
        report_req: 0, attach_req: 0, archived: 0, links: '[]', atts: '[]', created_at: '2026-07-13', sort: 4,
      },
      {
        id: 't5', title: '6월 성적표 발송 확인',
        descr: '전 반 성적표 발송 여부를 확인해 주세요.',
        tag: '행정', start_date: '2026-07-01', due_date: '2026-07-04', scope: '"all"',
        report_req: 0, attach_req: 0, archived: 1, links: '[]', atts: '[]', created_at: '2026-07-01', sort: 5,
      },
    ];
    for (const t of tasks) insTask.run({ ...t, counsel: t.tag === '상담' ? 1 : 0 });

    // ── 업무 처리 상태 ──
    const insSt = db.prepare(
      'INSERT INTO task_status(task_id,teacher,status,report_text,report_files,at) VALUES(?,?,?,?,?,?)',
    );
    const done = (id: string, name: string, at: string, report = '') =>
      insSt.run(id, name, 'done', report, '[]', at);
    const undone = (id: string, name: string, at: string) => insSt.run(id, name, 'undone', '', '[]', at);
    // t1
    done('t1', '김민지', '09:30', '채점 완료, 성적 입력함. 서술형 3번 부분점수 기준 적용.');
    done('t1', '박서준', '10:11'); done('t1', '최지우', '10:40'); done('t1', '한도윤', '11:00');
    done('t1', '송예린', '12:20'); done('t1', '문가영', '13:05'); undone('t1', '정다인', '11:20');
    // t2  (이하은 = done + report)
    done('t2', '김민지', '어제'); done('t2', '박서준', '어제');
    insSt.run('t2', '이하은', 'done', '재고 32권 확인, 시트 입력 완료.', JSON.stringify(['재고사진_01.jpg']), '어제');
    // t3
    done('t3', '김민지', '10:02', '2건 통화 완료 — 7/14, 7/15 상담 확정.'); done('t3', '박서준', '10:45');
    // t5 archived — 전원 완료
    for (const [, name] of teachers) done('t5', name, '');

    // ── 일정(개인/팀) ──
    const insEv = db.prepare(
      'INSERT INTO events(id,owner,type,tag,title,descr,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)',
    );
    insEv.run('pl1', 'lead', 'personal', '개인일정', '교육지원청 회의', '오후 2시 · 교육지원청 3층', '2026-07-14', '2026-07-14');
    insEv.run('pm1', 'lee.he', 'personal', '개인일정', '치과 예약', '18:30 · 동네 치과', '2026-07-13', '2026-07-13');
    insEv.run('te1', 'team', 'team_event', '일정', '대입설명회 리허설', '13:00 · 강의동 3층 — 전 강사 참석', '2026-07-19', '2026-07-19');

    // ── 공지 ──
    const insN = db.prepare('INSERT INTO notices(id,text,active,posted_date,author,sort) VALUES(?,?,?,?,?,?)');
    insN.run('n1', '7월 19일(일) 대입설명회 리허설 — 전 강사 13:00까지 강의동 3층 집합', 1, '2026-07-08', '팀장 김도현', 1);
    insN.run('n2', '여름특강 시간표 초안 검토 — 7월 15일까지 의견 제출해 주세요', 1, '2026-07-06', '팀장 김도현', 2);
    insN.run('n3', '6월 정산 서류 제출 마감 안내', 0, '2026-06-30', '팀장 김도현', 3);

    // ── 날짜별 일일보고 정의 ──
    const insJ = db.prepare('INSERT INTO journals(date,created_at) VALUES(?,?)');
    const insJI = db.prepare('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)');
    const journal = (date: string, items: [string, number][]) => {
      insJ.run(date, date);
      items.forEach(([text, req], i) => insJI.run(`${date}-${i}`, date, text, req, i));
    };
    // 오늘(2026-07-11) 체크리스트
    journal('2026-07-11', [
      ['교실 환기·정리 상태 확인', 1],
      ['보강 대상 학생 연락', 1],
      ['주간 테스트 채점 입력', 0],
      ['교재 진도 기록', 0],
    ]);
    journal('2026-07-10', [['교실 환기·정리 상태 확인', 1], ['보강 대상 학생 연락', 1], ['주간 테스트 채점 입력', 0]]);
    journal('2026-07-09', [['교실 환기·정리 상태 확인', 1], ['보강 대상 학생 연락', 1], ['주간 테스트 채점 입력', 0]]);
    journal('2026-07-08', [['교실 환기·정리 상태 확인', 1], ['여름특강 홍보물 부착 확인', 0]]);
    journal('2026-07-07', [['교실 환기·정리 상태 확인', 1], ['보강 대상 학생 연락', 1]]);

    // ── 일일보고 제출물 (오늘) ──
    const insDR = db.prepare(
      `INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)`,
    );
    // time(제출시각) 있는 강사 = 제출, confirmed 목록 = 확인 완료
    const todaySubs: [string, string][] = [
      ['김민지', '09:12'], ['박서준', '09:40'], ['최지우', '10:05'], ['한도윤', '10:22'],
      ['송예린', '11:02'], ['문가영', '11:15'], ['임재현', '13:40'],
    ];
    const confirmedToday = new Set(['김민지', '박서준', '최지우', '한도윤']);
    for (const [name, time] of todaySubs) {
      insDR.run(`dr-0711-${name}`, name, '2026-07-11', 'submitted', confirmedToday.has(name) ? 1 : 0, '{}', time);
    }
    // 이하은 과거 제출(지난 일일보고 목록용)
    const lhPast: [string, number][] = [['2026-07-10', 1], ['2026-07-09', 2], ['2026-07-08', 1], ['2026-07-07', 2]];
    for (const [date, nb] of lhPast) {
      insDR.run(`dr-${date}-이하은`, '이하은', date, 'submitted', 1, JSON.stringify({ nb }), '09:0' + nb);
    }
  });

  tx();
  return true;
}
