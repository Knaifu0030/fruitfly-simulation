from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import HybridAgent
from .brain import BrainActivityModel
from .models import Observation, RoundResult
from .provider import LocalBlackjackProvider

SCHEMA = "fruitfly-blackjack/1"
RUNTIME = Path(os.getenv("FRUITFLY_RUNTIME_DIR", ".runtime"))
MAX_HISTORY = 10_000


class RunRequest(BaseModel):
    hands: int = Field(default=1_000, ge=1, le=100_000)
    seed: int = 20260914
    duration_seconds: int = Field(default=7_200, ge=10, le=7_200)
    speed_hands_per_second: float = Field(default=2.0, gt=0, le=100)


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
        }


state = SimulationState()
app = FastAPI(title="Fruitfly Blackjack", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_owner(
    authorization: str | None = Header(default=None),
) -> None:
    token = os.getenv("ADMIN_TOKEN", "")
    valid_token = bool(token and authorization == f"Bearer {token}")
    if not valid_token:
        raise HTTPException(status_code=403, detail="Owner authentication required")


def observation_payload(observation: Observation) -> dict[str, Any]:
    data = asdict(observation)
    data["legal_actions"] = [action.value for action in observation.legal_actions]
    return data


async def run_simulation(request: RunRequest) -> None:
    provider = LocalBlackjackProvider()
    agent = HybridAgent(request.seed)
    brain = BrainActivityModel()
    provider.start_session(request.seed)
    deadline = time.monotonic() + min(request.duration_seconds, 7_200)
    delay = 1 / request.speed_hands_per_second
    try:
        for _ in range(request.hands):
            if state.stop_requested or time.monotonic() >= deadline:
                break
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
            update_counters(state.counters, result, decisions)
            hand_record = {
                "hand_id": result.hand_id,
                "dealer_cards": result.dealer_cards,
                "results": [asdict(item) for item in result.results],
                "total_reward": result.total_reward,
                "decisions": decisions,
                "sequence": state.bus.sequence,
            }
            state.history.append(hand_record)
            state.latest = hand_record
            await state.bus.publish("hand.result", hand_record)
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
