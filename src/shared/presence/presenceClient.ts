import { getAuthSession, getValidAccessToken } from "../api/auth-session";
import { isSupabaseConfigured, supabaseRestRequest } from "../supabase/client";

const DEFAULT_INTERVAL_MS = 120_000;
const MIN_GAP_MS = 120_000; // at most once every 2 minutes

export class PresenceClient {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private inFlight = false;
  private lastBeatAt = 0;

  constructor(private intervalMs = DEFAULT_INTERVAL_MS) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (typeof window !== "undefined") {
      window.addEventListener("auth:changed", this.handleWake);
      window.addEventListener("online", this.handleWake);
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }

    this.schedule();
    void this.beat();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("auth:changed", this.handleWake);
      window.removeEventListener("online", this.handleWake);
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  private handleWake = (): void => {
    const minGap = Math.min(MIN_GAP_MS, this.intervalMs);
    if (Date.now() - this.lastBeatAt >= minGap) void this.beat();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.handleWake();
  };

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
  }

  async beat(): Promise<void> {
    if (!this.isRunning || this.inFlight) return;
    const minGap = Math.min(MIN_GAP_MS, this.intervalMs);
    if (Date.now() - this.lastBeatAt < minGap && this.lastBeatAt > 0) return;

    const session = getAuthSession();
    if (!session?.accessToken || !session.user?.id) return;
    if (!isSupabaseConfigured()) return;

    this.inFlight = true;
    this.lastBeatAt = Date.now();
    try {
      const accessToken = await getValidAccessToken();
      if (!accessToken || !this.isRunning) return;
      await supabaseRestRequest(
        `/profiles?id=eq.${encodeURIComponent(session.user.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
        },
        accessToken,
      );
    } catch {
      // offline or server unreachable
    } finally {
      this.inFlight = false;
    }
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }
}

export const presenceClient = new PresenceClient();
