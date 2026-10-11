package com.npr.erp.bootstrap.web;

import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.AuthenticatedAccount;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.context.annotation.RequestScope;

/**
 * 계정 ID를 화면에 보여 줄 이름으로 바꿈
 *
 * 한 요청 안에서 처음 쓸 때 계정 목록을 한 번 읽어 둠
 */
@Component("names")
@RequestScope
@RequiredArgsConstructor
public class Names {
    /**
     * 계정 조회
     */
    private final AccountDirectory accountDirectory;

    /**
     * 이 요청에서 읽어 둔 계정 ID별 이름
     */
    private Map<UUID, String> displayNames;

    /**
     * 계정의 표시 이름
     *
     * @param accountId 계정 ID
     * @return 표시 이름. 계정을 찾지 못하면 "알 수 없음"
     */
    public String of(UUID accountId) {
        if (accountId == null) {
            return "";
        }
        if (displayNames == null) {
            displayNames = new HashMap<>();
            for (AuthenticatedAccount account : accountDirectory.list()) {
                displayNames.put(account.accountId(), account.displayName());
            }
        }
        return displayNames.getOrDefault(accountId, "알 수 없음");
    }
}
