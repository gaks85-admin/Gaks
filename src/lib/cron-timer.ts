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

  private currentWatcherContext: WatcherTimingContext | null = null;
  private currentWatcherStart: number = 0;
  private currentWatcherStages: WatcherStageTiming[] = [];
  private currentStageName: string | null = null;
  private currentStageStart: number = 0;

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
    this.currentWatcherContext = context;
    this.currentWatcherStart = performance.now();
    this.currentWatcherStages = [];
    this.currentStageName = null;
    this.currentStageStart = 0;
  }

  public startStage(stageName: string): void {
    if (this.currentStageName && this.currentStageStart > 0) {
      this.endStage();
    }
    this.currentStageName = stageName;
    this.currentStageStart = performance.now();
  }

  public endStage(): void {
    if (!this.currentStageName || this.currentStageStart === 0) return;
    const duration = Math.round(performance.now() - this.currentStageStart);
    const stageName = this.currentStageName;

    this.currentWatcherStages.push({ stageName, durationMs: duration });
    this.stageAggregateTimes[stageName] = (this.stageAggregateTimes[stageName] || 0) + duration;

    this.currentStageName = null;
    this.currentStageStart = 0;
  }

  public endWatcher(skipped: boolean = false): void {
    if (this.currentStageName) {
      this.endStage();
    }

    if (!this.currentWatcherContext) return;

    const totalMs = Math.round(performance.now() - this.currentWatcherStart);
    const record: SingleWatcherTimingRecord = {
      context: { ...this.currentWatcherContext },
      totalMs,
      stages: [...this.currentWatcherStages],
    };

    this.watcherRecords.push(record);

    if (skipped) {
      this.skippedWatchersCount++;
    } else {
      this.processedWatchersCount++;
    }

    const { userEmail, watcherId, pair, timeframe } = this.currentWatcherContext;
    console.log(`[CRON TIMING] Watcher Processed in ${totalMs}ms | User: ${userEmail} | Watcher: ${watcherId} | Pair: ${pair} | Timeframe: ${timeframe}`);

    const elapsed = this.getElapsedTimeMs();
    if (elapsed >= this.warningThresholdMs) {
      console.warn(`[CRON TIMING WARNING] Cron execution time (${elapsed}ms) reached warning threshold (${this.warningThresholdMs}ms / ${this.timeLimitMs}ms limit) after Watcher: ${watcherId} | Pair: ${pair}`);
    }

    this.currentWatcherContext = null;
    this.currentWatcherStart = 0;
    this.currentWatcherStages = [];
  }

  public printSummary(): void {
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
