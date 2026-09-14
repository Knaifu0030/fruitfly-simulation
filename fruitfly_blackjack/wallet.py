from __future__ import annotations

import asyncio
import math
import os
import random
import statistics
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

STARTING_BALANCE_PAISE = 1_000_000
DEFAULT_WAGER_PAISE = 10_000
MAX_EXPOSURE_UNITS = 8


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class WalletState:
    balance_paise: int = STARTING_BALANCE_PAISE
    reserved_paise: int = 0
    base_wager_paise: int = DEFAULT_WAGER_PAISE
    total_topups_paise: int = STARTING_BALANCE_PAISE
    total_removed_paise: int = 0
    late_surrender: bool = True
    realized_pnl_paise: int = 0
    peak_balance_paise: int = STARTING_BALANCE_PAISE
    max_drawdown_paise: int = 0
    hands: int = 0
    wagered_paise: int = 0
    largest_win_paise: int = 0
    largest_loss_paise: int = 0
    hands_since_topup: int = 0
    version: int = 0


class WalletStore(Protocol):
    async def load(self) -> WalletState: ...
    async def save(self, state: WalletState, expected_version: int) -> bool: ...
    async def append(self, transaction: dict[str, Any]) -> None: ...
    async def ledger(self, limit: int) -> list[dict[str, Any]]: ...
    async def idempotent(self, key: str) -> dict[str, Any] | None: ...


class MemoryWalletStore:
    def __init__(self) -> None:
        self.state = WalletState()
        self.transactions: list[dict[str, Any]] = [{
            "transaction_id": "initial-funding", "kind": "topup", "amount_paise": STARTING_BALANCE_PAISE,
            "balance_after_paise": STARTING_BALANCE_PAISE, "created_at": now_iso(), "idempotency_key": "initial",
        }]
        self.lock = asyncio.Lock()

    async def load(self) -> WalletState:
        return WalletState(**asdict(self.state))

    async def save(self, state: WalletState, expected_version: int) -> bool:
        async with self.lock:
            if self.state.version != expected_version:
                return False
            state.version = expected_version + 1
            self.state = WalletState(**asdict(state))
            return True

    async def append(self, transaction: dict[str, Any]) -> None:
        self.transactions.append(transaction.copy())

    async def ledger(self, limit: int) -> list[dict[str, Any]]:
        return list(reversed(self.transactions[-limit:]))

    async def idempotent(self, key: str) -> dict[str, Any] | None:
        return next((item for item in self.transactions if item.get("idempotency_key") == key), None)


class AzureTableWalletStore:
    """Azure Table-backed state with ETag compare-and-swap and an append-only ledger."""

    def __init__(self, account_url: str) -> None:
        from azure.data.tables import TableServiceClient
        from azure.identity import DefaultAzureCredential

        service = TableServiceClient(endpoint=account_url, credential=DefaultAzureCredential())
        self.state_table = service.create_table_if_not_exists("walletstate")
        self.ledger_table = service.create_table_if_not_exists("walletledger")

    async def load(self) -> WalletState:
        def operation() -> WalletState:
            try:
                entity = self.state_table.get_entity("wallet", "canonical")
                values = {key: entity[key] for key in asdict(WalletState()) if key in entity}
                return WalletState(**values)
            except Exception as error:
                if error.__class__.__name__ != "ResourceNotFoundError":
                    raise
                state = WalletState()
                self.state_table.create_entity({"PartitionKey": "wallet", "RowKey": "canonical", **asdict(state)})
                return state
        return await asyncio.to_thread(operation)

    async def save(self, state: WalletState, expected_version: int) -> bool:
        from azure.core import MatchConditions
        from azure.data.tables import UpdateMode

        def operation() -> bool:
            entity = self.state_table.get_entity("wallet", "canonical")
            if int(entity.get("version", 0)) != expected_version:
                return False
            state.version = expected_version + 1
            try:
                self.state_table.update_entity(
                    {"PartitionKey": "wallet", "RowKey": "canonical", **asdict(state)},
                    mode=UpdateMode.REPLACE, etag=entity.metadata["etag"], match_condition=MatchConditions.IfNotModified,
                )
                return True
            except Exception as error:
                if error.__class__.__name__ in {"ResourceModifiedError", "HttpResponseError"}:
                    return False
                raise
        return await asyncio.to_thread(operation)

    async def append(self, transaction: dict[str, Any]) -> None:
        entity = {"PartitionKey": "ledger", "RowKey": transaction["transaction_id"], **transaction}
        await asyncio.to_thread(self.ledger_table.create_entity, entity)

    async def ledger(self, limit: int) -> list[dict[str, Any]]:
        def operation() -> list[dict[str, Any]]:
            rows = list(self.ledger_table.query_entities("PartitionKey eq 'ledger'"))
            rows.sort(key=lambda item: item["created_at"], reverse=True)
            return [{key: value for key, value in row.items() if key not in {"PartitionKey", "RowKey"}} for row in rows[:limit]]
        return await asyncio.to_thread(operation)

    async def idempotent(self, key: str) -> dict[str, Any] | None:
        rows = await asyncio.to_thread(lambda: list(self.ledger_table.query_entities(
            "PartitionKey eq 'ledger' and idempotency_key eq @key", parameters={"key": key}, results_per_page=1
        )))
        return dict(rows[0]) if rows else None


def configured_store() -> WalletStore:
    account_url = os.getenv("AZURE_STORAGE_ACCOUNT_URL")
    return AzureTableWalletStore(account_url) if account_url else MemoryWalletStore()


class WalletService:
    def __init__(self, store: WalletStore | None = None) -> None:
        self.store = store or configured_store()
        self.outcomes: list[int] = []
        self.adjustment_lock = asyncio.Lock()

    async def mutate(self, operation):
        for _ in range(5):
            state = await self.store.load()
            expected = state.version
            transaction = operation(state)
            if await self.store.save(state, expected):
                if transaction:
                    await self.store.append(transaction)
                return state, transaction
        raise RuntimeError("wallet state changed concurrently")

    async def reserve(self, base_wager_paise: int) -> tuple[WalletState, dict[str, Any] | None]:
        exposure = base_wager_paise * MAX_EXPOSURE_UNITS
        def operation(state: WalletState):
            if state.balance_paise - state.reserved_paise < exposure:
                raise ValueError("insufficient_funds")
            state.reserved_paise = exposure
            state.base_wager_paise = base_wager_paise
        return await self.mutate(operation)

    async def settle(self, reward_units: float, wager_paise: int, hand_id: str) -> tuple[WalletState, dict[str, Any]]:
        delta = round(reward_units * wager_paise)
        def operation(state: WalletState):
            before = state.balance_paise
            state.reserved_paise = 0
            state.balance_paise += delta
            if state.balance_paise < 0:
                raise RuntimeError("wallet invariant violated")
            state.realized_pnl_paise += delta
            state.hands += 1
            state.wagered_paise += wager_paise
            state.hands_since_topup += 1
            state.peak_balance_paise = max(state.peak_balance_paise, state.balance_paise)
            drawdown = state.peak_balance_paise - state.balance_paise
            state.max_drawdown_paise = max(state.max_drawdown_paise, drawdown)
            state.largest_win_paise = max(state.largest_win_paise, delta)
            state.largest_loss_paise = min(state.largest_loss_paise, delta)
            return {
                "transaction_id": uuid.uuid4().hex, "kind": "settlement", "amount_paise": delta,
                "balance_before_paise": before, "balance_after_paise": state.balance_paise,
                "hand_id": hand_id, "created_at": now_iso(), "idempotency_key": f"hand:{hand_id}",
            }
        state, transaction = await self.mutate(operation)
        self.outcomes.append(delta)
        self.outcomes = self.outcomes[-10_000:]
        return state, transaction

    async def topup(self, amount_paise: int, key: str, public_note: str = "") -> tuple[WalletState, dict[str, Any], bool]:
        return await self.adjust("add", amount_paise, key, public_note)

    async def adjust(self, direction: str, amount_paise: int, key: str, public_note: str = "") -> tuple[WalletState, dict[str, Any], bool]:
        if direction not in {"add", "reduce"}:
            raise ValueError("invalid_adjustment")
        async with self.adjustment_lock:
            existing = await self.store.idempotent(key)
            if existing:
                return await self.store.load(), existing, False
            def operation(state: WalletState):
                delta = amount_paise if direction == "add" else -amount_paise
                if state.balance_paise + delta < state.reserved_paise:
                    raise ValueError("reduction_exceeds_available_funds")
                state.balance_paise += delta
                if direction == "add":
                    state.total_topups_paise += amount_paise
                    state.hands_since_topup = 0
                else:
                    state.total_removed_paise += amount_paise
                state.peak_balance_paise = max(state.peak_balance_paise, state.balance_paise)
                return {
                    "transaction_id": uuid.uuid4().hex, "kind": f"funding_{direction}", "amount_paise": delta,
                    "balance_after_paise": state.balance_paise, "created_at": now_iso(),
                    "idempotency_key": key, "public_note": public_note[:80],
                }
            state, transaction = await self.mutate(operation)
            return state, transaction, True

    async def configure(self, wager_paise: int, late_surrender: bool) -> WalletState:
        def operation(item: WalletState) -> None:
            item.base_wager_paise = wager_paise
            item.late_surrender = late_surrender
        state, _ = await self.mutate(operation)
        return state

    def public(self, state: WalletState) -> dict[str, Any]:
        current_drawdown = state.peak_balance_paise - state.balance_paise
        net_contributed = max(0, state.total_topups_paise - state.total_removed_paise)
        roi = state.realized_pnl_paise / net_contributed if net_contributed else 0
        average = state.wagered_paise / state.hands if state.hands else 0
        mean = statistics.fmean(self.outcomes) if self.outcomes else 0
        variance = statistics.pvariance(self.outcomes) if len(self.outcomes) > 1 else state.base_wager_paise**2
        bankroll = max(0, state.balance_paise - state.reserved_paise)
        risk = math.exp(-2 * max(mean, 1) * bankroll / max(variance, 1)) if self.outcomes and bankroll else None
        return {
            "currency": "INR_SIM", "label": "simulated INR", "balance_paise": state.balance_paise,
            "available_paise": bankroll, "reserved_paise": state.reserved_paise,
            "base_wager_paise": state.base_wager_paise, "max_exposure_paise": state.base_wager_paise * MAX_EXPOSURE_UNITS,
            "total_topups_paise": state.total_topups_paise, "realized_pnl_paise": state.realized_pnl_paise,
            "total_removed_paise": state.total_removed_paise, "net_contributed_paise": net_contributed,
            "late_surrender": state.late_surrender,
            "roi": roi, "peak_balance_paise": state.peak_balance_paise,
            "current_drawdown_paise": current_drawdown, "max_drawdown_paise": state.max_drawdown_paise,
            "average_wager_paise": round(average), "largest_win_paise": state.largest_win_paise,
            "largest_loss_paise": state.largest_loss_paise, "hands_since_topup": state.hands_since_topup,
            "risk_of_ruin_heuristic": min(1, max(0, risk)) if risk is not None else None,
            "updated_at": now_iso(),
        }

    def experiments(self) -> list[dict[str, Any]]:
        outcomes = self.outcomes or [1, -1, -1, 1, 0, -0.5, 1.5, -1]
        definitions = [
            ("flat_50", "Flat ₹50", lambda balance: 5_000, None),
            ("flat_100", "Flat ₹100", lambda balance: 10_000, None),
            ("flat_200", "Flat ₹200", lambda balance: 20_000, None),
            ("bankroll_1pct", "1% bankroll (₹50–₹1,000)", lambda balance: max(5_000, min(100_000, round(balance * 0.01))), None),
            ("stop_10", "Flat ₹100 / 10% stop-loss", lambda balance: 10_000, 0.10),
            ("stop_20", "Flat ₹100 / 20% stop-loss", lambda balance: 10_000, 0.20),
            ("stop_30", "Flat ₹100 / 30% stop-loss", lambda balance: 10_000, 0.30),
        ]
        results = []
        for key, label, wager_policy, stop_loss in definitions:
            balance = peak = STARTING_BALANCE_PAISE
            max_drawdown = wagered = 0
            returns = []
            for units in outcomes:
                wager = wager_policy(balance)
                if balance < wager * MAX_EXPOSURE_UNITS:
                    break
                delta = round(units * wager)
                balance += delta
                wagered += wager
                returns.append(delta)
                peak = max(peak, balance)
                max_drawdown = max(max_drawdown, peak - balance)
                if stop_loss and balance <= STARTING_BALANCE_PAISE * (1 - stop_loss):
                    break
            rng = random.Random(f"wallet-experiment:{key}")
            depleted = 0
            for _ in range(200):
                sample_balance = STARTING_BALANCE_PAISE
                for _ in range(min(1_000, max(100, len(outcomes)))):
                    wager = wager_policy(sample_balance)
                    if sample_balance < wager * MAX_EXPOSURE_UNITS:
                        depleted += 1
                        break
                    sample_balance += round(rng.choice(outcomes) * wager)
                    if stop_loss and sample_balance <= STARTING_BALANCE_PAISE * (1 - stop_loss):
                        break
            results.append({
                "key": key, "label": label, "final_balance_paise": balance,
                "pnl_paise": balance - STARTING_BALANCE_PAISE, "wagered_paise": wagered,
                "max_drawdown_paise": max_drawdown,
                "volatility_paise": round(statistics.pstdev(returns)) if len(returns) > 1 else 0,
                "depletion_probability": depleted / 200, "hands": len(returns),
                "shadow_only": True,
            })
        return results
