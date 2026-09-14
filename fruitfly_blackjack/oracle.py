from __future__ import annotations

from .models import Action, Observation


def optimal_action(observation: Observation) -> Action:
    """Six-deck S17 DAS late-surrender basic-strategy oracle."""
    dealer = observation.dealer_upcard
    legal = set(observation.legal_actions)
    total = observation.player_total

    if (
        Action.SURRENDER in legal
        and ((total == 16 and dealer in {9, 10, 11}) or (total == 15 and dealer == 10))
        and observation.pair_rank != 8
    ):
        return Action.SURRENDER

    pair = observation.pair_rank
    if pair is not None and Action.SPLIT in legal:
        split = (
            pair in {11, 8}
            or (pair == 9 and dealer in {2, 3, 4, 5, 6, 8, 9})
            or (pair == 7 and dealer in {2, 3, 4, 5, 6, 7})
            or (pair == 6 and dealer in {2, 3, 4, 5, 6})
            or (pair in {2, 3} and dealer in {2, 3, 4, 5, 6, 7})
            or (pair == 4 and dealer in {5, 6})
        )
        if split:
            return Action.SPLIT

    if observation.soft and total <= 20:
        if total >= 19:
            return Action.STAND
        if total == 18:
            if dealer in {3, 4, 5, 6} and Action.DOUBLE in legal:
                return Action.DOUBLE
            return Action.STAND if dealer in {2, 7, 8} else Action.HIT
        double_ranges = {17: {3, 4, 5, 6}, 16: {4, 5, 6}, 15: {4, 5, 6}, 14: {5, 6}, 13: {5, 6}}
        if dealer in double_ranges.get(total, set()) and Action.DOUBLE in legal:
            return Action.DOUBLE
        return Action.HIT

    if total >= 17:
        return Action.STAND
    if 13 <= total <= 16:
        return Action.STAND if dealer in {2, 3, 4, 5, 6} else Action.HIT
    if total == 12:
        return Action.STAND if dealer in {4, 5, 6} else Action.HIT
    if total == 11:
        return Action.DOUBLE if dealer != 11 and Action.DOUBLE in legal else Action.HIT
    if total == 10:
        return Action.DOUBLE if dealer in range(2, 10) and Action.DOUBLE in legal else Action.HIT
    if total == 9:
        return Action.DOUBLE if dealer in {3, 4, 5, 6} and Action.DOUBLE in legal else Action.HIT
    return Action.HIT
