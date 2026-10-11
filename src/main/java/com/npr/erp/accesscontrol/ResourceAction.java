package com.npr.erp.accesscontrol;

/**
 * ACL이 구분하는 작업 종류
 *
 * 작업 사이에 포함 관계는 없음. WRITE가 있어도 READ가 자동으로 허용되지 않음
 */
public enum ResourceAction {
    /**
     * 폴더의 하위 목록 조회
     */
    LIST,

    /**
     * 파일 내용이나 리소스 정보 읽기
     */
    READ,

    /**
     * 폴더 생성, 파일 올리기, 이름 변경, 이동, 삭제 같은 상태 변경
     */
    WRITE,

    /**
     * 리소스에 걸린 ACL 부여·변경·회수
     */
    MANAGE_ACL
}
