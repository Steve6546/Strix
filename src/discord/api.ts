import { REST } from "discord.js";
import { config } from "../config.js";

type RequestTask = {
  route: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  retries: number;
};

class DiscordRequestQueue {
  private queues = new Map<string, RequestTask[]>();
  private activeLimits = new Map<string, { resetAt: number }>();
  private processing = new Set<string>();

  public async enqueue<T>(route: string, execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: RequestTask = {
        route,
        execute,
        resolve,
        reject,
        retries: 0
      };

      const bucket = this.getBucket(route);
      if (!this.queues.has(bucket)) {
        this.queues.set(bucket, []);
      }
      this.queues.get(bucket)!.push(task);
      void this.processQueue(bucket);
    });
  }

  private getBucket(route: string): string {
    const match = route.match(/^\/(channels|guilds|users)\/\d+/);
    return match ? match[0] : "global";
  }

  private async processQueue(bucket: string) {
    if (this.processing.has(bucket)) return;
    this.processing.add(bucket);

    while (true) {
      const queue = this.queues.get(bucket) || [];
      if (queue.length === 0) break;

      const limit = this.activeLimits.get(bucket);
      if (limit && limit.resetAt > Date.now()) {
        const delay = limit.resetAt - Date.now();
        await new Promise((r) => setTimeout(r, delay));
      }

      const task = queue.shift()!;
      try {
        const result = await task.execute();
        task.resolve(result);
      } catch (error: any) {
        if (error && error.status === 429) {
          const retryAfter = (error.rawError?.retry_after ?? 1) * 1000;
          this.activeLimits.set(bucket, { resetAt: Date.now() + retryAfter });
          queue.unshift(task);
        } else if (task.retries < 3) {
          task.retries++;
          queue.unshift(task);
        } else {
          task.reject(error);
        }
      }
    }

    this.processing.delete(bucket);
  }
}

export const requestQueue = new DiscordRequestQueue();
export const discordRest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
