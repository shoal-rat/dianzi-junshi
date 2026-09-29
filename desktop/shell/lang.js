// 非中文系统显示英文
if (!/^zh\b/i.test(navigator.language)) {
  document.documentElement.lang = "en";
  document.title = "Junshi";
  document.getElementById("name").textContent = "Junshi";
  document.getElementById("wait").textContent = "Grinding the ink — the first launch takes a few seconds…";
}
