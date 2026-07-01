/**
 * Beginner AI Assistant Widget
 * Drop-in chat widget that lets users ask "what does this mean?" questions
 * about your trading platform, in plain language.
 *
 * SETUP:
 * 1. Host this file on your site (or a CDN) as /widget.js
 * 2. Add one line before </body> on any page:
 *      <script src="/widget.js" data-api-url="https://your-backend.com/api/ask"></script>
 * 3. Point data-api-url at your backend endpoint (see server-example.js).
 *    Never call the AI API directly from this file with a secret key —
 *    keys must stay server-side.
 */
(function () {
  "use strict";

  const scriptTag = document.currentScript;
  const API_URL = scriptTag?.getAttribute("data-api-url") || "/api/ask";
  const PLATFORM_NAME = scriptTag?.getAttribute("data-platform-name") || "Ramzfx Traders Hub";

  // ---------- Design tokens ----------
  const css = `
  :root {
    --aw-bg: #0B1220;
    --aw-panel: #131B2E;
    --aw-panel-2: #1B2540;
    --aw-border: #263454;
    --aw-text: #E5EAF5;
    --aw-muted: #8B96AD;
    --aw-accent: #F5A623;
    --aw-accent-dim: #7A5A1E;
    --aw-live: #4ADE80;
    --aw-radius: 14px;
    --aw-font-display: 'Space Grotesk', 'Segoe UI', sans-serif;
    --aw-font-body: 'Inter', 'Segoe UI', sans-serif;
    --aw-font-mono: 'IBM Plex Mono', 'Courier New', monospace;
  }

  #aw-root * { box-sizing: border-box; }

  #aw-launcher {
    position: fixed;
    bottom: 22px;
    right: 22px;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: var(--aw-panel);
    border: 1px solid var(--aw-border);
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999998;
    transition: transform 0.15s ease;
  }
  #aw-launcher:hover { transform: scale(1.06); }
  #aw-launcher .aw-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--aw-live);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
    animation: aw-pulse 2s infinite;
  }
  @keyframes aw-pulse {
    0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
    70% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
    100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
  }

  #aw-panel {
    position: fixed;
    bottom: 92px;
    right: 22px;
    width: 360px;
    max-width: calc(100vw - 32px);
    height: 480px;
    max-height: calc(100vh - 140px);
    background: var(--aw-bg);
    border: 1px solid var(--aw-border);
    border-radius: var(--aw-radius);
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 999999;
    font-family: var(--aw-font-body);
    color: var(--aw-text);
  }
  #aw-panel.aw-open { display: flex; }

  #aw-header {
    background: var(--aw-panel);
    border-bottom: 1px solid var(--aw-border);
    padding: 12px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  #aw-header .aw-title {
    font-family: var(--aw-font-display);
    font-weight: 600;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #aw-header .aw-title .aw-tag {
    font-family: var(--aw-font-mono);
    font-size: 10px;
    color: var(--aw-accent);
    border: 1px solid var(--aw-accent-dim);
    border-radius: 4px;
    padding: 1px 5px;
    letter-spacing: 0.04em;
  }
  #aw-close {
    background: none;
    border: none;
    color: var(--aw-muted);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    padding: 4px;
  }
  #aw-close:hover { color: var(--aw-text); }

  #aw-ticker {
    background: var(--aw-panel-2);
    border-bottom: 1px solid var(--aw-border);
    padding: 5px 0;
    overflow: hidden;
    white-space: nowrap;
    flex-shrink: 0;
  }
  #aw-ticker span {
    display: inline-block;
    padding-left: 100%;
    font-family: var(--aw-font-mono);
    font-size: 10px;
    color: var(--aw-muted);
    letter-spacing: 0.03em;
    animation: aw-scroll 22s linear infinite;
  }
  @keyframes aw-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-100%); }
  }

  #aw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .aw-msg {
    max-width: 85%;
    padding: 9px 12px;
    border-radius: 10px;
    font-size: 13.5px;
    line-height: 1.45;
  }
  .aw-msg-bot {
    background: var(--aw-panel);
    border: 1px solid var(--aw-border);
    align-self: flex-start;
    border-top-left-radius: 3px;
  }
  .aw-msg-user {
    background: var(--aw-accent-dim);
    color: #FFE9C6;
    align-self: flex-end;
    border-top-right-radius: 3px;
  }
  .aw-msg-typing {
    display: flex;
    gap: 4px;
    padding: 10px 12px;
  }
  .aw-msg-typing span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--aw-muted);
    animation: aw-bounce 1.2s infinite ease-in-out;
  }
  .aw-msg-typing span:nth-child(2) { animation-delay: 0.15s; }
  .aw-msg-typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes aw-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-4px); opacity: 1; }
  }

  #aw-suggestions {
    display: flex;
    gap: 6px;
    padding: 0 14px 10px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .aw-chip {
    font-family: var(--aw-font-mono);
    font-size: 10.5px;
    color: var(--aw-muted);
    background: var(--aw-panel);
    border: 1px solid var(--aw-border);
    border-radius: 20px;
    padding: 5px 10px;
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .aw-chip:hover { border-color: var(--aw-accent); color: var(--aw-accent); }

  #aw-inputrow {
    border-top: 1px solid var(--aw-border);
    padding: 10px;
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    background: var(--aw-panel);
  }
  #aw-input {
    flex: 1;
    background: var(--aw-bg);
    border: 1px solid var(--aw-border);
    border-radius: 8px;
    color: var(--aw-text);
    font-family: var(--aw-font-body);
    font-size: 13px;
    padding: 9px 11px;
    outline: none;
  }
  #aw-input:focus { border-color: var(--aw-accent); }
  #aw-send {
    background: var(--aw-accent);
    border: none;
    border-radius: 8px;
    color: #1A1200;
    font-weight: 600;
    font-size: 13px;
    padding: 0 14px;
    cursor: pointer;
  }
  #aw-send:disabled { opacity: 0.5; cursor: default; }
  #aw-send:hover:not(:disabled) { filter: brightness(1.08); }

  #aw-disclaimer {
    font-family: var(--aw-font-mono);
    font-size: 9.5px;
    color: var(--aw-muted);
    text-align: center;
    padding: 6px 10px 10px;
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    #aw-launcher .aw-dot, #aw-ticker span, .aw-msg-typing span { animation: none; }
  }

  /* ---------- Inline badges (small AI icons placed within page content) ---------- */
  .aw-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--aw-panel);
    border: 1px solid var(--aw-accent-dim);
    border-radius: 20px;
    padding: 3px 9px 3px 6px;
    cursor: pointer;
    font-family: var(--aw-font-mono);
    font-size: 11px;
    color: var(--aw-accent);
    vertical-align: middle;
    transition: border-color 0.15s ease, background 0.15s ease;
    user-select: none;
  }
  .aw-badge:hover { border-color: var(--aw-accent); background: var(--aw-panel-2); }
  .aw-badge svg { flex-shrink: 0; }

  #aw-intro-popup {
    position: absolute;
    z-index: 1000000;
    width: 260px;
    background: var(--aw-bg);
    border: 1px solid var(--aw-border);
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.45);
    padding: 14px;
    font-family: var(--aw-font-body);
    color: var(--aw-text);
    display: none;
  }
  #aw-intro-popup.aw-visible { display: block; }
  #aw-intro-popup .aw-intro-text {
    font-size: 13px;
    line-height: 1.45;
    margin-bottom: 10px;
    color: var(--aw-text);
  }
  #aw-intro-popup .aw-intro-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  #aw-intro-popup .aw-intro-dismiss {
    background: none;
    border: none;
    color: var(--aw-muted);
    font-size: 12px;
    cursor: pointer;
    padding: 6px 4px;
  }
  #aw-intro-popup .aw-intro-start {
    background: var(--aw-accent);
    border: none;
    border-radius: 7px;
    color: #1A1200;
    font-weight: 600;
    font-size: 12px;
    padding: 6px 12px;
    cursor: pointer;
  }
  #aw-intro-popup .aw-intro-start:hover { filter: brightness(1.08); }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- Markup ----------
  const root = document.createElement("div");
  root.id = "aw-root";
  root.innerHTML = `
    <button id="aw-launcher" aria-label="Ask a question about ${PLATFORM_NAME}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4H20V16H7L4 19V4Z" stroke="#F5A623" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="9" cy="10" r="1" fill="#F5A623"/>
        <circle cx="12" cy="10" r="1" fill="#F5A623"/>
        <circle cx="15" cy="10" r="1" fill="#F5A623"/>
      </svg>
      <span class="aw-dot"></span>
    </button>

    <div id="aw-panel" role="dialog" aria-label="Ask a question">
      <div id="aw-header">
        <div class="aw-title">Ask Robert Nyaundi <span class="aw-tag">BEGINNER MODE</span></div>
        <button id="aw-close" aria-label="Close">&times;</button>
      </div>
      <div id="aw-ticker"><span>WHAT'S A LIMIT ORDER? &nbsp;&bull;&nbsp; HOW DO FEES WORK? &nbsp;&bull;&nbsp; WHAT DOES "SPREAD" MEAN? &nbsp;&bull;&nbsp; HOW DO I READ A CANDLESTICK? &nbsp;&bull;&nbsp; WHAT IS MARGIN?</span></div>
      <div id="aw-messages"></div>
      <div id="aw-suggestions">
        <div class="aw-chip" data-q="What's the difference between a market order and a limit order?">market vs limit order</div>
        <div class="aw-chip" data-q="What does this chart's candlesticks mean?">reading candlesticks</div>
        <div class="aw-chip" data-q="How do trading fees on this platform work?">how fees work</div>
      </div>
      <div id="aw-inputrow">
        <input id="aw-input" type="text" placeholder="Ask about any term or feature..." autocomplete="off" />
        <button id="aw-send">Ask</button>
      </div>
      <div id="aw-disclaimer">Explains how things work — not investment advice.</div>
    </div>

    <div id="aw-intro-popup">
      <div class="aw-intro-text"></div>
      <div class="aw-intro-actions">
        <button class="aw-intro-dismiss">Not now</button>
        <button class="aw-intro-start">Explain it</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ---------- Behavior ----------
  const launcher = document.getElementById("aw-launcher");
  const panel = document.getElementById("aw-panel");
  const closeBtn = document.getElementById("aw-close");
  const messages = document.getElementById("aw-messages");
  const input = document.getElementById("aw-input");
  const sendBtn = document.getElementById("aw-send");
  const chips = document.querySelectorAll(".aw-chip");

  let opened = false;
  let history = []; // {role, content}

  function toggle() {
    opened = !opened;
    panel.classList.toggle("aw-open", opened);
    if (opened && messages.children.length === 0) {
      addMessage(
        "bot",
        `Hi! I'm here to explain anything on ${PLATFORM_NAME} in plain language — terms, charts, order types, whatever you're unsure about. What would you like to know?`
      );
    }
    if (opened) input.focus();
  }

  launcher.addEventListener("click", toggle);
  closeBtn.addEventListener("click", toggle);

  function addMessage(role, text) {
    const el = document.createElement("div");
    el.className = "aw-msg " + (role === "user" ? "aw-msg-user" : "aw-msg-bot");
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function addTyping() {
    const el = document.createElement("div");
    el.className = "aw-msg aw-msg-bot aw-msg-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  async function ask(question) {
    if (!question.trim()) return;
    addMessage("user", question);
    history.push({ role: "user", content: question });
    input.value = "";
    sendBtn.disabled = true;
    const typingEl = addTyping();

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      typingEl.remove();
      const answer = data.answer || "Sorry, I couldn't process that. Please try again.";
      addMessage("bot", answer);
      history.push({ role: "assistant", content: answer });
    } catch (err) {
      typingEl.remove();
      addMessage("bot", "Something went wrong reaching the assistant. Please try again in a moment.");
      console.error("AI widget error:", err);
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", () => ask(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ask(input.value);
  });
  chips.forEach((chip) => {
    chip.addEventListener("click", () => ask(chip.getAttribute("data-q")));
  });

  // ---------- Inline badges + intro popup ----------
  // Usage on your site: add a small element anywhere in your page content:
  //   <span class="aw-badge" data-question="What does 'spread' mean?" data-intro="Want a quick explanation of spread?">
  //     <svg>...</svg> Ask
  //   </span>
  // On tap, a short intro message appears first; tapping "Explain it" opens
  // the full chat and asks the question automatically.

  const introPopup = document.getElementById("aw-intro-popup");
  const introText = introPopup.querySelector(".aw-intro-text");
  const introStartBtn = introPopup.querySelector(".aw-intro-start");
  const introDismissBtn = introPopup.querySelector(".aw-intro-dismiss");
  let pendingQuestion = null;

  function positionPopupNear(el) {
    const rect = el.getBoundingClientRect();
    const popupWidth = 260;
    let left = rect.left + window.scrollX;
    // keep popup on-screen horizontally
    if (left + popupWidth > window.innerWidth - 12) {
      left = window.innerWidth - popupWidth - 12;
    }
    introPopup.style.top = rect.bottom + window.scrollY + 8 + "px";
    introPopup.style.left = Math.max(12, left) + "px";
  }

  function openIntro(el) {
    const question = el.getAttribute("data-question") || "";
    const intro =
      el.getAttribute("data-intro") ||
      "Want me to explain this in plain language?";
    pendingQuestion = question;
    introText.textContent = intro;
    positionPopupNear(el);
    introPopup.classList.add("aw-visible");
  }

  function closeIntro() {
    introPopup.classList.remove("aw-visible");
    pendingQuestion = null;
  }

  introStartBtn.addEventListener("click", () => {
    const question = pendingQuestion;
    closeIntro();
    if (!opened) toggle();
    if (question) ask(question);
  });

  introDismissBtn.addEventListener("click", closeIntro);

  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".aw-badge");
    if (badge) {
      e.stopPropagation();
      openIntro(badge);
      return;
    }
    if (!e.target.closest("#aw-intro-popup")) {
      closeIntro();
    }
  });

  window.addEventListener("resize", () => {
    if (introPopup.classList.contains("aw-visible")) closeIntro();
  });
})();
