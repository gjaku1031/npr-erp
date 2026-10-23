/**
 * 이미 외부 시스템에서 성공이 확인된 비멱등 쓰기의 후속 로컬/원격 저장 처리.
 * 이 단계의 실패를 외부 쓰기 실패로 다시 던지면 호출자가 재전송해 중복을 만들 수 있으므로,
 * 성공 여부 대신 앱 상태 영속이 지연됐다는 별도 상태를 반환한다.
 */
export function persistConfirmedExternalWrite(sync: () => void): 'synced' | 'pending' {
  try {
    sync();
    return 'synced';
  } catch {
    return 'pending';
  }
}
