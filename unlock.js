/* EDAIC Antigravity MCQ — web build loader.
 * Downloads data.enc, decrypts it in the browser (PBKDF2-SHA256 → AES-256-GCM, gzip inside)
 * and starts the app via window.FRCA_BOOT(data). The password never leaves the device.
 */
(function () {
  "use strict";

  var CFG = window.EDAIC_WEB || { dataUrl: "data.enc", version: "dev" };
  var KEY_STORE = "edaic-mcq-key-v1";
  var MAGIC = "EDC1";

  var lock = document.getElementById("lockScreen");
  var form = document.getElementById("lockForm");
  var pw = document.getElementById("lockPw");
  var remember = document.getElementById("lockRemember");
  var btn = document.getElementById("lockBtn");
  var msg = document.getElementById("lockMsg");
  var err = document.getElementById("lockErr");

  var blob = null; // parsed data.enc

  function setMsg(t) { msg.textContent = t; }
  function setErr(t) { err.textContent = t || ""; }
  function busy(on, label) {
    btn.disabled = on;
    pw.disabled = on;
    btn.textContent = on ? (label || "Расшифровка…") : "Открыть";
  }

  function b64encode(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64decode(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function parse(buf) {
    var u8 = new Uint8Array(buf);
    var magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== MAGIC) throw new Error("bad file");
    var iters = new DataView(buf).getUint32(4, false);
    return { iters: iters, salt: u8.slice(8, 24), iv: u8.slice(24, 36), ct: u8.slice(36) };
  }

  function deriveKey(password) {
    var enc = new TextEncoder().encode(password);
    return crypto.subtle.importKey("raw", enc, "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: blob.salt, iterations: blob.iters, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    });
  }

  function decrypt(key) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.ct).then(function (plain) {
      var stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text();
    }).then(function (text) { return JSON.parse(text); });
  }

  function open(payload) {
    var data = payload.data;
    var figs = payload.figures || {};
    data.questions.forEach(function (q) {
      q.figures.forEach(function (f) {
        if (figs[f.src]) {
          f.src = URL.createObjectURL(new Blob([b64decode(figs[f.src])], { type: "image/png" }));
        }
      });
    });
    window.FRCA_DATA = data;
    window.FRCA_BOOT(data);
    lock.hidden = true;
    var forget = document.getElementById("btnForgetKey");
    if (forget) {
      forget.hidden = false;
      forget.addEventListener("click", function () {
        if (!confirm("Забыть пароль на этом устройстве? Прогресс сохранится, но при следующем запуске нужно будет ввести пароль.")) return;
        try { localStorage.removeItem(KEY_STORE); } catch (e) {}
        location.reload();
      });
    }
  }

  function tryStoredKey() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_STORE); } catch (e) {}
    if (!raw) return Promise.resolve(false);
    return crypto.subtle.importKey("raw", b64decode(raw), { name: "AES-GCM" }, false, ["decrypt"])
      .then(decrypt)
      .then(function (payload) { open(payload); return true; })
      .catch(function () {
        try { localStorage.removeItem(KEY_STORE); } catch (e) {}
        return false;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!blob || !pw.value) return;
    setErr("");
    busy(true);
    var key;
    deriveKey(pw.value)
      .then(function (k) { key = k; return decrypt(k); })
      .then(function (payload) {
        if (remember.checked) {
          return crypto.subtle.exportKey("raw", key).then(function (raw) {
            try { localStorage.setItem(KEY_STORE, b64encode(raw)); } catch (e2) {}
            return payload;
          });
        }
        return payload;
      })
      .then(function (payload) { pw.value = ""; open(payload); })
      .catch(function () {
        busy(false);
        setErr("Неверный пароль");
        pw.select();
      });
  });

  function start() {
    if (!window.crypto || !crypto.subtle) {
      setMsg("Нужно открыть сайт по HTTPS — в этом режиме браузер не даёт расшифровать данные.");
      busy(true, "Недоступно");
      return;
    }
    if (typeof DecompressionStream === "undefined") {
      setMsg("Браузер устарел: нужен Safari из iOS 16.4 или новее.");
      busy(true, "Недоступно");
      return;
    }
    busy(true, "Загрузка…");
    setMsg("Загрузка данных…");
    fetch(CFG.dataUrl + "?v=" + encodeURIComponent(CFG.version))
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        blob = parse(buf);
        return tryStoredKey();
      })
      .then(function (opened) {
        if (opened) return;
        setMsg("Введите пароль, чтобы открыть банк вопросов.");
        busy(false);
        setTimeout(function () { pw.focus(); }, 50);
      })
      .catch(function (e) {
        setMsg("Не удалось загрузить данные (" + (e && e.message ? e.message : e) + "). Проверьте интернет и обновите страницу.");
        busy(true, "Ошибка");
      });
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    // a new version was deployed: reload right away if the app is not in use yet
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController || reloaded || lock.hidden) return;
      reloaded = true;
      location.reload();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) { reg.update(); }).catch(function () {});
    });
  }

  start();
})();
