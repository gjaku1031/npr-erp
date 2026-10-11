/**
 * 학원 단위 역할·권한·ACL과 플랫폼 슈퍼유저 정책을 소유하는 모듈
 *
 * 다른 업무 모듈에 의존하지 않음. 리소스가 실제로 있는지, 어느 학원 것인지는 리소스를 소유한 모듈이 확인한 뒤
 * {@link com.npr.erp.accesscontrol.ResourceContext}로 넘김
 */
@ApplicationModule(displayName = "Access Control", allowedDependencies = {})
package com.npr.erp.accesscontrol;

import org.springframework.modulith.ApplicationModule;
