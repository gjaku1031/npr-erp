package com.npr.erp.identity;

/**
 * 계정 생성과 비밀번호 변경 계약
 *
 * 공개 가입은 없으며 운영 명령과 시연 데이터 구성에서만 호출함
 */
public interface AccountAdministration {
    /**
     * 계정 생성
     *
     * 같은 ID와 아이디의 계정이 이미 있으면 새로 만들지 않고 기존 계정을 돌려줌
     *
     * @param command 생성 요청
     * @return 생성했거나 이미 있던 활성 계정
     * @throws AccountBindingConflictException ID나 아이디가 다른 계정에 쓰이고 있을 때
     * @throws IllegalArgumentException 아이디·비밀번호·사유가 규칙에 맞지 않을 때
     */
    AuthenticatedAccount createAccount(CreateAccountCommand command);

    /**
     * 비밀번호 변경
     *
     * @param command 변경 요청
     * @throws AccountNotFoundException 계정이 없을 때
     * @throws IllegalArgumentException 비밀번호나 사유가 규칙에 맞지 않을 때
     */
    void setPassword(SetAccountPasswordCommand command);
}
