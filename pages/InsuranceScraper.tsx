import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, Database, Search, ClipboardList, 
  Loader2, Zap, X, AlertCircle, Hourglass, 
  CheckCircle2, Globe, Activity, Server 
} from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { supabase } from '../services/supabaseClient';

const BATCH_SIZE = 1000;
const COOLDOWN_MS = 60000;

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

const PolicyCard: React.FC<{ policy: InsurancePolicy }> = ({ policy }) => (
  <div className="p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl space-y-3 hover:border-indigo-500/50 transition-all duration-300 shadow-xl">
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm truncate uppercase tracking-tight">{policy.carrier}</p>
        <p className="text-slate-500 text-[10px] font-mono mt-0.5">ID: {policy.policyNumber}</p>
      </div>
      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
        {policy.type}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-black/40 rounded-xl p-2.5 border border-white/5">
        <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Limit</p>
        <p className="text-indigo-300 font-bold">{policy.coverageAmount}</p>
      </div>
      <div className="bg-black/40 rounded-xl p-2.5 border border-white/5">
        <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Expiry</p>
        <p className="text-white font-bold">{policy.effectiveDate}</p>
      </div>
    </div>
  </div>
);

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'warn'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  const [mcRangeMode, setMcRangeMode] = useState(true);
  const [mcRangeStart, setMcRangeStart] = useState('1580000');
  const [mcRangeEnd, setMcRangeEnd] = useState('1580050');
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

  // ── REBUILT SYNC WITH NETWORK SAFETY ──
  const syncToDB = async (carrier: any, policies: InsurancePolicy[]) => {
    const mc = (carrier.mc_number || carrier.mcNumber)?.toString().trim();
    if (!mc) return { success: false, error: 'No MC Number' };

    try {
      // Add a tiny delay so we don't spam the network interface
      await new Promise(r => setTimeout(r, 150));

      const { data, error } = await supabase
        .from('carriers')
        .update({ 
          insurance_policies: policies,
          date_scraped: new Date().toISOString()
        })
        .eq('mc_number', mc)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) return { success: false, error: 'MC not found in DB' };
      
      return { success: true };
    } catch (e: any) {
      console.error("Supabase Error:", e);
      return { success: false, error: e.message || 'Fetch failed' };
    }
  };

  const handleManualLookup = async () => {
    const dot = manualDot.trim();
    if (!dot) return;
    setIsManualLoading(true);
    try {
      log(`🔎 Manual Lookup: DOT #${dot}...`, 'info');
      const { policies } = await fetchInsuranceData(dot);
      setManualResult({ dot, policies });
      log(`✅ Found ${policies.length} policies for #${dot}`, 'success');
    } catch (e: any) {
      log(`❌ Lookup Error: ${e.message}`, 'error');
    } finally { setIsManualLoading(false); }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`📡 Loading Range: MC ${mcRangeStart} - ${mcRangeEnd}`, 'info');
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);

      if (error) throw error;
      setMcRangeCarriers(data || []);
      log(`✅ DB Response: ${data?.length || 0} carriers found.`, 'success');
    } catch (err: any) { log(`❌ DB Error: ${err.message}`, 'error'); }
  };

  const startScrape = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ Load carriers first.', 'warn');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: target.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Engine Started. Concurrency: Serial (Network Safe)`, 'info');

    const updated = [...target];
    let foundCount = 0;
    let savedCount = 0;
    let failCount = 0;

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      
      const c = updated[i];
      const dot = (c.dot_number || c.dotNumber)?.toString().trim();

      try {
        if (!dot || dot === "undefined") throw new Error('Missing DOT');

        // Step 1: Fetch Insurance
        const { policies } = await fetchInsuranceData(dot);
        
        // Step 2: Update Database (Awaited carefully)
        const db = await syncToDB(c, policies);
        
        if (db.success) {
          savedCount++;
        } else {
          log(`⚠️ DB Bypass [${dot}]: ${db.error}`, 'warn');
        }

        if (policies.length > 0) {
          foundCount++;
          log(`✓ [${i+1}] DOT ${dot}: Found ${policies.length} policies.`, 'success');
        } else {
          log(`- [${i+1}] DOT ${dot}: No insurance data.`, 'info');
        }
      } catch (e: any) {
        failCount++;
        log(`! [${i+1}] Network/Fetch Error: ${e.message}`, 'error');
      }

      setStats(s => ({ ...s, insFound: foundCount, insFailed: failCount, dbSaved: savedCount }));
      setProgress(Math.round(((i + 1) / target.length) * 100));
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    onUpdateCarriers([...updated]);
    log(`🏁 Finished. Total Saved to DB: ${savedCount}`, 'success');
  };

  return (
    <div className="h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#0a0c14] to-black text-slate-200 p-6 flex flex-col overflow-hidden font-sans">
      
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-5">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/40 rounded-2xl">
            <ShieldCheck className="text-indigo-400" size={30} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">DeepScrape v2</h1>
            <div className="flex gap-4 text-[10px] font-bold text-slate-500 uppercase mt-1">
              <span className="flex items-center gap-1"><Activity size={10} className="text-green-500" /> Socket: Open</span>
              <span className="flex items-center gap-1"><Server size={10} className="text-indigo-500" /> Database: Ready</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startScrape()}
          className={`px-10 py-5 rounded-2xl font-black transition-all shadow-2xl ${
            isProcessing ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-indigo-600 text-white hover:bg-indigo-500'
          }`}
        >
          {isProcessing ? 'EMERGENCY STOP' : 'IGNITE SCRAPER'}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-4 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
          {/* Range Selector */}
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-6 rounded-3xl shadow-2xl">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Control Panel</h3>
            <div className="flex gap-2 mb-4">
              <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all" />
              <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all" />
            </div>
            <button onClick={handleMcRangeSearch} className="w-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 py-4 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-600/20 transition-all">
              Load From Database
            </button>
          </div>

          {/* Stats Display */}
          <div className="bg-indigo-600/5 border border-indigo-500/10 p-8 rounded-[2.5rem] space-y-8 shadow-inner">
            <div className="grid grid-cols-2 gap-6 text-center">
              <div className="bg-black/40 p-5 rounded-3xl border border-white/5">
                <p className="text-[10px] font-black text-indigo-400 uppercase mb-2">Policies Found</p>
                <p className="text-5xl font-black text-white">{stats.insFound}</p>
              </div>
              <div className="bg-black/40 p-5 rounded-3xl border border-white/5">
                <p className="text-[10px] font-black text-green-500 uppercase mb-2">DB Updates</p>
                <p className="text-5xl font-black text-white">{stats.dbSaved}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <span>Task Progress</span>
                <span className="text-indigo-400">{progress}%</span>
              </div>
              <div className="h-3 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Traffic Console */}
        <div className="col-span-8 bg-black/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 flex flex-col overflow-hidden shadow-2xl relative">
          <div className="bg-white/5 p-6 border-b border-white/10 px-10 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_green]" />
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em]">Live Stream</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-10 font-mono text-[11px] leading-loose custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-6 mb-2 animate-in fade-in slide-in-from-left-2 ${
                log.type === 'success' ? 'text-green-400' : 
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warn' ? 'text-amber-400' : 'text-slate-500'
              }`}>
                <span className="opacity-20 shrink-0 font-bold tracking-tighter">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
                <span className="select-text">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
