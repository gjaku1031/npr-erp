package com.npr.erp.bootstrap.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 학원 문맥을 만드는 인터셉터와 인자 해석기 등록
 */
@Configuration
@RequiredArgsConstructor
public class WebConfiguration implements WebMvcConfigurer {
    /**
     * 학원 문맥 인터셉터
     */
    private final AcademyContextInterceptor contextInterceptor;

    /**
     * 학원 문맥 인자 해석기
     */
    private final AcademyContextArgumentResolver contextArgumentResolver;

    /**
     * 학원 경로 아래의 모든 요청에 인터셉터 적용
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(contextInterceptor).addPathPatterns("/a/**");
    }

    /**
     * 인자 해석기 등록
     */
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(contextArgumentResolver);
    }
}
