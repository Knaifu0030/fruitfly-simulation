import "./style.css";
import { BlackjackStage } from "./stage.js";
import { BrainView } from "./brain-view.js";
import { LiveClient } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const stage = new BlackjackStage($("#stage-canvas"));
const brain = new BrainView($("#brain-canvas"), $("#brain-labels"), $("#activity-plot"));
const recent = [];
const balances = [];
let currentObservation = null;
let latestWallet = {};

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

const inr = (paise = 0) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

function renderWallet(data = {}) {
  latestWallet = { ...latestWallet, ...data };
  $("#wallet-balance").textContent = inr(data.available_paise ?? data.balance_paise ?? 1_000_000);
  $("#wallet-status").textContent = `${inr(data.reserved_paise ?? 0)} reserved / simulated INR`;
  $("#wallet-wager").textContent = inr(data.base_wager_paise ?? 10_000);
  $("#wallet-pnl").textContent = inr(data.realized_pnl_paise ?? 0);
  $("#wallet-roi").textContent = `${((data.roi ?? 0) * 100).toFixed(2)}%`;
  $("#wallet-drawdown").textContent = inr(data.max_drawdown_paise ?? 0);
  $("#wallet-risk").textContent = data.risk_of_ruin_heuristic == null ? "—" : `${(data.risk_of_ruin_heuristic * 100).toFixed(1)}%`;
  $("#wallet-surrender").textContent = (data.late_surrender ?? true) ? "Enabled" : "Disabled";
  $("#wallet-pnl").className = (data.realized_pnl_paise ?? 0) >= 0 ? "positive" : "negative";
  if (data.balance_paise !== undefined) {
    balances.push(data.balance_paise);
    if (balances.length > 100) balances.shift();
    drawBalanceChart();
  }
}

function drawBalanceChart() {
  const canvas = $("#balance-chart");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const context = canvas.getContext("2d"); context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  if (balances.length < 2) return;
  const min = Math.min(...balances); const max = Math.max(...balances); const span = Math.max(1, max - min);
  context.strokeStyle = balances.at(-1) >= balances[0] ? "#62d47b" : "#dc554b";
  context.lineWidth = 2; context.beginPath();
  balances.forEach((value, index) => {
    const x = index / (balances.length - 1) * width; const y = height - 3 - (value - min) / span * (height - 6);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

function renderExperiments(items = []) {
  $("#experiment-list").innerHTML = '<div class="experiment-row experiment-head"><span>Policy</span><span>P/L</span><span>Drawdown</span><span>Depletion</span></div>' + items.map((item) => `
    <div class="experiment-row"><span>${item.label}</span><span>${inr(item.pnl_paise)}</span><span>${inr(item.max_drawdown_paise)}</span><span>${(item.depletion_probability * 100).toFixed(0)}%</span></div>`).join("");
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
  if (event.type === "brain.frame") brain.update(payload);
  if (event.type === "wallet.snapshot" || event.type === "wallet.low_balance") renderWallet(payload);
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
$("#brain-labels").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-population]");
  if (button) {
    brain.inspect(button.dataset.population);
    $("#technical-panel").hidden = false;
    $("#brain-info").setAttribute("aria-expanded", "true");
  }
});
$("#timeline").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (button) replay(recent[Number(button.dataset.index)]);
});

client.connect();
client.getWallet().then(renderWallet).catch(() => {});
client.getExperiments().then((data) => renderExperiments(data.experiments)).catch(() => {
  $("#experiment-list").textContent = "Available when the simulation API is online.";
});

const walletDialog = $("#wallet-dialog");
$("#owner-wallet").addEventListener("click", () => walletDialog.showModal());
$("#pin-login").addEventListener("click", async () => {
  const message = $("#wallet-message");
  try {
    await client.login($("#owner-pin").value);
    $("#pin-step").hidden = true; $("#topup-step").hidden = false;
    $("#owner-wager").value = (latestWallet.base_wager_paise ?? 10_000) / 100;
    $("#owner-surrender").checked = latestWallet.late_surrender ?? true;
    message.textContent = "Owner session unlocked. Token remains only in this page's memory."; message.className = "positive";
  } catch (error) { message.textContent = error.message; message.className = "negative"; }
});
function updateAdjustmentCopy() {
  const direction = $("#balance-direction").value;
  const amount = inr(Number($("#topup-amount").value || 0) * 100);
  const reducing = direction === "reduce";
  $("#topup-confirmation").textContent = `This ${reducing ? "removes" : "adds"} ${amount} of non-redeemable play money${reducing ? "; game profit/loss is unchanged" : ""}.`;
  $("#topup-submit").textContent = reducing ? "Confirm balance reduction" : "Confirm balance addition";
  $("#topup-submit").classList.toggle("destructive", reducing);
  $("#topup-note").value = reducing ? "Virtual funds removed" : "Virtual funds added";
}
$("#topup-amount").addEventListener("input", updateAdjustmentCopy);
$("#balance-direction").addEventListener("change", updateAdjustmentCopy);
$("#topup-submit").addEventListener("click", async () => {
  const message = $("#wallet-message");
  try {
    const direction = $("#balance-direction").value;
    const result = await client.adjustWallet(direction, Math.round(Number($("#topup-amount").value) * 100), $("#topup-note").value);
    renderWallet(result.wallet); message.textContent = `${inr(Math.abs(result.transaction.amount_paise))} ${direction === "add" ? "added to" : "removed from"} the virtual wallet.`; message.className = direction === "add" ? "positive" : "negative";
  } catch (error) { message.textContent = error.message; message.className = "negative"; }
});
$("#settings-submit").addEventListener("click", async () => {
  const message = $("#wallet-message");
  try {
    const wager = Math.round(Number($("#owner-wager").value) * 100);
    const configured = await client.configureWallet(wager, $("#owner-surrender").checked);
    renderWallet(configured); message.textContent = `Next run: ${inr(wager)} wager, late surrender ${configured.late_surrender ? "enabled" : "disabled"}.`; message.className = "positive";
  } catch (error) { message.textContent = error.message; message.className = "negative"; }
});
