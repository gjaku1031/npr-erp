package com.npr.erp.bootstrap.operations;

import com.npr.erp.NprErpApplication;
import com.npr.erp.accesscontrol.SuperuserManagement;
import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.identity.SetAccountPasswordCommand;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 화면 없이 실행하는 운영 명령
 *
 * 첫 슈퍼유저처럼 화면으로는 만들 수 없는 것을 서버에서 직접 만듦. 비밀번호는 명령 인자가 아니라 환경 변수로만 받아
 * 셸 기록과 프로세스 목록에 남지 않게 함. 명령마다 확인 문자열을 요구함
 *
 * <pre>
 * NPR_ACCOUNT_PASSWORD=... java -jar npr-erp.jar --spring.main.web-application-type=none \
 *     --npr-command=create-account --username=admin --display-name=관리자 --reason=초기구성 --confirm=CREATE_ACCOUNT
 * </pre>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OperationsRunner implements ApplicationRunner {
    /**
     * 명령 이름을 받는 옵션. {@link NprErpApplication#COMMAND_PREFIX}와 같은 이름
     */
    private static final String COMMAND_OPTION = "npr-command";

    /**
     * 비밀번호를 읽는 환경 변수
     */
    private static final String PASSWORD_VARIABLE = "NPR_ACCOUNT_PASSWORD";

    /**
     * 계정 생성과 비밀번호 변경
     */
    private final AccountAdministration accountAdministration;

    /**
     * 계정 조회
     */
    private final AccountDirectory accountDirectory;

    /**
     * 슈퍼유저 부여와 회수
     */
    private final SuperuserManagement superuserManagement;

    /**
     * 실행 환경
     */
    private final Environment environment;

    /**
     * 명령 옵션이 있으면 해당 명령을 실행
     *
     * @throws IllegalStateException 웹 서버를 끄지 않고 실행했거나 옵션이 잘못됐을 때
     */
    @Override
    public void run(ApplicationArguments args) {
        var command = option(args, COMMAND_OPTION);
        if (command == null) {
            return;
        }
        if (!"none".equalsIgnoreCase(environment.getProperty("spring.main.web-application-type"))) {
            throw new IllegalStateException("운영 명령은 spring.main.web-application-type=none으로만 실행할 수 있습니다.");
        }
        switch (command) {
            case "create-account" -> createAccount(args);
            case "set-account-password" -> setAccountPassword(args);
            case "grant-superuser" -> grantSuperuser(args);
            case "revoke-superuser" -> revokeSuperuser(args);
            default -> throw new IllegalStateException("지원하지 않는 명령입니다: " + command);
        }
    }

    /**
     * 계정 생성
     *
     * @param args 명령 인자
     */
    private void createAccount(ApplicationArguments args) {
        requireConfirmation(args, "CREATE_ACCOUNT");
        var username = required(args, "username");
        var displayName = option(args, "display-name");
        var account = accountAdministration.createAccount(new CreateAccountCommand(
                UUID.randomUUID(),
                username,
                displayName == null ? username : displayName,
                environment.getRequiredProperty(PASSWORD_VARIABLE),
                required(args, "reason")));
        log.info("계정을 만들었습니다: {}", account.accountId());
    }

    /**
     * 계정 비밀번호 변경
     *
     * @param args 명령 인자
     */
    private void setAccountPassword(ApplicationArguments args) {
        requireConfirmation(args, "SET_ACCOUNT_PASSWORD");
        var accountId = UUID.fromString(required(args, "account-id"));
        accountAdministration.setPassword(new SetAccountPasswordCommand(
                accountId, environment.getRequiredProperty(PASSWORD_VARIABLE), required(args, "reason")));
        log.info("비밀번호를 바꿨습니다: {}", accountId);
    }

    /**
     * 슈퍼유저 부여
     *
     * 첫 슈퍼유저는 실행자 없이 부여하고, 그다음부터는 기존 슈퍼유저를 실행자로 적어야 함
     *
     * @param args 명령 인자
     */
    private void grantSuperuser(ApplicationArguments args) {
        requireConfirmation(args, "GRANT_SUPERUSER");
        var target = UUID.fromString(required(args, "target-account-id"));
        accountDirectory.requireActive(target);
        var actorOption = option(args, "actor-account-id");
        var actor = actorOption == null ? null : UUID.fromString(actorOption);
        if (actor != null) {
            accountDirectory.requireActive(actor);
        }
        var changed = superuserManagement.grant(target, actor, required(args, "reason"));
        log.info("슈퍼유저 부여: accountId={}, changed={}", target, changed);
    }

    /**
     * 슈퍼유저 회수
     *
     * @param args 명령 인자
     */
    private void revokeSuperuser(ApplicationArguments args) {
        requireConfirmation(args, "REVOKE_SUPERUSER");
        var target = UUID.fromString(required(args, "target-account-id"));
        var actor = UUID.fromString(required(args, "actor-account-id"));
        accountDirectory.requireActive(actor);
        var changed = superuserManagement.revoke(target, actor, required(args, "reason"));
        log.info("슈퍼유저 회수: accountId={}, changed={}", target, changed);
    }

    /**
     * 확인 문자열이 맞는지 확인
     *
     * @param args 명령 인자
     * @param expected 기대하는 확인 문자열
     */
    private static void requireConfirmation(ApplicationArguments args, String expected) {
        if (!expected.equals(required(args, "confirm"))) {
            throw new IllegalStateException("확인 문자열은 " + expected + " 이어야 합니다.");
        }
    }

    /**
     * 반드시 있어야 하는 옵션 값
     *
     * @param args 명령 인자
     * @param name 옵션 이름
     * @return 옵션 값
     */
    private static String required(ApplicationArguments args, String name) {
        var value = option(args, name);
        if (value == null) {
            throw new IllegalStateException("--" + name + " 옵션이 필요합니다.");
        }
        return value;
    }

    /**
     * 옵션 값 하나
     *
     * @param args 명령 인자
     * @param name 옵션 이름
     * @return 값. 없거나 비었거나 여러 번 주어졌으면 null
     */
    private static String option(ApplicationArguments args, String name) {
        var values = args.getOptionValues(name);
        if (values == null || values.size() != 1 || values.getFirst().isBlank()) {
            return null;
        }
        return values.getFirst().strip();
    }
}
