const ADMIN_AUTH_KEY = 'poker_admin_authenticated';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD?.trim() ?? '';

export function hasConfiguredAdminPassword(): boolean {
  return ADMIN_PASSWORD.length > 0;
}

export function isAdminAuthenticated(): boolean {
  return sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true';
}

export function authenticateAdmin(password: string): boolean {
  if (!hasConfiguredAdminPassword()) {
    return false;
  }

  const isValid = password === ADMIN_PASSWORD;

  if (isValid) {
    sessionStorage.setItem(ADMIN_AUTH_KEY, 'true');
  }

  return isValid;
}

export function logoutAdmin(): void {
  sessionStorage.removeItem(ADMIN_AUTH_KEY);
}
