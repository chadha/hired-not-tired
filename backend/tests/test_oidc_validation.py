from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.oidc import ISSUER, LinkedInOIDC, OIDCError
from tests.conftest import make_test_settings


def signing_material() -> tuple[object, dict[str, object]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": "test-key", "use": "sig", "alg": "RS256"})
    return private_key, jwk


def signed_token(private_key: object, nonce: str, **overrides: object) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "iss": ISSUER,
        "aud": "test-client",
        "sub": "signed-subject",
        "name": "Signed User",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "nonce": nonce,
    }
    payload.update(overrides)
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key"})


async def test_real_local_signature_issuer_audience_expiry_and_nonce_validation() -> None:
    settings = make_test_settings()
    provider = LinkedInOIDC(settings)
    private_key, jwk = signing_material()

    async def local_jwks(refresh: bool = False) -> list[dict[str, object]]:
        return [jwk]

    provider._fetch_jwks = local_jwks  # type: ignore[method-assign]
    token = signed_token(private_key, "expected-nonce")
    claims = await provider.validate_id_token(token, "expected-nonce")
    assert claims.sub == "signed-subject"
    assert claims.name == "Signed User"

    with pytest.raises(OIDCError):
        await provider.validate_id_token(token, "different-nonce")
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(OIDCError):
        await provider.validate_id_token(
            signed_token(other_private_key, "expected-nonce"), "expected-nonce"
        )
    with pytest.raises(OIDCError):
        await provider.validate_id_token(
            signed_token(private_key, "expected-nonce", aud="other"), "expected-nonce"
        )
    with pytest.raises(OIDCError):
        await provider.validate_id_token(
            signed_token(private_key, "expected-nonce", iss="https://evil.test"), "expected-nonce"
        )
    expired = datetime.now(UTC) - timedelta(minutes=10)
    with pytest.raises(OIDCError):
        await provider.validate_id_token(
            signed_token(private_key, "expected-nonce", iat=expired, exp=expired),
            "expected-nonce",
        )