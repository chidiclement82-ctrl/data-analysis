/* Ogarider — homepage: shows the homepage photo set on the admin page */
(function () {
  "use strict";

  // Homepage photo (set on the admin page). Shown once it has loaded, so the
  // top of the page never flashes an empty background.
  function showHeroPhoto(menu) {
    var src = menu.site && menu.site.image;
    if (!src) return;
    var hero = document.querySelector(".hero");
    var img = new Image();
    img.onload = function () {
      // Use the full address: a relative url() inside a CSS variable would be
      // resolved against the stylesheet's folder, not the page.
      hero.style.setProperty("--hero-photo", 'url("' + img.src + '")');
      hero.classList.add("has-photo");
    };
    img.src = src;
  }

  // XMLHttpRequest rather than fetch() so older phone browsers load it too.
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "menu.json?v=" + Date.now());
  xhr.onload = function () {
    try { if (xhr.status === 200) showHeroPhoto(JSON.parse(xhr.responseText)); } catch (_) { /* keep the plain background */ }
  };
  xhr.send();
})();
