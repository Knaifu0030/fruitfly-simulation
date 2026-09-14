from __future__ import annotations

import asyncio
import os
import secrets
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import HybridAgent
from .brain import BrainActivityModel
from .models import Observation, RoundResult, Rules
from .provider import LocalBlackjackProvider
from .wallet import WalletService

SCHEMA = "fruitfly-blackjack/1"
RUNTIME = Path(os.getenv("FRUITFLY_RUNTIME_DIR", ".runtime"))
MAX_HISTORY = 10_000


class RunRequest(BaseModel):
    hands: int = Field(default=1_000, ge=1, le=100_000)
    seed: int = 20260914
    duration_seconds: int = Field(default=7_200, ge=10, le=7_200)
    speed_hands_per_second: float = Field(default=2.0, gt=0, le=100)
    base_wager_paise: int | None = Field(default=None, ge=100, le=10_000_000)
    late_surrender: bool | None = None


class PinRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=128)


class TopupRequest(BaseModel):
    amount_paise: int = Field(ge=100, le=1_000_000_000)
    public_note: str = Field(default="Virtual funds added", max_length=80)


class WalletConfigRequest(BaseModel):
    base_wager_paise: int = Field(ge=100, le=10_000_000)
    late_surrender: bool


class AdjustmentRequest(BaseModel):
    direction: Literal["add", "reduce"]
    amount_paise: int = Field(ge=100, le=1_000_000_000)
    public_note: str = Field(default="Virtual balance adjusted", max_length=80)


@dataclass
class Counters:
    hands: int = 0
    wins: int = 0
    losses: int = 0
    pushes: int = 0
    blackjacks: int = 0
    surrenders: int = 0
    doubles: int = 0
    splits: int = 0
    unit_return: float = 0.0
    decisions: int = 0
    correct: int = 0

    @property
    def accuracy(self) -> float:
        return self.correct / self.decisions if self.decisions else 1.0


class EventBus:
    def __init__(self) -> None:
        self.sequence = 0
        self.subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    async def publish(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.sequence += 1
        event = {
            "schema": SCHEMA,
            "sequence": self.sequence,
            "type": event_type,
            "timestamp": datetime.now(UTC).isoformat(),
            "payload": payload,
        }
        for queue in tuple(self.subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)
        return event


class SimulationState:
    def __init__(self) -> None:
        self.bus = EventBus()
        self.history: deque[dict[str, Any]] = deque(maxlen=MAX_HISTORY)
        self.checkpoints: list[dict[str, Any]] = []
        self.counters = Counters()
        self.task: asyncio.Task[None] | None = None
        self.stop_requested = False
        self.run_id: str | None = None
        self.run_started: str | None = None
        self.latest: dict[str, Any] | None = None
        self.paused_reason: str | None = None
        self.funds_available = asyncio.Event()

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def snapshot(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "run_id": self.run_id,
            "run_started": self.run_started,
            "latest_hand": self.latest,
            "stats": {**asdict(self.counters), "accuracy": self.counters.accuracy},
            "model": "hybrid-oracle-tabular/0.1",
            "brain_model": "MaleCNS aggregate activity/0.1",
            "provider": "local-blackjack/0.1",
            "paused_reason": self.paused_reason,
        }


state = SimulationState()
wallet = WalletService()
password_hasher = PasswordHasher()
pin_attempts: dict[str, deque[float]] = {}
admin_sessions: dict[str, float] = {}
app = FastAPI(title="Fruitfly Blackjack", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


def require_owner(
    authorization: str | None = Header(default=None),
) -> None:
    token = os.getenv("ADMIN_TOKEN", "")
    valid_token = bool(token and authorization == f"Bearer {token}")
    if not valid_token:
        raise HTTPException(status_code=403, detail="Owner authentication required")


def require_wallet_owner(authorization: str | None = Header(default=None)) -> None:
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if os.getenv("ADMIN_TOKEN") and secrets.compare_digest(token, os.getenv("ADMIN_TOKEN", "")):
        return
    expiry = admin_sessions.get(token, 0)
    if not token or expiry <= time.time():
        admin_sessions.pop(token, None)
        raise HTTPException(status_code=403, detail="Owner session required")


def observation_payload(observation: Observation) -> dict[str, Any]:
    data = asdict(observation)
    data["legal_actions"] = [action.value for action in observation.legal_actions]
    return data


async def run_simulation(request: RunRequest) -> None:
    configured = await wallet.store.load()
    wager_paise = request.base_wager_paise or configured.base_wager_paise
    late_surrender = configured.late_surrender if request.late_surrender is None else request.late_surrender
    provider = LocalBlackjackProvider(Rules(late_surrender=late_surrender))
    agent = HybridAgent(request.seed)
    brain = BrainActivityModel()
    provider.start_session(request.seed)
    deadline = time.monotonic() + min(request.duration_seconds, 7_200)
    delay = 1 / request.speed_hands_per_second
    try:
        for _ in range(request.hands):
            if state.stop_requested or time.monotonic() >= deadline:
                break
            while True:
                try:
                    wallet_before, _ = await wallet.reserve(wager_paise)
                    if state.paused_reason:
                        state.paused_reason = None
                        await state.bus.publish("run.resumed", {"reason": "virtual_funds_added"})
                    break
                except ValueError:
                    state.paused_reason = "insufficient_funds"
                    state.funds_available.clear()
                    current_wallet = await wallet.store.load()
                    await state.bus.publish("wallet.low_balance", wallet.public(current_wallet))
                    await state.bus.publish("run.paused", {"reason": state.paused_reason})
                    await state.funds_available.wait()
                    if state.stop_requested:
                        return
            balance_before = wallet_before.balance_paise
            current = provider.start_hand()
            await state.bus.publish("hand.started", {
                "hand_id": provider.hand_id,
                "dealer_upcard": provider.dealer.cards[0],
                "player_cards": provider.hands[0].cards,
            })
            published_events = len(provider.events)
            decisions: list[dict[str, Any]] = []
            while isinstance(current, Observation):
                action, oracle, rationale = agent.choose(current, training=True)
                decision = {
                    "observation": observation_payload(current),
                    "action": action.value,
                    "oracle_action": oracle.value,
                    "correct": action == oracle,
                    "rationale": rationale,
                }
                decisions.append(decision)
                for frame in brain.decision_frames(current, action):
                    await state.bus.publish("brain.frame", frame)
                    await asyncio.sleep(0.055)
                await state.bus.publish("agent.decision", decision)
                current = provider.act(action)
                for provider_event in provider.events[published_events:]:
                    if provider_event["type"] == "card.dealt":
                        await state.bus.publish("card.dealt", provider_event)
                published_events = len(provider.events)
            result = current
            agent.learn(result.total_reward)
            for frame in brain.reinforce(result.total_reward):
                await state.bus.publish("brain.frame", frame)
                await asyncio.sleep(0.055)
            wallet_after, wallet_transaction = await wallet.settle(
                result.total_reward, wager_paise, result.hand_id
            )
            update_counters(state.counters, result, decisions)
            hand_record = {
                "hand_id": result.hand_id,
                "dealer_cards": result.dealer_cards,
                "results": [asdict(item) for item in result.results],
                "total_reward": result.total_reward,
                "decisions": decisions,
                "sequence": state.bus.sequence,
                "wager_paise": wager_paise,
                "max_exposure_paise": wager_paise * 8,
                "rules": {"late_surrender": late_surrender},
                "virtual_inr_result_paise": wallet_transaction["amount_paise"],
                "balance_before_paise": balance_before,
                "balance_after_paise": wallet_after.balance_paise,
                "wallet_transaction_id": wallet_transaction["transaction_id"],
            }
            state.history.append(hand_record)
            state.latest = hand_record
            await state.bus.publish("hand.result", hand_record)
            await state.bus.publish("wallet.transaction", public_transaction(wallet_transaction))
            await state.bus.publish("wallet.snapshot", wallet.public(wallet_after))
            await state.bus.publish("stats.updated", state.snapshot()["stats"])
            if state.counters.hands and state.counters.hands % 1_000 == 0:
                checkpoint = save_checkpoint(agent)
                state.checkpoints.append(checkpoint)
                await state.bus.publish("checkpoint.saved", checkpoint)
            await asyncio.sleep(delay)
    finally:
        checkpoint = save_checkpoint(agent)
        state.checkpoints.append(checkpoint)
        provider.close()
        state.stop_requested = False
        await state.bus.publish("checkpoint.saved", checkpoint)


def update_counters(counters: Counters, result: RoundResult, decisions: list[dict[str, Any]]) -> None:
    counters.hands += 1
    counters.unit_return += result.total_reward
    counters.decisions += len(decisions)
    counters.correct += sum(bool(item["correct"]) for item in decisions)
    for hand in result.results:
        counters.wins += int(hand.outcome in {"win", "blackjack"})
        counters.losses += int(hand.outcome == "loss")
        counters.pushes += int(hand.outcome == "push")
        counters.blackjacks += int(hand.outcome == "blackjack")
        counters.surrenders += int(hand.outcome == "surrender")
        counters.doubles += int("double" in hand.actions)
        counters.splits += int("split" in hand.actions)


def save_checkpoint(agent: HybridAgent) -> dict[str, Any]:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = RUNTIME / "checkpoints" / f"agent-{stamp}-{state.counters.hands}.json"
    agent.save(path)
    return {"hands": state.counters.hands, "accuracy": agent.accuracy, "path": path.name, "created_at": stamp}


def public_transaction(item: dict[str, Any]) -> dict[str, Any]:
    allowed = {"transaction_id", "kind", "amount_paise", "balance_after_paise", "created_at", "hand_id", "public_note"}
    return {key: value for key, value in item.items() if key in allowed}


@app.get("/api/live")
async def live() -> dict[str, Any]:
    return {"schema": SCHEMA, **state.snapshot()}


@app.get("/api/stats")
async def stats() -> dict[str, Any]:
    return {"schema": SCHEMA, **state.snapshot()["stats"]}


@app.get("/api/hands/{hand_id}")
async def hand(hand_id: str) -> dict[str, Any]:
    for item in reversed(state.history):
        if item["hand_id"] == hand_id:
            return {"schema": SCHEMA, **item}
    raise HTTPException(status_code=404, detail="Hand not found")


@app.get("/api/checkpoints")
async def checkpoints() -> dict[str, Any]:
    return {"schema": SCHEMA, "checkpoints": state.checkpoints}


@app.get("/api/wallet")
async def wallet_summary() -> dict[str, Any]:
    current = await wallet.store.load()
    public_topups = [public_transaction(item) for item in await wallet.store.ledger(20) if item.get("kind") in {"topup", "funding_add", "funding_reduce"}]
    return {"schema": SCHEMA, **wallet.public(current), "recent_topups": public_topups[:5]}


@app.get("/api/wallet/experiments")
async def wallet_experiments() -> dict[str, Any]:
    return {"schema": SCHEMA, "experiments": wallet.experiments(), "warning": "Bet sizing changes volatility, not the underlying expected value."}


@app.post("/api/admin/auth/pin")
async def pin_login(payload: PinRequest, request: Request) -> dict[str, Any]:
    address = request.client.host if request.client else "unknown"
    cutoff = time.time() - 900
    attempts = pin_attempts.setdefault(address, deque())
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts; try again later")
    attempts.append(time.time())
    pin_hash = os.getenv("OWNER_PIN_HASH", "")
    try:
        valid = bool(pin_hash and password_hasher.verify(pin_hash, payload.pin))
    except VerifyMismatchError:
        valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="Invalid owner PIN")
    attempts.clear()
    token = secrets.token_urlsafe(32)
    admin_sessions[token] = time.time() + 900
    return {"access_token": token, "expires_in": 900, "token_type": "bearer"}


@app.post("/api/admin/wallet/topups", dependencies=[Depends(require_wallet_owner)])
async def wallet_topup(payload: TopupRequest, idempotency_key: str = Header(alias="Idempotency-Key")) -> dict[str, Any]:
    current, transaction, created = await wallet.topup(payload.amount_paise, idempotency_key, payload.public_note)
    state.funds_available.set()
    if created:
        await state.bus.publish("wallet.transaction", public_transaction(transaction))
        await state.bus.publish("wallet.snapshot", wallet.public(current))
    return {"created": created, "transaction": public_transaction(transaction), "wallet": wallet.public(current)}


@app.post("/api/admin/wallet/adjustments", dependencies=[Depends(require_wallet_owner)])
async def wallet_adjustment(payload: AdjustmentRequest, idempotency_key: str = Header(alias="Idempotency-Key")) -> dict[str, Any]:
    try:
        current, transaction, created = await wallet.adjust(
            payload.direction, payload.amount_paise, idempotency_key, payload.public_note
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if payload.direction == "add":
        state.funds_available.set()
    if created:
        await state.bus.publish("wallet.transaction", public_transaction(transaction))
        await state.bus.publish("wallet.snapshot", wallet.public(current))
    return {"created": created, "transaction": public_transaction(transaction), "wallet": wallet.public(current)}


@app.get("/api/admin/wallet/ledger", dependencies=[Depends(require_wallet_owner)])
async def wallet_ledger(limit: int = 100) -> dict[str, Any]:
    return {"transactions": await wallet.store.ledger(max(1, min(limit, 500)))}


@app.post("/api/admin/wallet/config", dependencies=[Depends(require_wallet_owner)])
async def wallet_config(payload: WalletConfigRequest) -> dict[str, Any]:
    if state.running:
        raise HTTPException(status_code=409, detail="Wager is locked during an active run")
    current = await wallet.configure(payload.base_wager_paise, payload.late_surrender)
    await state.bus.publish("wallet.snapshot", wallet.public(current))
    return wallet.public(current)


@app.post("/api/admin/runs", dependencies=[Depends(require_owner)])
async def start_run(request: RunRequest) -> dict[str, Any]:
    if state.running:
        raise HTTPException(status_code=409, detail="A run is already active")
    state.run_id = f"run-{int(time.time())}"
    state.run_started = datetime.now(UTC).isoformat()
    state.stop_requested = False
    state.task = asyncio.create_task(run_simulation(request))
    await state.bus.publish("session.snapshot", state.snapshot())
    return state.snapshot()


@app.post("/api/admin/runs/{run_id}/stop", dependencies=[Depends(require_owner)])
async def stop_run(run_id: str) -> dict[str, Any]:
    if run_id != state.run_id or not state.running:
        raise HTTPException(status_code=404, detail="Active run not found")
    state.stop_requested = True
    state.funds_available.set()
    return {"run_id": run_id, "stop_requested": True}


@app.get("/api/admin/runs/{run_id}", dependencies=[Depends(require_owner)])
async def run_status(run_id: str) -> dict[str, Any]:
    if run_id != state.run_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return state.snapshot()


@app.websocket("/api/stream")
async def stream(websocket: WebSocket) -> None:
    await websocket.accept()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    state.bus.subscribers.add(queue)
    await websocket.send_json({"schema": SCHEMA, "sequence": state.bus.sequence, "type": "session.snapshot", "payload": state.snapshot()})
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
            except TimeoutError:
                event = await state.bus.publish("heartbeat", {"running": state.running})
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        state.bus.subscribers.discard(queue)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok", "schema": SCHEMA}
