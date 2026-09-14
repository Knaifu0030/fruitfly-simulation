from __future__ import annotations

import math
from dataclasses import dataclass

from .models import Action, Observation


@dataclass
class Population:
    key: str
    label: str
    technical: str
    neuron_count: int
    evidence: str
    activity: float = 0.0


class BrainActivityModel:
    """Honest aggregate dynamics over MaleCNS-annotated functional populations."""

    def __init__(self) -> None:
        self.populations = {
            "perception": Population("perception", "Card perception", "visual projection neurons", 9201, "dataset + model mapping"),
            "working": Population("working", "Current hand", "central complex / recurrent state proxy", 2950, "engineered model mapping"),
            "choice": Population("choice", "Action selection", "descending-neuron readout", 1314, "dataset + engineered readout"),
            "learning": Population("learning", "Learning & memory", "Kenyon cells and MBONs", 4161, "dataset + model plasticity"),
            "appetitive": Population("appetitive", "Appetitive reinforcement", "dopaminergic neuron aggregate", 340, "dataset + reward mapping"),
            "aversive": Population("aversive", "Aversive reinforcement", "negative-valence teaching aggregate", 340, "engineered valence mapping"),
        }
        self.plasticity = 0.0

    def decision_frames(self, observation: Observation, action: Action, reward: float | None = None) -> list[dict[str, object]]:
        card_load = min(1.0, len(observation.player_cards) / 5)
        uncertainty = 1 - abs(observation.player_total - 17) / 17
        action_drive = {Action.HIT: 0.7, Action.STAND: 0.52, Action.DOUBLE: 0.9, Action.SPLIT: 0.85, Action.SURRENDER: 0.64}[action]
        targets = {
            "perception": 0.35 + 0.55 * card_load,
            "working": 0.3 + 0.5 * max(0.0, uncertainty),
            "choice": action_drive,
            "learning": 0.28 + self.plasticity,
            "appetitive": max(0.0, reward or 0.0) / 1.5,
            "aversive": max(0.0, -(reward or 0.0)),
        }
        frames = []
        for phase in range(8):
            blend = 1 - math.exp(-(phase + 1) / 2.4)
            populations = []
            for key, population in self.populations.items():
                population.activity = max(0.015, min(1.0, population.activity * 0.65 + targets[key] * blend * 0.5))
                populations.append({**population.__dict__})
            frames.append({"populations": populations, "plasticity": self.plasticity})
        return frames

    def reinforce(self, reward: float) -> list[dict[str, object]]:
        self.plasticity = max(0.0, min(0.7, self.plasticity * 0.997 + abs(reward) * 0.002))
        dummy = Observation("", 0, (10, 7), 17, False, None, 10, (Action.STAND,), 0, reward)
        return self.decision_frames(dummy, Action.STAND, reward)
