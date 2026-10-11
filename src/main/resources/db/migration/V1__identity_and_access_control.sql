-- 계정(identity)과 권한 원장(accesscontrol)

CREATE TABLE account (
    id UUID PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT account_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

CREATE TABLE identity_audit_log (
    id UUID PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    actor_account_id UUID NULL REFERENCES account(id),
    target_account_id UUID NOT NULL REFERENCES account(id),
    reason VARCHAR(500) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 플랫폼 슈퍼유저는 학원 역할과 분리된 등록부로 관리함
CREATE TABLE platform_superuser (
    account_id UUID PRIMARY KEY REFERENCES account(id),
    granted_by UUID NULL REFERENCES account(id),
    granted_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 학원별 권한 정책의 뿌리. policy_version은 정책이 바뀔 때마다 1씩 오름
CREATE TABLE academy_access_scope (
    academy_id UUID PRIMARY KEY,
    storage_root_resource_id UUID NOT NULL,
    policy_version BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT academy_access_scope_policy_version_check CHECK (policy_version >= 1)
);

CREATE TABLE staff_membership (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL REFERENCES academy_access_scope(academy_id),
    account_id UUID NOT NULL REFERENCES account(id),
    status VARCHAR(32) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT staff_membership_status_check CHECK (status IN ('ACTIVE', 'ENDED')),
    CONSTRAINT staff_membership_end_state_check CHECK (
        (status = 'ACTIVE' AND ended_at IS NULL)
        OR (status = 'ENDED' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT staff_membership_id_academy_unique UNIQUE (id, academy_id)
);

-- 한 계정은 한 학원에 활성 소속을 하나만 가짐
CREATE UNIQUE INDEX staff_membership_active_unique
    ON staff_membership(account_id, academy_id)
    WHERE status = 'ACTIVE';

CREATE TABLE academy_role (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL REFERENCES academy_access_scope(academy_id),
    name VARCHAR(120) NOT NULL,
    normalized_name VARCHAR(120) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT academy_role_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT academy_role_name_unique UNIQUE (academy_id, normalized_name),
    CONSTRAINT academy_role_id_academy_unique UNIQUE (id, academy_id)
);

-- 권한 키는 코드의 PermissionCatalog가 원본이고, 이 표는 외래 키와 관리 화면 조회용 사본
CREATE TABLE permission (
    permission_key VARCHAR(160) PRIMARY KEY,
    description VARCHAR(500) NOT NULL
);

CREATE TABLE role_permission (
    role_id UUID NOT NULL REFERENCES academy_role(id),
    permission_key VARCHAR(160) NOT NULL REFERENCES permission(permission_key),
    granted_by UUID NOT NULL REFERENCES account(id),
    granted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (role_id, permission_key)
);

-- 복합 외래 키로 소속과 역할이 같은 학원의 것임을 DB가 강제함
CREATE TABLE role_assignment (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    staff_membership_id UUID NOT NULL,
    role_id UUID NOT NULL,
    assigned_by UUID NOT NULL REFERENCES account(id),
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_by UUID NULL REFERENCES account(id),
    revoked_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT role_assignment_membership_fk
        FOREIGN KEY (staff_membership_id, academy_id)
        REFERENCES staff_membership(id, academy_id),
    CONSTRAINT role_assignment_role_fk
        FOREIGN KEY (role_id, academy_id)
        REFERENCES academy_role(id, academy_id),
    CONSTRAINT role_assignment_revoke_state_check CHECK (
        (revoked_by IS NULL AND revoked_at IS NULL)
        OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX role_assignment_active_unique
    ON role_assignment(staff_membership_id, role_id)
    WHERE revoked_at IS NULL;

-- 리소스별 허용 목록. 주체는 계정 하나 또는 같은 학원의 역할 하나
CREATE TABLE resource_acl (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL REFERENCES academy_access_scope(academy_id),
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    subject_account_id UUID NULL REFERENCES account(id),
    subject_role_id UUID NULL,
    action VARCHAR(64) NOT NULL,
    inherit_to_children BOOLEAN NOT NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT resource_acl_resource_type_check CHECK (resource_type IN ('STORAGE_NODE')),
    CONSTRAINT resource_acl_action_check CHECK (action IN ('LIST', 'READ', 'WRITE', 'MANAGE_ACL')),
    CONSTRAINT resource_acl_subject_check CHECK (
        (subject_account_id IS NOT NULL AND subject_role_id IS NULL)
        OR (subject_account_id IS NULL AND subject_role_id IS NOT NULL)
    ),
    CONSTRAINT resource_acl_role_fk
        FOREIGN KEY (subject_role_id, academy_id)
        REFERENCES academy_role(id, academy_id)
);

CREATE UNIQUE INDEX resource_acl_account_unique
    ON resource_acl(academy_id, resource_type, resource_id, subject_account_id, action)
    WHERE subject_account_id IS NOT NULL;

CREATE UNIQUE INDEX resource_acl_role_unique
    ON resource_acl(academy_id, resource_type, resource_id, subject_role_id, action)
    WHERE subject_role_id IS NOT NULL;

-- 인가 거부, 슈퍼유저 우회, 정책 변경 기록
CREATE TABLE authorization_audit_log (
    id UUID PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    request_id VARCHAR(128) NULL,
    actor_account_id UUID NULL REFERENCES account(id),
    target_account_id UUID NULL REFERENCES account(id),
    academy_id UUID NULL,
    permission_key VARCHAR(160) NULL,
    resource_type VARCHAR(64) NULL,
    resource_id UUID NULL,
    decision VARCHAR(32) NULL,
    reason_code VARCHAR(100) NOT NULL,
    policy_version BIGINT NULL,
    matched_acl_id UUID NULL,
    before_state JSONB NULL,
    after_state JSONB NULL,
    details JSONB NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT authorization_audit_decision_check CHECK (
        decision IS NULL OR decision IN ('ALLOW', 'DENY')
    )
);

CREATE INDEX authorization_audit_actor_time_index
    ON authorization_audit_log(actor_account_id, occurred_at DESC);

CREATE INDEX authorization_audit_academy_time_index
    ON authorization_audit_log(academy_id, occurred_at DESC);

INSERT INTO permission(permission_key, description) VALUES
    ('access.membership.read', '학원 소속 직원 목록을 조회합니다.'),
    ('access.membership.manage', '활성 계정을 학원 직원으로 추가하거나 소속을 종료합니다.'),
    ('access.role.read', '역할과 역할에 연결된 권한을 조회합니다.'),
    ('access.role.manage', '역할을 만들고 이름을 바꾸고 비활성화하며 권한 구성을 바꿉니다.'),
    ('access.assignment.read', '직원에게 배정된 역할을 조회합니다.'),
    ('access.assignment.manage', '직원의 역할 배정을 바꿉니다.'),
    ('access.audit.read', '권한 판단과 정책 변경 기록을 조회합니다.'),
    ('storage.folder.list', '접근할 수 있는 폴더의 하위 목록을 조회합니다.'),
    ('storage.folder.create', '접근할 수 있는 폴더 아래에 폴더를 만듭니다.'),
    ('storage.file.read', '접근할 수 있는 폴더의 파일을 내려받습니다.'),
    ('storage.file.write', '접근할 수 있는 폴더에 파일을 올립니다.'),
    ('storage.acl.read', '폴더에 설정된 접근 허용 목록을 조회합니다.'),
    ('storage.acl.manage', '폴더의 접근 허용 목록을 부여하거나 회수합니다.'),
    ('storage.node.modify', '파일과 폴더의 이름을 바꾸고 옮기고 휴지통으로 보내거나 복원합니다.'),
    ('storage.node.delete', '휴지통의 파일과 폴더를 영구 삭제합니다.');
