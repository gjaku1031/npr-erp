package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.AccessControlException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationDeniedException;
import com.npr.erp.identity.AccountNotFoundException;
import com.npr.erp.identity.IdentityException;
import com.npr.erp.storage.StorageException;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.tng.TngGatewayException;
import com.npr.erp.worklog.WorklogException;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.support.RequestContextUtils;

/**
 * 모듈이 던진 업무 예외를 화면으로 바꿈
 *
 * 입력을 보낸 요청(POST)은 이전 화면으로 돌려보내며 오류 문구를 띄우고, 조회 요청은 오류 화면을 보여 줌. 권한 거부와
 * 대상 없음은 언제나 오류 화면으로 보냄
 */
@Slf4j
@ControllerAdvice
public class WebExceptionHandler {
    /**
     * 오류 화면 템플릿
     */
    private static final String ERROR_VIEW = "error";

    /**
     * 권한 엔진이 거부한 요청
     *
     * @param failure 거부 예외
     * @param response 응답
     * @return 403 오류 화면
     */
    @ExceptionHandler(AuthorizationDeniedException.class)
    public ModelAndView denied(AuthorizationDeniedException failure, HttpServletResponse response) {
        return page(response, HttpStatus.FORBIDDEN, "이 작업을 할 권한이 없습니다", "권한이 필요하면 학원 관리자에게 요청해 주세요.");
    }

    /**
     * 본인의 것이 아닌 대상을 다루려 한 요청
     *
     * @param failure 소유 조건 예외
     * @param response 응답
     * @return 403 오류 화면
     */
    @ExceptionHandler(WorklogForbiddenException.class)
    public ModelAndView notOwner(WorklogForbiddenException failure, HttpServletResponse response) {
        return page(response, HttpStatus.FORBIDDEN, "이 작업을 할 권한이 없습니다", failure.getMessage());
    }

    /**
     * 대상을 찾지 못한 요청
     *
     * @param failure 대상 없음 예외
     * @param request 요청
     * @param response 응답
     * @return 입력 요청이면 이전 화면, 조회 요청이면 404 오류 화면
     */
    @ExceptionHandler({
        WorklogNotFoundException.class,
        StorageNotFoundException.class,
        AccessControlNotFoundException.class,
        AccountNotFoundException.class
    })
    public ModelAndView notFound(RuntimeException failure, HttpServletRequest request, HttpServletResponse response) {
        if (isPost(request)) {
            return backWithError(request, failure.getMessage());
        }
        return page(response, HttpStatus.NOT_FOUND, "찾을 수 없습니다", failure.getMessage());
    }

    /**
     * 규칙에 어긋난 입력이나 상태 충돌
     *
     * @param failure 업무 예외
     * @param request 요청
     * @param response 응답
     * @return 입력 요청이면 이전 화면, 조회 요청이면 오류 화면
     */
    @ExceptionHandler({
        WorklogException.class,
        StorageException.class,
        AccessControlException.class,
        IdentityException.class,
        TngGatewayException.class
    })
    public ModelAndView business(RuntimeException failure, HttpServletRequest request, HttpServletResponse response) {
        if (isPost(request)) {
            return backWithError(request, failure.getMessage());
        }
        return page(response, HttpStatus.CONFLICT, "요청을 처리하지 못했습니다", failure.getMessage());
    }

    /**
     * 올릴 수 있는 크기를 넘은 파일
     *
     * @param failure 크기 초과 예외
     * @param request 요청
     * @return 이전 화면
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ModelAndView tooLarge(MaxUploadSizeExceededException failure, HttpServletRequest request) {
        return backWithError(request, "파일이 너무 큽니다.");
    }

    /**
     * 같은 대상을 동시에 고쳐 버전이 어긋난 요청
     *
     * @param failure 낙관적 잠금 실패
     * @param request 요청
     * @return 이전 화면
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ModelAndView concurrentChange(OptimisticLockingFailureException failure, HttpServletRequest request) {
        return backWithError(request, "다른 변경과 겹쳤습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.");
    }

    /**
     * 잘못된 형식의 주소나 입력값
     *
     * @param failure 변환 예외
     * @param response 응답
     * @return 400 오류 화면
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ModelAndView badRequest(IllegalArgumentException failure, HttpServletResponse response) {
        log.debug("잘못된 요청", failure);
        return page(response, HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다", "주소나 입력값을 확인해 주세요.");
    }

    /**
     * 오류 문구를 띄우며 이전 화면으로 돌려보냄
     *
     * @param request 요청
     * @param message 오류 문구
     * @return 리다이렉트
     */
    private static ModelAndView backWithError(HttpServletRequest request, String message) {
        RequestContextUtils.getOutputFlashMap(request).put("error", message);
        return new ModelAndView(Redirects.back(request, "/"));
    }

    /**
     * 오류 화면 구성
     *
     * @param response 응답
     * @param status HTTP 상태
     * @param title 제목
     * @param message 설명
     * @return 오류 화면
     */
    private static ModelAndView page(HttpServletResponse response, HttpStatus status, String title, String message) {
        response.setStatus(status.value());
        var view = new ModelAndView(ERROR_VIEW);
        view.addObject("status", status.value());
        view.addObject("title", title);
        view.addObject("message", message);
        return view;
    }

    /**
     * 입력을 보낸 요청인지
     *
     * @param request 요청
     * @return POST이면 true
     */
    private static boolean isPost(HttpServletRequest request) {
        return "POST".equals(request.getMethod());
    }
}
