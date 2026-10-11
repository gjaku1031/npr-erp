package com.npr.erp.worklog;

import java.util.ArrayList;
import java.util.List;

/**
 * 일일보고 다섯 단계의 완료 여부
 *
 * 서버가 저장된 값과 외부 시스템, 업무 원장을 직접 읽어 계산함. 화면이 보낸 완료 표시는 믿지 않음
 *
 * @param checklist 1단계: 항목이 하나 이상 있고 전부 체크했으며, 필수 항목에는 확인 결과를 적음
 * @param notebook 2단계: 그날 담당 반이 없거나 모든 반에 알림장을 게시함
 * @param counsel 3단계: 상담 내용을 확인함
 * @param attendance 4단계: 출결 기록을 확인함
 * @param tasks 5단계: 그날이 기간에 드는 일반 업무를 전부 완료 또는 미완료로 표시함
 */
public record WizardGate(boolean checklist, boolean notebook, boolean counsel, boolean attendance, boolean tasks) {
    /**
     * 단계 수
     */
    public static final int STEPS = 5;

    /**
     * 다섯 단계를 모두 마쳤는지
     *
     * @return 제출할 수 있으면 true
     */
    public boolean complete() {
        return doneCount() == STEPS;
    }

    /**
     * 마친 단계 수
     *
     * @return 0부터 5
     */
    public int doneCount() {
        var count = 0;
        for (var done : new boolean[] {checklist, notebook, counsel, attendance, tasks}) {
            if (done) {
                count++;
            }
        }
        return count;
    }

    /**
     * 단계 하나를 마쳤는지
     *
     * @param step 1부터 5까지의 단계 번호
     * @return 마쳤으면 true
     */
    public boolean done(int step) {
        return switch (step) {
            case 1 -> checklist;
            case 2 -> notebook;
            case 3 -> counsel;
            case 4 -> attendance;
            case 5 -> tasks;
            default -> false;
        };
    }

    /**
     * 아직 마치지 못한 단계의 이름
     *
     * @return 단계 순서대로
     */
    public List<String> openSteps() {
        var names = List.of("체크리스트", "알림장", "상담 확인", "출결 확인", "업무 확인");
        var open = new ArrayList<String>();
        for (var step = 1; step <= STEPS; step++) {
            if (!done(step)) {
                open.add(names.get(step - 1));
            }
        }
        return open;
    }
}
