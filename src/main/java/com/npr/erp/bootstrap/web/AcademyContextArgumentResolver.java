package com.npr.erp.bootstrap.web;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * 컨트롤러 메서드의 {@link AcademyContext} 인자를 채움
 */
@Component
public class AcademyContextArgumentResolver implements HandlerMethodArgumentResolver {
    /**
     * 문맥 타입의 인자만 처리
     */
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.getParameterType() == AcademyContext.class;
    }

    /**
     * 인터셉터가 요청 속성에 넣어 둔 문맥을 꺼냄
     *
     * @throws IllegalStateException 학원 경로가 아닌 곳에서 문맥을 요구했을 때
     */
    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory) {
        var context = webRequest.getAttribute(AcademyContext.ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        if (context == null) {
            throw new IllegalStateException("학원 경로 밖에서는 학원 문맥을 쓸 수 없습니다.");
        }
        return context;
    }
}
