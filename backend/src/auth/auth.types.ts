/** Claims del access token (FR-001): identificación, tenant y rol. */
export interface JwtClaims {
  sub: string
  tenant_id: string | null
  rol: string
  full_name?: string
  /** Clave temporal pendiente de cambio (TSK-AUTH-010). */
  mcp?: boolean
}

/** Fila de app_user que usa el flujo de autenticación (owner pool). */
export interface AuthUserRow {
  id: string
  tenant_id: string | null
  email: string
  password_hash: string
  role: string
  full_name: string
  is_active: boolean
  failed_login_count: number
  locked_until: string | null
  must_change_password: boolean
  tenant_slug: string | null
  tenant_status: string | null
}

/** Fila de auth_session. */
export interface SessionRow {
  id: string
  user_id: string
  tenant_id: string | null
  family_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  /** TSK-AUTH-011: 'new_login' | 'password_changed' | null (rotación/expiración). */
  revoked_reason?: string | null
}

/** Perfil público devuelto por GET /me. */
export interface PublicProfile {
  id: string
  tenant_id: string | null
  email: string
  role: string
  full_name: string
  must_change_password: boolean
}

export interface LoginBody {
  email: string
  password: string
  /** Slug del tenant; obligatorio si el email existe en más de un tenant. */
  tenant?: string
}

export interface ChangePasswordBody {
  current_password: string
  new_password: string
}

/** Largo mínimo de una clave definida por el usuario (TSK-AUTH-010). */
export const MIN_PASSWORD_LENGTH = 10

export interface LoginResult {
  access_token: string
  user: PublicProfile
}