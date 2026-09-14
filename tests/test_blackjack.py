from fruitfly_blackjack.agent import HybridAgent
from fruitfly_blackjack.models import Action, Hand, Observation
from fruitfly_blackjack.oracle import optimal_action
from fruitfly_blackjack.provider import LocalBlackjackProvider


def observation(cards, dealer, legal=None):
    hand = Hand(list(cards))
    return Observation(
        hand_id="fixture", hand_index=0, player_cards=tuple(cards), player_total=hand.total,
        soft=hand.soft, pair_rank=hand.pair_rank, dealer_upcard=dealer,
        legal_actions=tuple(legal or Action), cards_dealt=4, previous_reward=0,
    )


def fixed_provider(player, dealer, draws=()):
    provider = LocalBlackjackProvider()
    provider.start_session(7)
    provider.hand_id = "fixture"
    provider.hands = [Hand(list(player))]
    provider.hand_actions = [[]]
    provider.dealer = Hand(list(dealer))
    provider.active = 0
    provider.shoe = list(reversed(draws))
    return provider


def test_ace_total_and_softness():
    assert Hand([11, 6]).total == 17 and Hand([11, 6]).soft
    assert Hand([11, 6, 10]).total == 17 and not Hand([11, 6, 10]).soft


def test_blackjack_pays_three_to_two():
    provider = fixed_provider([11, 10], [10, 9])
    result = provider.settle()
    assert result.results[0].outcome == "blackjack"
    assert result.total_reward == 1.5


def test_double_is_one_card_and_reward_is_clipped():
    provider = fixed_provider([5, 6], [6, 10], [10, 10])
    result = provider.act(Action.DOUBLE)
    assert result.results[0].player_cards == [5, 6, 10]
    assert result.total_reward == 2


def test_surrender_costs_half_unit():
    provider = fixed_provider([10, 6], [10, 7])
    result = provider.act(Action.SURRENDER)
    assert result.total_reward == -0.5


def test_split_aces_receive_one_card_and_stop():
    provider = fixed_provider([11, 11], [6, 10], [9, 10, 10])
    result = provider.act(Action.SPLIT)
    assert len(result.results) == 2
    assert all(len(hand.player_cards) == 2 for hand in result.results)
    assert "split" in result.results[0].actions


def test_observation_and_public_events_hide_hole_and_future_cards():
    provider = LocalBlackjackProvider()
    provider.start_session(12)
    current = provider.start_hand()
    if isinstance(current, Observation):
        assert current.dealer_upcard == provider.dealer.cards[0]
        assert not hasattr(current, "dealer_hole_card")
    hidden = [event for event in provider.events if event.get("recipient") == "dealer" and event.get("card") is None]
    assert len(hidden) == 1
    assert all("shoe" not in event for event in provider.events)


def test_oracle_representative_table_entries():
    assert optimal_action(observation([10, 6], 10)) == Action.SURRENDER
    assert optimal_action(observation([8, 8], 10)) == Action.SPLIT
    assert optimal_action(observation([11, 7], 6)) == Action.DOUBLE
    assert optimal_action(observation([10, 10], 6)) == Action.STAND
    assert optimal_action(observation([10, 2], 4)) == Action.STAND
    assert optimal_action(observation([10, 2], 3)) == Action.HIT


def test_unaided_agent_matches_oracle_for_reachable_state_grid():
    agent = HybridAgent(99, epsilon=0)
    checked = 0
    card_sets = [[10, 6], [8, 8], [11, 7], [5, 6], [10, 2], [7, 2], [11, 3], [9, 9]]
    for cards in card_sets:
        for dealer in range(2, 12):
            item = observation(cards, dealer)
            action, oracle, _ = agent.choose(item, training=False)
            assert action == oracle
            checked += 1
    assert checked == 80
    assert agent.accuracy >= 0.995
