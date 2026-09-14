from fastapi.testclient import TestClient

from fruitfly_blackjack.service import SCHEMA, app

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
