package com.npr.erp.bootstrap.security;

import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.AccountStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * 로그인 아이디로 계정을 찾아 Spring Security에 넘김
 */
@Service
@RequiredArgsConstructor
public class AccountUserDetailsService implements UserDetailsService {
    /**
     * 계정 조회
     */
    private final AccountDirectory accountDirectory;

    /**
     * 로그인 아이디로 계정 조회
     *
     * @throws UsernameNotFoundException 계정이 없을 때
     */
    @Override
    public UserDetails loadUserByUsername(String username) {
        return accountDirectory.findCredentialsByUsername(username)
                .map(credentials -> new AccountPrincipal(
                        credentials.getAccountId(),
                        credentials.getUsername(),
                        credentials.getPasswordHash(),
                        credentials.getStatus() == AccountStatus.ACTIVE))
                .orElseThrow(() -> new UsernameNotFoundException("계정을 찾을 수 없습니다."));
    }
}
