package com.npr.erp.accesscontrol;

/**
 * 권한 키와 그 권한이 받는 대상의 계약
 *
 * @param key 권한 키
 * @param description 관리자에게 보여 줄 설명
 * @param group 관리 화면에서 묶어 보여 줄 영역 이름
 * @param targetType 대상 종류
 * @param resourceType 리소스 권한이 받는 리소스 종류. 학원 권한은 null
 * @param resourceAction 리소스 권한이 요구하는 ACL 작업. 학원 권한은 null
 */
public record PermissionDefinition(
        PermissionKey key,
        String description,
        String group,
        PermissionTargetType targetType,
        ResourceType resourceType,
        ResourceAction resourceAction) {
    /**
     * 리소스 계약의 완전성 확인
     *
     * @throws IllegalArgumentException 리소스 권한인데 종류·작업이 없거나, 학원 권한인데 있을 때
     */
    public PermissionDefinition {
        var hasResourceContract = resourceType != null && resourceAction != null;
        var hasNoResourceContract = resourceType == null && resourceAction == null;
        var valid = targetType == PermissionTargetType.RESOURCE ? hasResourceContract : hasNoResourceContract;
        if (!valid) {
            throw new IllegalArgumentException("리소스 권한에만 리소스 종류와 ACL 작업을 함께 지정할 수 있습니다.");
        }
    }

    /**
     * 이 권한으로 요청할 수 있는 대상인지 확인
     *
     * @param target 요청 대상
     * @return 대상 종류, 리소스 종류, ACL 작업이 모두 계약과 같으면 true
     */
    public boolean supports(AuthorizationTarget target) {
        return switch (target) {
            case AuthorizationTarget.Academy ignored -> targetType == PermissionTargetType.ACADEMY;
            case AuthorizationTarget.Resource resource -> targetType == PermissionTargetType.RESOURCE
                    && resource.context().resourceType() == resourceType
                    && resource.action() == resourceAction;
        };
    }
}
