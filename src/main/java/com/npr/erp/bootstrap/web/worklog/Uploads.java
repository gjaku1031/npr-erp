package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.WorklogValidationException;
import org.springframework.web.multipart.MultipartFile;

/**
 * 업무일지에 올리는 파일의 사전 확인
 */
final class Uploads {
    /**
     * 인스턴스를 만들지 않는 도우미
     */
    private Uploads() {
    }

    /**
     * 본문을 메모리에 올리기 전에 크기를 확인
     *
     * 요청 전체의 상한은 자료실 올리기에 맞춰 크게 잡혀 있음. 업무일지 첨부는 DB에 두므로 훨씬 작은 상한을 여기서 먼저 봄
     *
     * @param file 올린 파일
     * @throws WorklogValidationException 4MB를 넘을 때
     */
    static void requireAttachmentSize(MultipartFile file) {
        if (file.getSize() > TaskBoard.MAX_ATTACHMENT_BYTES) {
            throw new WorklogValidationException("ATTACHMENT_TOO_LARGE", "첨부 파일은 4MB 이하여야 합니다.");
        }
    }
}
