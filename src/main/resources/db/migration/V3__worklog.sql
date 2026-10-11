-- 업무일지(worklog): 업무, 일일보고, 공지, 일정
-- 사람은 모두 계정 ID로 가리킴. 역할(팀장·강사·다른 팀)은 이 표들에 두지 않고 권한 원장이 가짐

-- 직원의 업무일지 설정: 외부 시스템 직원 코드와, 거기서 가져온 담당 반의 사본
CREATE TABLE worklog_staff (
    academy_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES account(id),
    tng_staff_code VARCHAR(32) NULL,
    classrooms JSONB NOT NULL,
    classrooms_synced_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (academy_id, account_id)
);

CREATE TABLE worklog_tag (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    name VARCHAR(40) NOT NULL,
    color VARCHAR(20) NOT NULL,
    emoji VARCHAR(16) NOT NULL,
    fixed BOOLEAN NOT NULL,
    sort_order INTEGER NOT NULL,
    CONSTRAINT worklog_tag_name_unique UNIQUE (academy_id, name)
);

CREATE TABLE worklog_setting (
    academy_id UUID PRIMARY KEY,
    weekly_test_mwf DATE NULL,
    weekly_test_tts DATE NULL,
    special_period BOOLEAN NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE worklog_task (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    tag_id UUID NOT NULL REFERENCES worklog_tag(id),
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    kind VARCHAR(32) NOT NULL,
    assign_all BOOLEAN NOT NULL,
    report_required BOOLEAN NOT NULL,
    attachment_required BOOLEAN NOT NULL,
    archived BOOLEAN NOT NULL,
    links JSONB NOT NULL,
    owner_account_id UUID NULL REFERENCES account(id),
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT worklog_task_kind_check CHECK (
        kind IN ('GENERAL', 'MT', 'COUNSEL', 'SPECIAL_COUNSEL', 'SELF_COUNSEL')
    ),
    CONSTRAINT worklog_task_period_check CHECK (start_date <= due_date),
    -- 개인 상담일정만 소유자를 가짐
    CONSTRAINT worklog_task_owner_check CHECK ((kind = 'SELF_COUNSEL') = (owner_account_id IS NOT NULL))
);

CREATE INDEX worklog_task_academy_period_index ON worklog_task(academy_id, start_date, due_date);

-- 담당자를 골라서 배정한 업무와, 생성할 때 담당자를 고정하는 특강상담의 담당자
CREATE TABLE worklog_task_assignee (
    task_id UUID NOT NULL REFERENCES worklog_task(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES account(id),
    PRIMARY KEY (task_id, account_id)
);

-- 담당자별 처리 상태와 보고
CREATE TABLE worklog_task_status (
    task_id UUID NOT NULL REFERENCES worklog_task(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES account(id),
    status VARCHAR(16) NOT NULL,
    report_text TEXT NOT NULL,
    mwf_done BOOLEAN NOT NULL,
    tts_done BOOLEAN NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (task_id, account_id),
    CONSTRAINT worklog_task_status_check CHECK (status IN ('DONE', 'UNDONE', 'NONE'))
);

-- 업무 보고와 체크리스트에 붙이는 파일. 크기 상한은 애플리케이션이 4MB로 제한
CREATE TABLE worklog_attachment (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    owner_account_id UUID NOT NULL REFERENCES account(id),
    task_id UUID NULL REFERENCES worklog_task(id) ON DELETE CASCADE,
    report_date DATE NULL,
    journal_item_id UUID NULL,
    file_name VARCHAR(200) NOT NULL,
    media_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    content BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    -- 업무 보고의 첨부이거나 체크리스트 항목의 첨부 둘 중 하나
    CONSTRAINT worklog_attachment_target_check CHECK (
        (task_id IS NOT NULL AND report_date IS NULL AND journal_item_id IS NULL)
        OR (task_id IS NULL AND report_date IS NOT NULL AND journal_item_id IS NOT NULL)
    )
);

CREATE INDEX worklog_attachment_task_index ON worklog_attachment(task_id, owner_account_id);
CREATE INDEX worklog_attachment_report_index ON worklog_attachment(academy_id, owner_account_id, report_date);

-- 상담 업무의 학생별 상담. 명단을 다시 가져와도 써 둔 주제와 내용은 남김
CREATE TABLE worklog_counsel_entry (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES worklog_task(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES account(id),
    class_code VARCHAR(32) NOT NULL,
    class_name VARCHAR(120) NOT NULL,
    student_code VARCHAR(32) NOT NULL,
    student_name VARCHAR(120) NOT NULL,
    mother_phone VARCHAR(40) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    delivery_state VARCHAR(16) NOT NULL,
    delivery_date DATE NULL,
    sent_at TIMESTAMP WITH TIME ZONE NULL,
    receipt_id VARCHAR(64) NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT worklog_counsel_entry_unique UNIQUE (task_id, account_id, class_code, student_code),
    -- IDLE: 보내기 전, PENDING: 보내는 중이거나 결과를 모름, SENT: 외부 시스템 반영을 확인함
    CONSTRAINT worklog_counsel_delivery_check CHECK (delivery_state IN ('IDLE', 'PENDING', 'SENT')),
    CONSTRAINT worklog_counsel_sent_check CHECK ((delivery_state = 'SENT') = (sent_at IS NOT NULL))
);

-- 날짜별 일일보고 정의
CREATE TABLE worklog_journal (
    academy_id UUID NOT NULL,
    report_date DATE NOT NULL,
    special_period BOOLEAN NOT NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (academy_id, report_date)
);

CREATE TABLE worklog_journal_item (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    report_date DATE NOT NULL,
    text VARCHAR(300) NOT NULL,
    required BOOLEAN NOT NULL,
    sort_order INTEGER NOT NULL,
    CONSTRAINT worklog_journal_item_journal_fk
        FOREIGN KEY (academy_id, report_date)
        REFERENCES worklog_journal(academy_id, report_date) ON DELETE CASCADE
);

CREATE INDEX worklog_journal_item_date_index ON worklog_journal_item(academy_id, report_date, sort_order);

-- 직원이 낸 일일보고. 직원·날짜마다 한 건
CREATE TABLE worklog_daily_report (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES account(id),
    report_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL,
    confirmed BOOLEAN NOT NULL,
    confirmed_by UUID NULL REFERENCES account(id),
    payload JSONB NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT worklog_daily_report_unique UNIQUE (academy_id, account_id, report_date),
    CONSTRAINT worklog_daily_report_journal_fk
        FOREIGN KEY (academy_id, report_date)
        REFERENCES worklog_journal(academy_id, report_date) ON DELETE CASCADE,
    CONSTRAINT worklog_daily_report_status_check CHECK (status IN ('DRAFT', 'SUBMITTED')),
    -- 확인은 제출된 보고에만 붙음
    CONSTRAINT worklog_daily_report_confirm_check CHECK (NOT confirmed OR status = 'SUBMITTED')
);

CREATE TABLE worklog_notice (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    body TEXT NOT NULL,
    active BOOLEAN NOT NULL,
    author_account_id UUID NOT NULL REFERENCES account(id),
    posted_on DATE NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE INDEX worklog_notice_order_index ON worklog_notice(academy_id, sort_order);

CREATE TABLE worklog_event (
    id UUID PRIMARY KEY,
    academy_id UUID NOT NULL,
    kind VARCHAR(16) NOT NULL,
    owner_account_id UUID NULL REFERENCES account(id),
    tag_id UUID NULL REFERENCES worklog_tag(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    memo TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_by UUID NOT NULL REFERENCES account(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT worklog_event_kind_check CHECK (kind IN ('PERSONAL', 'TEAM')),
    CONSTRAINT worklog_event_period_check CHECK (start_date <= end_date),
    -- 개인일정만 소유자를 가짐
    CONSTRAINT worklog_event_owner_check CHECK ((kind = 'PERSONAL') = (owner_account_id IS NOT NULL))
);

CREATE INDEX worklog_event_period_index ON worklog_event(academy_id, start_date, end_date);

INSERT INTO permission(permission_key, description) VALUES
    ('worklog.task.manage', '업무를 만들고 고치고 지우며 전체 진행 상황을 봅니다.'),
    ('worklog.task.perform', '배정받은 업무를 처리하고 보고합니다.'),
    ('worklog.journal.manage', '날짜별 일일보고 항목, 주간테스트 날짜, 특강기간을 관리합니다.'),
    ('worklog.report.write', '본인의 일일보고를 작성하고 제출합니다.'),
    ('worklog.report.review', '전체 직원의 일일보고 제출 현황을 보고 확인 처리합니다.'),
    ('worklog.notice.manage', '공지를 쓰고 노출 순서를 관리합니다.'),
    ('worklog.event.manage', '팀 일정을 만들고 고치고 지웁니다.'),
    ('worklog.calendar.use', '캘린더를 보고 개인일정을 관리합니다.'),
    ('worklog.staff.manage', '직원의 담당 반 연결과 태그를 관리합니다.'),
    ('worklog.counsel.write', '상담을 작성하고 외부 시스템으로 보냅니다.'),
    ('worklog.notebook.write', '담당 반의 알림장을 조회하고 게시합니다.'),
    ('worklog.selfclass.manage', '본인 담당 반을 직접 가져오고 개인 상담일정을 만듭니다.');
