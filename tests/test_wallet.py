import asyncio

import pytest

from fruitfly_blackjack.wallet import MemoryWalletStore, WalletService, WalletState


@pytest.mark.asyncio
async def test_reservation_and_settlement_use_integer_paise():
    service = WalletService(MemoryWalletStore())
    reserved, _ = await service.reserve(10_000)
    assert reserved.balance_paise == 1_000_000
    assert reserved.reserved_paise == 80_000
    settled, transaction = await service.settle(1.5, 10_000, "blackjack")
    assert settled.balance_paise == 1_015_000
    assert settled.reserved_paise == 0
    assert transaction["amount_paise"] == 15_000


@pytest.mark.asyncio
async def test_insufficient_funds_never_goes_negative():
    store = MemoryWalletStore()
    store.state = WalletState(balance_paise=79_999)
    service = WalletService(store)
    with pytest.raises(ValueError, match="insufficient_funds"):
        await service.reserve(10_000)
    assert (await store.load()).balance_paise == 79_999


@pytest.mark.asyncio
async def test_topup_is_idempotent_even_when_retried_concurrently():
    service = WalletService(MemoryWalletStore())
    results = await asyncio.gather(
        service.topup(100_000, "same-request"),
        service.topup(100_000, "same-request"),
    )
    assert sum(created for _, _, created in results) == 1
    assert (await service.store.load()).balance_paise == 1_100_000


@pytest.mark.asyncio
async def test_drawdown_profit_and_public_payload():
    service = WalletService(MemoryWalletStore())
    await service.reserve(10_000)
    state, _ = await service.settle(-2, 10_000, "loss")
    public = service.public(state)
    assert public["realized_pnl_paise"] == -20_000
    assert public["max_drawdown_paise"] == 20_000
    assert "idempotency_key" not in public


@pytest.mark.asyncio
async def test_compare_and_swap_rejects_stale_version():
    store = MemoryWalletStore()
    first = await store.load()
    second = await store.load()
    assert await store.save(first, 0)
    assert not await store.save(second, 0)


def test_shadow_experiments_do_not_mutate_wallet():
    service = WalletService(MemoryWalletStore())
    before = service.store.state.balance_paise
    experiments = service.experiments()
    assert {item["key"] for item in experiments} >= {"flat_50", "flat_100", "flat_200", "bankroll_1pct"}
    assert all(item["shadow_only"] for item in experiments)
    assert service.store.state.balance_paise == before
