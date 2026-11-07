"""Password hashing (scrypt) and stateless HMAC-signed session tokens with roles."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

ROLES = {"viewer": 0, "operator": 1, "admin": 2}


def hash_password(pw: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, s, h = stored.split("$")
        salt, want = base64.b64decode(s), base64.b64decode(h)
    except ValueError:
        return False
    got = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return hmac.compare_digest(got, want)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(secret: str, username: str, role: str, ttl_s: int = 12 * 3600) -> str:
    body = _b64(json.dumps({"u": username, "r": role, "exp": int(time.time()) + ttl_s}).encode())
    sig = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(secret: str, token: str) -> dict | None:
    try:
        body, sig = token.split(".")
    except ValueError:
        return None
    want = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(want, sig):
        return None
    data = json.loads(_unb64(body))
    if data.get("exp", 0) < time.time() or data.get("r") not in ROLES:
        return None
    return data


def has_role(claims: dict, needed: str) -> bool:
    return ROLES.get(claims.get("r", ""), -1) >= ROLES[needed]
