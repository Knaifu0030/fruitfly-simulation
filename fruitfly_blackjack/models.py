from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Action(StrEnum):
    HIT = "hit"
    STAND = "stand"
    DOUBLE = "double"
    SPLIT = "split"
    SURRENDER = "surrender"


@dataclass(frozen=True)
class Rules:
    decks: int = 6
    dealer_hits_soft_17: bool = False
    double_after_split: bool = True
    late_surrender: bool = True
    blackjack_payout: float = 1.5
    max_hands: int = 4
    resplit_aces: bool = False
    hit_split_aces: bool = False
    insurance: bool = False
    penetration: float = 0.75


@dataclass
class Hand:
    cards: list[int]
    wager: float = 1.0
    stood: bool = False
    surrendered: bool = False
    doubled: bool = False
    from_split: bool = False
    split_aces: bool = False
    decisions: int = 0

    @property
    def total(self) -> int:
        total = sum(self.cards)
        aces = self.cards.count(11)
        while total > 21 and aces:
            total -= 10
            aces -= 1
        return total

    @property
    def soft(self) -> bool:
        return 11 in self.cards and sum(self.cards) <= 21

    @property
    def busted(self) -> bool:
        return self.total > 21

    @property
    def blackjack(self) -> bool:
        return len(self.cards) == 2 and self.total == 21 and not self.from_split

    @property
    def pair_rank(self) -> int | None:
        if len(self.cards) == 2 and self.cards[0] == self.cards[1]:
            return self.cards[0]
        return None


@dataclass(frozen=True)
class Observation:
    hand_id: str
    hand_index: int
    player_cards: tuple[int, ...]
    player_total: int
    soft: bool
    pair_rank: int | None
    dealer_upcard: int
    legal_actions: tuple[Action, ...]
    cards_dealt: int
    previous_reward: float


@dataclass
class HandResult:
    hand_index: int
    player_cards: list[int]
    dealer_cards: list[int]
    outcome: str
    reward: float
    wager: float
    actions: list[str] = field(default_factory=list)


@dataclass
class RoundResult:
    hand_id: str
    results: list[HandResult]
    total_reward: float
    dealer_cards: list[int]
    events: list[dict[str, Any]]
