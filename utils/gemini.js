const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 15000;

export const isGeminiEnabled = () => {
  const enabled = String(process.env.RECOMMENDATION_AI_ENABLED ?? "true").toLowerCase();
  return enabled !== "false" && enabled !== "0" && enabled !== "no";
};

export const isGeminiConfigured = () => {
  return Boolean(process.env.GEMINI_API_KEY) && isGeminiEnabled();
};

const truncate = (s, max = 1200) => {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...[truncated ${s.length - max} chars]`;
};

const fetchJson = async (url, { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort?.(), timeoutMs);

  try {
    if (typeof globalThis.fetch === "function") {
      const res = await globalThis.fetch(url, {
        method,
        headers,
        body,
        signal: controller?.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`Gemini API error ${res.status}: ${truncate(text, 800)}`);
        err.status = res.status;
        err.body = text;
        throw err;
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch (e) {
        const err = new Error(`Gemini JSON parse failed: ${truncate(text, 800)}`);
        err.status = res.status;
        err.body = text;
        throw err;
      }
    }

    throw new Error("Global fetch is not available; Gemini requires Node fetch or a polyfill.");
  } finally {
    clearTimeout(timeout);
  }

  // return await new Promise((resolve, reject) => {


  //   const req = https.request(
  //     url,
  //     { method, headers, timeout: timeoutMs },
  //     (res) => {
  //       let data = "";
  //       res.setEncoding("utf8");
  //       res.on("data", (chunk) => (data += chunk));
  //       res.on("end", () => {
  //         if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
  //           try {
  //             resolve(data ? JSON.parse(data) : null);
  //           } catch (e) {
  //             reject(e);
  //           }
  //           return;
  //         }
  //         const err = new Error(`Gemini API error ${res.statusCode}: ${data}`);
  //         err.status = res.statusCode;
  //         reject(err);
  //       });
  //     },
  //   );
  //   req.on("error", reject);
  //   req.on("timeout", () => req.destroy(new Error("Gemini API request timeout")));
  //   if (body) req.write(body);
  //   req.end();
  // });
};

const extractText = (geminiResponse) => {
  // Gemini can return multiple text parts. If we only read parts[0], JSON outputs
  // may look "truncated" and fail JSON.parse.
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return "";

  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("");

  return typeof text === "string" ? text : "";
};


export const geminiGenerateText = async ({

  prompt,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  temperature = 0.3,
  maxOutputTokens = 512,
  timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
} = {}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured.");
    err.status = 500;
    throw err;
  }

  const baseUrl = process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL;
  // Prefer header auth so the API key doesn't end up in URLs/logs.
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;



  const generationConfig = {
    temperature,
    maxOutputTokens,
    responseMimeType: "application/json",
  };

  // console.debug("gemini generationConfig", generationConfig);

  const bodyWithMime = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  });
  const bodyWithoutMime = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  });

  let json;
  try {
    json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: bodyWithMime,
      timeoutMs,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const shouldRetry =
      err?.status === 400 &&
      (msg.includes("responseMimeType") || msg.includes("Unknown name") || msg.includes("Invalid JSON payload"));

    // console.error("gemini fetch failed", {
    //   status: err?.status,
    //   message: msg,
    //   retrying: shouldRetry,
    // });

    if (!shouldRetry) throw err;
    json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: bodyWithoutMime,
      timeoutMs,
    });
  }

  const extracted = extractText(json);
  const hasCandidates = Boolean(json?.candidates?.length);

  return extracted;
};
