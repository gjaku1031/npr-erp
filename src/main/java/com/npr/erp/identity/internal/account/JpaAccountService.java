package com.npr.erp.identity.internal.account;

import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.AccountBindingConflictException;
import com.npr.erp.identity.AccountCredentials;
import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.AccountInactiveException;
import com.npr.erp.identity.AccountNotFoundException;
import com.npr.erp.identity.AccountStatus;
import com.npr.erp.identity.AuthenticatedAccount;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.identity.SetAccountPasswordCommand;
import com.npr.erp.identity.internal.audit.IdentityAuditLogEntity;
import com.npr.erp.identity.internal.audit.IdentityAuditLogRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 계정 조회와 관리 구현
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JpaAccountService implements AccountDirectory, AccountAdministration {
    /**
     * 로그인 아이디와 이름의 최대 길이
     */
    private static final int MAX_USERNAME_LENGTH = 255;

    /**
     * 화면 이름의 최대 길이
     */
    private static final int MAX_DISPLAY_NAME_LENGTH = 120;

    /**
     * 감사 사유의 최대 길이
     */
    private static final int MAX_REASON_LENGTH = 500;

    /**
     * BCrypt가 실제로 쓰는 입력 바이트 상한
     */
    private static final int MAX_PASSWORD_BYTES = 72;

    /**
     * 비밀번호 최소 글자 수
     */
    private static final int MIN_PASSWORD_LENGTH = 8;

    /**
     * 계정 저장소
     */
    private final AccountRepository accountRepository;

    /**
     * 계정 감사 기록 저장소
     */
    private final IdentityAuditLogRepository auditLogRepository;

    /**
     * 계정 변경 잠금
     */
    private final AccountMutationLock mutationLock;

    /**
     * 비밀번호 해시 인코더
     */
    private final PasswordEncoder passwordEncoder;

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<AccountCredentials> findCredentialsByUsername(String username) {
        return accountRepository.findByUsername(username)
                .map(account -> new AccountCredentials(
                        account.getId(), account.getUsername(), account.getPasswordHash(), account.getStatus()));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public AuthenticatedAccount requireActive(UUID accountId) {
        var account = accountRepository.findById(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        return toView(requireActive(account));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<AuthenticatedAccount> find(UUID accountId) {
        return accountRepository.findById(accountId).map(JpaAccountService::toView);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<AuthenticatedAccount> findAll(Collection<UUID> accountIds) {
        if (accountIds.isEmpty()) {
            return List.of();
        }
        return accountRepository.findAllById(accountIds).stream().map(JpaAccountService::toView).toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<AuthenticatedAccount> list() {
        return accountRepository.findAllByOrderByUsernameAsc().stream().map(JpaAccountService::toView).toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AuthenticatedAccount createAccount(CreateAccountCommand command) {
        // 입력 검증은 잠금 전에 끝내 잘못된 요청이 잠금을 잡지 않게 함
        validatePassword(command.getPassword());
        var username = normalize(command.getUsername(), "로그인 아이디", MAX_USERNAME_LENGTH);
        var displayName = normalize(command.getDisplayName(), "이름", MAX_DISPLAY_NAME_LENGTH);
        var reason = normalize(command.getReason(), "생성 사유", MAX_REASON_LENGTH);
        mutationLock.acquire();

        // ID와 아이디 중 하나만 일치하는 기존 계정은 다른 계정이므로 충돌로 처리
        var byId = accountRepository.findById(command.getAccountId()).orElse(null);
        var byUsername = accountRepository.findByUsername(username).orElse(null);
        if (byId != null && !byId.getUsername().equals(username)) {
            throw new AccountBindingConflictException("요청한 계정 ID가 다른 로그인 아이디에 쓰이고 있습니다.");
        }
        if (byUsername != null && !byUsername.getId().equals(command.getAccountId())) {
            throw new AccountBindingConflictException("요청한 로그인 아이디가 다른 계정에 쓰이고 있습니다.");
        }
        if (byId != null) {
            return toView(requireActive(byId));
        }

        var now = Instant.now();
        var account = accountRepository.save(new AccountEntity(
                command.getAccountId(), username, displayName, passwordEncoder.encode(command.getPassword()), now));
        auditLogRepository.save(new IdentityAuditLogEntity("ACCOUNT_CREATED", null, account.getId(), reason, now));
        return toView(account);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void setPassword(SetAccountPasswordCommand command) {
        validatePassword(command.getPassword());
        var reason = normalize(command.getReason(), "변경 사유", MAX_REASON_LENGTH);
        mutationLock.acquire();

        var account = accountRepository.findById(command.getAccountId())
                .orElseThrow(() -> new AccountNotFoundException(command.getAccountId()));
        var now = Instant.now();
        account.changePassword(passwordEncoder.encode(command.getPassword()), now);
        auditLogRepository.save(new IdentityAuditLogEntity("ACCOUNT_PASSWORD_SET", null, account.getId(), reason, now));
    }

    /**
     * 비밀번호 길이 규칙 확인
     *
     * BCrypt는 72바이트 뒤를 버리므로 그보다 긴 비밀번호는 받지 않음
     *
     * @param password 평문 비밀번호
     * @throws IllegalArgumentException 8자 미만이거나 72바이트를 넘을 때
     */
    private static void validatePassword(String password) {
        if (password == null || password.isBlank() || password.length() < MIN_PASSWORD_LENGTH
                || password.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new IllegalArgumentException("비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 합니다.");
        }
    }

    /**
     * 앞뒤 공백을 지우고 길이 확인
     *
     * @param value 입력값
     * @param label 오류 문구에 쓸 항목 이름
     * @param maxLength 허용 최대 길이
     * @return 공백을 지운 값
     * @throws IllegalArgumentException 비었거나 최대 길이를 넘을 때
     */
    private static String normalize(String value, String label, int maxLength) {
        var trimmed = value == null ? "" : value.strip();
        if (trimmed.isEmpty() || trimmed.length() > maxLength) {
            throw new IllegalArgumentException(label + "은(는) 1자 이상 " + maxLength + "자 이하여야 합니다.");
        }
        return trimmed;
    }

    /**
     * 활성 계정인지 확인
     *
     * @param account 확인할 계정
     * @return 같은 계정
     * @throws AccountInactiveException 활성 상태가 아닐 때
     */
    private static AccountEntity requireActive(AccountEntity account) {
        if (account.getStatus() != AccountStatus.ACTIVE) {
            throw new AccountInactiveException(account.getId());
        }
        return account;
    }

    /**
     * 엔티티를 공개 계정 정보로 변환
     *
     * @param account 계정 엔티티
     * @return 비밀번호 해시가 빠진 계정 정보
     */
    private static AuthenticatedAccount toView(AccountEntity account) {
        return new AuthenticatedAccount(
                account.getId(), account.getUsername(), account.getDisplayName(), account.getStatus());
    }
}
