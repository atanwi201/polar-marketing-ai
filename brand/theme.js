/* Polar Marketing theme switch: light | dark | system. Persists the explicit choice in localStorage ("polar-theme").
   Load in <head> (blocking, before paint). Sets <html data-theme="light|dark"> and <html data-theme-pref="light|dark|system">.
   API: PolarTheme.get() -> pref, PolarTheme.set(pref), PolarTheme.mount(el) renders a 3-way selector into el. */
(function () {
  var KEY = "polar-theme", root = document.documentElement, mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function read() { try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch (e) { return "system"; } }
  function apply(pref) {
    var eff = pref === "system" ? (mq && mq.matches ? "dark" : "light") : pref;
    root.setAttribute("data-theme", eff); root.setAttribute("data-theme-pref", pref);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", eff === "dark" ? "#0a0a0a" : "#d7ff64");
    try { window.dispatchEvent(new CustomEvent("polar-theme", { detail: { pref: pref, theme: eff } })); } catch (e) {}
  }
  function set(pref) { try { if (pref === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch (e) {} apply(pref); }
  var LABELS = { en: { light: "Light", dark: "Dark", system: "System", group: "Theme" }, es: { light: "Claro", dark: "Oscuro", system: "Sistema", group: "Tema" } };
  function mount(el, lang) {
    var L = LABELS[(lang || root.lang || "en").slice(0, 2)] || LABELS.en;
    el.classList.add("pm-theme"); el.setAttribute("role", "radiogroup"); el.setAttribute("aria-label", L.group);
    function draw() {
      var cur = read(); el.innerHTML = "";
      ["light", "dark", "system"].forEach(function (p) {
        var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(cur === p)); b.textContent = L[p];
        b.onclick = function () { set(p); draw(); }; el.appendChild(b);
      });
    }
    draw();
  }
  apply(read());
  var onChange = function () { if (read() === "system") apply("system"); };
  if (mq) { if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange); }
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });
  window.PolarTheme = { get: read, set: set, mount: mount };
})();
