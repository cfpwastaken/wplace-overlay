(async () => {
  let s = document.createElement("script");
  s.src = URL.createObjectURL(await (await fetch("https://cfp.is-a.dev/wplace/enable.js", { cache: "no-cache" })).blob());
  document.body.appendChild(s);
})();