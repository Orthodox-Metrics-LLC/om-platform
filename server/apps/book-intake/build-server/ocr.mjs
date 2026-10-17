// server/ocr.ts
var api = "https://api.cloud.llamaindex.ai";
function createOCRMiddleware(settings, fetcher = fetch) {
  const middleware = async (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!["/api/ocr/config", "/api/ocr/parse"].includes(pathname)) return next();
    const send = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    const provider = settings.OCR_PROVIDER || (settings.LLAMA_PARSE_ENABLED === "true" ? "llamaparse" : "none");
    const key = provider === "google-vision" ? settings.GOOGLE_VISION_API_KEY : settings.LLAMA_CLOUD_API_KEY;
    if (pathname === "/api/ocr/config" && req.method === "GET") {
      send(200, { provider, configured: provider === "tesseract" || ["llamaparse", "google-vision"].includes(provider) && Boolean(key), credentials: { llamaparse: Boolean(settings.LLAMA_CLOUD_API_KEY), "google-vision": Boolean(settings.GOOGLE_VISION_API_KEY) } });
      return;
    }
    if (req.method !== "POST") return send(405, { error: "Use POST to process a page." });
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: "Origin is not allowed." });
    if (!["llamaparse", "google-vision"].includes(provider) || !key) return send(503, { error: "Choose and configure an OCR provider in Administration before processing pages." });
    if (req.headers["content-type"] !== "image/png") return send(415, { error: "A PNG page image is required." });
    const timeout = Number(settings.LLAMA_PARSE_TIMEOUT_MS || 3e5);
    const disconnected = new AbortController();
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 3e5) : 3e5)]);
    res.once("close", () => {
      if (!res.writableEnded) disconnected.abort();
    });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) return send(413, { error: "Page image exceeds 25 MB." });
        chunks.push(Buffer.from(chunk));
      }
      if (!size) return send(400, { error: "Page image is empty." });
      if (provider === "google-vision") {
        const payload = JSON.stringify({ requests: [{ image: { content: Buffer.concat(chunks).toString("base64") }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] });
        if (Buffer.byteLength(payload) > 10 * 1024 * 1024) return send(413, { error: "Google Vision request exceeds 10 MB. Reduce the scan resolution." });
        const response = await fetcher("https://vision.googleapis.com/v1/images:annotate", { method: "POST", signal, headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key }, body: payload });
        if (!response.ok) throw new Error(`Google Vision returned HTTP ${response.status}. Check the API key, enabled Vision API and billing.`);
        const result = await response.json(), page = result.responses?.[0];
        if (!page || page.error) throw new Error("Google Vision could not process this image. Check credentials, quota and image format.");
        return send(200, { text: page.fullTextAnnotation?.text || page.textAnnotations?.[0]?.description || "", words: [] });
      }
      const request = async (path, init = {}) => {
        const response = await fetcher(`${api}${path}`, {
          ...init,
          signal,
          headers: { ...init.headers, Authorization: `Bearer ${settings.LLAMA_CLOUD_API_KEY}` }
        });
        if (!response.ok) throw new Error(`LlamaCloud returned HTTP ${response.status}. Check API credentials, credits and service availability.`);
        return response.json();
      };
      const form = new FormData();
      form.append("purpose", "parse");
      form.append("file", new Blob([new Uint8Array(Buffer.concat(chunks))], { type: "image/png" }), "page.png");
      const file = await request("/api/v1/beta/files", { method: "POST", body: form });
      const created = await request("/api/v2/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: file.id, tier: settings.LLAMA_PARSE_TIER || "agentic", version: "latest" })
      });
      const id = created.id || created.job?.id;
      if (!id) throw new Error("LlamaCloud did not return a parse job ID.");
      while (true) {
        const result = await request(`/api/v2/parse/${encodeURIComponent(id)}?expand=text`);
        const status = result.job?.status || result.status;
        if (status === "COMPLETED" || status === "SUCCESS") {
          const pages = result.text?.pages;
          if (!Array.isArray(pages) || pages.some((p) => p.success === false)) throw new Error("LlamaCloud did not return successful page text.");
          send(200, { text: pages.map((p) => p.text || "").join("\n\n").trim(), words: [] });
          return;
        }
        if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) throw new Error(`LlamaCloud parse job ${status.toLowerCase()}.`);
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new Error("LlamaCloud processing timed out."));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 1500);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
    } catch (error) {
      send(502, { error: signal.aborted ? "OCR processing timed out. Retry the page or choose another provider." : error instanceof Error ? error.message : "Cloud OCR failed." });
    }
  };
  return middleware;
}
export {
  createOCRMiddleware
};
