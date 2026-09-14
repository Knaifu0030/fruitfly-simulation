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
      this.onEvent({ type: "session.snapshot", payload: await response.json() });
      this.openSocket();
    } catch {
      this.onConnection("demo", "Demonstration stream");
      this.startDemo();
    }
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

  startDemo() {
    const examples = [
      { player: [10, 6], dealer: 10, action: "surrender", reward: -0.5, rationale: "Give up half a unit with hard 16 against dealer 10." },
      { player: [8, 8], dealer: 6, action: "split", reward: 1, rationale: "Separate the pair into two hands against dealer 6." },
      { player: [11, 7], dealer: 6, action: "double", reward: 2, rationale: "Double soft 18 against a vulnerable dealer 6." },
      { player: [10, 10], dealer: 9, action: "stand", reward: 1, rationale: "Keep hard 20 against dealer 9." },
      { player: [10, 2], dealer: 3, action: "hit", reward: -1, rationale: "Take another card with hard 12 against dealer 3." },
    ];
    let hands = 0;
    const emit = () => {
      if (this.paused) return;
      const example = examples[hands % examples.length];
      this.onEvent({ type: "agent.decision", payload: { action: example.action, oracle_action: example.action, correct: true, rationale: example.rationale, observation: { player_cards: example.player, player_total: example.player.reduce((a, b) => a + b, 0), dealer_upcard: example.dealer } } });
      this.onEvent({ type: "brain.frame", payload: { populations: demoPopulations(example.reward) } });
      setTimeout(() => {
        if (this.paused) return;
        hands += 1;
        const outcome = example.reward > 0 ? "win" : example.reward < -0.5 ? "loss" : "surrender";
        this.onEvent({ type: "hand.result", payload: { hand_id: `demo-${hands}`, dealer_cards: [example.dealer, 10], results: [{ player_cards: example.player, outcome, reward: example.reward, actions: [example.action] }], total_reward: example.reward, decisions: [{ action: example.action, oracle_action: example.action, correct: true, rationale: example.rationale }] } });
        this.onEvent({ type: "stats.updated", payload: { hands, wins: Math.ceil(hands * 0.44), losses: Math.floor(hands * 0.48), pushes: Math.floor(hands * 0.08), unit_return: -hands * 0.005, accuracy: Math.min(0.999, 0.91 + hands * 0.002) } });
      }, 1700);
    };
    emit();
    this.demoTimer = setInterval(emit, 3600);
  }
}

function demoPopulations(reward) {
  return [
    ["perception", "Card perception", "visual projection neurons", 0.82],
    ["working", "Current hand", "central complex / recurrent state proxy", 0.68],
    ["choice", "Action selection", "descending-neuron readout", 0.9],
    ["learning", "Learning & memory", "Kenyon cells and MBONs", 0.55],
    ["appetitive", "Appetitive reinforcement", "dopaminergic neuron aggregate", reward > 0 ? 1 : 0.04],
    ["aversive", "Aversive reinforcement", "negative-valence teaching aggregate", reward < 0 ? 1 : 0.04],
  ].map(([key, label, technical, activity]) => ({ key, label, technical, activity }));
}
