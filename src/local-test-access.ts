export const LOCAL_TEST_LOGIN_PAGE_KEY = "tai-login-open-local-test-accounts";

export function showLocalTestAccounts(input: { devBuild: boolean; backendEnabled?: boolean; hostname: string; mobileReadonly: boolean }) {
  return input.devBuild && input.backendEnabled === true && !input.mobileReadonly
    && ["localhost", "127.0.0.1", "[::1]"].includes(input.hostname);
}
