"""Authentication: hashing, tokens, and the API gate."""
from app.security import create_token, decode_token, hash_password, verify_password


def test_password_hash_roundtrip():
    h = hash_password("s3cret")
    assert h != "s3cret"
    assert verify_password("s3cret", h) is True
    assert verify_password("wrong", h) is False
    assert verify_password("s3cret", None) is False
    assert verify_password("s3cret", "garbage") is False


def test_token_roundtrip_and_tamper():
    user = {"user_id": 1, "email": "a@b.c", "full_name": "A", "role": "admin"}
    tok = create_token(user)
    payload = decode_token(tok)
    assert payload and payload["email"] == "a@b.c" and payload["role"] == "admin"
    assert decode_token(tok[:-2] + "xx") is None
    assert decode_token(None) is None
    assert decode_token("not-a-token") is None
