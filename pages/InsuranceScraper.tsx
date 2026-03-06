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

const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy }) => {
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
          <p className="text-slate-500 text-[10px] font-mono mt-0.5 uppercase tracking-tighter">ID: {policy.policyNumber}</p>
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
          <p className="text-[9px] text-slate-500 uppercase font-black mb-1">Expiry</p>
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

  // ── UPDATED SYNC: Uses MC Number as primary anchor ──
  const syncToDB = async (carrier: any, policies: InsurancePolicy[]) => {
    try {
      // Use mc_number since your schema says it is UNIQUE
      const identifier = carrier.mc_number || carrier.mcNumber;
      
      const { error, data, status } = await supabase
        .from('carriers')
        .update({ 
          insurance_policies: policies,
          date_scraped: new Date().toISOString()
        })
        .eq('mc_number', identifier.toString().trim())
        .select(); // Calling .select() ensures we can see if rows were actually affected

      if (error) throw error;
      
      // Check if any row was actually modified
      if (!data || data.length === 0) {
        return { success: false, error: 'Record not found in database' };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
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
      log(`❌ Manual Lookup Error: ${e.message}`, 'error');
    } finally { setIsManualLoading(false); }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`📡 Querying MC Range: ${mcRangeStart} - ${mcRangeEnd}`, 'info');
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);

      if (error) throw error;
      setMcRangeCarriers(data || []);
      log(`✅ Range Loaded: ${data?.length || 0} carriers found.`, 'success');
    } catch (err: any) { log(`❌ DB Fetch Error: ${err.message}`, 'error'); }
  };

  const startScrape = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ Buffer is empty. Pull records first.', 'warn');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: target.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Engine Started. Target: ${target.length} records.`, 'info');

    const updated = [...target];
    let foundCount = 0;
    let savedCount = 0;
    let failCount = 0;

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      
      const c = updated[i];
      // Force string conversion to prevent type mismatch
      const dot = (c.dot_number || c.dotNumber)?.toString().trim();

      try {
        if (!dot || dot === "undefined") throw new Error('Missing DOT');

        const { policies } = await fetchInsuranceData(dot);
        
        // SYNC TO DB
        const db = await syncToDB(c, policies);
        
        if (db.success) {
          savedCount++;
        } else {
          log(`⚠️ Update failed for DOT ${dot}: ${db.error}`, 'warn');
        }

        if (policies.length > 0) {
          foundCount++;
          log(`✓ [${i+1}] DOT ${dot}: Found ${policies.length} policies.`, 'success');
        } else {
          log(`- [${i+1}] DOT ${dot}: No data.`, 'info');
        }
      } catch (e: any) {
        failCount++;
        log(`! [${i+1}] Error: ${e.message}`, 'error');
      }

      setStats(s => ({ ...s, insFound: foundCount, insFailed: failCount, dbSaved: savedCount }));
      setProgress(Math.round(((i + 1) / target.length) * 100));

      if ((i + 1) % 5 === 0) onUpdateCarriers([...updated]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🏁 Finished. Found: ${foundCount} | Saved to DB: ${savedCount}`, 'success');
  };

  return (
    <div className="h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#0a0c14] to-black text-slate-200 p-6 flex flex-col overflow-hidden font-sans">
      
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-5">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/40 rounded-2xl">
            <ShieldCheck className="text-indigo-400" size={30} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter uppercase">Insurance Engine</h1>
            <div className="flex gap-4 text-[10px] font-bold text-slate-500 uppercase mt-1">
              <span className="flex items-center gap-1"><Activity size={10} className="text-green-500" /> API: Live</span>
              <span className="flex items-center gap-1"><Server size={10} className="text-indigo-500" /> DB: Connected</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startScrape()}
          className={`px-10 py-5 rounded-2xl font-black transition-all transform active:scale-95 shadow-2xl ${
            isProcessing ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-indigo-600 text-white'
          }`}
        >
          {isProcessing ? 'STOP SCRAPER' : 'IGNITE SCRAPER'}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-4 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-6 rounded-3xl">
            <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Manual Search</h3>
            <div className="flex gap-2">
              <input value={manualDot} onChange={e => setManualDot(e.target.value)} placeholder="DOT#" className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm" />
              <button onClick={handleManualLookup} className="px-5 bg-white/10 rounded-xl border border-white/10 hover:bg-white/20">
                {isManualLoading ? <Loader2 className="animate-spin" /> : <Zap size={18} />}
              </button>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-6 rounded-3xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Range Selector</h3>
              <div className={`h-2 w-2 rounded-full ${mcRangeMode ? 'bg-indigo-500 shadow-[0_0_8px_indigo]' : 'bg-slate-700'}`} />
            </div>
            <div className="flex gap-2 mb-4">
              <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm" />
              <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End" className="w-1/2 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm" />
            </div>
            <button onClick={handleMcRangeSearch} className="w-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 py-4 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-600/20 transition-all">
              Load Database Carriers
            </button>
          </div>

          <div className="bg-indigo-600/5 border border-indigo-500/10 p-6 rounded-[2.5rem] space-y-6">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div><p className="text-[10px] font-black text-slate-500 uppercase">Found</p><p className="text-4xl font-black text-white">{stats.insFound}</p></div>
              <div><p className="text-[10px] font-black text-green-500 uppercase">Saved</p><p className="text-4xl font-black text-white">{stats.dbSaved}</p></div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase"><span>Progress</span><span>{progress}%</span></div>
              <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-8 bg-black/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 flex flex-col overflow-hidden">
          <div className="bg-white/5 p-5 border-b border-white/10 px-8 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Traffic Console</span>
            {isPaused && <span className="text-amber-500 text-[9px] font-black animate-pulse">COOLDOWN ACTIVE</span>}
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] leading-relaxed custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 mb-1 ${log.type === 'success' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-slate-500'}`}>
                <span className="opacity-20 shrink-0 tracking-tighter">{new Date().toLocaleTimeString([], {hour12: false})}</span>
                <span>{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
