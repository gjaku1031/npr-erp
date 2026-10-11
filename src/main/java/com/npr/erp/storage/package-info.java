/**
 * 학원 자료실의 파일·폴더 트리, 외부 저장소 작업 원장, 파일 전송을 소유하는 모듈
 *
 * 다른 업무 모듈에 의존하지 않음. 누가 무엇을 할 수 있는지는 판단하지 않으며, 호출자가 인가를 마친 뒤 호출함.
 * 파일 본문을 두는 외부 저장소는 포트({@code StorageGateway}) 뒤에 두어 어댑터를 바꿀 수 있게 함
 */
@ApplicationModule(displayName = "Storage", allowedDependencies = {})
package com.npr.erp.storage;

import org.springframework.modulith.ApplicationModule;
