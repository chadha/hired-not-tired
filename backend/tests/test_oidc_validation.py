from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.oidc import ISSUER, LinkedInOIDC, OIDCError
from tests.conftest import make_test_settings


def test_issuer_matches_linkedin_oidc_discovery_issuer() -> None:
    assert ISSUER == "https://www.linkedin.com/oauth"


def signing_material() -> tuple[object, dict[str, object]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": "test-key", "use": "sig", "alg": "RS256"})
    return private_key, jwk


def signed_token(private_key: object, **overrides: object) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "iss": ISSUER,
        "aud": "test-client",
        "sub": "signed-subject",
        "name": "Signed User",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    payload.update(overrides)
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key"})


async def test_linkedin_id_token_without_nonce_is_validated_by_signature_and_core_claims() -> None:
    settings = make_test_settings()
    provider = LinkedInOIDC(settings)
    private_key, jwk = signing_material()

    async def local_jwks(refresh: bool = False) -> list[dict[str, object]]:
        return [jwk]

    provider._fetch_jwks = local_jwks  # type: ignore[method-assign]
    token = signed_token(private_key)
    claims = await provider.validate_id_token(token)
    assert claims.sub == "signed-subject"
    assert claims.name == "Signed User"


async def test_id_token_rejects_invalid_signature_audience_issuer_and_expiry() -> None:
    settings = make_test_settings()
    provider = LinkedInOIDC(settings)
    private_key, jwk = signing_material()

    async def local_jwks(refresh: bool = False) -> list[dict[str, object]]:
        return [jwk]

    provider._fetch_jwks = local_jwks  # type: ignore[method-assign]
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(OIDCError):
        await provider.validate_id_token(signed_token(other_private_key))
    with pytest.raises(OIDCError):
        await provider.validate_id_token(signed_token(private_key, aud="other"))
    with pytest.raises(OIDCError):
        await provider.validate_id_token(signed_token(private_key, iss="https://evil.test"))
    expired = datetime.now(UTC) - timedelta(minutes=10)
    with pytest.raises(OIDCError):
        await provider.validate_id_token(signed_token(private_key, iat=expired, exp=expired))
