package com.npr.erp.accesscontrol;

/**
 * 학원 권한 정책의 최초 구성 계약
 */
public interface AcademyAccessInitializer {
    /**
     * 학원의 첫 소속·역할·권한·역할 배정·루트 ACL을 한 트랜잭션에 생성
     *
     * 루트 폴더와 첫 관리자 계정이 실제로 있는지는 호출자가 먼저 확인해야 함
     *
     * @param command 초기화 요청
     * @return 생성된 식별자와 정책 버전 1
     * @throws AuthorizationDeniedException 실행자가 플랫폼 슈퍼유저가 아닐 때
     * @throws AccessControlConflictException 이미 초기화된 학원일 때
     * @throws AccessControlValidationException 첫 역할에 ACL 관리 권한이 없거나 모르는 권한이 있을 때
     */
    AcademyAccessInitializationResult initialize(InitializeAcademyAccessCommand command);
}
