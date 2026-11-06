"use strict";
(() => {
  const form = document.getElementById("loginForm"),
    button = document.getElementById("loginBtn"),
    error = document.getElementById("loginError");
  document.getElementById("showPassword").addEventListener("click", () => {
    const input = document.getElementById("password"),
      show = input.type === "password",
      toggle = document.getElementById("showPassword");
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const username = document.getElementById("username").value.trim(),
      password = document.getElementById("password").value;
    if (!username || !password) return;
    error.hidden = true;
    button.disabled = true;
    button.querySelector("span").textContent = "正在登录…";
    form.setAttribute("aria-busy", "true");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw Error(
          `登录服务返回异常（HTTP ${response.status}），请稍后重试。`,
        );
      }
      if (!response.ok)
        throw Error(
          typeof data.detail === "string"
            ? data.detail
            : "登录失败，请检查账号和密码。",
        );
      location.assign("/");
    } catch (e) {
      error.textContent =
        e.name === "AbortError"
          ? "登录超时，请检查网络后重试。"
          : e instanceof TypeError
            ? "无法连接登录服务，请检查网络后重试。"
            : e.message;
      error.hidden = false;
    } finally {
      clearTimeout(timer);
      button.disabled = false;
      button.querySelector("span").textContent = "进入控制台";
      form.removeAttribute("aria-busy");
    }
  });
})();
