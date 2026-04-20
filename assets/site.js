const runtimeConfig = {
  turnstileSiteKey: "",
  contactEnabled: false,
};

function attachEvents() {
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".nav");
  if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => {
      nav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
    });
  }

  document.querySelectorAll(".lang-switch a").forEach((link) => {
    link.addEventListener("click", () => {
      const lang = link.dataset.lang;
      if (lang === "en" || lang === "el") {
        window.localStorage.setItem("iasis-language", lang);
      }
    });
  });

  const form = document.querySelector("#appointment-form");
  if (form) {
    const messages = {
      loading: form.dataset.loadingMessage || "Sending your request...",
      success: form.dataset.successMessage || "Thank you. Your appointment request has been sent successfully.",
      error: form.dataset.errorMessage || "We could not send your request right now. Please try again shortly.",
      captcha: form.dataset.captchaMessage || "Please complete the verification step before sending your request.",
      unavailable: form.dataset.unavailableMessage || "The contact service is temporarily unavailable.",
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status");
      const submitButton = form.querySelector('button[type="submit"]');
      const turnstileContainer = document.querySelector("#turnstile-container");

      if (!runtimeConfig.contactEnabled) {
        setFormStatus(status, "error", messages.unavailable);
        return;
      }

      let turnstileToken = "";
      if (runtimeConfig.turnstileSiteKey) {
        if (!window.turnstile || !turnstileContainer?.dataset.widgetId) {
          setFormStatus(status, "error", messages.captcha);
          return;
        }

        turnstileToken = window.turnstile.getResponse(turnstileContainer.dataset.widgetId);
        if (!turnstileToken) {
          setFormStatus(status, "error", messages.captcha);
          return;
        }
      }

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.turnstileToken = turnstileToken;

      submitButton.disabled = true;
      setFormStatus(status, "loading", messages.loading);

      try {
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 503) {
            throw new Error(messages.unavailable);
          }
          if (response.status === 400 && result.error === "Captcha verification failed") {
            throw new Error(messages.captcha);
          }
          throw new Error(messages.error);
        }

        form.reset();
        if (window.turnstile && turnstileContainer?.dataset.widgetId) {
          window.turnstile.reset(turnstileContainer.dataset.widgetId);
        }
        setFormStatus(status, "success", messages.success);
      } catch (error) {
        setFormStatus(status, "error", error.message || messages.error);
      } finally {
        submitButton.disabled = false;
      }
    });
  }
}

function setFormStatus(element, kind, message) {
  if (!element) {
    return;
  }

  element.className = `form-status is-${kind}`;
  element.textContent = message;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function setupTurnstile() {
  const container = document.querySelector("#turnstile-container");
  if (!container || !runtimeConfig.turnstileSiteKey) {
    return;
  }

  await loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  if (!window.turnstile) {
    return;
  }

  container.innerHTML = "";
  const widgetId = window.turnstile.render("#turnstile-container", {
    sitekey: runtimeConfig.turnstileSiteKey,
    language: document.documentElement.lang === "el" ? "el" : "en",
    theme: "light",
    retry: "auto",
    appearance: "always",
  });
  container.dataset.widgetId = String(widgetId);
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return;
    }

    const result = await response.json();
    runtimeConfig.turnstileSiteKey = typeof result.turnstileSiteKey === "string" ? result.turnstileSiteKey : "";
    runtimeConfig.contactEnabled = Boolean(result.contactEnabled);
  } catch {
    runtimeConfig.turnstileSiteKey = "";
    runtimeConfig.contactEnabled = false;
  }
}

async function initSite() {
  await loadRuntimeConfig();
  attachEvents();
  await setupTurnstile();
}

initSite();
