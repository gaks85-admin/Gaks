/**
 * GAKS AI — Stage E Scientific Validation Experiment Persistence
 * Manages atomic persistence, retrieval, listing, and deletion of scientific validation experiment runs.
 */

import fs from 'fs';
import path from 'path';
import { getSupabase } from '../../lib/supabase-server.js';
import { ScientificValidationExperiment } from './backtest-scientific-engine.js';

function getFallbackDir(): string {
  if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.cwd) {
    return '/tmp/.data/backtest';
  }
  try {
    return process.env.VERCEL || process.env.NODE_ENV === 'production' || process.cwd().startsWith('/var/task')
      ? path.join('/tmp', '.data', 'backtest')
      : path.join(process.cwd(), '.data', 'backtest');
  } catch {
    return '/tmp/.data/backtest';
  }
}

function ensureFallbackDir() {
  if (typeof window !== 'undefined') return;
  try {
    const dir = getFallbackDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Ignore in non-filesystem environments
  }
}

function getFallbackFile(): string {
  if (typeof window !== 'undefined') return '';
  ensureFallbackDir();
  try {
    return path.join(getFallbackDir(), 'scientific_experiments.json');
  } catch {
    return '';
  }
}

function readFallbackExperiments(): ScientificValidationExperiment[] {
  if (typeof window !== 'undefined') return [];
  try {
    const file = getFallbackFile();
    if (!file || !fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveFallbackExperiments(experiments: ScientificValidationExperiment[]) {
  if (typeof window !== 'undefined') return;
  try {
    ensureFallbackDir();
    const file = getFallbackFile();
    if (!file) return;
    fs.writeFileSync(file, JSON.stringify(experiments, null, 2), 'utf8');
  } catch (err) {
    console.error('[Scientific Persistence Fallback] Error saving experiments:', err);
  }
}

/**
 * Persists a scientific validation experiment.
 */
export async function saveScientificExperiment(
  experiment: ScientificValidationExperiment,
  userId: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = getSupabase();

  try {
    const { error } = await supabase.from('backtest_scientific_experiments').insert({
      id: experiment.id,
      created_by: userId,
      name: experiment.name,
      dataset_id: experiment.datasetId,
      symbol: experiment.symbol,
      timeframe: experiment.timeframe,
      status: experiment.status,
      summary_reason: experiment.summaryReason,
      results: experiment,
      created_at: experiment.createdAt
    });

    if (error) {
      console.warn('[Scientific Persistence] Supabase insert error (using fallback):', error.message);
      throw error;
    }

    return { success: true, id: experiment.id };
  } catch {
    const list = readFallbackExperiments();
    list.unshift(experiment);
    saveFallbackExperiments(list);
    return { success: true, id: experiment.id };
  }
}

/**
 * Retrieves a scientific validation experiment by ID.
 */
export async function getScientificExperiment(id: string): Promise<ScientificValidationExperiment | null> {
  if (!id) return null;
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('backtest_scientific_experiments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) throw new Error('Not found in DB');

    return data.results as ScientificValidationExperiment;
  } catch {
    const list = readFallbackExperiments();
    return list.find(e => e.id === id) || null;
  }
}

/**
 * Lists scientific validation experiments.
 */
export async function listScientificExperiments(): Promise<ScientificValidationExperiment[]> {
  const supabase = getSupabase();
  const fallback = readFallbackExperiments();

  try {
    const { data, error } = await supabase
      .from('backtest_scientific_experiments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return fallback;

    const dbExperiments = data.map((row: any) => row.results as ScientificValidationExperiment);
    const map = new Map<string, ScientificValidationExperiment>();
    for (const e of fallback) map.set(e.id, e);
    for (const e of dbExperiments) map.set(e.id, e);

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return fallback;
  }
}

/**
 * Deletes a scientific validation experiment.
 */
export async function deleteScientificExperiment(id: string): Promise<{ success: boolean; error?: string }> {
  if (!id) return { success: false, error: 'ID is required' };
  const supabase = getSupabase();

  const list = readFallbackExperiments();
  saveFallbackExperiments(list.filter(e => e.id !== id));

  try {
    await supabase.from('backtest_scientific_experiments').delete().eq('id', id);
    return { success: true };
  } catch {
    return { success: true };
  }
}
