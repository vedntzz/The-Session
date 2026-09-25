export async function requestJev(question: "scope" | "flag" | "tag", intent: string, paths: readonly string[], timeoutMs = 1000): Promise<unknown | null> {
  return postJev({ question, intent, paths }, timeoutMs);
}

export async function requestSystemOne(intent: string, files: readonly string[], questions: Readonly<Record<string, unknown>>, timeoutMs = 1000): Promise<Record<string, unknown> | null> {
  const response = await postJev({ model: "jev-1.13.0", state: { intent, files }, questions }, timeoutMs);
  if (typeof response !== "object" || response === null || !("answers" in response)) return null;
  const { answers } = response;
  return typeof answers === "object" && answers !== null && !Array.isArray(answers) ? answers as Record<string, unknown> : null;
}

async function postJev(body: unknown, timeoutMs: number): Promise<unknown | null> {
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
      body: JSON.stringify(body),
    }).then((response) => response.ok ? response.json() : null)]);
  } catch { return null; } finally {
    clearTimeout(timer);
  }
}
