const runtimeConfig = {
  turnstileSiteKey: "",
  contactEnabled: false,
};

function initCarousels() {
  document.querySelectorAll(".clinic-carousel").forEach(function (carousel) {
    const slides = Array.from(carousel.querySelectorAll(".carousel-slide"));
    const dots = Array.from(carousel.querySelectorAll(".carousel-dot"));
    const prevBtn = carousel.querySelector(".carousel-prev");
    const nextBtn = carousel.querySelector(".carousel-next");
    const counter = carousel.querySelector(".carousel-current");
    const progressBar = carousel.querySelector(".carousel-progress-bar");
    const INTERVAL = 5000;
    let current = 0;
    let autoTimer = null;

    function goTo(index) {
      slides[current].classList.remove("active");
      dots[current].classList.remove("active");
      dots[current].setAttribute("aria-selected", "false");
      current = ((index % slides.length) + slides.length) % slides.length;
      slides[current].classList.add("active");
      dots[current].classList.add("active");
      dots[current].setAttribute("aria-selected", "true");
      if (counter) counter.textContent = String(current + 1);
    }

    function resetProgress() {
      if (!progressBar) return;
      progressBar.style.transition = "none";
      progressBar.style.width = "0%";
      void progressBar.offsetWidth;
      progressBar.style.transition = "width " + INTERVAL + "ms linear";
      progressBar.style.width = "100%";
    }

    function stopAuto() {
      clearInterval(autoTimer);
      autoTimer = null;
      if (progressBar) {
        progressBar.style.transition = "none";
        progressBar.style.width = "0%";
      }
    }

    function startAuto() {
      stopAuto();
      resetProgress();
      autoTimer = setInterval(function () {
        goTo(current + 1);
        resetProgress();
      }, INTERVAL);
    }

    if (prevBtn) prevBtn.addEventListener("click", function () { stopAuto(); goTo(current - 1); startAuto(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { stopAuto(); goTo(current + 1); startAuto(); });

    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () { stopAuto(); goTo(i); startAuto(); });
    });

    carousel.addEventListener("mouseenter", stopAuto);
    carousel.addEventListener("mouseleave", startAuto);
    carousel.addEventListener("focusin", stopAuto);
    carousel.addEventListener("focusout", function (e) {
      if (!carousel.contains(e.relatedTarget)) startAuto();
    });

    let touchStartX = 0;
    carousel.addEventListener("touchstart", function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener("touchend", function (e) {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) { stopAuto(); goTo(dx < 0 ? current + 1 : current - 1); startAuto(); }
    }, { passive: true });

    carousel.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); stopAuto(); goTo(current - 1); startAuto(); }
      if (e.key === "ArrowRight") { e.preventDefault(); stopAuto(); goTo(current + 1); startAuto(); }
    });

    startAuto();
  });
}

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

  initCarousels();

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
