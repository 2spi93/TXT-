export type RenderJobType = "candle" | "indicator" | "overlay";

export type RenderJob = {
  type: RenderJobType;
  priority: number;
  callback: () => void;
};

type RenderSchedulerOptions = {
  frameBudgetMs?: number;
};

const DEFAULT_FRAME_BUDGET = 16.7;
const MIN_DYNAMIC_BUDGET = 8.4;
const MAX_DYNAMIC_BUDGET = 16.2;

export class RenderScheduler {
  private queue: RenderJob[] = [];
  private running = false;
  private frameBudgetMs: number;
  private dynamicBudgetMs: number;
  private lastFrameTs = 0;
  private frameCostEmaMs = 0;

  constructor(options?: RenderSchedulerOptions) {
    this.frameBudgetMs = options?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET;
    this.dynamicBudgetMs = this.frameBudgetMs;
  }

  enqueue(job: RenderJob): void {
    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority);

    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.flush);
    }
  }

  clear(): void {
    this.queue = [];
    this.running = false;
    this.lastFrameTs = 0;
    this.frameCostEmaMs = 0;
    this.dynamicBudgetMs = this.frameBudgetMs;
  }

  private compactBacklog(): void {
    if (this.queue.length <= 4) {
      return;
    }

    const compacted: RenderJob[] = [];
    const seenLowPriorityTypes = new Set<RenderJobType>();

    // Keep all candle jobs, but only the newest indicator/overlay jobs when overloaded.
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const job = this.queue[index];
      if (job.type === "candle") {
        compacted.push(job);
        continue;
      }
      if (!seenLowPriorityTypes.has(job.type)) {
        seenLowPriorityTypes.add(job.type);
        compacted.push(job);
      }
    }

    compacted.reverse();
    compacted.sort((a, b) => b.priority - a.priority);
    this.queue = compacted;
  }

  private computeDynamicBudget(frameTs: number): number {
    if (this.lastFrameTs <= 0) {
      this.lastFrameTs = frameTs;
      this.dynamicBudgetMs = this.frameBudgetMs;
      return this.dynamicBudgetMs;
    }

    const frameDelta = Math.max(1, frameTs - this.lastFrameTs);
    this.lastFrameTs = frameTs;

    // Keep some main-thread headroom: heavier frames reduce scheduler budget.
    const targetHeadroom = Math.max(0, 16.7 - frameDelta);
    const baseline = clamp(this.frameBudgetMs - (frameDelta - 16.7) * 0.7, MIN_DYNAMIC_BUDGET, MAX_DYNAMIC_BUDGET);
    const targetBudget = clamp(baseline - targetHeadroom * 0.2, MIN_DYNAMIC_BUDGET, MAX_DYNAMIC_BUDGET);
    this.dynamicBudgetMs = this.dynamicBudgetMs * 0.72 + targetBudget * 0.28;
    return this.dynamicBudgetMs;
  }

  private flush = (frameTs: number) => {
    const frameStart = performance.now();
    const frameBudget = this.computeDynamicBudget(frameTs);

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) {
        break;
      }

      const jobStart = performance.now();
      job.callback();
      const jobCost = performance.now() - jobStart;
      this.frameCostEmaMs = this.frameCostEmaMs <= 0 ? jobCost : this.frameCostEmaMs * 0.82 + jobCost * 0.18;

      if (performance.now() - frameStart > frameBudget) {
        // Intelligent frame skipping: under load, keep only freshest non-candle jobs.
        if (this.frameCostEmaMs > 2 || this.queue.length > 3) {
          this.compactBacklog();
        }
        requestAnimationFrame(this.flush);
        return;
      }
    }

    this.running = false;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
