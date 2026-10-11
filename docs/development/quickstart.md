# 로컬 실행

프로젝트 루트에서 실행한다. **JDK 25**가 필요하다. 다른 런타임(Node.js, Python)은 필요 없다.

## 시연 실행

```bash
./gradlew demoRun
```

임베디드 PostgreSQL을 띄우고 `local` 프로필로 실행한다. 빈 DB에 가상의 학원 하나를 넣으며, 끄면 데이터가 사라진다.
`http://localhost:8080`에서 아래 계정으로 로그인한다. 비밀번호는 모두 `demo-1234!`다(로컬 전용).

| 아이디 | 역할 | 보이는 것 |
|---|---|---|
| `lead` | 팀장 | 업무 배정, 일일보고 관리, 공지, 자료실 전체, 권한 관리, 감사 기록 |
| `teacher1`~`teacher4` | 강사 | 내 업무, 일일보고 작성, 교재·시험지 폴더 |
| `other1` | 다른 팀 | 내 반(알림장·개인 상담일정), 교재 폴더 읽기 |
| `admin` | 플랫폼 슈퍼유저 | 소속 없이 모든 학원 기능 |

사람 이름, 반, 학생, 연락처는 모두 지어낸 값이다.

| 환경 변수 | 뜻 | 기본값 |
|---|---|---|
| `SERVER_PORT` | 포트 | `8080` |
| `NPR_WORKLOG_TODAY` | 업무일지의 오늘을 고정(`YYYY-MM-DD`). 수업이 없는 일요일에 시연할 때 씀 | 한국 시간의 실제 날짜 |
| `NPR_DEMO_PASSWORD` | 시연 계정의 비밀번호 | `demo-1234!` |
| `NPR_STORAGE_LOCAL_ROOT` | 파일 본문을 두는 디렉터리 | `./data/storage` |

## 로컬 PostgreSQL로 실행

데이터를 남기려면 Compose의 PostgreSQL을 쓴다.

```bash
docker compose up -d
./gradlew bootRun --args='--spring.profiles.active=local'
```

다른 DB를 쓰려면 `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`를 넣는다.
`local` 프로필을 빼면 시연 데이터를 넣지 않는다. 그때의 첫 계정은 [운영 명령](../operations/accounts.md)으로 만든다.

## 테스트

```bash
./gradlew test             # 단위·구조 검사. DB 없이 실행
./gradlew integrationTest  # 임베디드 PostgreSQL과 전체 컨텍스트
python3 scripts/check-docs.py
```

통합 테스트는 Docker 없이 돈다. 첫 실행 때 PostgreSQL 바이너리를 내려받는다.
