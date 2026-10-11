# 계정·플랫폼 슈퍼유저 관리

학원 직원의 계정은 권한 관리 화면에서 만든다. 여기서는 화면으로 할 수 없는 일, 곧 **첫 계정과 플랫폼 슈퍼유저**를
다룬다. 운영 명령은 DB 접근 권한이 있는 제한된 환경에서 **`--spring.main.web-application-type=none`**으로만 실행한다.

## 준비

대상 DB의 `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`를 안전하게 넣는다.

```bash
./gradlew bootJar
JAR=build/libs/npr-erp.jar
```

비밀번호는 명령 인자로 받지 않는다. 셸 기록과 프로세스 목록에 남지 않도록 숨김 입력으로 받아 환경 변수로 넘긴다.
비밀번호는 8자 이상, UTF-8 72바이트 이하다.

## 계정 생성

```bash
read -r -s -p '새 계정 비밀번호: ' NPR_ACCOUNT_PASSWORD; printf '\n'
export NPR_ACCOUNT_PASSWORD
java -jar "$JAR" \
  --spring.main.web-application-type=none \
  --npr-command=create-account \
  --username='<로그인-아이디>' \
  --display-name='<표시 이름>' \
  --reason='운영 계정 생성' \
  --confirm=CREATE_ACCOUNT
unset NPR_ACCOUNT_PASSWORD
```

만든 계정의 ID가 로그에 나온다. 계정을 만드는 것만으로는 소속·역할·슈퍼유저 권한이 생기지 않는다.

## 비밀번호 설정

```bash
read -r -s -p '새 비밀번호: ' NPR_ACCOUNT_PASSWORD; printf '\n'
export NPR_ACCOUNT_PASSWORD
java -jar "$JAR" \
  --spring.main.web-application-type=none \
  --npr-command=set-account-password \
  --account-id='<계정 UUID>' \
  --reason='비밀번호 재설정' \
  --confirm=SET_ACCOUNT_PASSWORD
unset NPR_ACCOUNT_PASSWORD
```

이미 열린 세션은 회수되지 않는다.

## 슈퍼유저 부여·회수

첫 슈퍼유저는 실행자 없이 부여한다. 그다음부터는 기존 슈퍼유저를 실행자로 적어야 한다.

```bash
# 첫 슈퍼유저
java -jar "$JAR" --spring.main.web-application-type=none \
  --npr-command=grant-superuser --target-account-id='<계정 UUID>' \
  --reason='초기 구성' --confirm=GRANT_SUPERUSER

# 추가 부여
java -jar "$JAR" --spring.main.web-application-type=none \
  --npr-command=grant-superuser --target-account-id='<계정 UUID>' --actor-account-id='<슈퍼유저 UUID>' \
  --reason='운영 인계' --confirm=GRANT_SUPERUSER

# 회수
java -jar "$JAR" --spring.main.web-application-type=none \
  --npr-command=revoke-superuser --target-account-id='<계정 UUID>' --actor-account-id='<슈퍼유저 UUID>' \
  --reason='권한 회수' --confirm=REVOKE_SUPERUSER
```

부여와 회수는 감사 기록에 남는다. 슈퍼유저는 학원의 역할과 분리돼 있어 학원 관리자가 줄 수 없다
([ADR-0003](../adr/0003-separate-platform-superuser-from-academy-rbac.md)).

학원을 처음 여는 일(권한 정책 초기화, 첫 관리자 역할)은 슈퍼유저만 할 수 있다. 지금은 시연 데이터가 이 절차를
대신하며, 화면이나 운영 명령으로는 제공하지 않는다.
