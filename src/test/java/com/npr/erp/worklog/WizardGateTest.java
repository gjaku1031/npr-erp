package com.npr.erp.worklog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 일일보고 단계 완료 집계 검사
 */
class WizardGateTest {
    /**
     * 다섯 단계를 모두 마쳐야 제출할 수 있는지 확인
     */
    @Test
    void completeOnlyWhenEveryStepIsDone() {
        assertThat(new WizardGate(true, true, true, true, true).complete()).isTrue();
        assertThat(new WizardGate(true, true, true, true, false).complete()).isFalse();
    }

    /**
     * 마치지 못한 단계의 이름을 순서대로 돌려주는지 확인
     */
    @Test
    void listsOpenStepsInOrder() {
        var gate = new WizardGate(true, false, true, false, true);

        assertThat(gate.doneCount()).isEqualTo(3);
        assertThat(gate.openSteps()).containsExactly("알림장", "출결 확인");
        assertThat(gate.done(1)).isTrue();
        assertThat(gate.done(2)).isFalse();
    }
}
