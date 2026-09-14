const DEMO_HANDS = [
  {
    player: [10, 6], upcard: 10, dealerFinal: [10, 7],
    action: "surrender", actions: ["surrender"], finalHands: [[10, 6]],
    reward: -0.5, outcome: "surrender",
    rationale: "Give up half a unit with hard 16 against dealer 10.",
  },
  {
    player: [8, 8], upcard: 6, dealerFinal: [6, 10, 8],
    action: "split", actions: ["split", "hit", "stand"], finalHands: [[8, 3, 10], [8, 10]],
    reward: 2, outcome: "win",
    rationale: "Separate the pair into two hands against a weak dealer 6.",
  },
  {
    player: [11, 7], upcard: 6, dealerFinal: [6, 10, 2, 4],
    action: "double", actions: ["double"], finalHands: [[11, 7, 3]],
    reward: 2, outcome: "win",
    rationale: "Double soft 18 against a vulnerable dealer 6.",
  },
  {
    player: [10, 10], upcard: 9, dealerFinal: [9, 9],
    action: "stand", actions: ["stand"], finalHands: [[10, 10]],
    reward: 1, outcome: "win",
    rationale: "Keep hard 20 against dealer 9 rather than risking the total.",
  },
  {
    player: [10, 2], upcard: 3, dealerFinal: [3, 10, 5],
    action: "hit", actions: ["hit"], finalHands: [[10, 2, 10]],
    reward: -1, outcome: "loss",
    rationale: "Take another card with hard 12 against dealer 3.",
  },
  {
    player: [11, 10], upcard: 7, dealerFinal: [7, 10],
    action: null, actions: [], finalHands: [[11, 10]],
    reward: 1.5, outcome: "blackjack",
    rationale: "Natural blackjack settles immediately and pays three to two.",
  },
];

function demoPopulations(reward) {
  return [
    ["perception", "Card perception", "visual projection neurons", 9201, "dataset + model mapping", 0.82],
    ["working", "Current hand", "central complex / recurrent state proxy", 2950, "engineered model mapping", 0.68],
    ["choice", "Action selection", "descending-neuron readout", 1314, "dataset + engineered readout", 0.9],
    ["learning", "Learning & memory", "Kenyon cells and MBONs", 4161, "dataset + model plasticity", 0.55],
    ["appetitive", "Appetitive reinforcement", "dopaminergic neuron aggregate", 340, "dataset + reward mapping", reward > 0 ? 1 : 0.04],
    ["aversive", "Aversive reinforcement", "negative-valence teaching aggregate", 340, "engineered valence mapping", reward < 0 ? 1 : 0.04],
  ].map(([key, label, technical, neuronCount, evidence, activity]) => ({
    key, label, technical, neuron_count: neuronCount, evidence, activity,
  }));
}

export class LiveClient {
  constructor(onEvent, onConnection) {
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.paused = false;
    this.lastSequence = 0;
    const configured = import.meta.env.VITE_API_URL;
    this.api = configured || `${location.protocol}//${location.hostname}:8000`;
  }

  async connect() {
    try {
      const response = await fetch(`${this.api}/api/live`);
      if (!response.ok) throw new Error("API unavailable");
      const snapshot = await response.json();
      this.onEvent({ type: "session.snapshot", payload: snapshot });
      if (!snapshot.running && !snapshot.latest_hand) {
        this.onConnection("demo", "Demonstration stream");
        this.startDemo();
        return;
      }
      this.openSocket();
    } catch {
      this.onConnection("demo", "Demonstration stream");
      this.startDemo();
    }
  }

  async getWallet() {
    const response = await fetch(`${this.api}/api/wallet`);
    if (!response.ok) throw new Error("Wallet unavailable");
    return response.json();
  }

  async getExperiments() {
    const response = await fetch(`${this.api}/api/wallet/experiments`);
    if (!response.ok) throw new Error("Experiments unavailable");
    return response.json();
  }

  async login(pin) {
    const response = await fetch(`${this.api}/api/admin/auth/pin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }),
    });
    if (!response.ok) throw new Error((await response.json()).detail ?? "Login failed");
    const result = await response.json();
    this.ownerToken = result.access_token;
    setTimeout(() => { this.ownerToken = undefined; }, result.expires_in * 1000);
    return result;
  }

  async adjustWallet(direction, amountPaise, publicNote) {
    if (!this.ownerToken) throw new Error("Owner session expired");
    const response = await fetch(`${this.api}/api/admin/wallet/adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.ownerToken}`, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ direction, amount_paise: amountPaise, public_note: publicNote }),
    });
    if (!response.ok) throw new Error((await response.json()).detail ?? "Balance adjustment failed");
    return response.json();
  }

  async configureWallet(baseWagerPaise, lateSurrender) {
    if (!this.ownerToken) throw new Error("Owner session expired");
    const response = await fetch(`${this.api}/api/admin/wallet/config`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.ownerToken}` },
      body: JSON.stringify({ base_wager_paise: baseWagerPaise, late_surrender: lateSurrender }),
    });
    if (!response.ok) throw new Error((await response.json()).detail ?? "Settings update failed");
    return response.json();
  }

  openSocket() {
    const url = new URL(this.api);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/stream";
    this.socket = new WebSocket(url);
    this.socket.addEventListener("open", () => this.onConnection("live", "Live simulation"));
    this.socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data);
      if (event.sequence <= this.lastSequence || this.paused) return;
      this.lastSequence = event.sequence;
      this.onEvent(event);
    });
    this.socket.addEventListener("close", () => {
      this.onConnection("offline", "Reconnecting");
      setTimeout(() => this.openSocket(), 2000);
    });
  }

  /**
   * Clearly-labelled scripted stream used when the simulation API is offline.
   * It exercises the same event contract as the live service, including
   * surrender, splits, doubles and a natural, so the table is never idle.
   */
  startDemo() {
    const wager = 10_000;
    let index = 0;
    let hands = 0;
    let dealt = 0;
    let balance = 1_000_000;
    let peak = balance;
    let maxDrawdown = 0;

    const deal = () => {
      if (this.paused) return;
      const example = DEMO_HANDS[index % DEMO_HANDS.length];
      index += 1;
      const handId = `demo-${index}`;
      const playerTotal = example.player.reduce((sum, card) => sum + card, 0);
      dealt += 4;

      this.onEvent({ type: "hand.started", payload: { hand_id: handId, dealer_upcard: example.upcard, player_cards: example.player } });
      this.onEvent({ type: "brain.frame", payload: {
        phase: "visual_encoding", pathway: ["perception", "working"],
        stimulus: { player_cards: example.player, dealer_upcard: example.upcard, hand_total: playerTotal, action: example.action ?? "none" },
        populations: demoPopulations(0), plasticity: hands * 0.0004, plasticity_delta: 0,
      } });

      const decision = example.action && {
        action: example.action, oracle_action: example.action, correct: true, rationale: example.rationale,
        observation: {
          hand_id: handId, hand_index: 0, player_cards: example.player, player_total: playerTotal,
          soft: example.player.includes(11), dealer_upcard: example.upcard, cards_dealt: dealt,
        },
      };

      setTimeout(() => {
        if (this.paused) return;
        if (decision) {
          this.onEvent({ type: "agent.decision", payload: decision });
          this.onEvent({ type: "brain.frame", payload: {
            phase: "action_readout", pathway: ["perception", "working", "choice"],
            stimulus: { player_cards: example.player, dealer_upcard: example.upcard, hand_total: playerTotal, action: example.action },
            populations: demoPopulations(0), plasticity: hands * 0.0004, plasticity_delta: 0,
          } });
        }
      }, 700);

      setTimeout(() => {
        if (this.paused) return;
        hands += 1;
        dealt += example.finalHands.flat().length + example.dealerFinal.length - 4;
        const delta = Math.round(example.reward * wager);
        balance += delta;
        peak = Math.max(peak, balance);
        maxDrawdown = Math.max(maxDrawdown, peak - balance);

        this.onEvent({ type: "hand.result", payload: {
          hand_id: handId,
          dealer_cards: example.dealerFinal,
          results: example.finalHands.map((cards, hand) => ({
            hand_index: hand, player_cards: cards, dealer_cards: example.dealerFinal,
            outcome: example.outcome, reward: example.reward / example.finalHands.length,
            wager: 1, actions: hand === 0 ? example.actions : [],
          })),
          total_reward: example.reward,
          decisions: decision ? [decision] : [],
          wager_paise: wager,
          rules: { late_surrender: true },
          virtual_inr_result_paise: delta,
          balance_before_paise: balance - delta,
          balance_after_paise: balance,
        } });
        this.onEvent({ type: "brain.frame", payload: {
          phase: "kc_mbon_update", pathway: [example.reward > 0 ? "appetitive" : "aversive", "learning", "choice"],
          stimulus: { reward: example.reward, teaching_signal: example.reward > 0 ? "appetitive" : "aversive" },
          populations: demoPopulations(example.reward), plasticity: hands * 0.0004, plasticity_delta: Math.abs(example.reward) * 0.0004,
        } });
        this.onEvent({ type: "stats.updated", payload: {
          hands, wins: Math.ceil(hands * 0.44), losses: Math.floor(hands * 0.48),
          pushes: Math.floor(hands * 0.08), unit_return: -hands * 0.005,
          accuracy: Math.min(0.999, 0.91 + hands * 0.002),
        } });
        this.onEvent({ type: "wallet.snapshot", payload: {
          currency: "INR_SIM", label: "simulated INR demonstration", balance_paise: balance,
          available_paise: balance, reserved_paise: 0, base_wager_paise: wager,
          max_exposure_paise: wager * 8, late_surrender: true,
          realized_pnl_paise: balance - 1_000_000, roi: (balance - 1_000_000) / 1_000_000,
          max_drawdown_paise: maxDrawdown, risk_of_ruin_heuristic: null,
        } });
      }, 2600);
    };

    deal();
    this.demoTimer = setInterval(deal, 5200);
  }
}
