export interface WatcherTimingContext {
  userEmail: string;
  watcherId: string;
  pair: string;
  timeframe: string;
}

export interface WatcherStageTiming {
  stageName: string;
  durationMs: number;
}

export interface SingleWatcherTimingRecord {
  context: WatcherTimingContext;
  totalMs: number;
  stages: WatcherStageTiming[];
}

export interface CronTimerOptions {
  warningThresholdMs?: number; // default 25000ms
  timeLimitMs?: number;        // default 30000ms
}

interface ActiveWatcherState {
  context: WatcherTimingContext;
  startTime: number;
  stages: WatcherStageTiming[];
  currentStageName: string | null;
  currentStageStart: number;
}

export class CronTimer {
  private startTime: number;
  private warningThresholdMs: number;
  private timeLimitMs: number;

  private discoveredWatchersCount: number = 0;
  private processedWatchersCount: number = 0;
  private skippedWatchersCount: number = 0;
  private earlyExitTriggered: boolean = false;

  private watcherRecords: SingleWatcherTimingRecord[] = [];
  private stageAggregateTimes: Record<string, number> = {};

  // Concurrency-safe map for active watchers
  private activeWatchers: Map<string, ActiveWatcherState> = new Map();
  private lastActiveWatcherId: string | null = null;

  constructor(options?: CronTimerOptions) {
    this.startTime = performance.now();
    this.warningThresholdMs = options?.warningThresholdMs ?? 25000;
    this.timeLimitMs = options?.timeLimitMs ?? 30000;
  }

  public getElapsedTimeMs(): number {
    return Math.round(performance.now() - this.startTime);
  }

  public isApproachingLimit(): boolean {
    return this.getElapsedTimeMs() >= this.warningThresholdMs;
  }

  public setDiscoveredCount(count: number): void {
    this.discoveredWatchersCount = count;
  }

  public markEarlyExit(): void {
    this.earlyExitTriggered = true;
  }

  public startWatcher(context: WatcherTimingContext): void {
    const watcherId = context.watcherId || 'default';
    this.lastActiveWatcherId = watcherId;
    this.activeWatchers.set(watcherId, {
      context,
      startTime: performance.now(),
      stages: [],
      currentStageName: null,
      currentStageStart: 0
    });
  }

  public startStage(stageName: string, watcherId?: string): void {
    const targetId = watcherId || this.lastActiveWatcherId;
    if (!targetId) return;
    const state = this.activeWatchers.get(targetId);
    if (!state) return;

    if (state.currentStageName && state.currentStageStart > 0) {
      this.endStage(targetId);
    }
    state.currentStageName = stageName;
    state.currentStageStart = performance.now();
  }

  public endStage(watcherId?: string): void {
    const targetId = watcherId || this.lastActiveWatcherId;
    if (!targetId) return;
    const state = this.activeWatchers.get(targetId);
    if (!state || !state.currentStageName || state.currentStageStart === 0) return;

    const duration = Math.round(performance.now() - state.currentStageStart);
    const stageName = state.currentStageName;

    state.stages.push({ stageName, durationMs: duration });
    this.stageAggregateTimes[stageName] = (this.stageAggregateTimes[stageName] || 0) + duration;

    state.currentStageName = null;
    state.currentStageStart = 0;
  }

  public endWatcher(skipped: boolean = false, watcherId?: string): void {
    const targetId = watcherId || this.lastActiveWatcherId;
    if (!targetId) return;
    const state = this.activeWatchers.get(targetId);
    if (!state) return;

    if (state.currentStageName) {
      this.endStage(targetId);
    }

    const totalMs = Math.round(performance.now() - state.startTime);
    const record: SingleWatcherTimingRecord = {
      context: { ...state.context },
      totalMs,
      stages: [...state.stages],
    };

    this.watcherRecords.push(record);
    this.activeWatchers.delete(targetId);

    if (skipped) {
      this.skippedWatchersCount++;
    } else {
      this.processedWatchersCount++;
    }

    const { userEmail, pair, timeframe } = state.context;
    if (process.env.LOG_LEVEL === 'debug' || process.env.DEBUG === 'true') {
      console.log(`[CRON TIMING] Watcher Processed in ${totalMs}ms | User: ${userEmail} | Watcher: ${targetId} | Pair: ${pair} | Timeframe: ${timeframe}`);
    }

    const elapsed = this.getElapsedTimeMs();
    if (elapsed >= this.warningThresholdMs) {
      console.warn(`[CRON] DEADLINE WARNING | elapsed=${elapsed}ms | limit=${this.warningThresholdMs}ms | watcher=${targetId.slice(0, 8)}... | pair=${pair}`);
    }
  }

  public getMaxWatcherDurationMs(): number {
    if (this.watcherRecords.length === 0) return 0;
    return Math.max(...this.watcherRecords.map(r => r.totalMs));
  }

  public getAvgWatcherDurationMs(): number {
    if (this.watcherRecords.length === 0) return 0;
    const sum = this.watcherRecords.reduce((acc, r) => acc + r.totalMs, 0);
    return Math.round(sum / this.watcherRecords.length);
  }

  public printSummary(): void {
    if (process.env.LOG_LEVEL !== 'debug' && process.env.DEBUG !== 'true') {
      return;
    }
    const totalDuration = this.getElapsedTimeMs();

    let slowestWatcher: SingleWatcherTimingRecord | null = null;
    for (const record of this.watcherRecords) {
      if (!slowestWatcher || record.totalMs > slowestWatcher.totalMs) {
        slowestWatcher = record;
      }
    }

    let slowestStageName = 'N/A';
    let slowestStageTimeMs = 0;
    for (const [stage, time] of Object.entries(this.stageAggregateTimes)) {
      if (time > slowestStageTimeMs) {
        slowestStageTimeMs = time;
        slowestStageName = stage;
      }
    }

    console.log(`\n==================================================`);
    console.log(`[CRON TIMING SUMMARY]`);
    console.log(`Total Cron Execution Time: ${totalDuration}ms`);
    console.log(`Warning Threshold: ${this.warningThresholdMs}ms | Hard Limit: ${this.timeLimitMs}ms`);
    console.log(`Approaching Limit Warning Triggered: ${totalDuration >= this.warningThresholdMs ? 'YES' : 'NO'}`);
    console.log(`Early Exit Executed: ${this.earlyExitTriggered ? 'YES' : 'NO'}`);
    console.log(`Watchers Discovered: ${this.discoveredWatchersCount}`);
    console.log(`Watchers Processed: ${this.processedWatchersCount}`);
    console.log(`Watchers Skipped: ${this.skippedWatchersCount}`);
    console.log(`Maximum Watcher Duration: ${this.getMaxWatcherDurationMs()}ms`);
    console.log(`Average Watcher Duration: ${this.getAvgWatcherDurationMs()}ms`);

    if (slowestWatcher) {
      const { userEmail, watcherId, pair, timeframe } = slowestWatcher.context;
      console.log(`Slowest Watcher: ${slowestWatcher.totalMs}ms | User: ${userEmail} | Watcher: ${watcherId} | Pair: ${pair} | Timeframe: ${timeframe}`);
    } else {
      console.log(`Slowest Watcher: None processed`);
    }

    console.log(`Slowest Stage Overall: ${slowestStageName} (${slowestStageTimeMs}ms)`);
    console.log(`Stage Breakdown (Aggregate Across All Watchers):`);
    for (const [stage, time] of Object.entries(this.stageAggregateTimes)) {
      console.log(`  - ${stage}: ${time}ms`);
    }
    console.log(`==================================================\n`);
  }
}
