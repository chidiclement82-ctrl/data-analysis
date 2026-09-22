/* Live chat with customers, powered by Tawk.to (free). Staff reply from the
   Tawk.to dashboard or the Tawk.to phone app. */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // EDIT: paste your Tawk.to chat link here to switch on live chat, e.g.
  // "https://tawk.to/chat/64f1a2b3c4d5e6f7a8b9c0d1/1h8abc123"
  // (Tawk.to dashboard → Administration → Channels → Chat Widget → Direct Chat Link).
  // The embed link "https://embed.tawk.to/…/…" works too. Leave "" to hide chat.
  // -------------------------------------------------------------------------
  var TAWK_LINK = "";

  var match = TAWK_LINK.match(/tawk\.to\/(?:chat\/)?([a-f0-9]{16,})\/([a-z0-9]+)/i);
  if (!match) return;

  // Sit bottom-left so the chat bubble doesn't cover the "Order on WhatsApp" button.
  var script = document.currentScript;
  var lift = Number((script && script.dataset.offsetY) || 20);
  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_API.customStyle = {
    visibility: {
      desktop: { position: "bl", xOffset: 20, yOffset: lift },
      mobile: { position: "bl", xOffset: 12, yOffset: lift }
    }
  };
  window.Tawk_LoadStart = new Date();

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://embed.tawk.to/" + match[1] + "/" + match[2];
  s.charset = "UTF-8";
  s.setAttribute("crossorigin", "*");
  document.head.appendChild(s);
})();
