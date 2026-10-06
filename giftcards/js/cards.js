/* Ogarider Cards: sell gift cards for naira (giftcards/index.html) */

// ---------------------------------------------------------------------------
// EDIT: the WhatsApp number that receives trades, with country code.
// Rates live in giftcards/rates.json (naira paid per 1 unit of card currency).
// ---------------------------------------------------------------------------
var WHATSAPP_NUMBER = "+234 705 994 6531";
var BUSINESS_NAME = "Ogarider Cards";

var BANKS = ["Access Bank", "Fidelity Bank", "First Bank", "FCMB", "GTBank", "Kuda", "Moniepoint",
  "Opay", "PalmPay", "Polaris Bank", "Stanbic IBTC", "Sterling Bank", "UBA", "Union Bank",
  "Wema Bank", "Zenith Bank"];

// Plain, older-style JavaScript so it also runs on older phones, like order.js.
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  var digits = WHATSAPP_NUMBER.replace(/\D/g, "");
  var data = null;
  var sellType = "physical";
  var ratesCur = "USD";

  function naira(n) {
    return "₦" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function badge(card) {
    var b = el("span", "badge", card.name.charAt(0));
    b.style.background = card.color;
    return b;
  }

  function findCard(id) {
    for (var i = 0; i < data.cards.length; i++) if (data.cards[i].id === id) return data.cards[i];
    return data.cards[0];
  }

  function waLink(text) {
    return "https://wa.me/" + digits + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  // Naira paid per 1 unit of card currency; e-codes pay a little less.
  function rateFor(card, cur, type) {
    var r = card.rates[cur];
    if (!r) return 0;
    return type === "ecode" ? r * data.ecodeDiscount : r;
  }

  function fillCards(select) {
    select.innerHTML = "";
    for (var i = 0; i < data.cards.length; i++) {
      var o = el("option", null, data.cards[i].name);
      o.value = data.cards[i].id;
      select.appendChild(o);
    }
  }

  // Only the countries that card is bought in; keeps the current choice when possible.
  function fillCurrencies(select, card) {
    var keep = select.value;
    select.innerHTML = "";
    for (var cur in card.rates) {
      if (!data.currencies[cur]) continue;
      var o = el("option", null, data.currencies[cur].label);
      o.value = cur;
      select.appendChild(o);
    }
    if (card.rates[keep]) select.value = keep;
  }

  function rateLine(card, cur, type) {
    return "Rate: " + naira(rateFor(card, cur, type)) + " per " + data.currencies[cur].symbol + "1";
  }

  // ---- Home calculator ----
  function updateQuick() {
    var card = findCard($("q-card").value);
    var cur = $("q-cur").value;
    var amt = parseFloat($("q-amt").value) || 0;
    $("q-out").textContent = naira(amt * rateFor(card, cur, "physical"));
    $("q-rate").textContent = rateLine(card, cur, "physical");
  }

  // ---- Rates page ----
  function renderRates() {
    var seg = $("rates-cur");
    seg.innerHTML = "";
    for (var cur in data.currencies) {
      (function (c) {
        var b = el("button", c === ratesCur ? "on" : null, data.currencies[c].label);
        b.type = "button";
        b.onclick = function () { ratesCur = c; renderRates(); };
        seg.appendChild(b);
      })(cur);
    }
    var list = $("rate-list");
    list.innerHTML = "";
    for (var i = 0; i < data.cards.length; i++) {
      var card = data.cards[i];
      if (!card.rates[ratesCur]) continue;
      var row = el("a", "rate-row");
      row.href = "#sell";
      row.setAttribute("data-card", card.id);
      row.onclick = pickCard;
      var val = el("span", "rate-val", naira(card.rates[ratesCur]));
      val.appendChild(el("small", null, " / " + data.currencies[ratesCur].symbol + "1"));
      row.appendChild(badge(card));
      row.appendChild(el("span", "rate-name", card.name));
      row.appendChild(val);
      list.appendChild(row);
    }
  }

  // Tapping a card anywhere opens the sell form with it chosen.
  function pickCard() {
    var id = this.getAttribute("data-card");
    $("s-card").value = id;
    fillCurrencies($("s-cur"), findCard(id));
    if (this.closest && this.closest("#rate-list") && findCard(id).rates[ratesCur]) $("s-cur").value = ratesCur;
    updateSell();
  }

  // ---- Sell form ----
  function updateSell() {
    var card = findCard($("s-card").value);
    var cur = $("s-cur").value;
    var amt = parseFloat($("s-amt").value) || 0;
    $("s-out").textContent = naira(amt * rateFor(card, cur, sellType));
    $("s-rate").textContent = rateLine(card, cur, sellType);
  }

  function submitSell(e) {
    e.preventDefault();
    var card = findCard($("s-card").value);
    var cur = $("s-cur").value;
    var sym = data.currencies[cur].symbol;
    var amt = parseFloat($("s-amt").value) || 0;
    var bank = $("s-bank").value.trim();
    var acct = $("s-acct").value.replace(/\D/g, "");
    var name = $("s-name").value.trim();
    var err = "";
    if (amt < data.minValue) err = "The smallest card we buy is " + sym + data.minValue + ".";
    else if (!bank) err = "Enter your bank.";
    else if (acct.length !== 10) err = "Account number must be 10 digits.";
    else if (!name) err = "Enter the account name.";
    $("s-error").textContent = err;
    if (err) return;

    var msg = [
      "Hello " + BUSINESS_NAME + ", I want to sell a gift card.",
      "",
      "Card: " + card.name + " (" + data.currencies[cur].label + ")",
      "Type: " + (sellType === "ecode" ? "E-code" : "Physical card"),
      "Value: " + sym + amt,
      "Rate: " + naira(rateFor(card, cur, sellType)) + " per " + sym + "1",
      "I get: " + naira(amt * rateFor(card, cur, sellType)),
      "",
      "Pay to:",
      "Bank: " + bank,
      "Account number: " + acct,
      "Account name: " + name,
      "",
      "I'll send the card photo / code next."
    ].join("\n");
    window.location.href = waLink(msg);
  }

  // ---- Tabs (one page, switched by the address #hash) ----
  function showView() {
    var tab = (location.hash || "#home").slice(1);
    if (!$("view-" + tab)) tab = "home";
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].hidden = views[i].id !== "view-" + tab;
    var links = document.querySelectorAll(".tabbar a");
    for (var j = 0; j < links.length; j++) {
      links[j].className = links[j].getAttribute("data-tab") === tab ? "on" : "";
    }
    window.scrollTo(0, 0);
  }

  function start(json) {
    data = json;
    var strip = $("brand-strip");
    for (var i = 0; i < data.cards.length; i++) {
      var chip = el("a", "brand-chip");
      chip.href = "#sell";
      chip.setAttribute("data-card", data.cards[i].id);
      chip.onclick = pickCard;
      chip.appendChild(badge(data.cards[i]));
      chip.appendChild(el("span", null, data.cards[i].name));
      strip.appendChild(chip);
    }

    fillCards($("q-card"));
    fillCurrencies($("q-cur"), data.cards[0]);
    $("q-card").onchange = function () { fillCurrencies($("q-cur"), findCard(this.value)); updateQuick(); };
    $("q-cur").onchange = updateQuick;
    $("q-amt").oninput = updateQuick;
    $("q-sell").onclick = function () {
      $("s-card").value = $("q-card").value;
      fillCurrencies($("s-cur"), findCard($("q-card").value));
      $("s-cur").value = $("q-cur").value;
      $("s-amt").value = $("q-amt").value;
      updateSell();
    };
    updateQuick();

    fillCards($("s-card"));
    fillCurrencies($("s-cur"), data.cards[0]);
    $("s-card").onchange = function () { fillCurrencies($("s-cur"), findCard(this.value)); updateSell(); };
    $("s-cur").onchange = updateSell;
    $("s-amt").oninput = updateSell;
    var typeBtns = $("s-type").getElementsByTagName("button");
    for (var t = 0; t < typeBtns.length; t++) {
      typeBtns[t].onclick = function () {
        sellType = this.getAttribute("data-type");
        for (var k = 0; k < typeBtns.length; k++) typeBtns[k].className = typeBtns[k] === this ? "on" : "";
        updateSell();
      };
    }
    for (var b = 0; b < BANKS.length; b++) {
      var o = document.createElement("option");
      o.value = BANKS[b];
      $("banks").appendChild(o);
    }
    $("sell-form").onsubmit = submitSell;
    updateSell();

    var off = Math.round((1 - data.ecodeDiscount) * 100);
    $("rates-updated").textContent = "Updated " + data.updated + ". Naira paid per 1 unit of card value.";
    $("updated-label").textContent = "Updated " + data.updated;
    $("ecode-note").textContent = "Rates shown are for physical cards. E-codes pay " + off + "% less. Tap a card to sell it.";
    renderRates();
  }

  $("wa-top").href = waLink("Hello " + BUSINESS_NAME + ", I have a question about selling a gift card.");
  $("wa-help").href = $("wa-top").href;
  window.addEventListener("hashchange", showView);
  showView();

  // no-cache so a rate change shows up straight away.
  fetch("rates.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(start)
    .catch(function () {
      $("q-out").textContent = "—";
      $("q-rate").textContent = "Couldn't load today's rates. Please refresh.";
    });
})();
