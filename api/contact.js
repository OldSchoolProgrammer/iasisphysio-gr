const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const rateLimitStore = globalThis.__iasisRateLimitStore || new Map();
globalThis.__iasisRateLimitStore = rateLimitStore;

function json(res, status, payload) {
  return res.status(status).json(payload);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function pruneRateLimit(now) {
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

function isRateLimited(ip) {
  const now = Date.now();
  pruneRateLimit(now);
  const current = rateLimitStore.get(ip);

  if (!current || now - current.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, startedAt: now });
    return false;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  current.count += 1;
  rateLimitStore.set(ip, current);
  return false;
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDate(value) {
  return value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function verifyTurnstileToken(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return true;
  }

  if (!token) {
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip,
  });

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  return Boolean(result.success);
}

function buildEmailHtml(fields) {
  const submittedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Athens",
  });

  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#1c1915;">
      <h2 style="margin-bottom:16px;">New IASIS appointment request</h2>
      <p style="margin:0 0 16px;">A new contact form submission was received from the IASIS website.</p>
      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        <tbody>
          <tr><td style="padding:8px 0;font-weight:700;">Name</td><td style="padding:8px 0;">${escapeHtml(fields.name)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Phone</td><td style="padding:8px 0;">${escapeHtml(fields.phone)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Email</td><td style="padding:8px 0;">${escapeHtml(fields.email)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Reason</td><td style="padding:8px 0;">${escapeHtml(fields.visitReason)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Preferred date</td><td style="padding:8px 0;">${escapeHtml(fields.date || "Not provided")}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;vertical-align:top;">Message</td><td style="padding:8px 0;">${escapeHtml(fields.message).replace(/\n/g, "<br />")}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Submitted</td><td style="padding:8px 0;">${submittedAt}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

async function sendEmail(fields) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL,
      to: [process.env.CONTACT_TO_EMAIL],
      reply_to: fields.email,
      subject: `IASIS appointment request - ${fields.name}`,
      text: [
        "New IASIS appointment request",
        `Name: ${fields.name}`,
        `Phone: ${fields.phone}`,
        `Email: ${fields.email}`,
        `Reason: ${fields.visitReason}`,
        `Preferred date: ${fields.date || "Not provided"}`,
        `Message: ${fields.message}`,
      ].join("\n"),
      html: buildEmailHtml(fields),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend request failed: ${response.status} ${text}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_TO_EMAIL || !process.env.CONTACT_FROM_EMAIL) {
    return json(res, 503, { error: "Contact service is not configured" });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return json(res, 429, { error: "Too many requests. Please try again later." });
  }

  let payload;
  try {
    payload = parseBody(req);
  } catch {
    return json(res, 400, { error: "Invalid request body" });
  }

  const website = normalizeText(payload.website, 200);
  if (website) {
    return json(res, 400, { error: "Invalid submission" });
  }

  const fields = {
    name: normalizeText(payload.name, 120),
    phone: normalizeText(payload.phone, 50),
    email: normalizeText(payload.email, 160).toLowerCase(),
    visitReason: normalizeText(payload.visitReason, 120),
    date: normalizeText(payload.date, 20),
    message: normalizeText(payload.message, 2000),
  };

  if (!fields.name || !fields.phone || !fields.email || !fields.visitReason || !fields.message) {
    return json(res, 400, { error: "Missing required fields" });
  }

  if (!isValidEmail(fields.email)) {
    return json(res, 400, { error: "Invalid email address" });
  }

  if (!isValidDate(fields.date)) {
    return json(res, 400, { error: "Invalid preferred date" });
  }

  const captchaOk = await verifyTurnstileToken(normalizeText(payload.turnstileToken, 2048), ip);
  if (!captchaOk) {
    return json(res, 400, { error: "Captcha verification failed" });
  }

  try {
    await sendEmail(fields);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("IASIS contact form delivery failed", error);
    return json(res, 502, { error: "Email delivery failed" });
  }
};
