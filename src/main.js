import "./style.css";
import { BlackjackStage } from "./stage.js";
import { BrainView } from "./brain-view.js";
import { LiveClient } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const stage = new BlackjackStage($("#stage-canvas"));
const brain = new BrainView($("#brain-canvas"), $("#brain-labels"));
const recent = [];
let currentObservation = null;

function cardTotal(cards = []) {
  let total = cards.reduce((sum, card) => sum + card, 0);
  let aces = cards.filter((card) => card === 11).length;
  while (total > 21 && aces--) total -= 10;
  return total || "-";
}

function showHand(player = [], dealer = []) {
  stage.setHand(player, dealer);
  $("#player-total").textContent = cardTotal(player);
  $("#dealer-total").textContent = dealer.length > 1 ? cardTotal(dealer) : `${cardTotal(dealer)} + hidden`;
}

function renderStats(stats = {}) {
  const hands = stats.hands ?? 0;
  const accuracy = stats.accuracy ?? 1;
  $("#hand-count").textContent = `${hands.toLocaleString()} hands`;
  $("#wins").textContent = (stats.wins ?? 0).toLocaleString();
  $("#losses").textContent = (stats.losses ?? 0).toLocaleString();
  $("#pushes").textContent = (stats.pushes ?? 0).toLocaleString();
  $("#unit-return").textContent = Number(stats.unit_return ?? 0).toFixed(2);
  $("#accuracy").textContent = `${(accuracy * 100).toFixed(2)}%`;
  $("#learning-fill").style.width = `${Math.min(100, accuracy * 100)}%`;
  $("#mastery-label").textContent = accuracy >= 0.995 ? "Mastery threshold reached" : "Learning in progress";
}

function renderTimeline() {
  $("#timeline").innerHTML = recent.map((hand, index) => {
    const result = hand.results?.[0] ?? {};
    return `<li><button type="button" data-index="${index}"><span>${hand.hand_id}</span><b class="${result.outcome}">${result.outcome ?? "complete"}</b><small>${(result.actions ?? []).join(" -> ") || "natural"} / ${Number(hand.total_reward ?? 0).toFixed(1)} units</small></button></li>`;
  }).join("") || '<li class="empty">Completed hands will appear here.</li>';
}

function replay(hand) {
  const result = hand.results?.[0] ?? {};
  showHand(result.player_cards ?? [], hand.dealer_cards ?? []);
  $("#decision-action").textContent = `Replay: ${(result.actions ?? []).at(-1) ?? "natural result"}`;
  $("#decision-rationale").textContent = hand.decisions?.at(-1)?.rationale ?? "This hand completed without a player decision.";
  $("#hand-id").textContent = hand.hand_id;
}

function handleEvent(event) {
  const payload = event.payload ?? {};
  if (event.type === "session.snapshot") {
    renderStats(payload.stats);
    if (payload.latest_hand) replay(payload.latest_hand);
  }
  if (event.type === "hand.started") {
    stage.setMood("thinking");
    showHand(payload.player_cards, [payload.dealer_upcard]);
  }
  if (event.type === "card.dealt" && payload.public_cards) showHand(payload.public_cards.player, payload.public_cards.dealer);
  if (event.type === "agent.decision") {
    currentObservation = payload.observation;
    showHand(payload.observation?.player_cards, [payload.observation?.dealer_upcard]);
    $("#decision-action").textContent = String(payload.action ?? "thinking").toUpperCase();
    $("#decision-rationale").textContent = payload.rationale ?? "Decision produced by the current policy.";
    const comparison = payload.correct ? "Matches the exact strategy oracle" : `Oracle preferred ${payload.oracle_action}`;
    $("#oracle-check").textContent = comparison;
    $("#oracle-check").classList.toggle("mistake", !payload.correct);
  }
  if (event.type === "brain.frame") brain.update(payload.populations ?? []);
  if (event.type === "hand.result") {
    recent.unshift(payload);
    recent.splice(10);
    renderTimeline();
    replay(payload);
    const outcome = payload.results?.[0]?.outcome ?? "complete";
    const flash = $("#outcome-flash");
    flash.textContent = `${outcome.toUpperCase()} ${Number(payload.total_reward ?? 0) >= 0 ? "+" : ""}${Number(payload.total_reward ?? 0).toFixed(1)}`;
    flash.className = `outcome-flash show ${outcome}`;
    stage.setMood(outcome === "win" || outcome === "blackjack" ? "win" : outcome === "loss" ? "loss" : "idle");
    setTimeout(() => flash.classList.remove("show"), 1200);
  }
  if (event.type === "stats.updated") renderStats(payload);
}

const client = new LiveClient(handleEvent, (state, label) => {
  $("#connection-label").textContent = label;
  $(".live-state").dataset.state = state;
});

$("#pause").addEventListener("click", (event) => {
  client.paused = !client.paused;
  event.currentTarget.setAttribute("aria-pressed", String(client.paused));
  event.currentTarget.textContent = client.paused ? "Resume" : "Pause";
});
$("#brain-info").addEventListener("click", (event) => {
  const panel = $("#technical-panel");
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
});
$("#timeline").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (button) replay(recent[Number(button.dataset.index)]);
});

client.connect();
