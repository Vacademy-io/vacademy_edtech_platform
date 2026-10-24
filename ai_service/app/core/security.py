import base64
import logging
from typing import Optional, Annotated

from fastapi import Depends, HTTPException, status, Request, Header
from jose import jwt, JWTError
import httpx

from ..config import get_settings, Settings
from ..schemas.auth import CustomUserDetails, AuthError, PinnedPrincipal

logger = logging.getLogger(__name__)


def _extract_bearer(auth_header: Optional[str]) -> Optional[str]:
    """Return the raw token from an 'Authorization: Bearer <token>' header."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    return auth_header[len("Bearer "):]


def _decode_jwt_token(token: str, settings: Settings) -> Optional[dict]:
    """
    Verify the HS256 signature and return the JWT claims, or None if invalid.

    Mirrors the Java side (common_service JwtService.getSignInKey): the secret
    STRING is BASE64-decoded to bytes before use. We pad to a valid base64
    length first. This does not mutate the cached settings object.
    """
    try:
        secret = settings.jwt_secret_key
        missing_padding = len(secret) % 4
        if missing_padding:
            secret = secret + "=" * (4 - missing_padding)
        secret_bytes = base64.b64decode(secret)
        return jwt.decode(
            token,
            secret_bytes,
            algorithms=[settings.jwt_algorithm],
            options={"verify_aud": False, "verify_iss": False},
        )
    except Exception as e:
        logger.error(f"JWT Validation failed: {e}")
        return None

def decode_access_token(token: str) -> Optional[dict]:
    """
    Verify an access token outside the HTTP dependency chain and return its
    claims, or None if it is missing/invalid.

    WebSockets cannot carry an Authorization header from a browser, so the voice
    socket verifies the token it is handed as its first message with this.
    """
    if not token:
        return None
    return _decode_jwt_token(token, get_settings())


def is_platform_staff(user) -> bool:
    """
    True only for a caller whose auth user id is on SUPER_ADMIN_USER_IDS: the
    gate for global writes (super-admin endpoints, credit rate, credit grants,
    model registry). Exact id match: ids are immutable, unlike usernames, which
    their owner can rename or case-vary. is_root_user and the ADMIN / ROOT_ADMIN
    roles are deliberately NOT staff signals (ordinary admins and learners carry
    them). Unset = nobody passes.
    """
    if not user:
        return False
    raw = get_settings().super_admin_user_ids or ""
    allowed = {uid.strip() for uid in raw.split(",") if uid.strip()}
    user_id = user.get("user_id") if isinstance(user, dict) else getattr(user, "user_id", None)
    return bool(user_id) and str(user_id).strip() in allowed


def jwt_institute_roles(authorization: Optional[str], institute_id: Optional[str]) -> Optional[set]:
    """
    The caller's roles in ONE institute, read from the verified JWT's
    per-institute authorities map, or None when the token is missing/invalid or
    names no such institute. Roles are uppercased with spaces/hyphens as '_'.

    No root bypass: is_root_user is set for ordinary admins and learners, so it
    says nothing about membership of a particular institute.
    """
    token = _extract_bearer(authorization)
    if not token or not institute_id:
        return None
    payload = _decode_jwt_token(token, get_settings())
    if payload is None:
        return None
    authorities = payload.get("authorities")
    entry = authorities.get(str(institute_id)) if isinstance(authorities, dict) else None
    if not isinstance(entry, dict):
        return None
    return {
        str(r).strip().upper().replace("-", "_").replace(" ", "_")
        for r in (entry.get("roles") or []) if r
    }


def require_institute_member(
    authorization: Optional[str],
    institute_id: Optional[str],
    *,
    admin: bool = False,
) -> None:
    """
    403 unless the bearer token is a member of `institute_id` (and, with
    admin=True, holds the ADMIN role there). Call it after get_current_user /
    get_optional_user has authenticated the caller; it adds the tenant check
    those do not make (they trust the clientId header verbatim).
    """
    roles = jwt_institute_roles(authorization, institute_id)
    if roles is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this institute.",
        )
    if admin and "ADMIN" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only institute admins can do this.",
        )


async def get_optional_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings)
) -> Optional[CustomUserDetails]:
    """
    Extract and verify user from JWT token if present.
    Returns None if token is missing or invalid (no exception raised).
    This allows the endpoint to work for both authenticated and unauthenticated users.
    """
    if not authorization:
        return None

    try:
        return await _verify_and_fetch_user(authorization, _client_id_from_request(request), settings)
    except Exception as e:
        logger.warning(f"Optional auth failed: {e}")
        return None


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings)
) -> CustomUserDetails:
    """
    Enforce authentication. Raises HTTPException if token is invalid or missing.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header"
        )
        
    try:
        user = await _verify_and_fetch_user(authorization, _client_id_from_request(request), settings)
        if not user:
             raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User verification failed"
            )
        return user
    except AuthError as ae:
        raise HTTPException(status_code=ae.status_code, detail=ae.message)
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )


def _client_id_from_request(request: Request) -> Optional[str]:
    """The institute this request declares, via the `clientId` header."""
    return request.headers.get("clientId") or request.headers.get("client_id")


async def _verify_and_fetch_user(
    auth_header: str,
    client_id: Optional[str],
    settings: Settings,
) -> Optional[CustomUserDetails]:
    """
    Internal logic to decode JWT and call Auth Service.

    Takes the institute id explicitly rather than a Request, so callers without
    an HTTP request in hand (the MCP server, which replays a stored token) reuse
    exactly this verification path.
    """
    if not auth_header.startswith("Bearer "):
        # Log to debug
        # logger.debug(f"Invalid auth header format: {auth_header[:10]}...")
        return None # Do not raise immediately to allow optional auth to fail gracefully if header is just wrong
        
    token = auth_header.replace("Bearer ", "")

    # 1. Decode and Validate JWT locally first (shared helper; does not mutate settings)
    payload = _decode_jwt_token(token, settings)
    if payload is None:
        return None
    username = payload.get("sub")
    if not username:
        logger.warning("JWT decoded but missing 'sub' claim")
        return None
        
    # 2. Call Auth Service (Internal API)
    if not settings.client_secret:
        logger.warning("CLIENT_SECRET not configured. Skipping Auth Service call. Returning JWT claims.")
        return _create_user_from_jwt_payload(payload)
        
    # 'clientId' (Institute ID) is required by Auth Service:
    # Java: final String instituteId = request.getHeader("clientId");
    # Java: final String usernameWithInstituteId = instituteId + "@" + jwtService.extractUsername(jwt);
    if not client_id:
         # Fallback: if no institute ID header, we can't construct the full username expected by Auth Service
         # But maybe Auth Service accepts just username if institute is implicit? 
         # Based on Java code, it strictly concatenates.
         # We'll try with just username if client_id is missing, or return JWT user.
         logger.warning("Missing 'clientId' header. Auth Service might reject user lookup.")
         full_username = username
    else:
         full_username = f"{client_id}@{username}"

    try:
        async with httpx.AsyncClient() as client:
            headers = {
                "clientName": settings.client_name,
                "Signature": settings.client_secret, # Pass secret directly as Signature
                "Content-Type": "application/json"
            }
            
            # Auth Service internal route
            url = f"{settings.auth_service_base_url}/auth-service/v1/internal/user"
            params = {
                "userName": full_username,
                "serviceName": settings.client_name
            }
            
            response = await client.get(url, headers=headers, params=params, timeout=5.0)
            
            if response.status_code == 200:
                data = response.json()
                # Java serializes isRootUser as "rootUser" (Jackson boolean convention)
                is_root = data.get("rootUser", False) or data.get("isRootUser", False) or data.get("is_root_user", False)
                return CustomUserDetails(
                    username=data.get("username", username),
                    user_id=data.get("userId"),
                    institute_id=client_id,
                    enabled=data.get("enabled", True),
                    is_root_user=bool(is_root),
                    roles=data.get("roles") or [],
                    authorities=data.get("authorities") or []
                )
            else:
                 logger.warning(f"Auth Service returned {response.status_code} for user {full_username}: {response.text}")
                 # Fallback to JWT if Auth Service fails? 
                 # User said "verify via auth service". If verification fails, we should fail.
                 return None
                 
    except httpx.RequestError as e:
        logger.error(f"Failed to connect to Auth Service: {e}")
        return None

def _create_user_from_jwt_payload(payload: dict) -> CustomUserDetails:
    # Use 'user' claim for ID if present (from Java generateToken)
    user_id = payload.get("user")
    if not user_id:
        user_id = "unknown"

    # Extract is_root_user from JWT claims (Java puts "is_root_user": true/false)
    is_root = payload.get("is_root_user", False)

    return CustomUserDetails(
        username=payload.get("sub"),
        user_id=str(user_id),
        is_root_user=bool(is_root),
        roles=[],
        authorities=list(payload.get("authorities", {}).keys()) if isinstance(payload.get("authorities"), dict) else []
    )


async def get_pinned_principal(
    request: Request,
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> PinnedPrincipal:
    """
    Trust boundary for the Vacademy Assistant.

    Produces a PinnedPrincipal locked to exactly ONE institute — the one named
    by the `clientId` header — and reads the caller's roles/permissions from the
    JWT's per-institute authorities map UNDER THAT INSTITUTE KEY ONLY.

    This is deliberately stricter than get_current_user, which flattens the
    authorities map to a list of institute ids and so cannot tell which roles
    belong to which institute. The backend does no per-institute RBAC and every
    ai_service->Java internal call runs with full service trust, so this pin is
    the authoritative scope for everything the Assistant is allowed to do.

    Raises:
        401 — missing/invalid token (via get_current_user).
        403 — no `clientId` header, or the user is not a member of that institute.
    """
    return await resolve_pinned_principal(
        token=_extract_bearer(authorization),
        client_id=_client_id_from_request(request),
        settings=settings,
    )


async def resolve_pinned_principal(
    token: Optional[str],
    client_id: Optional[str],
    settings: Settings,
) -> PinnedPrincipal:
    """
    The body of the Assistant trust boundary, without an HTTP request.

    Callers that hold a platform token and an institute id directly — the MCP
    server replays a stored token on every tool call — go through this so the
    verification, pinning and authorities-map rules stay in exactly one place.

    Raises the same HTTPExceptions as get_pinned_principal (401/403).
    """
    # 1. Enforce authentication (and liveness/enabled checks when CLIENT_SECRET
    #    is configured). Reuses the existing, audited verification path.
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    try:
        current_user = await _verify_and_fetch_user(f"Bearer {token}", client_id, settings)
    except AuthError as ae:
        raise HTTPException(status_code=ae.status_code, detail=ae.message)

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    # 2. Pin the institute. There is no implicit institute — the caller must
    #    declare which one this session is for.
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing 'clientId' header: the institute for this session is not specified.",
        )

    # 3. Decode the JWT to read the per-institute authorities map. The map shape
    #    is {instituteId: {"roles": [...], "permissions": [...]}} — built by Java
    #    common_service UserRoleService.createInstituteRoleMap.
    payload = _decode_jwt_token(token, settings)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    user_id = current_user.user_id or str(payload.get("user") or "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing a user id",
        )

    authorities = payload.get("authorities")
    entry = authorities.get(client_id) if isinstance(authorities, dict) else None

    if entry is None:
        # Root/super-admin users may legitimately operate across institutes even
        # without a per-institute role row. They pass the pin but carry NO
        # per-institute roles/permissions, so deny-by-default tool gating still
        # applies unless a tool is explicitly granted to them.
        if current_user.is_root_user:
            return PinnedPrincipal(
                user_id=user_id,
                institute_id=client_id,
                username=current_user.username,
                full_name=str(payload.get("fullname") or "") or None,
                roles=[],
                permissions=[],
                is_root_user=True,
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not a member of the requested institute.",
        )

    roles = entry.get("roles") if isinstance(entry, dict) else None
    permissions = entry.get("permissions") if isinstance(entry, dict) else None

    return PinnedPrincipal(
        user_id=user_id,
        institute_id=client_id,
        username=current_user.username,
        full_name=str(payload.get("fullname") or "") or None,
        roles=list(roles or []),
        permissions=list(permissions or []),
        is_root_user=current_user.is_root_user,
    )
