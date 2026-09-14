#!/usr/bin/env python3
"""Unaided seeded evaluation. Use one million hands before claiming mastery."""

import argparse

from fruitfly_blackjack.agent import HybridAgent
from fruitfly_blackjack.models import Observation
from fruitfly_blackjack.provider import LocalBlackjackProvider


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hands", type=int, default=1_000_000)
    parser.add_argument("--seed", type=int, default=20260914)
    args = parser.parse_args()
    provider = LocalBlackjackProvider()
    agent = HybridAgent(args.seed, epsilon=0)
    provider.start_session(args.seed)
    rewards = 0.0
    decisions = correct = 0
    for _ in range(args.hands):
        current = provider.start_hand()
        while isinstance(current, Observation):
            action, oracle, _ = agent.choose(current, training=False)
            decisions += 1
            correct += action == oracle
            current = provider.act(action)
        rewards += current.total_reward
    accuracy = correct / decisions if decisions else 1.0
    unit_return = rewards / args.hands
    print(f"hands={args.hands} seed={args.seed} decisions={decisions}")
    print(f"oracle_agreement={accuracy:.6%} unit_return_per_initial_hand={unit_return:.6f}")
    if accuracy < 0.995:
        raise SystemExit("mastery threshold not reached")


if __name__ == "__main__":
    main()
