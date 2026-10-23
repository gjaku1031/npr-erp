// 백엔드 싱글톤 — DB/Store/외부 ERP 서비스를 프로세스당 1회만 생성(DB 커넥션 공유).
import { DbService } from './db/db.service';
import { StoreService } from './api/store.service';
import { MockTttGateway } from './ttt/ttt.mock';
import { TttService, TttSpecialService } from './ttt/ttt.service';

let _db: DbService | null = null;
let _store: StoreService | null = null;
let _ttt: TttService | null = null;
let _specialTtt: TttSpecialService | null = null;

export function backend() {
  if (!_db) {
    // init()이 던지면 _db를 남기지 않는다 — 남기면 이후 호출이 !_db=false로 재초기화를 건너뛰어
    // store/ttt=null 상태가 프로세스 내내 고착(모든 요청이 혼란스러운 null 에러로 500). 성공 후에만 할당.
    const db = new DbService();
    db.init();
    const store = new StoreService(db);
    // 기존 DB에도 두 시스템 상담 태그를 보장하고, Turso 원격에 즉시 영속한다.
    if (store.ensureFixedTags()) db.syncStrict();
    // 공개 저장소의 외부 ERP 구현은 모의 구현뿐이다. 모의 ERP의 직원 명단은 앱의 강사 명단을 따른다.
    const gateway = new MockTttGateway(() =>
      db.all<any>('SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name').map((row) => row.name));
    _store = store;
    _ttt = new TttService(gateway);
    _specialTtt = new TttSpecialService(gateway);
    _db = db;
  }
  return { db: _db, store: _store as StoreService, ttt: _ttt as TttService, specialTtt: _specialTtt as TttSpecialService };
}
