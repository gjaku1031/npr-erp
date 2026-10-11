package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * 정책 버전과 함께 돌려주는 조회·변경 결과
 *
 * 관리 화면은 이 버전을 다음 변경 요청의 기대 버전으로 보냄
 *
 * @param academyId 학원 ID
 * @param policyVersion 결과를 읽은 시점의 정책 버전
 * @param value 조회하거나 변경한 값
 * @param <T> 값의 타입
 */
public record AcademyPolicyView<T>(UUID academyId, long policyVersion, T value) {
}
