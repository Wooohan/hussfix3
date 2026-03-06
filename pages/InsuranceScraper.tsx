import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, Database, Search, ClipboardList, 
  Loader2, Zap, X, AlertCircle, Hourglass, 
  CheckCircle2, Globe, Activity 
} from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { supabase } from '../services/supabaseClient';

// Configuration
const BATCH_SIZE = 1000;
const COOLDOWN_MS = 60000;

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

// ── Glass Policy Card ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'CARGO': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'BOND': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  return (
    <div className="p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl space-y-3 hover:border-indigo-500/50 transition-all duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate uppercase tracking-tight">{policy.carrier}</p>
          <p className="text-slate-500 text-[10px] font-mono mt-0.5">ID: {policy.policyNumber}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase ${typeColors[policy.type] || 'bg-slate-800 text-slate-400'}`}>
          {policy.type}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Limit</p>
          <p className="text-indigo-300 font-bold">{policy.coverageAmount}</p>
        </div>
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Expiry</p>
          <p className="text-white font-bold">{policy.effectiveDate}</p>
        </div>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'warn'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  // MC Range State
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  // Manual Search State
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const log = (msg: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    setLogs(prev => [...prev, { msg, type }]);
  };

  // ── Database Schema Aligned Sync ──
  const syncToDB = async (dot: string, policies: InsurancePolicy[]) => {
    try {
      const { error } = await supabase
        .from('carriers')
        .update({ 
          insurance_policies: policies, // Aligned to JSONB column
          date_scraped: new Date().toISOString() 
        })
        .eq('dot_number', dot.toString().trim()); // Aligned to TEXT column
      
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // ── Restore Manual Search ──
  const handleManualLookup = async () => {
    const dot = manualDot.trim();
    if (!dot) return;
    setIsManualLoading(true);
    setManualResult(null);
    try {
      log(`🔎 Manual Lookup: Requesting DOT #${dot}...`, 'info');
      const { policies } = await fetchInsuranceData(dot);
      
      if (policies.length > 0) {
        setManualResult({ dot, policies });
        const db = await syncToDB(dot, policies);
        if (db.success) log(`✅ Manual Save: DOT #${dot} updated in database.`, 'success');
      } else {
        log(`⬜ Manual Lookup: No insurance found for DOT #${dot}.`, 'warn');
      }
    } catch (e: any) {
      log(`❌ Manual Lookup Error: ${e.message}`, 'error');
    } finally { setIsManualLoading(false); }
  };

  // ── MC Range Logic ──
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`📡 Querying DB for MC Range ${mcRangeStart} - ${mcRangeEnd}...`, 'info');
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd)
        .order('mc_number', { ascending: true });

      if (error) throw error;
      setMcRangeCarriers(data || []);
      log(`✅ Range Loaded: ${data?.length || 0} carriers ready.`, 'success');
    } catch (err: any) { log(`❌ DB Fetch Error: ${err.message}`, 'error'); }
  };

  // ── Main Pipeline ──
  const startScrape = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ Pipeline Empty: Load carriers first.', 'warn');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: target.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Engine Started. Concurrency: Sequential | Batching: ${BATCH_SIZE}`, 'info');

    const updated = [...target];
    let foundCount = 0;
    let failCount = 0;
    let savedCount = 0;
    let batchCounter = 0;

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      const c = updated[i];
      const dot = c.dotNumber?.toString().trim();

      try {
        if (!dot) throw new Error('Invalid DOT');
        const { policies } = await fetchInsuranceData(dot);
        
        const db = await syncToDB(dot, policies);
        if (db.success) savedCount++;
        if (policies.length > 0) {
            foundCount++;
            log(`✓ [${i+1}] DOT ${dot}: Found ${policies.length} policies.`, 'success');
        } else {
            log(`- [${i+1}] DOT ${dot}: No data.`, 'info');
        }
      } catch (e: any) {
        failCount++;
        log(`! [${i+1}] DOT ${dot}: ${e.message}`, 'error');
      }

      // Update State
      setStats(s => ({ ...s, insFound: foundCount, insFailed: failCount, dbSaved: savedCount }));
      setProgress(Math.round(((i + 1) / target.length) * 100));

      // Batch Check
      batchCounter++;
      if (batchCounter >= BATCH_SIZE && (i + 1) < target.length) {
        setIsPaused(true);
        log(`⏳ BATCH LIMIT: Cooling down for 60s to prevent API lock...`, 'warn');
        await new Promise(r => setTimeout(r, COOLDOWN_MS));
        setIsPaused(false);
        batchCounter = 0;
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🏁 Pipeline Finished. Total Records Updated: ${savedCount}`, 'success');
  };

  return (
    <div className="h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-200 p-6 flex flex-col overflow-hidden font-sans">
      
      {/* Header Area */}
      <div className="flex justify-between items-center mb-8 px-2">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/40 rounded-2xl shadow-lg shadow-indigo-500/10">
            <ShieldCheck className="text-indigo-400" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase flex items-center gap-2">
              Insurance Scraper <span className="text-[10px] bg-indigo-600 px-2 py-0.5 rounded text-white tracking-widest">v2.0</span>
            </h1>
            <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
              <span className="flex items-center gap-1"><Activity size={10} className="text-green-500" /> API: Active</span>
              <span className="flex items-center gap-1"><Database size={10} className="text-indigo-500" /> DB Sync: Aligned</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startScrape()}
          className={`group flex items-center gap-3 px-8 py-4 rounded-2xl font-black transition-all duration-500 transform active:scale-95 ${
            isProcessing 
            ? 'bg-red-500/10 text-red-500 border border-red-500/30' 
            : 'bg-indigo-600 text-white shadow-2xl shadow-indigo-500/30 hover:bg-indigo-500'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" /> STOP ENGINE</> : <><Zap className="group-hover:animate-pulse" /> IGNITE SCRAPER</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Left Control Panel */}
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Manual Search (Restored) */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-3xl">
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Search size={12} /> Manual Carrier Lookup
            </h3>
            <div className="flex gap-2">
              <input
                value={manualDot}
                onChange={e => setManualDot(e.target.value)}
                placeholder="Enter USDOT#"
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
              />
              <button 
                onClick={handleManualLookup}
                disabled={isManualLoading}
                className="px-5 bg-white/10 hover:bg-white/20 rounded-xl transition-all"
              >
                {isManualLoading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
              </button>
            </div>
            {manualResult && (
              <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black text-green-400 uppercase">Results for #{manualResult.dot}</span>
                  <button onClick={() => setManualResult(null)}><X size={12}/></button>
                </div>
                <div className="space-y-2">
                  {manualResult.policies.map((p, i) => <PolicyCard key={i} policy={p} dot={manualResult.dot} />)}
                </div>
              </div>
            )}
          </div>

          {/* Range Selection */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-3xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Globe size={12} /> DB Range Selector
              </h3>
              <button 
                onClick={() => setMcRangeMode(!mcRangeMode)}
                className={`text-[9px] font-black px-2 py-1 rounded-md transition-all ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}
              >
                {mcRangeMode ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className={`space-y-3 transition-all ${mcRangeMode ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div className="flex gap-2">
                <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm" />
                <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm" />
              </div>
              <button onClick={handleMcRangeSearch} className="w-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 py-2.5 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-600/20">
                Load Carriers Into Buffer
              </button>
            </div>
          </div>

          {/* Real-time Stats */}
          <div className="bg-indigo-600/5 border border-indigo-500/20 p-6 rounded-[2.5rem] space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-black text-indigo-400 uppercase mb-1">Found Insurance</p>
                <p className="text-4xl font-black text-white leading-none">{stats.insFound}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-green-400 uppercase mb-1">DB Records Saved</p>
                <p className="text-4xl font-black text-white leading-none">{stats.dbSaved}</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <span>Task Completion</span>
                <span className="text-indigo-400">{progress}%</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-600 to-blue-400 transition-all duration-700 ease-out" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Console Panel */}
        <div className="col-span-12 lg:col-span-8 bg-black/40 backdrop-blur-2xl rounded-[2.5rem] border border-white/10 overflow-hidden flex flex-col shadow-inner">
          <div className="bg-white/5 p-5 border-b border-white/10 flex justify-between items-center px-8">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">System Traffic Log</span>
            </div>
            {isPaused && (
              <div className="flex items-center gap-2 text-amber-500 text-[10px] font-black bg-amber-500/10 px-3 py-1 rounded-full animate-bounce">
                <Hourglass size={12} /> COOLDOWN ACTIVE
              </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] leading-relaxed custom-scrollbar">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-4">
                <ClipboardList size={48} />
                <p className="font-black uppercase tracking-[0.3em]">Console Idle</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 mb-1 group ${
                log.type === 'success' ? 'text-green-400' : 
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warn' ? 'text-amber-400' : 'text-slate-500'
              }`}>
                <span className="opacity-20 shrink-0 font-bold tracking-tighter">{new Date().toLocaleTimeString([], {hour12: false})}</span>
                <span className="group-hover:text-white transition-colors">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
