package com.npr.erp.tng.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.tng.TngGatewayException;
import com.npr.erp.tng.TngStudent;
import java.time.LocalDate;
import java.util.HashSet;
import org.junit.jupiter.api.Test;

/**
 * 외부 시스템 대역이 포트 계약을 지키는지 검사
 *
 * 업무일지의 화면과 테스트가 이 대역의 성질(결정적, 가상 데이터, 게시 후 조회 가능)에 기대므로 그 성질을 고정함
 */
class MockTngGatewayTest {
    /**
     * 검사 대상
     */
    private final MockTngGateway gateway = new MockTngGateway();

    /**
     * 월요일인 날짜
     */
    private static final LocalDate MONDAY = LocalDate.of(2026, 10, 12);

    /**
     * 직원마다 정규 반과 특강 반이 요일 묶음별로 있는지 확인
     */
    @Test
    void everyStaffHasRegularAndSpecialClassrooms() {
        for (var staff : gateway.staff()) {
            var classrooms = gateway.classroomsOf(staff.code());

            assertThat(classrooms).extracting(TngClassroom::kind).contains(TngClassKind.REGULAR, TngClassKind.SPECIAL);
            assertThat(classrooms).extracting(TngClassroom::dayGroup).contains(TngDayGroup.MWF, TngDayGroup.TTS);
        }
        assertThat(gateway.classroomsOf("없는 직원")).isEmpty();
    }

    /**
     * 학번이 전체에서 겹치지 않고, 연락처는 지어낸 형식이거나 비어 있는지 확인
     */
    @Test
    void studentsAreUniqueAndUseFictionalContacts() {
        var codes = new HashSet<String>();
        var withoutPhone = 0;
        for (var staff : gateway.staff()) {
            for (var classroom : gateway.classroomsOf(staff.code())) {
                for (TngStudent student : gateway.students(classroom.code())) {
                    assertThat(codes.add(student.code())).isTrue();
                    assertThat(student.motherPhone()).matches("|010-0000-\\d{4}");
                    if (student.motherPhone().isEmpty()) {
                        withoutPhone++;
                    }
                }
            }
        }
        assertThat(withoutPhone).isPositive();
    }

    /**
     * 같은 질문에는 같은 출결과 성적이 나오고, 수업이 없는 요일의 출결은 비어 있는지 확인
     */
    @Test
    void readsAreDeterministic() {
        assertThat(gateway.attendance("C11", MONDAY)).isEqualTo(gateway.attendance("C11", MONDAY)).isNotEmpty();
        assertThat(gateway.weeklyTestScores("C11", MONDAY)).isEqualTo(gateway.weeklyTestScores("C11", MONDAY));
        assertThat(gateway.attendance("C11", MONDAY.plusDays(1))).isEmpty();
    }

    /**
     * 성적이 석차 순이고 석차와 응시자 수가 명단과 맞는지 확인
     */
    @Test
    void scoresAreRankedWithinClass() {
        var scores = gateway.weeklyTestScores("C11", MONDAY);

        assertThat(scores).hasSameSizeAs(gateway.students("C11"));
        for (var index = 0; index < scores.size(); index++) {
            assertThat(scores.get(index).rank()).isEqualTo(index + 1);
            assertThat(scores.get(index).examinees()).isEqualTo(scores.size());
        }
        assertThat(scores).isSortedAccordingTo((left, right) -> Integer.compare(right.total(), left.total()));
    }

    /**
     * 알림장을 게시하면 조회되고, 다시 게시하면 새로 생기지 않고 내용이 바뀌는지 확인
     */
    @Test
    void publishingNotebookUpsertsByClassAndDate() {
        assertThat(gateway.notebook("C11", MONDAY)).isEmpty();

        gateway.publishNotebook("C11", MONDAY, "첫 제목", "첫 본문");
        gateway.publishNotebook("C11", MONDAY, "고친 제목", "고친 본문");

        assertThat(gateway.notebook("C11", MONDAY)).hasValueSatisfying(notebook -> assertThat(notebook.title())
                .isEqualTo("고친 제목"));
        assertThat(gateway.notebook("C12", MONDAY)).isEmpty();
        assertThatThrownBy(() -> gateway.publishNotebook("없는 반", MONDAY, "제목", "본문"))
                .isInstanceOf(TngGatewayException.class);
    }

    /**
     * 보낸 상담이 그 직원·그 날짜의 상담 조회에 나오는지 확인
     */
    @Test
    void postedCounselAppearsInDailyRecords() {
        var student = gateway.students("C11").getFirst();

        var receipt = gateway.postCounsel("S01", student.code(), MONDAY, "학습 태도", "숙제를 꾸준히 해 옴");

        assertThat(receipt).startsWith("MOCK-");
        assertThat(gateway.counsels("S01", MONDAY)).singleElement().satisfies(record -> {
            assertThat(record.studentName()).isEqualTo(student.name());
            assertThat(record.topic()).isEqualTo("학습 태도");
        });
        assertThat(gateway.counsels("S01", MONDAY.plusDays(1))).isEmpty();
        assertThat(gateway.counsels("S02", MONDAY)).isEmpty();
    }
}
