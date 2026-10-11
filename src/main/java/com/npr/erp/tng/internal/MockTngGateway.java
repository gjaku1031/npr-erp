package com.npr.erp.tng.internal;

import com.npr.erp.tng.TngAttendance;
import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngCounselRecord;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.tng.TngGatewayException;
import com.npr.erp.tng.TngHomework;
import com.npr.erp.tng.TngNotebook;
import com.npr.erp.tng.TngScore;
import com.npr.erp.tng.TngStaff;
import com.npr.erp.tng.TngStudent;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * 가상의 반과 학생을 돌려주는 {@link TngGateway} 대역
 *
 * 실제 외부 시스템에 접속하지 않음. 직원·반·학생은 고정된 표에서 만들고, 출결·성적·과제는 날짜와 학번으로 계산해
 * 같은 질문에는 항상 같은 답을 함. 게시한 알림장과 보낸 상담은 프로세스 메모리에만 두므로 서버를 다시 띄우면 사라짐.
 * 이름과 연락처는 모두 지어낸 값임
 */
@Component
public final class MockTngGateway implements TngGateway {
    /**
     * 지어낸 성
     */
    private static final String[] FAMILY_NAMES = {"가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타"};

    /**
     * 지어낸 이름
     */
    private static final String[] GIVEN_NAMES = {
        "하늘", "바다", "나무", "새벽", "노을", "별", "이슬", "솔", "가람", "다온", "마루", "보람", "소담", "아름", "한결", "해솔"
    };

    /**
     * 지어낸 학교
     */
    private static final String[] SCHOOLS = {"푸른초", "맑은초", "한빛초", "새솔초"};

    /**
     * 직원 표. 코드 순서가 반 이름의 번호가 됨
     */
    private static final List<TngStaff> STAFF = List.of(
            new TngStaff("S01", "한결 선생님"),
            new TngStaff("S02", "다온 선생님"),
            new TngStaff("S03", "소담 선생님"),
            new TngStaff("S04", "마루 선생님"),
            new TngStaff("S05", "보람 선생님"));

    /**
     * 반마다 넣을 학생 수의 범위: 최소
     */
    private static final int MIN_STUDENTS = 7;

    /**
     * 반마다 넣을 학생 수의 범위: 최소에 더할 최대 폭
     */
    private static final int STUDENT_SPREAD = 5;

    /**
     * 직원 코드별 반 목록
     */
    private final Map<String, List<TngClassroom>> classroomsByStaff = new LinkedHashMap<>();

    /**
     * 반 코드별 학생 명단
     */
    private final Map<String, List<TngStudent>> studentsByClass = new LinkedHashMap<>();

    /**
     * 반 코드별 반 정보
     */
    private final Map<String, TngClassroom> classroomsByCode = new LinkedHashMap<>();

    /**
     * 게시한 알림장. 키는 반 코드와 날짜
     */
    private final Map<String, TngNotebook> notebooks = new ConcurrentHashMap<>();

    /**
     * 보낸 상담. 키는 직원 코드
     */
    private final Map<String, List<TngCounselRecord>> postedCounsels = new ConcurrentHashMap<>();

    /**
     * 상담 기록 번호를 매기는 순번
     */
    private final AtomicLong counselSequence = new AtomicLong(1000);

    /**
     * 고정된 표로 반과 학생을 만들어 둠
     */
    public MockTngGateway() {
        var studentNumber = 1;
        for (var index = 0; index < STAFF.size(); index++) {
            var staff = STAFF.get(index);
            var number = index + 1;
            var classrooms = List.of(
                    new TngClassroom("C" + number + "1", "초4 M" + number, TngDayGroup.MWF, TngClassKind.REGULAR),
                    new TngClassroom("C" + number + "2", "초5 M" + number, TngDayGroup.MWF, TngClassKind.REGULAR),
                    new TngClassroom("C" + number + "3", "초5 T" + number, TngDayGroup.TTS, TngClassKind.REGULAR),
                    new TngClassroom("C" + number + "4", "초6 T" + number, TngDayGroup.TTS, TngClassKind.REGULAR),
                    new TngClassroom("X" + number + "1", "특강 초등 M" + number, TngDayGroup.MWF, TngClassKind.SPECIAL),
                    new TngClassroom("X" + number + "2", "특강 초등 T" + number, TngDayGroup.TTS, TngClassKind.SPECIAL));
            classroomsByStaff.put(staff.code(), classrooms);
            for (var classroom : classrooms) {
                classroomsByCode.put(classroom.code(), classroom);
                var size = MIN_STUDENTS + Math.floorMod(classroom.code().hashCode(), STUDENT_SPREAD);
                var students = new ArrayList<TngStudent>();
                for (var seat = 0; seat < size; seat++) {
                    students.add(student(studentNumber++));
                }
                students.sort(Comparator.comparing(TngStudent::name).thenComparing(TngStudent::code));
                studentsByClass.put(classroom.code(), List.copyOf(students));
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngStaff> staff() {
        return STAFF;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngClassroom> classroomsOf(String staffCode) {
        return classroomsByStaff.getOrDefault(staffCode, List.of());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngStudent> students(String classCode) {
        return studentsByClass.getOrDefault(classCode, List.of());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngAttendance> attendance(String classCode, LocalDate date) {
        var classroom = classroomsByCode.get(classCode);
        if (classroom == null || !classroom.dayGroup().includes(date.getDayOfWeek())) {
            return List.of();
        }
        var result = new ArrayList<TngAttendance>();
        for (var student : students(classCode)) {
            // 열에 여덟은 출석, 나머지는 지각·결석·조퇴가 섞이게 함
            var status = switch (pick(student.code(), date, "attendance", 20)) {
                case 0 -> "결석";
                case 1, 2 -> "지각";
                case 3 -> "조퇴";
                default -> "출석";
            };
            result.add(new TngAttendance(student.code(), student.name(), status));
        }
        return result;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngCounselRecord> counsels(String staffCode, LocalDate date) {
        return postedCounsels.getOrDefault(staffCode, List.of()).stream()
                .filter(record -> record.date().equals(date))
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<TngNotebook> notebook(String classCode, LocalDate date) {
        return Optional.ofNullable(notebooks.get(notebookKey(classCode, date)));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public TngNotebook publishNotebook(String classCode, LocalDate date, String title, String body) {
        if (!classroomsByCode.containsKey(classCode)) {
            throw new TngGatewayException("알림장을 게시할 반을 찾을 수 없습니다.", true);
        }
        var notebook = new TngNotebook(classCode, date, title, body, Instant.now());
        notebooks.put(notebookKey(classCode, date), notebook);
        return notebook;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngScore> weeklyTestScores(String classCode, LocalDate testDate) {
        var students = students(classCode);
        if (students.isEmpty()) {
            return List.of();
        }

        // 총점을 먼저 정하고 높은 순으로 석차를 매김
        var totals = new LinkedHashMap<TngStudent, Integer>();
        var sum = 0;
        for (var student : students) {
            var total = 48 + pick(student.code(), testDate, "score", 53);
            totals.put(student, total);
            sum += total;
        }
        var average = Math.round(sum * 10.0 / students.size()) / 10.0;
        var ranked = totals.entrySet().stream()
                .sorted(Map.Entry.<TngStudent, Integer>comparingByValue().reversed())
                .toList();
        var result = new ArrayList<TngScore>();
        for (var position = 0; position < ranked.size(); position++) {
            var student = ranked.get(position).getKey();
            var total = ranked.get(position).getValue();
            var comment = total < 70 ? "오답 단원 보충이 필요함" : "";
            result.add(new TngScore(
                    student.code(), student.name(), total, position + 1, ranked.size(), average, comment));
        }
        return result;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngHomework> homework(String classCode, LocalDate date) {
        var result = new ArrayList<TngHomework>();
        for (var student : students(classCode)) {
            result.add(new TngHomework(
                    student.code(),
                    homeworkGrade(pick(student.code(), date, "advance", 10)),
                    homeworkGrade(pick(student.code(), date, "deep", 10))));
        }
        return result;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public String postCounsel(String staffCode, String studentCode, LocalDate date, String topic, String content) {
        var studentName = studentsByClass.values().stream()
                .flatMap(List::stream)
                .filter(student -> student.code().equals(studentCode))
                .map(TngStudent::name)
                .findFirst()
                .orElseThrow(() -> new TngGatewayException("상담을 기록할 학생을 찾을 수 없습니다.", true));
        postedCounsels
                .computeIfAbsent(staffCode, ignored -> new CopyOnWriteArrayList<>())
                .add(new TngCounselRecord(studentCode, studentName, date, topic, content));
        return "MOCK-" + counselSequence.incrementAndGet();
    }

    /**
     * 순번으로 지어낸 학생 한 명
     *
     * @param number 전체 학생 중의 순번
     * @return 가상의 학생. 열 명에 한 명은 어머니 연락처가 비어 있음
     */
    private static TngStudent student(int number) {
        var name = FAMILY_NAMES[number % FAMILY_NAMES.length] + GIVEN_NAMES[(number * 7) % GIVEN_NAMES.length];
        // 실제 번호와 겹치지 않도록 가운데 자리를 0000으로 고정
        var phone = number % 10 == 0 ? "" : String.format("010-0000-%04d", number);
        return new TngStudent(String.format("N%05d", number), name, SCHOOLS[number % SCHOOLS.length], phone);
    }

    /**
     * 학번·날짜·항목으로 정해지는 0 이상 bound 미만의 수
     *
     * 난수 대신 써서 같은 입력에 같은 값이 나오게 함
     *
     * @param studentCode 학번
     * @param date 날짜
     * @param salt 항목 구분 문자열
     * @param bound 범위의 상한
     * @return 결정적인 값
     */
    private static int pick(String studentCode, LocalDate date, String salt, int bound) {
        return Math.floorMod((studentCode + "|" + date + "|" + salt).hashCode(), bound);
    }

    /**
     * 과제 이행 문구로 변환
     *
     * @param value 0 이상 10 미만의 값
     * @return 미이행, 미흡, 입력 전(빈 문자열), 없음 중 하나
     */
    private static String homeworkGrade(int value) {
        return switch (value) {
            case 0 -> "미이행";
            case 1, 2 -> "미흡";
            case 3 -> "";
            default -> "없음";
        };
    }

    /**
     * 알림장을 찾는 키
     *
     * @param classCode 반 코드
     * @param date 날짜
     * @return 반 코드와 날짜를 이은 문자열
     */
    private static String notebookKey(String classCode, LocalDate date) {
        return classCode + "|" + date;
    }
}
