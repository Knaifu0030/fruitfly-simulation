from __future__ import annotations

import random
import uuid
from abc import ABC, abstractmethod

from .models import Action, Hand, HandResult, Observation, RoundResult, Rules


class BlackjackProvider(ABC):
    @abstractmethod
    def start_session(self, seed: int) -> str: ...

    @abstractmethod
    def start_hand(self) -> Observation | RoundResult: ...

    @abstractmethod
    def observe(self) -> Observation: ...

    @abstractmethod
    def act(self, action: Action) -> Observation | RoundResult: ...

    @abstractmethod
    def settle(self) -> RoundResult: ...

    @abstractmethod
    def close(self) -> None: ...


class LocalBlackjackProvider(BlackjackProvider):
    """Deterministic six-deck blackjack. It exposes player-visible state only."""

    def __init__(self, rules: Rules | None = None) -> None:
        self.rules = rules or Rules()
        self.rng = random.Random()
        self.session_id = ""
        self.shoe: list[int] = []
        self.initial_shoe_size = 0
        self.hand_id = ""
        self.hands: list[Hand] = []
        self.hand_actions: list[list[str]] = []
        self.active = 0
        self.dealer = Hand([])
        self.cards_dealt = 0
        self.previous_reward = 0.0
        self.events: list[dict[str, object]] = []
        self.closed = True

    def start_session(self, seed: int) -> str:
        self.rng.seed(seed)
        self.session_id = f"local-{seed}-{uuid.uuid4().hex[:8]}"
        self.closed = False
        self._shuffle()
        return self.session_id

    def _shuffle(self) -> None:
        ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11]
        self.shoe = ranks * 4 * self.rules.decks
        self.rng.shuffle(self.shoe)
        self.initial_shoe_size = len(self.shoe)

    def _draw(self, recipient: str, hidden: bool = False) -> int:
        if not self.shoe:
            self._shuffle()
        card = self.shoe.pop()
        self.cards_dealt += 1
        self.events.append({"type": "card.dealt", "recipient": recipient, "card": None if hidden else card})
        return card

    def start_hand(self) -> Observation | RoundResult:
        if self.closed:
            raise RuntimeError("session is not active")
        if len(self.shoe) < self.initial_shoe_size * (1 - self.rules.penetration):
            self._shuffle()
        self.hand_id = uuid.uuid4().hex
        self.events = []
        player = Hand([self._draw("player"), self._draw("player")])
        upcard = self._draw("dealer")
        hole = self._draw("dealer", hidden=True)
        self.hands = [player]
        self.hand_actions = [[]]
        self.dealer = Hand([upcard, hole])
        self.active = 0
        self.events.insert(0, {"type": "hand.started", "hand_id": self.hand_id})
        if player.blackjack or self.dealer.blackjack:
            return self.settle()
        return self.observe()

    def _legal_actions(self, hand: Hand) -> tuple[Action, ...]:
        if hand.stood or hand.busted or hand.surrendered:
            return ()
        if hand.split_aces and not self.rules.hit_split_aces:
            return (Action.STAND,)
        actions = [Action.HIT, Action.STAND]
        first = len(hand.cards) == 2 and hand.decisions == 0
        if first and (not hand.from_split or self.rules.double_after_split):
            actions.append(Action.DOUBLE)
        if first and self.rules.late_surrender and not hand.from_split:
            actions.append(Action.SURRENDER)
        if (
            first
            and hand.pair_rank is not None
            and len(self.hands) < self.rules.max_hands
            and (hand.pair_rank != 11 or self.rules.resplit_aces or not hand.from_split)
        ):
            actions.append(Action.SPLIT)
        return tuple(actions)

    def observe(self) -> Observation:
        hand = self.hands[self.active]
        return Observation(
            hand_id=self.hand_id,
            hand_index=self.active,
            player_cards=tuple(hand.cards),
            player_total=hand.total,
            soft=hand.soft,
            pair_rank=hand.pair_rank,
            dealer_upcard=self.dealer.cards[0],
            legal_actions=self._legal_actions(hand),
            cards_dealt=self.cards_dealt,
            previous_reward=self.previous_reward,
        )

    def _advance(self) -> Observation | RoundResult:
        while self.active < len(self.hands):
            hand = self.hands[self.active]
            if not (hand.stood or hand.busted or hand.surrendered):
                return self.observe()
            self.active += 1
        return self.settle()

    def act(self, action: Action) -> Observation | RoundResult:
        hand = self.hands[self.active]
        if action not in self._legal_actions(hand):
            raise ValueError(f"illegal action {action}; legal={self._legal_actions(hand)}")
        hand.decisions += 1
        self.hand_actions[self.active].append(action.value)
        self.events.append({"type": "agent.decision", "hand_index": self.active, "action": action.value})
        if action == Action.HIT:
            hand.cards.append(self._draw(f"player:{self.active}"))
            if hand.total >= 21:
                hand.stood = True
        elif action == Action.STAND:
            hand.stood = True
        elif action == Action.DOUBLE:
            hand.wager *= 2
            hand.doubled = True
            hand.cards.append(self._draw(f"player:{self.active}"))
            hand.stood = True
        elif action == Action.SURRENDER:
            hand.surrendered = True
        elif action == Action.SPLIT:
            card = hand.cards.pop()
            split_aces = card == 11
            new_hand = Hand([card], from_split=True, split_aces=split_aces)
            hand.from_split = True
            hand.split_aces = split_aces
            hand.cards.append(self._draw(f"player:{self.active}"))
            new_hand.cards.append(self._draw(f"player:{self.active + 1}"))
            self.hands.insert(self.active + 1, new_hand)
            self.hand_actions.insert(self.active + 1, [])
            if split_aces and not self.rules.hit_split_aces:
                hand.stood = True
                new_hand.stood = True
        return self._advance()

    def settle(self) -> RoundResult:
        live_hands = [hand for hand in self.hands if not hand.busted and not hand.surrendered]
        if live_hands and not any(hand.blackjack for hand in self.hands):
            while self.dealer.total < 17 or (self.dealer.total == 17 and self.dealer.soft and self.rules.dealer_hits_soft_17):
                self.dealer.cards.append(self._draw("dealer"))

        results: list[HandResult] = []
        for index, hand in enumerate(self.hands):
            if hand.surrendered:
                outcome, reward = "surrender", -0.5 * hand.wager
            elif hand.busted:
                outcome, reward = "loss", -hand.wager
            elif hand.blackjack and not self.dealer.blackjack:
                outcome, reward = "blackjack", self.rules.blackjack_payout * hand.wager
            elif self.dealer.blackjack and not hand.blackjack:
                outcome, reward = "loss", -hand.wager
            elif self.dealer.busted or hand.total > self.dealer.total:
                outcome, reward = "win", hand.wager
            elif hand.total < self.dealer.total:
                outcome, reward = "loss", -hand.wager
            else:
                outcome, reward = "push", 0.0
            reward = max(-2.0, min(2.0, reward))
            results.append(HandResult(index, hand.cards.copy(), self.dealer.cards.copy(), outcome, reward, hand.wager, self.hand_actions[index].copy()))
        total = sum(result.reward for result in results)
        self.previous_reward = total
        self.events.append({"type": "hand.result", "hand_id": self.hand_id, "reward": total})
        return RoundResult(self.hand_id, results, total, self.dealer.cards.copy(), self.events.copy())

    def close(self) -> None:
        self.closed = True
