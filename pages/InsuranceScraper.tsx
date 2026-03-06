import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, Database, Search, ClipboardList, 
  Loader2, Zap, X, AlertCircle, Hourglass, 
  CheckCircle2, Globe, Activity, Server 
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
    <div className="p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl space-y-3 hover:border-indigo-500/50 transition-all duration-300 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate uppercase tracking-tight">{policy.carrier}</p>
          <p className="text-slate-500 text-[10px] font-mono mt-0.5">POLICY: {policy.policyNumber}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase ${typeColors[policy.type] || 'bg-slate-800 text-slate-400'}`}>
          {policy.type}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-black/40 rounded-xl p-2.5 border border-white/5">
          <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Limit</p>
          <p className="text-indigo-300 font-bold">{policy.coverageAmount}</p>
        </div>
        <div className="bg-black/40 rounded-xl p-2.5 border border-white/5">
          <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Effective</p>
          <p className="text-white font-bold">{policy.effectiveDate}</p>
        </div>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'warn'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<any[]>([]);

  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const log = (msg: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    setLogs(prev => [...prev, { msg, type }]);
  };

  // ── Database Sync Logic (Aligned to your Schema) ──
  const syncToDB = async (dot: string, policies: InsurancePolicy[]) => {
    try {
      const { error, count } = await supabase
        .from('carriers')
        .update({ 
          insurance_policies: policies, // Matches your JSONB column
          date_scraped: new Date().toISOString() // Matches your TEXT column
        })
        .eq('dot_number', dot.toString().trim()); // Matches your TEXT column filter
      
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // ── Manual Search ──
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
        if (db.success) log(`✅ Manual Save: DOT #${dot} updated in DB.`, 'success');
        else log(`⚠️ DB Update Failed: ${db.error}`, 'error');
      } else {
        log(`⬜ Manual Lookup: No insurance found for DOT #${dot}.`, 'warn');
      }
    } catch (e: any) {
      log(`❌ Manual Lookup Error: ${e.message}`, 'error');
    } finally { setIsManualLoading(false); }
  };

  // ── Range Selection ──
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

  // ── MAIN ENGINE ──
  const startScrape = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ Pipeline Empty: Load carriers first.', 'warn');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: target.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Engine Ignite. Batching: ${BATCH_SIZE} | Mode: Aligned SQL`, 'info');

    const updated = [...target];
    let foundCount = 0;
    let failCount = 0;
    let savedCount = 0;
    let batchCounter = 0;

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      
      const c = updated[i];
      // FIX: Check for both snake_case (SQL) and camelCase (React Props)
      const dot = (c.dot_number || c.dotNumber)?.toString().trim();

      try {
        if (!dot || dot === "undefined") throw new Error('Invalid DOT identifier');

        // 1. Fetch from Service
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Await Database Sync
        const db = await syncToDB(dot, policies);
        
        if (db.success) {
          savedCount++;
        } else {
          log(`⚠️ DOT ${dot} update bypassed (No matching row in DB)`, 'warn');
        }

        if (policies.length > 0) {
            foundCount++;
            log(`✓ [${i+1}] DOT ${dot}: Found ${policies.length} policies.`, 'success');
        } else {
            log(`- [${i+1}] DOT ${dot}: No data.`, 'info');
        }

        updated[i] = { ...c, insurance_policies: policies };

      } catch (e: any) {
        failCount++;
        log(`! [${i+1}] Carrier ${i+1}: ${e.message}`, 'error');
      }

      // Update State
      setStats({ total: target.length, insFound: foundCount, insFailed: failCount, dbSaved: savedCount });
      setProgress(Math.round(((i + 1) / target.length) * 100));

      batchCounter++;
      if (batchCounter >= BATCH_SIZE && (i + 1) < target.length) {
        setIsPaused(true);
        log(`⏳ COOLDOWN: 60s pause to prevent API lock...`, 'warn');
        await new Promise(r => setTimeout(r, COOLDOWN_MS));
        setIsPaused(false);
        batchCounter = 0;
      }

      if ((i + 1) % 5 === 0) onUpdateCarriers([...updated]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🏁 Finished. Total Saved to DB: ${savedCount}`, 'success');
  };

  return (
    <div className="h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#0a0c14] to-black text-slate-200 p-6 flex flex-col overflow-hidden font-sans select-none">
      
      {/* Top Navigation / Header */}
      <div className="flex justify-between items-center mb-8 px-2">
        <div className="flex items-center gap-5">
          <div className="p-3.5 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl shadow-[0_0_20px_rgba(79,70,229,0.2)]">
            <ShieldCheck className="text-indigo-400" size={30} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter uppercase flex items-center gap-3">
              Deep Scraper <span className="text-[10px] bg-white/10 px-2 py-1 rounded text-slate-400 border border-white/5 tracking-[0.3em]">PRO</span>
            </h1>
            <div className="flex items-center gap-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1.5">
              <span className="flex items-center gap-1.5"><Activity size={10} className="text-green-500 shadow-[0_0_5px_green]" /> System: Online</span>
              <span className="flex items-center gap-1.5"><Server size={10} className="text-indigo-500" /> Sync: Aligned (SQL)</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startScrape()}
          className={`group flex items-center gap-4 px-10 py-5 rounded-[1.5rem] font-black tracking-widest transition-all duration-500 transform active:scale-95 shadow-2xl ${
            isProcessing 
            ? 'bg-red-500/10 text-red-500 border border-red-500/30' 
            : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" /> STOP</> : <><Zap /> IGNITE SCRAPER</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Sidebar Controls */}
        <div className="col-span-12 lg:col-span-4 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
          
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-2">
              <Search size={14} /> Manual Entry
            </h3>
            <div className="flex gap-2.5">
              <input
                value={manualDot}
                onChange={e => setManualDot(e.target.value)}
                placeholder="Enter USDOT#"
                className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm focus:border-indigo-500/50 outline-none transition-all placeholder-slate-700"
              />
              <button 
                onClick={handleManualLookup}
                disabled={isManualLoading}
                className="px-6 bg-white/5 hover:bg-indigo-600 rounded-2xl transition-all border border-white/10"
              >
                {isManualLoading ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} />}
              </button>
            </div>
            {manualResult && (
              <div className="mt-5 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-black text-green-400 tracking-widest uppercase">Target Found: #{manualResult.dot}</span>
                  <button onClick={() => setManualResult(null)} className="text-slate-600 hover:text-white"><X size={14}/></button>
                </div>
                <div className="space-y-3">
                  {manualResult.policies.map((p, i) => <PolicyCard key={i} policy={p} dot={manualResult.dot} />)}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <Globe size={14} /> Database Filters
              </h3>
              <button 
                onClick={() => setMcRangeMode(!mcRangeMode)}
                className={`text-[9px] font-black px-3 py-1.5 rounded-lg transition-all ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}
              >
                {mcRangeMode ? 'RANGE ACTIVE' : 'RANGE OFF'}
              </button>
            </div>
            <div className={`space-y-4 transition-all duration-500 ${mcRangeMode ? 'opacity-100' : 'opacity-30 pointer-events-none blur-[2px]'}`}>
              <div className="flex gap-3">
                <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-indigo-500/50 outline-none" />
                <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-indigo-500/50 outline-none" />
              </div>
              <button onClick={handleMcRangeSearch} className="w-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 py-4 rounded-2xl text-[10px] font-black uppercase hover:bg-indigo-600/20 tracking-widest">
                Pull Records Into Cache
              </button>
            </div>
          </div>

          <div className="bg-indigo-600/5 border border-indigo-500/10 p-7 rounded-[2.5rem] shadow-inner space-y-8">
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-black/20 p-5 rounded-3xl border border-white/5">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Policies</p>
                <p className="text-4xl font-black text-white">{stats.insFound}</p>
              </div>
              <div className="bg-black/20 p-5 rounded-3xl border border-white/5">
                <p className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-2">DB Syncs</p>
                <p className="text-4xl font-black text-white">{stats.dbSaved}</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">
                <span>Progress Engine</span>
                <span className="text-indigo-400">{progress}%</span>
              </div>
              <div className="h-2.5 w-full bg-black/40 rounded-full overflow-hidden p-[1px] border border-white/5">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-700 via-indigo-500 to-blue-400 transition-all duration-1000 ease-in-out rounded-full shadow-[0_0_10px_rgba(79,70,229,0.5)]" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Console Log */}
        <div className="col-span-12 lg:col-span-8 bg-black/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 overflow-hidden flex flex-col shadow-2xl relative">
          <div className="bg-white/5 p-6 border-b border-white/10 flex justify-between items-center px-10">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_green]" />
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em]">Live Stream Data</span>
            </div>
            {isPaused && (
              <div className="flex items-center gap-2 text-amber-500 text-[10px] font-black bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20">
                <Hourglass size={14} className="animate-spin" /> COOLDOWN ACTIVE
              </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-10 font-mono text-[11px] leading-loose custom-scrollbar bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-10 space-y-6">
                <ClipboardList size={80} strokeWidth={1} />
                <p className="font-black uppercase tracking-[0.5em] text-sm text-center">Awaiting System Ignition</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-6 mb-2 group animate-in fade-in slide-in-from-left-2 ${
                log.type === 'success' ? 'text-green-400' : 
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warn' ? 'text-amber-400' : 'text-slate-500'
              }`}>
                <span className="opacity-30 shrink-0 font-bold tabular-nums">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
                <span className="group-hover:text-white transition-colors cursor-default select-text">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
