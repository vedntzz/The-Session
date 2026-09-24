// For flag, paths must be [attemptedPath, ...agreedPaths], with attemptedPath first.
export async function requestJev(question: "scope" | "flag" | "tag", intent: string, paths: readonly string[], timeoutMs = 1000): Promise<unknown | null> {
  const { JEV_ENDPOINT: endpoint, JEV_API_KEY: key } = process.env;
  if (!key || !endpoint || !Number.isFinite(timeoutMs) || timeoutMs < 0) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { resolve(null); controller.abort(); }, timeoutMs);
    });
    return await Promise.race([deadline, fetch(endpoint, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question, intent, paths }),
    }).then((response) => response.ok ? response.json() : null)]);
  } catch { return null; } finally {
    clearTimeout(timer);
  }
}
