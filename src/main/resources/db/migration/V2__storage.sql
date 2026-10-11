-- 자료실(storage): 파일·폴더 트리와 외부 저장소 작업 원장

CREATE TABLE storage_node (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    parent_id UUID NULL REFERENCES storage_node(id),
    node_type VARCHAR(32) NOT NULL,
    name VARCHAR(180) NOT NULL,
    normalized_name VARCHAR(180) NOT NULL,
    status VARCHAR(32) NOT NULL,
    external_locator VARCHAR(1000) NULL,
    size_bytes BIGINT NULL,
    media_type VARCHAR(255) NULL,
    checksum_sha256 VARCHAR(64) NULL,
    trash_root_id UUID NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    trashed_at TIMESTAMP WITH TIME ZONE NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT storage_node_type_check CHECK (node_type IN ('FOLDER', 'FILE')),
    CONSTRAINT storage_node_status_check CHECK (
        status IN ('PROVISIONING', 'ACTIVE', 'MUTATING', 'TRASHED', 'DELETING', 'DELETED', 'FAILED')
    ),
    CONSTRAINT storage_node_size_check CHECK (size_bytes IS NULL OR size_bytes >= 0),
    CONSTRAINT storage_node_folder_metadata_check CHECK (
        node_type = 'FILE' OR (size_bytes IS NULL AND media_type IS NULL AND checksum_sha256 IS NULL)
    ),
    CONSTRAINT storage_node_trash_state_check CHECK (
        status <> 'TRASHED' OR (trash_root_id IS NOT NULL AND trashed_at IS NOT NULL)
    )
);

-- 학원마다 살아 있는 루트는 하나
CREATE UNIQUE INDEX storage_node_academy_root_unique
    ON storage_node(academy_id)
    WHERE parent_id IS NULL AND status NOT IN ('DELETED', 'FAILED');

-- 같은 폴더 안에서 살아 있는 항목의 이름은 겹치지 않음. 휴지통에 있는 항목도 이름을 차지함
CREATE UNIQUE INDEX storage_node_live_sibling_name_unique
    ON storage_node(academy_id, parent_id, normalized_name)
    WHERE parent_id IS NOT NULL AND status NOT IN ('DELETED', 'FAILED');

CREATE INDEX storage_node_parent_status_index
    ON storage_node(academy_id, parent_id, status, name);

-- 외부 저장소를 바꾸는 작업의 원장. 실행 전에 기록하고 결과를 확인한 뒤 확정함
CREATE TABLE storage_operation (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    actor_account_id UUID NOT NULL REFERENCES account(id),
    operation_type VARCHAR(40) NOT NULL,
    target_node_id UUID NOT NULL REFERENCES storage_node(id),
    status VARCHAR(40) NOT NULL,
    source_path VARCHAR(2000) NULL,
    destination_path VARCHAR(2000) NULL,
    destination_parent_id UUID NULL,
    requested_name VARCHAR(180) NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code VARCHAR(100) NULL,
    last_error_message VARCHAR(1000) NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NULL,
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT storage_operation_type_check CHECK (
        operation_type IN (
            'INITIALIZE_ROOT', 'CREATE_FOLDER', 'RENAME', 'MOVE', 'TRASH', 'RESTORE',
            'DELETE_PERMANENTLY', 'UPLOAD'
        )
    ),
    CONSTRAINT storage_operation_status_check CHECK (
        status IN ('PENDING', 'PROCESSING', 'VERIFY', 'COMPLETED', 'RETRYABLE_FAILED', 'MANUAL_REVIEW')
    ),
    CONSTRAINT storage_operation_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX storage_operation_academy_time_index
    ON storage_operation(academy_id, created_at DESC);

-- 끝나지 않은 작업만 빠르게 찾기 위한 부분 인덱스
CREATE INDEX storage_operation_unsettled_index
    ON storage_operation(academy_id, status, updated_at)
    WHERE status IN ('PROCESSING', 'VERIFY', 'RETRYABLE_FAILED', 'MANUAL_REVIEW');
