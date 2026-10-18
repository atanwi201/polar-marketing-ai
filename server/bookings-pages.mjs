// Public reservation pages: the booking form (/book/<code>) and the manage/cancel page (/booking/<token>).
// Self-contained HTML strings on the Crier design system, same approach as loyalty-pages.mjs.
// The interactive part is one client function (`app`) stringified into the page; the server only renders
// the shell (business header, notice) and hands the page its data as escaped JSON.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// JSON safe inside <script>
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const safeFile = (f) => (f && /^[\w.\-]+$/.test(f) ? f : "");
const LANGS = ["es", "en"];

const STR = {
  es: {
    book: "Reservar", bookTable: "Reserva una mesa", bookRoom: "Reserva tu habitación",
    party: "Número de personas", whenH: "Cuándo", people1: "persona", peopleN: "personas", date: "Fecha", time: "Hora", pickTime: "Elige una hora",
    noSlots: "No hay horas libres ese día. Prueba con otra fecha.", loading: "Buscando disponibilidad…",
    checkIn: "Entrada", checkOut: "Salida", guests: "Huéspedes", guest1: "huésped", guestN: "huéspedes", night1: "noche", nightN: "noches",
    rooms: "Habitaciones disponibles", noRooms: "No hay habitaciones para esas fechas. Prueba con otras.", perNight: "por noche", total: "total", upTo: "hasta",
    left: "quedan", soldOut: "Completo", choose: "Elegir", chosen: "Elegida", pickDates: "Elige las fechas y el número de huéspedes.",
    details: "Tus datos", name: "Nombre", email: "Correo electrónico", phone: "Teléfono", optional: "(opcional)", notes: "Comentarios", notesHint: "Alergias, celebración, hora de llegada…",
    emailNote: "Usaremos tu correo solo para la confirmación de esta reserva.",
    submit: "Solicitar reserva", submitConfirm: "Confirmar reserva", sending: "Enviando…",
    errName: "Escribe tu nombre.", errEmail: "Escribe un correo válido para recibir la confirmación.", errSlot: "Elige una hora.", errRoom: "Elige una habitación.", errDate: "Elige una fecha.", errDates: "La salida debe ser después de la entrada.",
    errNet: "No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.", errGeneric: "Algo ha ido mal. Inténtalo de nuevo.",
    taken: "Esa opción se acaba de ocupar. Hemos actualizado la disponibilidad, elige otra.",
    closedTitle: "Reservas online no disponibles", closedText: "Ahora mismo no se pueden hacer reservas online. Por favor, llama al local.", call: "Llamar",
    okPending: "Solicitud recibida", okConfirmed: "Reserva confirmada", okPendingText: "El local la revisará y te escribirá a %s para confirmarla.", okConfirmedText: "Te hemos enviado la confirmación a %s.",
    manage: "Ver o cancelar mi reserva", summary: "Resumen", another: "Hacer otra reserva",
    status: "Estado", s_pending: "Pendiente de confirmar", s_confirmed: "Confirmada", s_cancelled: "Cancelada", s_no_show: "No presentado", s_completed: "Completada",
    yourBooking: "Tu reserva", cancel: "Cancelar reserva", cancelAsk: "¿Seguro que quieres cancelar esta reserva?", cancelYes: "Sí, cancelar", cancelNo: "No, mantenerla", cancelling: "Cancelando…",
    cancelledOk: "Reserva cancelada.", cantCancel: "Esta reserva ya no se puede cancelar online. Si necesitas cambiarla, contacta con el local.", room: "Habitación", at: "a las", of: "de", lang: "Idioma",
    reference: "Referencia", nameL: "Nombre", emailL: "Correo", phoneL: "Teléfono", notesL: "Comentarios", guestsL: "Huéspedes", partyL: "Personas", dateL: "Fecha", timeL: "Hora", nightsL: "Noches", stay: "Estancia",
  },
  en: {
    book: "Book", bookTable: "Book a table", bookRoom: "Book your room",
    party: "Party size", whenH: "When", people1: "person", peopleN: "people", date: "Date", time: "Time", pickTime: "Pick a time",
    noSlots: "No free times on that day. Try another date.", loading: "Checking availability…",
    checkIn: "Check-in", checkOut: "Check-out", guests: "Guests", guest1: "guest", guestN: "guests", night1: "night", nightN: "nights",
    rooms: "Available rooms", noRooms: "No rooms for those dates. Try different ones.", perNight: "per night", total: "total", upTo: "up to",
    left: "left", soldOut: "Full", choose: "Choose", chosen: "Selected", pickDates: "Choose your dates and number of guests.",
    details: "Your details", name: "Name", email: "Email", phone: "Phone", optional: "(optional)", notes: "Notes", notesHint: "Allergies, celebration, arrival time…",
    emailNote: "We use your email only to send the confirmation for this booking.",
    submit: "Request booking", submitConfirm: "Confirm booking", sending: "Sending…",
    errName: "Please enter your name.", errEmail: "Please enter a valid email so we can send your confirmation.", errSlot: "Please pick a time.", errRoom: "Please choose a room.", errDate: "Please choose a date.", errDates: "Check-out must be after check-in.",
    errNet: "We couldn't reach the server. Check your connection and try again.", errGeneric: "Something went wrong. Please try again.",
    taken: "That option was just taken. We've refreshed availability, please choose another.",
    closedTitle: "Online booking is unavailable", closedText: "Online bookings aren't open right now. Please call us instead.", call: "Call",
    okPending: "Request received", okConfirmed: "Booking confirmed", okPendingText: "The venue will review it and email %s to confirm.", okConfirmedText: "We've sent your confirmation to %s.",
    manage: "View or cancel my booking", summary: "Summary", another: "Make another booking",
    status: "Status", s_pending: "Awaiting confirmation", s_confirmed: "Confirmed", s_cancelled: "Cancelled", s_no_show: "No-show", s_completed: "Completed",
    yourBooking: "Your booking", cancel: "Cancel booking", cancelAsk: "Are you sure you want to cancel this booking?", cancelYes: "Yes, cancel it", cancelNo: "No, keep it", cancelling: "Cancelling…",
    cancelledOk: "Booking cancelled.", cantCancel: "This booking can no longer be cancelled online. To change it, please contact the venue.", room: "Room", at: "at", of: "of", lang: "Language",
    reference: "Reference", nameL: "Name", emailL: "Email", phoneL: "Phone", notesL: "Notes", guestsL: "Guests", partyL: "Party", dateL: "Date", timeL: "Time", nightsL: "Nights", stay: "Stay",
  },
};

// ---- Client app: stringified into the page, so it must not reference anything outside itself ----
function app(D) {
  var T = D.strings, info = D.info, $ = function (id) { return document.getElementById(id); };
  var lang = D.lang, S = {}, token = "";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var t = function (k) { return (T[lang] && T[lang][k]) || T.en[k] || k; };
  var plural = function (n, one, many) { return n + " " + t(n === 1 ? one : many); };
  var fmtDate = function (d) { try { return new Date(d + "T00:00:00Z").toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); } catch (e) { return d; } };
  var addDays = function (d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10); };
  var nights = function (a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); };
  var money = function (n) { try { return new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch (e) { return n + " EUR"; } };
  var req = function (url, opt) {
    return fetch(url, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  };
  var isTable = info.kind === "table";
  var qs = function (o) { return Object.keys(o).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&"); };
  var setErr = function (m) { var e = $("err"); e.textContent = m || ""; e.classList.toggle("on", !!m); if (m) e.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  var fieldErr = function (id, m) { var f = $(id).closest(".cr-field"); f.classList.toggle("cr-field--error", !!m); var h = f.querySelector(".cr-hint.fe"); if (h) h.textContent = m || ""; $(id).setAttribute("aria-invalid", m ? "true" : "false"); };

  function setLang(l) {
    lang = l; document.documentElement.lang = l;
    try { localStorage.setItem("cr-book-lang", l); } catch (e) {}
    var btns = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", btns[i].dataset.lang === l ? "true" : "false");
    var els = document.querySelectorAll("[data-t]");
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].dataset.t);
    var ph = document.querySelectorAll("[data-tph]");
    for (i = 0; i < ph.length; i++) ph[i].setAttribute("placeholder", t(ph[i].dataset.tph));
    if (D.mode === "manage") renderManage(); else { renderParty(); renderResult(); if (S.done) renderDone(); }
  }
  function bindLang() {
    var btns = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function (e) { setLang(e.currentTarget.dataset.lang); });
  }

  // ---------- booking form ----------
  function renderParty() {
    var sel = $("party"), h = "";
    if (sel) {
      var cur = sel.value || S.party || "";
      var lo = info.table.minParty, hi = info.table.maxParty;
      for (var n = lo; n <= hi; n++) h += '<option value="' + n + '">' + esc(plural(n, "people1", "peopleN")) + "</option>";
      sel.innerHTML = h; sel.value = cur || String(Math.min(Math.max(2, lo), hi));
      S.party = sel.value;
    }
    var gs = $("guests");
    if (gs) {
      var gc = gs.value || "2", mx = 1; (info.room.roomTypes || []).forEach(function (r) { mx = Math.max(mx, r.maxGuests); });
      h = ""; for (var g = 1; g <= mx; g++) h += '<option value="' + g + '">' + esc(plural(g, "guest1", "guestN")) + "</option>";
      gs.innerHTML = h; gs.value = String(Math.min(Number(gc), mx));
    }
  }

  function loadAvail() {
    S.pick = null; setErr(""); updateSubmit();
    var box = $("result");
    if (isTable) {
      var d = $("date").value, p = $("party").value;
      if (!d) { S.res = null; S.state = "idle"; return renderResult(); }
      S.state = "loading"; renderResult();
      var my = (S.seq = (S.seq || 0) + 1);
      return req("/api/book/" + encodeURIComponent(info.code) + "/availability?" + qs({ date: d, party: p })).then(function (x) {
        if (my !== S.seq) return;
        if (!x.ok) { S.state = "error"; S.msg = x.d.error || t("errGeneric"); } else { S.state = "ok"; S.res = x.d.slots || []; }
        renderResult();
      }, function () { if (my !== S.seq) return; S.state = "error"; S.msg = t("errNet"); renderResult(); });
    }
    var ci = $("checkIn").value, co = $("checkOut").value, g = $("guests").value;
    if (!ci || !co) { S.res = null; S.state = "idle"; return renderResult(); }
    if (nights(ci, co) < 1) { S.state = "error"; S.msg = t("errDates"); return renderResult(); }
    S.state = "loading"; renderResult();
    var my2 = (S.seq = (S.seq || 0) + 1);
    return req("/api/book/" + encodeURIComponent(info.code) + "/availability?" + qs({ checkIn: ci, checkOut: co, guests: g })).then(function (x) {
      if (my2 !== S.seq) return;
      if (!x.ok) { S.state = "error"; S.msg = x.d.error || t("errGeneric"); } else { S.state = "ok"; S.res = x.d.rooms || []; }
      renderResult();
    }, function () { if (my2 !== S.seq) return; S.state = "error"; S.msg = t("errNet"); renderResult(); });
  }

  function renderResult() {
    var box = $("result"); if (!box) return;
    var h = "";
    if (S.state === "loading") h = '<p class="muted" role="status">' + esc(t("loading")) + "</p>";
    else if (S.state === "error") h = '<p class="note bad" role="status">' + esc(S.msg) + "</p>";
    else if (S.state !== "ok") h = '<p class="muted">' + esc(isTable ? t("errDate") : t("pickDates")) + "</p>";
    else if (isTable) {
      var any = S.res.some(function (s) { return s.available; });
      if (!S.res.length || !any) h = '<p class="note" role="status">' + esc(t("noSlots")) + "</p>";
      if (S.res.length) {
        h += '<div class="slots" role="group" aria-label="' + esc(t("pickTime")) + '">' + S.res.map(function (s) {
          var on = S.pick === s.time;
          return '<button type="button" class="slot" data-time="' + esc(s.time) + '" aria-pressed="' + on + '"' + (s.available ? "" : " disabled") + ">" + esc(s.time) + "</button>";
        }).join("") + "</div>";
      }
    } else {
      var n = nights($("checkIn").value, $("checkOut").value);
      if (!S.res.length || !S.res.some(function (r) { return r.available; })) h = '<p class="note" role="status">' + esc(t("noRooms")) + "</p>";
      h += '<div class="rooms">' + S.res.map(function (r) {
        var on = S.pick === r.id, nn = r.nights || n;
        return '<div class="room cr-card' + (on ? " on" : "") + (r.available ? "" : " off") + '"><div class="room-top"><b>' + esc(r.name) + '</b><span class="muted sm">' + esc(t("upTo") + " " + plural(r.maxGuests, "guest1", "guestN")) + "</span></div>" +
          (r.priceEur > 0 ? '<div class="room-price"><b>' + esc(money(r.priceEur)) + '</b> <span class="muted sm">' + esc(t("perNight")) + "</span>" + (nn > 1 ? ' <span class="muted sm">&middot; ' + esc(money(r.priceEur * nn) + " " + t("total")) + "</span>" : "") + "</div>" : "") +
          '<div class="room-foot">' + (r.available ? '<span class="muted sm">' + (r.free != null && r.free <= 3 ? esc(r.free + " " + t("left")) : "") + "</span>" : '<span class="cr-badge cr-badge--bad">' + esc(t("soldOut")) + "</span>") +
          '<button type="button" class="cr-btn ' + (on ? "cr-btn--primary" : "cr-btn--outline") + '" data-room="' + esc(r.id) + '" aria-pressed="' + on + '"' + (r.available ? "" : " disabled") + ">" + esc(on ? t("chosen") : t("choose")) + "</button></div></div>";
      }).join("") + "</div>";
    }
    box.innerHTML = h;
  }

  function updateSubmit() { var b = $("goTxt"); if (b) b.textContent = t(info.autoConfirm ? "submitConfirm" : "submit"); }

  function validate() {
    var ok = true, first = null;
    var bad = function (id, m) { fieldErr(id, m); if (m) { ok = false; first = first || id; } };
    bad("name", $("name").value.trim() ? "" : t("errName"));
    bad("email", /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test($("email").value.trim()) ? "" : t("errEmail"));
    if (isTable) { if (!$("date").value) { setErr(t("errDate")); return false; } if (!S.pick) { setErr(t("errSlot")); return false; } }
    else { if (!$("checkIn").value || !$("checkOut").value) { setErr(t("errDate")); return false; } if (!S.pick) { setErr(t("errRoom")); return false; } }
    if (first) { $(first).focus(); setErr(""); }
    return ok;
  }

  function submit(e) {
    e.preventDefault(); setErr("");
    if (!validate()) return;
    var body = { name: $("name").value.trim(), email: $("email").value.trim(), phone: $("phone").value.trim(), notes: $("notes").value.trim(), lang: lang, source: D.source };
    if (isTable) { body.date = $("date").value; body.time = S.pick; body.party = Number($("party").value); }
    else { body.checkIn = $("checkIn").value; body.checkOut = $("checkOut").value; body.guests = Number($("guests").value); body.roomTypeId = S.pick; }
    var go = $("go"); go.disabled = true; go.classList.add("busy"); $("goTxt").textContent = t("sending");
    req("/api/book/" + encodeURIComponent(info.code), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (x) {
      go.disabled = false; go.classList.remove("busy"); updateSubmit();
      if (x.ok && x.d.booking) { S.done = x.d; renderDone(); return; }
      if (x.status === 409 && x.d.code === "taken") { setErr(t("taken")); return loadAvail().then(function () { setErr(t("taken")); }); }
      if (x.d.code === "email") { fieldErr("email", t("errEmail")); $("email").focus(); return; }
      if (x.d.code === "name") { fieldErr("name", t("errName")); $("name").focus(); return; }
      setErr(x.d.error || t("errGeneric"));
    }, function () { go.disabled = false; go.classList.remove("busy"); updateSubmit(); setErr(t("errNet")); });
  }

  function summaryRows(b) {
    var r = [];
    if (b.kind === "table") { r.push([t("dateL"), fmtDate(b.date)], [t("timeL"), b.time], [t("partyL"), plural(b.party, "people1", "peopleN")]); }
    else { r.push([t("checkIn"), fmtDate(b.checkIn) + (info.room && info.room.checkIn ? " · " + info.room.checkIn : "")], [t("checkOut"), fmtDate(b.checkOut) + (info.room && info.room.checkOut ? " · " + info.room.checkOut : "")], [t("nightsL"), String(b.nights || nights(b.checkIn, b.checkOut))], [t("room"), b.roomName || ""], [t("guestsL"), plural(b.guests, "guest1", "guestN")]); }
    r.push([t("nameL"), b.name], [t("emailL"), b.email]);
    if (b.phone) r.push([t("phoneL"), b.phone]);
    if (b.notes) r.push([t("notesL"), b.notes]);
    return '<dl class="sum">' + r.map(function (x) { return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") + "</dl>";
  }
  var BADGE = { pending: "warn", confirmed: "good", cancelled: "bad", no_show: "bad", completed: "info" };
  var badge = function (s) { return '<span class="cr-badge cr-badge--' + (BADGE[s] || "info") + '">' + esc(t("s_" + s)) + "</span>"; };

  function renderDone() {
    var b = S.done.booking, conf = b.status === "confirmed";
    $("flow").hidden = true; var d = $("done"); d.hidden = false;
    d.innerHTML = '<div class="ok-ic" aria-hidden="true">&#10003;</div><h2 tabindex="-1" id="doneH">' + esc(t(conf ? "okConfirmed" : "okPending")) + "</h2><p>" + esc(t(conf ? "okConfirmedText" : "okPendingText").replace("%s", b.email)) + "</p>" +
      '<div class="cr-card sumcard"><div class="sumhead"><b>' + esc(t("summary")) + "</b>" + badge(b.status) + "</div>" + summaryRows(b) + "</div>" +
      '<a class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" href="' + esc(S.done.manageUrl) + '">' + esc(t("manage")) + "</a>";
    $("doneH").focus(); window.scrollTo(0, 0);
  }

  // ---------- manage page ----------
  function renderManage() {
    var b = D.booking, st = S.status || b.status;
    var h = '<div class="cr-card sumcard"><div class="sumhead"><b>' + esc(t("yourBooking")) + '</b><span id="badge">' + badge(st) + "</span></div>" + summaryRows(b) + "</div>";
    $("manageBody").innerHTML = h;
    var box = $("cancelBox"), live = D.cancellable && st !== "cancelled";
    if (S.msg) { box.innerHTML = '<p class="note ' + (S.msgBad ? "bad" : "good") + '" role="status">' + esc(S.msg) + "</p>"; return; }
    if (!live) { box.innerHTML = st === "cancelled" ? "" : '<p class="muted sm">' + esc(t("cantCancel")) + "</p>"; return; }
    if (S.asking) {
      box.innerHTML = '<div class="cr-card ask" role="alertdialog" aria-labelledby="askT"><p id="askT"><b>' + esc(t("cancelAsk")) + '</b></p><div class="ask-row"><button type="button" class="cr-btn cr-btn--outline" id="no">' + esc(t("cancelNo")) + '</button><button type="button" class="cr-btn danger" id="yes">' + esc(t("cancelYes")) + "</button></div></div>";
      $("no").addEventListener("click", function () { S.asking = false; renderManage(); $("cancelBtn").focus(); });
      $("yes").addEventListener("click", doCancel); $("no").focus(); return;
    }
    box.innerHTML = '<button type="button" class="cr-btn cr-btn--outline cr-btn--block danger-o" id="cancelBtn">' + esc(t("cancel")) + "</button>";
    $("cancelBtn").addEventListener("click", function () { S.asking = true; renderManage(); });
  }
  function doCancel() {
    var y = $("yes"); y.disabled = true; y.textContent = t("cancelling");
    var tok = location.pathname.split("/").filter(Boolean).pop();
    req("/api/booking/" + encodeURIComponent(tok) + "/cancel", { method: "POST" }).then(function (x) {
      S.asking = false;
      if (x.ok) { S.status = "cancelled"; D.cancellable = false; S.msg = t("cancelledOk"); S.msgBad = false; } else { S.msg = x.d.error || t("errGeneric"); S.msgBad = true; }
      renderManage();
    }, function () { S.asking = false; S.msg = t("errNet"); S.msgBad = true; renderManage(); });
  }

  // ---------- init ----------
  bindLang();
  if (D.mode === "manage") { setLang(lang); return; }
  if (info.enabled) {
    var today = info.today || new Date().toISOString().slice(0, 10), max = addDays(today, Math.max(1, info.advanceDays || 60));
    if (isTable) {
      var dt = $("date"); dt.min = today; dt.max = max;
      dt.addEventListener("change", loadAvail); $("party").addEventListener("change", function () { S.party = this.value; loadAvail(); });
    } else {
      var ci = $("checkIn"), co = $("checkOut"); ci.min = today; ci.max = max; co.min = addDays(today, 1); co.max = addDays(max, (info.room.maxNights || 14));
      ci.addEventListener("change", function () {
        var minOut = addDays(ci.value || today, info.room.minNights || 1); co.min = minOut;
        if (!co.value || co.value < minOut) co.value = minOut;
        loadAvail();
      });
      co.addEventListener("change", loadAvail); $("guests").addEventListener("change", loadAvail);
    }
    $("result").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || b.disabled) return;
      S.pick = b.dataset.time || b.dataset.room || null; renderResult();
      if (S.pick) $("details").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    $("f").addEventListener("submit", submit);
    var inputs = ["name", "email"];
    inputs.forEach(function (id) { $(id).addEventListener("input", function () { fieldErr(id, ""); }); });
    $("another") && $("another").addEventListener("click", function () { location.reload(); });
    renderParty();
  }
  setLang(lang);
  if (info.enabled) { S.state = "idle"; renderResult(); }
}

const APP_SRC = `(${app.toString()})`;

const HEAD = (title) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow">
<script>
(function(){try{var m=matchMedia("(prefers-color-scheme: dark)"),r=document.documentElement,f=function(){r.dataset.theme=m.matches?"dark":"light"};f();m.addEventListener("change",f)}catch(e){}})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Figtree:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/logo/favicon.ico" sizes="48x48">
<link rel="stylesheet" href="/brand/tokens.css">
<link rel="stylesheet" href="/brand/components.css">`;

const CSS = `
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh}
[hidden]{display:none!important}
.wrap{max-width:560px;margin:0 auto;padding:max(var(--space-4),env(safe-area-inset-top)) max(var(--space-4),env(safe-area-inset-right)) max(var(--space-7),env(safe-area-inset-bottom)) max(var(--space-4),env(safe-area-inset-left))}
.muted{color:var(--ink-2)}.sm{font-size:13px;line-height:18px}
.top{display:flex;align-items:center;gap:var(--space-3);margin:var(--space-2) 0 var(--space-5)}
.biz{display:flex;align-items:center;gap:var(--space-3);flex:1;min-width:0}
.biz-logo{width:48px;height:48px;border-radius:14px;object-fit:cover;flex:none;background:var(--surface-2)}
.biz-mono{display:grid;place-items:center;background:var(--brand);color:var(--on-brand);font:800 22px var(--font-display)}
.biz-name{font:700 18px/22px var(--font-display);overflow-wrap:anywhere}
.biz-town{color:var(--ink-2);font-size:14px;line-height:18px}
.langs{display:flex;gap:2px;padding:3px;border-radius:var(--radius-pill);background:var(--surface-2);flex:none}
.langs button{min-width:44px;min-height:40px;border:0;border-radius:var(--radius-pill);background:transparent;color:var(--ink-2);font:700 14px var(--font-sans);cursor:pointer}
.langs button[aria-pressed=true]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-card)}
h1{font:700 clamp(26px,7.5vw,34px)/1.1 var(--font-display);letter-spacing:-.015em;margin:0 0 var(--space-4)}
h2{font:700 19px/24px var(--font-display);margin:0 0 var(--space-3)}
.notice{margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--brand-soft);color:var(--brand-ink);font:500 15px/22px var(--font-sans);overflow-wrap:anywhere}
.err{display:none;margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--bad-soft);color:var(--bad);font:600 15px/22px var(--font-sans)}
.err.on{display:block}
.note{margin:0;padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--warn-soft);color:var(--warn);font:600 15px/22px var(--font-sans)}
.note.bad{background:var(--bad-soft);color:var(--bad)}.note.good{background:var(--good-soft);color:var(--good)}
.step{padding:var(--space-5) var(--space-4);margin-bottom:var(--space-4)}
.step>h2{display:flex;align-items:center;gap:var(--space-3)}
.step>h2 i{font:700 14px/1 var(--font-sans);font-style:normal;width:28px;height:28px;border-radius:50%;background:var(--brand);color:var(--on-brand);display:grid;place-items:center;flex:none}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-3)}.grid2>*{min-width:0}
.f{margin-bottom:var(--space-4)}.f:last-child{margin-bottom:0}
select.cr-input{appearance:none;-webkit-appearance:none;padding-right:44px;background-image:linear-gradient(45deg,transparent 50%,var(--ink-2) 50%),linear-gradient(135deg,var(--ink-2) 50%,transparent 50%);background-position:calc(100% - 22px) 50%,calc(100% - 16px) 50%;background-size:6px 6px;background-repeat:no-repeat}
input[type=date].cr-input{min-width:0;max-width:100%;padding-inline:var(--space-3);-webkit-appearance:none;appearance:none}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:var(--space-2)}
.slot{min-height:48px;border-radius:var(--radius-pill);border:2px solid var(--line-strong);background:var(--surface);color:var(--ink);font:700 16px var(--font-sans);font-variant-numeric:tabular-nums;cursor:pointer}
.slot[aria-pressed=true]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.slot:disabled{opacity:.4;text-decoration:line-through;cursor:not-allowed;background:var(--surface-2);border-color:transparent}
.slot:focus-visible,.langs button:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
.rooms{display:grid;gap:var(--space-3);margin-top:var(--space-3)}
.room{padding:var(--space-4);border:2px solid transparent}.room.on{border-color:var(--brand)}.room.off{opacity:.6}
.room-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.room-top b{font:700 17px/22px var(--font-display)}
.room-price{margin-top:var(--space-1)}.room-price b{font-size:18px}
.room-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:var(--space-3)}
.room-foot .cr-btn{min-width:112px}
#result{margin-top:var(--space-4)}#result>.note{margin-bottom:var(--space-3)}
.cr-hint.fe:empty{display:none}
.spin{width:18px;height:18px;border:3px solid var(--on-brand);border-top-color:transparent;border-radius:50%;animation:sp .8s linear infinite;display:none}
.cr-btn.busy .spin{display:block}
@keyframes sp{to{transform:rotate(360deg)}}
.small{margin:var(--space-3) 0 0;color:var(--ink-2);font-size:13px;line-height:19px;text-align:center}
.closed{text-align:center;padding:var(--space-6) var(--space-4)}
.closed p{margin:0 0 var(--space-4);color:var(--ink-2)}
#done{text-align:center}
#done h2{font-size:26px;line-height:32px;margin:var(--space-3) 0 var(--space-2)}
#done>p{margin:0 0 var(--space-5);color:var(--ink-2);overflow-wrap:anywhere}
.ok-ic{width:64px;height:64px;border-radius:50%;background:var(--good-soft);color:var(--good);display:grid;place-items:center;font-size:32px;font-weight:800;margin:var(--space-4) auto 0}
.sumcard{text-align:left;padding:var(--space-4);margin-bottom:var(--space-4)}
.sumhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:var(--space-3);flex-wrap:wrap}
.sumhead b{font:700 17px var(--font-display)}
.sum{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0}
.sum dt{color:var(--ink-2);font-size:14px}.sum dd{margin:0;font-weight:600;overflow-wrap:anywhere;text-align:right}
a.cr-btn{text-decoration:none}
.danger{background:var(--bad);color:var(--surface);border-color:var(--bad)}
.danger-o{color:var(--bad);border-color:var(--bad)}
.ask{padding:var(--space-4);text-align:center}.ask p{margin:0 0 var(--space-4)}
.ask-row{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}
.foot{margin-top:var(--space-6);text-align:center;color:var(--ink-2);font-size:13px}
.foot a{color:inherit}
@media(prefers-reduced-motion:reduce){*{animation-duration:2s!important;transition:none!important}}
`;

function header(info, lang) {
  const b = info.business || {};
  const logo = safeFile(b.logoFile);
  const mark = logo ? `<img class="biz-logo" src="/media/${esc(logo)}" alt="">` : `<span class="biz-logo biz-mono" aria-hidden="true">${esc(((b.name || "").trim()[0] || "?").toUpperCase())}</span>`;
  const langs = (info.langs || []).filter((l) => LANGS.includes(l));
  const toggle = langs.length > 1 ? `<div class="langs" role="group" aria-label="${esc(STR[lang].lang)}">${langs.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}" lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>` : "";
  return `<header class="top"><div class="biz">${mark}<div style="min-width:0"><div class="biz-name">${esc(b.name)}</div>${b.town ? `<div class="biz-town">${esc(b.town)}</div>` : ""}</div></div>${toggle}</header>`;
}

function pickLang(info, wanted) {
  const langs = (info.langs || []).filter((l) => LANGS.includes(l));
  const allowed = langs.length ? langs : ["es"];
  const w = String(wanted || "").toLowerCase().slice(0, 2);
  return allowed.includes(w) ? w : allowed[0];
}

// Client-side language choice: ?lang wins, then the saved/browser language, limited to info.langs
const LANG_BOOT = (allowed, fixed) => `<script>
(function(){var A=${js(allowed)},F=${js(fixed)};var l=F;if(!l){try{l=localStorage.getItem("cr-book-lang")}catch(e){}}
if(!l||A.indexOf(l)<0){var n=((navigator.languages&&navigator.languages[0])||navigator.language||"").toLowerCase().slice(0,2);l=A.indexOf(n)>=0?n:A[0]}
window.__lang=l})();
</script>`;

export function bookPage({ info, baseUrl = "", lang = "", source = "link" }) {
  const b = info.business || {};
  const allowed = (info.langs || []).filter((l) => LANGS.includes(l));
  const al = allowed.length ? allowed : ["es"];
  const fixed = LANGS.includes(String(lang).toLowerCase()) && al.includes(String(lang).toLowerCase()) ? String(lang).toLowerCase() : "";
  const l0 = fixed || al[0];
  const isTable = info.kind === "table";
  const src = ["link", "website", "loyalty"].includes(source) ? source : "link";
  const T = STR[l0];
  const tx = (k) => `<span data-t="${k}">${esc(T[k])}</span>`;
  const phone = String(b.phone || "").replace(/[^\d+]/g, "");

  const when = isTable
    ? `<section class="step cr-card" aria-labelledby="h1"><h2 id="h1"><i>1</i>${tx("whenH")}</h2>
      <div class="grid2">
        <div class="cr-field"><label class="cr-label" for="party" data-t="party">${esc(T.party)}</label><select class="cr-input" id="party" name="party"></select></div>
        <div class="cr-field"><label class="cr-label" for="date" data-t="date">${esc(T.date)}</label><input class="cr-input" id="date" name="date" type="date" required></div>
      </div>
      <div id="result" aria-live="polite"></div></section>`
    : `<section class="step cr-card" aria-labelledby="h1"><h2 id="h1"><i>1</i>${tx("stay")}</h2>
      <div class="grid2">
        <div class="cr-field"><label class="cr-label" for="checkIn" data-t="checkIn">${esc(T.checkIn)}</label><input class="cr-input" id="checkIn" name="checkIn" type="date" required></div>
        <div class="cr-field"><label class="cr-label" for="checkOut" data-t="checkOut">${esc(T.checkOut)}</label><input class="cr-input" id="checkOut" name="checkOut" type="date" required></div>
      </div>
      <div class="cr-field" style="margin-top:var(--space-3)"><label class="cr-label" for="guests" data-t="guests">${esc(T.guests)}</label><select class="cr-input" id="guests" name="guests"></select></div>
      <div id="result" aria-live="polite"></div></section>`;

  const closed = `<section class="closed cr-card"><h2>${tx("closedTitle")}</h2><p>${tx("closedText")}</p>${phone ? `<a class="cr-btn cr-btn--primary cr-btn--lg" href="tel:${esc(phone)}"><span data-t="call">${esc(T.call)}</span>&nbsp;${esc(b.phone)}</a>` : ""}</section>`;

  const form = `
  <div id="flow">
  <form id="f" novalidate>
    <div id="err" class="err" role="alert"></div>
    ${when}
    <section class="step cr-card" id="details" aria-labelledby="h2"><h2 id="h2"><i>2</i>${tx("details")}</h2>
      <div class="f cr-field"><label class="cr-label" for="name" data-t="name">${esc(T.name)}</label><input class="cr-input" id="name" name="name" type="text" autocomplete="name" maxlength="80" required aria-describedby="name-e"><p class="cr-hint fe" id="name-e"></p></div>
      <div class="f cr-field"><label class="cr-label" for="email" data-t="email">${esc(T.email)}</label><input class="cr-input" id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required aria-required="true" aria-describedby="email-e email-n"><p class="cr-hint fe" id="email-e"></p><p class="cr-hint" id="email-n" data-t="emailNote">${esc(T.emailNote)}</p></div>
      <div class="f cr-field"><label class="cr-label" for="phone">${tx("phone")} <span class="muted" data-t="optional">${esc(T.optional)}</span></label><input class="cr-input" id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="40"></div>
      <div class="f cr-field"><label class="cr-label" for="notes">${tx("notes")} <span class="muted" data-t="optional">${esc(T.optional)}</span></label><textarea class="cr-input" id="notes" name="notes" rows="3" maxlength="300" data-tph="notesHint" placeholder="${esc(T.notesHint)}"></textarea></div>
      <button class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" id="go" type="submit"><span class="spin"></span><span id="goTxt">${esc(T[info.autoConfirm ? "submitConfirm" : "submit"])}</span></button>
    </section>
  </form>
  </div>
  <div id="done" hidden aria-live="polite"></div>`;

  const data = { mode: "book", info: { code: info.code, kind: info.kind, enabled: !!info.enabled, autoConfirm: !!info.autoConfirm, advanceDays: info.advanceDays, today: info.today, table: info.table, room: info.room, langs: al }, strings: STR, lang: l0, source: src };
  return `<!doctype html>
<html lang="${l0}" data-theme="light">
<head>
${HEAD(`${isTable ? STR[l0].bookTable : STR[l0].bookRoom} - ${b.name || ""}`)}
<style>${CSS}</style>
</head>
<body class="cr-root">
<div class="wrap">
  ${header(info, l0)}
  <h1 data-t="${isTable ? "bookTable" : "bookRoom"}">${esc(isTable ? T.bookTable : T.bookRoom)}</h1>
  ${info.notice ? `<p class="notice">${esc(info.notice)}</p>` : ""}
  ${info.enabled ? form : closed}
</div>
${LANG_BOOT(al, fixed)}
<script>
(function(){var D=${js(data)};D.lang=window.__lang||D.lang;${APP_SRC}(D)})();
</script>
</body>
</html>`;
}

export function managePage({ booking, info, baseUrl = "", cancellable = false }) {
  const b = info.business || {};
  const al = (info.langs || []).filter((l) => LANGS.includes(l));
  const langs = al.length ? al : ["es"];
  const pref = LANGS.includes(booking?.lang) && langs.includes(booking.lang) ? booking.lang : langs[0];
  const T = STR[pref];
  const view = {};
  for (const k of ["id", "kind", "status", "name", "email", "phone", "notes", "date", "time", "party", "checkIn", "checkOut", "guests", "roomName", "nights"]) view[k] = booking?.[k] ?? "";
  const data = { mode: "manage", info: { code: info.code, kind: info.kind, enabled: !!info.enabled, autoConfirm: !!info.autoConfirm, room: info.room ? { checkIn: info.room.checkIn, checkOut: info.room.checkOut } : undefined, langs }, strings: STR, lang: pref, booking: view, cancellable: !!cancellable };
  const phone = String(b.phone || "").replace(/[^\d+]/g, "");
  return `<!doctype html>
<html lang="${pref}" data-theme="light">
<head>
${HEAD(`${T.yourBooking} - ${b.name || ""}`)}
<style>${CSS}</style>
</head>
<body class="cr-root">
<div class="wrap">
  ${header({ ...info, langs }, pref)}
  <h1 data-t="yourBooking">${esc(T.yourBooking)}</h1>
  <div id="manageBody"></div>
  <div id="cancelBox" aria-live="polite" style="margin-top:var(--space-4)"></div>
  ${phone ? `<p class="small"><a href="tel:${esc(phone)}">${esc(b.phone)}</a></p>` : ""}
</div>
${LANG_BOOT(langs, "")}
<script>
(function(){var D=${js(data)};D.lang=window.__lang||D.lang;${APP_SRC}(D)})();
</script>
</body>
</html>`;
}
