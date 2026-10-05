// Scrape-resistant email: the address is never written out in the HTML.
// It is assembled only when a visitor clicks "Email me" or "Copy".
(function () {
  function address(el) {
    return el.getAttribute("data-user") + "@" + el.getAttribute("data-domain");
  }

  document.querySelectorAll("[data-email]").forEach(function (el) {
    el.addEventListener("click", function () {
      window.location.href = "mailto:" + address(el);
    });
  });

  document.querySelectorAll("[data-copy-email]").forEach(function (el) {
    el.addEventListener("click", function () {
      var note = document.getElementById(el.getAttribute("aria-describedby"));
      var done = function (msg) { if (note) note.textContent = msg; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(address(el)).then(
          function () { done("Copied to clipboard."); },
          function () { done("Copy failed, please type it from above."); }
        );
      } else {
        done("Copy is not supported here, please type it from above.");
      }
    });
  });
})();

// Click-to-enlarge for photos and figures: <a href="big.webp" data-lightbox><img ...></a>
// Without JavaScript the link simply opens the image.
(function () {
  var links = document.querySelectorAll("a[data-lightbox]");
  if (!links.length || typeof HTMLDialogElement !== "function") return;

  var dlg = document.createElement("dialog");
  dlg.className = "lightbox";
  dlg.setAttribute("aria-label", "Enlarged image");
  var close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  var img = document.createElement("img");
  var cap = document.createElement("p");
  dlg.appendChild(close);
  dlg.appendChild(img);
  dlg.appendChild(cap);
  document.body.appendChild(dlg);

  close.addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });

  links.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var thumb = a.querySelector("img");
      var fig = a.closest("figure");
      var fc = fig ? fig.querySelector("figcaption") : null;
      img.src = a.href;
      img.alt = thumb ? thumb.alt : "";
      cap.textContent = fc ? fc.textContent : "";
      dlg.showModal();
    });
  });
})();

// Blog: reading time, copy-link button, topic filter.
(function () {
  // Reading time for <li data-reading-time>, from the words in [data-post-body] (~220 words/min).
  var body = document.querySelector("[data-post-body]");
  var rt = document.querySelector("[data-reading-time]");
  if (body && rt) {
    var words = body.textContent.trim().split(/\s+/).length;
    rt.textContent = Math.max(1, Math.round(words / 220)) + " min read";
  }

  document.querySelectorAll("[data-copy-link]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var note = document.getElementById(btn.getAttribute("aria-describedby"));
      var done = function (msg) { if (note) note.textContent = msg; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href.split("#")[0]).then(
          function () { done("Link copied."); },
          function () { done("Copy failed, please copy the address bar."); }
        );
      } else {
        done("Please copy the address bar.");
      }
    });
  });

  // Topic filter: shown once the list has at least two real (not "coming soon") posts.
  var filter = document.querySelector(".topic-filter");
  var list = document.querySelector(".post-list");
  if (!filter || !list) return;
  var posts = Array.prototype.filter.call(list.children, function (li) { return li.hasAttribute("data-topics"); });
  if (posts.length < 2) return;
  filter.hidden = false;
  var buttons = filter.querySelectorAll("button[data-topic]");
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-topic");
      buttons.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
      Array.prototype.forEach.call(list.children, function (li) {
        var topics = (li.getAttribute("data-topics") || "").split(/\s+/);
        li.hidden = t !== "all" && (!li.hasAttribute("data-topics") || topics.indexOf(t) === -1);
      });
    });
  });
})();
