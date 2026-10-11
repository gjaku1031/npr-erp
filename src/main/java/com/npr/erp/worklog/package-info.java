/**
 * 업무일지 모듈: 업무 배정과 처리, 날짜별 일일보고, 상담, 공지, 일정을 소유함
 *
 * 사람은 계정 ID로만 가리키며 역할을 스스로 판단하지 않음. 누가 배정 후보인지, 누가 보고 대상인지는 호출자가 권한
 * 원장에서 구해 넘김. 대신 "본인의 것만 다룰 수 있다"는 소유 조건은 이 모듈이 계정 ID로 직접 확인함.
 * 반·학생·출결 같은 외부 시스템의 자료는 tng 모듈의 포트로만 가져옴
 */
@ApplicationModule(displayName = "Worklog", allowedDependencies = {"tng"})
package com.npr.erp.worklog;

import org.springframework.modulith.ApplicationModule;
