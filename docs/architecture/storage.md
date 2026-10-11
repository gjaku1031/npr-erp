# 자료실

PostgreSQL은 파일·폴더 메타데이터와 작업의 원장이고, 저장소 포트 뒤의 디스크는 파일 본문의 원장이다.
자료실 모듈은 누가 요청했는지 따지지 않는다. 권한은 요청을 받는 쪽이 확인한다.

## 트리·작업 계약

내부 UUID와 파일 이름·저장 경로를 분리한다. 학원마다 Root가 하나 있으며 Root의 이동·이름 변경·삭제는 거부한다.
이름·조상·학원·중복을 서버에서 검증하고, 클라이언트가 준 경로를 신뢰하지 않는다.

폴더 생성·이동·이름 변경·영구 삭제·올리기는 **실행 전에 작업 원장에 기록**하고,
저장소 포트를 호출한 뒤 결과를 확인해 트리를 확정한다. 호출하는 동안 DB 트랜잭션을 열어 두지 않는다.

```text
① 원장에 PENDING 기록, 노드를 MUTATING으로 표시 (짧은 트랜잭션)
② 트랜잭션 밖에서 저장소 포트 호출 (작업 UUID를 함께 넘김)
③ 성공이면 COMPLETED로 확정, 명확한 실패면 되돌림 (짧은 트랜잭션)
```

①을 커밋한 뒤 ③ 전에 프로세스가 끊기면 원장에는 끝나지 않은 작업(`PENDING` 또는 `PROCESSING`)이 남고, 대상 노드는
변경 중으로 잠겨 있다. 다시 시작할 때 이런 작업을 `VERIFY`로 표시한다.
운영자가 작업 기록 화면에서 대조를 실행하면 같은 작업 UUID로 포트를 다시 부른다. 포트의 연산은 같은 UUID로 다시
불러도 결과가 같도록(멱등) 만들었으므로, 이미 끝난 변경은 그대로 두고 끝나지 않은 변경만 마저 한다.
올리기는 본문을 다시 구할 수 없어 남은 임시 파일을 지우고 실패로 정리한다. 다시 시도해도 안 되는 실패는 `MANUAL_REVIEW`로 남긴다.

휴지통은 논리 상태이며 파일을 즉시 옮기거나 지우지 않는다. 복원 위치는 원래 폴더로 한정한다.
영구 삭제는 저장소에서 지워진 것을 확인한 뒤 tombstone으로 확정한다. 자동 보존 기간은 없다.

## 저장소 포트

| 연산 | 뜻 |
|---|---|
| `createDirectory`, `move`, `deleteRecursively` | 트리 변경. 작업 UUID로 멱등 |
| `write` | 임시 이름으로 받아 크기와 SHA-256을 확인한 뒤 최종 이름으로 확정 |
| `open` | 파일 하나를 스트림으로 읽음 |

어댑터는 `LocalFilesystemStorageGateway` 하나다. 학원마다 `academies/{academyId}` 아래로 경로를 가두고,
상위 경로로 벗어나는 요청을 거부한다. NAS나 오브젝트 저장소로 옮길 때는 어댑터만 추가한다.

## 권한 연결

`bootstrap`의 `StorageController`가 대상 노드와 조상을 `ResourceContext`로 만들어 권한 엔진에 넘긴다.

| 요청 | 필요한 Permission (괄호는 ACL 작업) | 대상 |
|---|---|---|
| 폴더 열기 | `storage.folder.list` (LIST) | 그 폴더. 하위 항목은 같은 조건으로 한 번에 걸러 냄 |
| 폴더 만들기 | `storage.folder.create` (WRITE) | 부모 폴더 |
| 올리기 | `storage.file.write` (WRITE) | 올릴 폴더 |
| 내려받기 | `storage.file.read` (READ) | 그 파일 |
| 이름 변경·휴지통·복원 | `storage.node.modify` (WRITE) | 그 노드 |
| 옮기기 | `storage.node.modify` + `storage.folder.create` + `storage.file.read` | 옮길 노드, 옮겨 갈 폴더, 옮길 노드와 그 아래 전부 |
| 영구 삭제 | `storage.node.delete` (WRITE) | 그 노드. 지운 뒤 하위 노드까지 ACL 정리 |
| ACL 조회·변경 | `storage.acl.read` (READ) / `storage.acl.manage` (MANAGE_ACL) | 그 폴더 |
| 작업 기록·대조 | `storage.node.delete` (WRITE) | Root |

역할의 Permission과 폴더의 ACL이 **둘 다** 맞아야 한다. 상위 폴더를 볼 수 있다고 하위 항목이 모두 보이지 않으며,
허용되지 않은 항목은 목록에서 빠지고 주소를 직접 넣어도 거부된다. ACL은 폴더에만 걸 수 있다.

옮긴 항목은 옮겨 간 폴더의 ACL을 물려받는다. 쓰기만 허용된 사람이 읽을 수 있는 폴더로 옮겨 읽기를 얻지 못하도록,
옮기려면 원본과 그 아래 전부를 이미 읽을 수 있어야 한다. 옮긴 뒤 **다른 사람**에게 보이는 범위가 달라지는 것은 막지 않는다.
읽을 수 있는 자료를 공유 폴더로 옮기는 것은 공유와 같은 행위로 본다.

## 알려진 비용

조회는 학원의 노드 전체를 읽어 메모리에서 트리를 만든다. 노드 수에 비례하며 수천 개 규모를 가정한다.
올리던 중 끊긴 임시 파일(`.part`)은 디스크에 남을 수 있고 자동으로 치우지 않는다.

근거: [ADR-0005](../adr/0005-storage-tree-mutations-and-trash-lifecycle.md),
[ADR-0008](../adr/0008-storage-gateway-as-in-process-port.md).
