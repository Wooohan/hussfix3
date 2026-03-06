import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Database, SearchIcon, ClipboardList, Loader2, Zap, X, AlertCircle, Hourglass } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

// Configuration
const BATCH_SIZE = 1000;
const COOLDOWN_MS = 60000; // 60 seconds

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

// ── Policy Card Component ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  const classColors: Record<string, string> = {
    'PRIMARY': 'bg-green-500/20 text-green-300',
    'EXCESS': 'bg-orange-500/20 text-orange-300',
  };
  return (
    <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3 hover:border-indigo-500/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate" title={policy.carrier}>{policy.carrier}</p>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{policy.policyNumber}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${typeColors[policy.type] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
            {policy.type}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${classColors[policy.class] || 'bg-slate-700 text-slate-400'}`}>
            {policy.class}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Coverage</p>
          <p className="text-white font-bold text-sm">{policy.coverageAmount}</p>
        </div>
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Effective</p>
          <p className="text-white font-bold text-sm">{policy.effectiveDate}</p>
        </div>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);
  const [manualError, setManualError] = useState('');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── Manual DOT lookup (Your working logic) ──
  const handleManualLookup = async () => {
    const dot = manualDot.trim();
    if (!dot) return;
    setIsManualLoading(true);
    setManualResult(null);
    setManualError('');
    try {
      const { policies } = await fetchInsuranceData(dot);
      if (policies.length === 0) {
        setManualError(`No insurance policies found for DOT #${dot}`);
      } else {
        setManualResult({ dot, policies });
        await updateCarrierInsurance(dot, { policies });
      }
    } catch (e: any) { setManualError(`Error: ${e.message}`); } finally { setIsManualLoading(false); }
  };

  // ── MC Range Search (Your working logic) ──
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Loading MC Range ${mcRangeStart} - ${mcRangeEnd}...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd))
        .order('mc_number', { ascending: true });

      if (error) throw error;
      const mapped = (data || []).map((row: any) => ({
        mcNumber: row.mc_number || '',
        dotNumber: row.dot_number || '',
        legalName: row.legal_name || '',
        insurancePolicies: row.insurance_policies || [],
      }));
      setMcRangeCarriers(mapped as any);
      log(`✅ Loaded ${mapped.length} carriers from DB.`);
    } catch (err: any) { log(`❌ DB Error: ${err.message}`); }
  };

  // ── Main Process with Batch & Pause ──
  const startEnrichmentProcess = async (overrideCarriers?: CarrierData[]) => {
    if (isProcessing) return;
    const target = overrideCarriers || (mcRangeMode ? mcRangeCarriers : carriers);
    if (target.length === 0) return log('⚠️ No carriers to process.');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: target.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Starting Scraper. Batch size: ${BATCH_SIZE} | Pause: 60s`);

    const updated = [...target];
    let insFound = 0;
    let insFailed = 0;
    let dbSaved = 0;
    let batchCounter = 0;

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;

      const carrier = updated[i];
      const dot = carrier.dotNumber;

      try {
        if (!dot || dot === 'UNKNOWN') throw new Error('Invalid DOT');

        const { policies } = await fetchInsuranceData(dot);
        updated[i] = { ...updated[i], insurancePolicies: policies };

        // Using your original working update function
        const saveResult = await updateCarrierInsurance(dot, { policies });
        if (saveResult.success) dbSaved++;

        if (policies.length > 0) {
          insFound++;
          log(`✅ DOT ${dot}: Found ${policies.length} policies.`);
        } else {
          log(`⬜ DOT ${dot}: No insurance.`);
        }
      } catch (err: any) {
        insFailed++;
        log(`❌ DOT ${dot}: ${err.message}`);
      }

      // Update state for progress
      setProgress(Math.round(((i + 1) / target.length) * 100));
      setStats(prev => ({ ...prev, insFound, insFailed, dbSaved }));
      
      // Batch Pause Logic
      batchCounter++;
      if (batchCounter >= BATCH_SIZE && (i + 1) < target.length) {
        log(`🕒 Reached batch of ${BATCH_SIZE}. Cooling down for 60s...`);
        setIsPaused(true);
        await new Promise(r => setTimeout(r, COOLDOWN_MS));
        setIsPaused(false);
        batchCounter = 0;
        log(`▶️ Cooldown finished. Resuming...`);
      }

      // Sync local UI every 5 items
      if ((i + 1) % 5 === 0) onUpdateCarriers([...updated]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Finished. Found: ${insFound} | Saved: ${dbSaved}`);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" /> Insurance Scraper
          </h1>
          <p className="text-slate-500 font-medium ml-8 italic">Batch Save: {BATCH_SIZE} | Cooldown: 60s</p>
        </div>
        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all ${
            isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" /> Stop</> : <><Zap /> Start Scrape</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-4 space-y-4 overflow-y-auto">
          {isPaused && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center gap-3 text-amber-400 animate-pulse">
              <Hourglass size={18} />
              <span className="text-xs font-black uppercase">Cooldown Active (60s)</span>
            </div>
          )}

          {/* Reuse your existing Sidebar items (Manual Lookup, DB Range, Stats) here... */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-3xl">
             <div className="flex items-center justify-between mb-3 text-[10px] font-black text-slate-500 uppercase">
               <span>MC Range Search</span>
               <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-2 py-1 rounded ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800'}`}>
                 {mcRangeMode ? 'ON' : 'OFF'}
               </button>
             </div>
             {mcRangeMode && (
               <div className="space-y-2">
                 <div className="flex gap-2">
                   <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
                   <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
                 </div>
                 <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 py-2.5 rounded-xl text-xs font-black uppercase">Load Carriers</button>
               </div>
             )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-3xl space-y-4">
             <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50 text-center">
                  <span className="text-[10px] text-slate-500 font-black uppercase">Found</span>
                  <p className="text-2xl font-black text-indigo-400">{stats.insFound}</p>
                </div>
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50 text-center">
                  <span className="text-[10px] text-slate-500 font-black uppercase">Saved</span>
                  <p className="text-2xl font-black text-green-400">{stats.dbSaved}</p>
                </div>
             </div>
             <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
               <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
             </div>
          </div>
        </div>

        <div className="col-span-8 bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden flex flex-col">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 text-[10px] font-black text-slate-500 px-6 uppercase tracking-widest">
            Pipeline Console
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${log.includes('✅') ? 'text-green-400' : log.includes('❌') ? 'text-red-400' : 'text-slate-400'}`}>
                <span className="opacity-20">{new Date().toLocaleTimeString()}</span>
                <span>{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
