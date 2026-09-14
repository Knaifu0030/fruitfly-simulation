import "./style.css";
import { BlackjackStage } from "./stage.js";
import { BrainView } from "./brain-view.js";
import { LiveClient } from "./api.js";

const $ = (selector) => document.querySelector(selector);

const stage = new BlackjackStage($("#stage-canvas"));
const brain = new BrainView($("#brain-canvas"), $("#brain-labels"), $("#activity-plot"));
if (import.meta.env.DEV) window.__stage = stage;
const inr = (paise = 0) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
const units = (value = 0) => `${value >= 0 ? "+" : "−"}${Math.abs(Number(value)).toFixed(2)}`;

const SHOE_CARDS = 312;
const PENETRATION_CARDS = Math.round(SHOE_CARDS * 0.75);

const recent = [];
const balances = [];
let wallet = { base_wager_paise: 10_000, balance_paise: 1_000_000, late_surrender: true };
let cardsDealt = 0;

// Single source of truth for what is physically on the felt.
const felt = { handId: "idle", dealer: [], dealerHidden: false, hands: [], activeIndex: 0 };

function total(cards = []) {
  let sum = cards.reduce((carry, card) => carry + card, 0);
  let aces = cards.filter((card) => card === 11).length;
  while (sum > 21 && aces) {
    sum -= 10;
    aces -= 1;
  }
  return sum;
}

function pushFelt() {
  stage.showHand(felt);
  const dealerKnown = felt.dealer.length > 0;
  const dealerMarker = $("#marker-dealer");
  dealerMarker.hidden = !dealerKnown;
  if (dealerKnown) {
    const value = total(felt.dealer);
    $("#dealer-total").textContent = felt.dealerHidden ? `${value} + ?` : String(value);
    dealerMarker.dataset.bust = String(!felt.dealerHidden && value > 21);
  }

  const active = felt.hands[felt.activeIndex] ?? felt.hands.find((cards) => cards?.length);
  const playerMarker = $("#marker-player");
  playerMarker.hidden = !active?.length;
  if (active?.length) {
    const value = total(active);
    $("#player-total").textContent = felt.hands.filter((cards) => cards?.length).length > 1
      ? `${value} · hand ${felt.activeIndex + 1}`
      : String(value);
    playerMarker.dataset.bust = String(value > 21);
  }
}

function placeMarkers() {
  const anchors = stage.anchors();
  const position = (element, anchor) => {
    if (!anchor || !anchor.onScreen) return;
    element.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -50%)`;
  };
  position($("#marker-dealer"), anchors.dealer);
  position($("#marker-player"), anchors[`hand-${felt.activeIndex}`] ?? anchors["hand-0"]);
}
stage.onFrame = placeMarkers;

function setShoe(count) {
  if (!Number.isFinite(count)) return;
  cardsDealt = count;
  $("#rule-dealt").textContent = `${count.toLocaleString("en-IN")} cards dealt`;
  stage.setShoeProgress((count % PENETRATION_CARDS) / PENETRATION_CARDS);
}

function renderStats(stats = {}) {
  const hands = stats.hands ?? 0;
  const accuracy = stats.accuracy ?? 1;
  $("#hand-count").textContent = `${hands.toLocaleString("en-IN")} hands`;
  $("#wins").textContent = (stats.wins ?? 0).toLocaleString("en-IN");
  $("#losses").textContent = (stats.losses ?? 0).toLocaleString("en-IN");
  $("#pushes").textContent = (stats.pushes ?? 0).toLocaleString("en-IN");
  $("#unit-return").textContent = Number(stats.unit_return ?? 0).toFixed(2);
  $("#accuracy").textContent = `${(accuracy * 100).toFixed(2)}%`;
  $("#learning-fill").style.width = `${Math.min(100, accuracy * 100)}%`;
  $("#mastery-label").textContent = accuracy >= 0.995 ? "Mastery threshold reached" : "Learning in progress";
}

function renderWallet(data = {}) {
  wallet = { ...wallet, ...data };
  const wager = wallet.base_wager_paise ?? 10_000;
  $("#wallet-balance").textContent = inr(wallet.available_paise ?? wallet.balance_paise ?? 0);
  $("#wallet-status").textContent = `${inr(wallet.reserved_paise ?? 0)} reserved / simulated INR`;
  $("#wallet-wager").textContent = inr(wager);
  $("#wallet-pnl").textContent = inr(wallet.realized_pnl_paise ?? 0);
  $("#wallet-roi").textContent = `${((wallet.roi ?? 0) * 100).toFixed(2)}%`;
  $("#wallet-drawdown").textContent = inr(wallet.max_drawdown_paise ?? 0);
  $("#wallet-risk").textContent = wallet.risk_of_ruin_heuristic == null
    ? "—"
    : `${(wallet.risk_of_ruin_heuristic * 100).toFixed(1)}%`;
  $("#wallet-pnl").className = (wallet.realized_pnl_paise ?? 0) >= 0 ? "positive" : "negative";

  const surrender = wallet.late_surrender ?? true;
  $("#wallet-surrender").textContent = surrender ? "Enabled" : "Disabled";
  const rule = $("#rule-surrender");
  rule.textContent = surrender ? "Late surrender" : "No surrender";
  rule.dataset.off = String(!surrender);

  $("#stage-wager").textContent = inr(wager);
  $("#stage-exposure").textContent = inr(wallet.max_exposure_paise ?? wager * 8);
  stage.setWager(wager);

  if (data.balance_paise !== undefined) {
    balances.push(data.balance_paise);
    if (balances.length > 160) balances.shift();
    drawBalanceChart();
  }
}

function drawBalanceChart() {
  const canvas = $("#balance-chart");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  context.strokeStyle = "rgba(255,255,255,0.07)";
  context.lineWidth = 1;
  for (let line = 0; line <= 3; line += 1) {
    const y = (height / 3) * line + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  if (balances.length < 2) return;

  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const span = Math.max(1, max - min);
  const point = (value, index) => [
    (index / (balances.length - 1)) * width,
    height - 4 - ((value - min) / span) * (height - 10),
  ];
  const gaining = balances.at(-1) >= balances[0];
  const stroke = gaining ? "#5ed37a" : "#e0574c";

  context.beginPath();
  balances.forEach((value, index) => {
    const [x, y] = point(value, index);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  const fill = context.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, gaining ? "rgba(94,211,122,0.26)" : "rgba(224,87,76,0.24)");
  fill.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = fill;
  context.fill();

  context.beginPath();
  balances.forEach((value, index) => {
    const [x, y] = point(value, index);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.stroke();

  const [lastX, lastY] = point(balances.at(-1), balances.length - 1);
  context.fillStyle = stroke;
  context.beginPath();
  context.arc(lastX, lastY, 2.8, 0, Math.PI * 2);
  context.fill();

  $("#balance-caption").textContent = `${balances.length} settled hands / range ${inr(min)} to ${inr(max)}`;
}

function renderExperiments(items = []) {
  $("#experiment-list").innerHTML = '<div class="experiment-row experiment-head"><span>Policy</span><span>P/L</span><span>Drawdown</span><span>Depletion</span></div>'
    + items.map((item) => `<div class="experiment-row"><span>${item.label}</span><span>${inr(item.pnl_paise)}</span><span>${inr(item.max_drawdown_paise)}</span><span>${(item.depletion_probability * 100).toFixed(0)}%</span></div>`).join("");
}

function renderTimeline() {
  $("#timeline").innerHTML = recent.map((hand, index) => {
    const first = hand.results?.[0] ?? {};
    const outcome = hand.results?.length > 1 ? "split" : (first.outcome ?? "complete");
    const actions = (first.actions ?? []).join(" → ") || "natural";
    const money = hand.virtual_inr_result_paise === undefined ? "" : ` / ${inr(hand.virtual_inr_result_paise)}`;
    return `<li><button type="button" data-index="${index}"><span>${hand.hand_id}</span><b class="${outcome}">${outcome}</b><small>${actions} / ${units(hand.total_reward ?? 0)} units${money}</small></button></li>`;
  }).join("") || '<li class="empty">Completed hands will appear here.</li>';
}

function showDecision(decision = {}) {
  const observation = decision.observation ?? {};
  $("#decision-action").textContent = String(decision.action ?? "thinking").toUpperCase();
  $("#decision-rationale").textContent = decision.rationale ?? "Decision produced by the current policy.";
  $("#decision-hand").textContent = observation.player_total
    ? `${observation.soft ? "soft " : ""}${observation.player_total} vs ${observation.dealer_upcard}`
    : "";
  const check = $("#oracle-check");
  check.dataset.state = decision.correct === undefined ? "idle" : decision.correct ? "match" : "mistake";
  $("#oracle-text").textContent = decision.correct === undefined
    ? "Optimal strategy comparison ready"
    : decision.correct ? "Matches the exact strategy oracle" : `Oracle preferred ${decision.oracle_action}`;
}

function replay(hand) {
  if (!hand) return;
  felt.handId = hand.hand_id ?? felt.handId;
  felt.dealer = hand.dealer_cards ?? [];
  felt.dealerHidden = false;
  felt.hands = (hand.results ?? []).map((item) => item.player_cards ?? []);
  felt.activeIndex = 0;
  pushFelt();
  showDecision(hand.decisions?.at(-1) ?? { action: "result", rationale: "This hand completed without a player decision." });
  $("#hand-id").textContent = hand.hand_id ?? "—";
}

function flashOutcome(outcome, reward, money) {
  const flash = $("#outcome-flash");
  $("#outcome-label").textContent = outcome.toUpperCase();
  $("#outcome-delta").textContent = money === undefined
    ? `${units(reward)} units`
    : `${units(reward)} units / ${inr(money)}`;
  flash.className = `outcome-flash ${outcome}`;
  requestAnimationFrame(() => flash.classList.add("show"));
  clearTimeout(flashOutcome.timer);
  flashOutcome.timer = setTimeout(() => flash.classList.remove("show"), 1400);
}

function handleEvent(event) {
  const payload = event.payload ?? {};
  switch (event.type) {
    case "session.snapshot":
      renderStats(payload.stats);
      if (payload.latest_hand) replay(payload.latest_hand);
      break;
    case "hand.started":
      felt.handId = payload.hand_id ?? "hand";
      felt.dealer = [payload.dealer_upcard];
      felt.dealerHidden = true;
      felt.hands = [payload.player_cards ?? []];
      felt.activeIndex = 0;
      stage.setMood("thinking");
      pushFelt();
      break;
    case "agent.decision": {
      const observation = payload.observation ?? {};
      if (observation.hand_id) felt.handId = observation.hand_id;
      if (observation.player_cards) {
        felt.activeIndex = observation.hand_index ?? 0;
        felt.hands[felt.activeIndex] = observation.player_cards;
        felt.dealer = [observation.dealer_upcard];
        felt.dealerHidden = true;
        pushFelt();
      }
      setShoe(observation.cards_dealt);
      showDecision(payload);
      break;
    }
    case "brain.frame":
      brain.update(payload);
      break;
    case "wallet.snapshot":
    case "wallet.low_balance":
      renderWallet(payload);
      break;
    case "hand.result": {
      recent.unshift(payload);
      recent.splice(12);
      renderTimeline();
      replay(payload);
      const results = payload.results ?? [];
      const outcome = results.length > 1
        ? (payload.total_reward > 0 ? "win" : payload.total_reward < 0 ? "loss" : "push")
        : (results[0]?.outcome ?? "push");
      stage.setMood(outcome === "win" || outcome === "blackjack" ? "win" : outcome === "loss" ? "loss" : "idle");
      flashOutcome(outcome, payload.total_reward ?? 0, payload.virtual_inr_result_paise);
      break;
    }
    case "stats.updated":
      renderStats(payload);
      break;
    default:
      break;
  }
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
  if (!button) return;
  brain.inspect(button.dataset.population);
  $("#technical-panel").hidden = false;
  $("#brain-info").setAttribute("aria-expanded", "true");
});
$("#timeline").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (button) replay(recent[Number(button.dataset.index)]);
});
addEventListener("resize", drawBalanceChart);

renderWallet(wallet);
client.getWallet().then(renderWallet).catch(() => {}).finally(() => client.connect());
client.getExperiments().then((data) => renderExperiments(data.experiments)).catch(() => {
  $("#experiment-list").textContent = "Available when the simulation API is online.";
});

/* --------------------------------------------------------- owner controls */

const walletDialog = $("#wallet-dialog");
$("#owner-wallet").addEventListener("click", () => walletDialog.showModal());
$("#pin-login").addEventListener("click", async () => {
  const message = $("#wallet-message");
  try {
    await client.login($("#owner-pin").value);
    $("#pin-step").hidden = true;
    $("#topup-step").hidden = false;
    $("#owner-wager").value = (wallet.base_wager_paise ?? 10_000) / 100;
    $("#owner-surrender").checked = wallet.late_surrender ?? true;
    message.textContent = "Owner session unlocked. Token remains only in this page's memory.";
    message.className = "positive";
  } catch (error) {
    message.textContent = error.message;
    message.className = "negative";
  }
});

function updateAdjustmentCopy() {
  const reducing = $("#balance-direction").value === "reduce";
  const amount = inr(Number($("#topup-amount").value || 0) * 100);
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
    renderWallet(result.wallet);
    message.textContent = `${inr(Math.abs(result.transaction.amount_paise))} ${direction === "add" ? "added to" : "removed from"} the virtual wallet.`;
    message.className = direction === "add" ? "positive" : "negative";
  } catch (error) {
    message.textContent = error.message;
    message.className = "negative";
  }
});

$("#settings-submit").addEventListener("click", async () => {
  const message = $("#wallet-message");
  try {
    const wager = Math.round(Number($("#owner-wager").value) * 100);
    const configured = await client.configureWallet(wager, $("#owner-surrender").checked);
    renderWallet(configured);
    message.textContent = `Next run: ${inr(wager)} wager, late surrender ${configured.late_surrender ? "enabled" : "disabled"}.`;
    message.className = "positive";
  } catch (error) {
    message.textContent = error.message;
    message.className = "negative";
  }
});
