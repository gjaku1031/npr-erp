/**
 * 외부 학원 관리 시스템으로 나가는 경계 모듈
 *
 * 다른 업무 모듈은 {@link com.npr.erp.tng.TngGateway} 하나만 보고, 외부 시스템의 주소·계정·응답 형식은 알지 못함.
 * 지금 어댑터는 가상의 반과 학생을 돌려주는 대역 하나뿐이며 실제 시스템에는 접속하지 않음
 */
@ApplicationModule(displayName = "TNG", allowedDependencies = {})
package com.npr.erp.tng;

import org.springframework.modulith.ApplicationModule;
