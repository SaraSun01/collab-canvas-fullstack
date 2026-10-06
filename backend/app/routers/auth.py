from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from ..auth import ACCESS_TOKEN_TTL, create_access_token, get_current_auth, public_user, require_user, verify_password
from ..errors import APIError
from ..models import TokenRequest, TokenResponse, User
from ..store import DatabaseStore, get_store


router = APIRouter(prefix="/v1/auth", tags=["Authentication"])


@router.post("/token", response_model=TokenResponse)
def issue_token(request: TokenRequest, store: DatabaseStore = Depends(get_store)) -> TokenResponse:
    user = store.find_user_by_email(request.email)
    if user is None or not verify_password(request.password, user.passwordHash):
        raise APIError("invalid", 401, "Invalid email or password.")
    return TokenResponse(access_token=create_access_token(user), expires_in=ACCESS_TOKEN_TTL)


@router.get("/me", response_model=User)
def get_current_user(context=Depends(get_current_auth), store: DatabaseStore = Depends(get_store)) -> User:
    return public_user(require_user(context, store))


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(context=Depends(get_current_auth), store: DatabaseStore = Depends(get_store)) -> Response:
    store.revoke_token(context.token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
