package com.npr.erp.worklog.internal.counsel;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngStudent;
import java.util.List;

/**
 * 외부 시스템에서 가져온 한 반의 학생 명단
 *
 * @param classroom 반
 * @param students 학생
 */
public record ClassRoster(TngClassroom classroom, List<TngStudent> students) {
}
