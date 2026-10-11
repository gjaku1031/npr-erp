package com.npr.erp.worklog;

/**
 * 업무 종류
 *
 * 종류에 따라 담당자를 정하는 방식과 완료를 판정하는 방식이 달라짐
 */
public enum TaskKind {
    /**
     * 일반 업무. 담당자가 직접 완료로 표시함
     */
    GENERAL("일반"),

    /**
     * 월수금·화목토를 따로 체크하는 업무. 둘 다 체크하면 완료
     */
    MT("MT"),

    /**
     * 전체 상담 업무. 담당 반 학생 전원의 상담을 보내면 완료
     */
    COUNSEL("전체 상담"),

    /**
     * 특강상담 업무. 만들 때 담당자와 특강 반 학생 명단을 고정함
     */
    SPECIAL_COUNSEL("특강상담"),

    /**
     * 직원이 스스로 만든 개인 상담일정. 만든 사람만 봄
     */
    SELF_COUNSEL("개인 상담일정");

    /**
     * 화면에 보이는 이름
     */
    private final String label;

    /**
     * 표시 이름으로 종류 생성
     *
     * @param label 화면에 보이는 이름
     */
    TaskKind(String label) {
        this.label = label;
    }

    /**
     * 화면에 보이는 이름 조회
     *
     * @return 표시 이름
     */
    public String label() {
        return label;
    }

    /**
     * 상담을 보내야 완료되는 종류인지
     *
     * @return 전체 상담, 특강상담, 개인 상담일정이면 true
     */
    public boolean counsel() {
        return this == COUNSEL || this == SPECIAL_COUNSEL || this == SELF_COUNSEL;
    }
}
