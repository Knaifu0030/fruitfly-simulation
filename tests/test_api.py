from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from fruitfly_blackjack import service
from fruitfly_blackjack.service import SCHEMA, app
from fruitfly_blackjack.wallet import MemoryWalletStore, WalletService

client = TestClient(app)


def test_public_health_and_snapshot():
    assert client.get("/healthz").json() == {"status": "ok", "schema": SCHEMA}
    response = client.get("/api/live")
    assert response.status_code == 200
    assert response.json()["provider"] == "local-blackjack/0.1"


def test_admin_is_closed_without_configured_identity():
    response = client.post("/api/admin/runs", json={"hands": 1})
    assert response.status_code == 403


def test_missing_replay_is_404():
    assert client.get("/api/hands/does-not-exist").status_code == 404


def test_websocket_starts_with_versioned_snapshot():
    with client.websocket_connect("/api/stream") as socket:
        event = socket.receive_json()
        assert event["schema"] == SCHEMA
        assert event["type"] == "session.snapshot"


def test_public_wallet_omits_private_ledger_fields():
    service.wallet = WalletService(MemoryWalletStore())
    payload = client.get("/api/wallet").json()
    assert payload["currency"] == "INR_SIM"
    assert payload["balance_paise"] == 1_000_000
    assert "idempotency_key" not in payload["recent_topups"][0]


def test_pin_session_can_topup_once_idempotently(monkeypatch):
    service.wallet = WalletService(MemoryWalletStore())
    service.pin_attempts.clear()
    service.admin_sessions.clear()
    monkeypatch.setenv("OWNER_PIN_HASH", PasswordHasher().hash("2468"))
    login = client.post("/api/admin/auth/pin", json={"pin": "2468"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}", "Idempotency-Key": "api-topup"}
    first = client.post("/api/admin/wallet/topups", headers=headers, json={"amount_paise": 100_000})
    second = client.post("/api/admin/wallet/topups", headers=headers, json={"amount_paise": 100_000})
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert second.json()["wallet"]["balance_paise"] == 1_100_000


def test_pin_rate_limit(monkeypatch):
    service.pin_attempts.clear()
    monkeypatch.setenv("OWNER_PIN_HASH", PasswordHasher().hash("2468"))
    for _ in range(5):
        assert client.post("/api/admin/auth/pin", json={"pin": "wrong"}).status_code == 403
    assert client.post("/api/admin/auth/pin", json={"pin": "wrong"}).status_code == 429


def test_owner_can_reduce_balance_and_configure_table(monkeypatch):
    service.wallet = WalletService(MemoryWalletStore())
    service.pin_attempts.clear()
    service.admin_sessions.clear()
    monkeypatch.setenv("OWNER_PIN_HASH", PasswordHasher().hash("2468"))
    token = client.post("/api/admin/auth/pin", json={"pin": "2468"}).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    adjusted = client.post(
        "/api/admin/wallet/adjustments",
        headers={**auth, "Idempotency-Key": "api-reduce"},
        json={"direction": "reduce", "amount_paise": 50_000},
    )
    assert adjusted.status_code == 200
    assert adjusted.json()["wallet"]["balance_paise"] == 950_000
    configured = client.post(
        "/api/admin/wallet/config",
        headers=auth,
        json={"base_wager_paise": 25_000, "late_surrender": False},
    )
    assert configured.status_code == 200
    assert configured.json()["base_wager_paise"] == 25_000
    assert configured.json()["late_surrender"] is False
