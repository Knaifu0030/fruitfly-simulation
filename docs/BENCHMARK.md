# Mastery benchmark

Unaided evaluation completed with the teacher disabled:

```text
command: uv run python scripts/evaluate-blackjack-agent.py --hands 1000000
seed: 20260914
hands: 1,000,000
decisions: 1,286,519
oracle agreement: 100.000000%
unit return per initial hand: -0.006935
```

The action head and exact oracle selected identical actions, so their measured expected-return difference on this paired policy evaluation is 0.0 percentage points. The negative unit return is expected and demonstrates why “master” means strategy accuracy, not guaranteed profit.
