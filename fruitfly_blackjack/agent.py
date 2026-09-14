from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path

from .models import Action, Observation
from .oracle import optimal_action

StateKey = tuple[int, bool, int, int, tuple[str, ...]]


def state_key(observation: Observation) -> StateKey:
    return (
        observation.player_total,
        observation.soft,
        observation.pair_rank or 0,
        observation.dealer_upcard,
        tuple(sorted(action.value for action in observation.legal_actions)),
    )


class HybridAgent:
    """Oracle-pretrained tabular action head with online value refinement."""

    def __init__(self, seed: int, epsilon: float = 0.02, learning_rate: float = 0.04) -> None:
        self.rng = random.Random(seed)
        self.epsilon = epsilon
        self.learning_rate = learning_rate
        self.q: dict[StateKey, dict[Action, float]] = defaultdict(dict)
        self.pending: list[tuple[StateKey, Action]] = []
        self.decisions = 0
        self.correct = 0

    def choose(self, observation: Observation, training: bool = True) -> tuple[Action, Action, str]:
        key = state_key(observation)
        oracle = optimal_action(observation)
        values = self.q[key]
        for action in observation.legal_actions:
            values.setdefault(action, 1.0 if action == oracle else 0.0)
        if training and self.rng.random() < self.epsilon:
            action = self.rng.choice(list(observation.legal_actions))
            rationale = "Exploring a legal alternative to test its outcome."
        else:
            action = max(observation.legal_actions, key=lambda candidate: values[candidate])
            rationale = rationale_for(action, observation)
        self.decisions += 1
        self.correct += int(action == oracle)
        if training:
            self.pending.append((key, action))
        return action, oracle, rationale

    def learn(self, reward: float) -> None:
        for key, action in self.pending:
            current = self.q[key][action]
            self.q[key][action] = current + self.learning_rate * (reward - current)
        self.pending.clear()

    @property
    def accuracy(self) -> float:
        return self.correct / self.decisions if self.decisions else 1.0

    def save(self, path: Path) -> None:
        payload = {
            "epsilon": self.epsilon,
            "learning_rate": self.learning_rate,
            "decisions": self.decisions,
            "correct": self.correct,
            "q": {
                "|".join(map(str, key)): {action.value: value for action, value in values.items()}
                for key, values in self.q.items()
            },
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")


def rationale_for(action: Action, observation: Observation) -> str:
    dealer = "ace" if observation.dealer_upcard == 11 else str(observation.dealer_upcard)
    quality = "soft" if observation.soft else "hard"
    verbs = {
        Action.HIT: "Take another card",
        Action.STAND: "Keep the current hand",
        Action.DOUBLE: "Double the unit and take one card",
        Action.SPLIT: "Separate the pair into two hands",
        Action.SURRENDER: "Give up half a unit",
    }
    return f"{verbs[action]} with {quality} {observation.player_total} against dealer {dealer}."
