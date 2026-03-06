import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle, Hourglass } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

const CONCURRENCY = 3;
const BATCH_SIZE = 1000; // Save every 1000 records
const COOLDOWN_MS = 60000; // 60 second pause

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 hover:border-indigo-500/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{policy.carrier}</p>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{policy.policyNumber}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${typeColors[policy.type] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
          {policy.type}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Coverage</p>
          <p className="text-white font-bold text-sm">{policy.coverageAmount}</p>
        </div>
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Effective</p>
          <p className="text-white font-bold text-sm">{policy.effectiveDate}</p>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-800 flex justify-between items-center text-[10px]">
        <span className="text-slate-600 font-mono text-xs">DOT #{dot}</span>
        <span className="text-indigo-400 font-black uppercase">Active Policy</span>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const pendingSavesRef = useRef<{ dot: string; policies: any[] }[]>([]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // Save the current buffer to Supabase
  const flushSaves = async () => {
    if (pendingSavesRef.current.length === 0) return;
    
    log(`💾 Syncing ${pendingSavesRef.current.length} records to Supabase...`);
    let successCount = 0;

    // Supabase usually prefers single updates for insurance, but we loop the pending array
    for (const item of pendingSavesRef.current) {
      const result = await updateCarrierInsurance(item.dot, { policies: item.policies });
      if (result.success) successCount++;
    }

    setStats(s => ({ ...s, dbSaved: s.dbSaved + successCount }));
    log(`✅ DB Sync Complete: ${successCount} records updated.`);
    pendingSavesRef.current = [];
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Fetching range MC ${mcRangeStart} → ${mcRangeEnd}...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('mc_number, dot_number, legal_name, insurance_policies')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd));

      if (error) throw error;
      const mapped = (data || []).map((row: any) => ({
        mcNumber: row.mc_number,
        dotNumber: row.dot_number,
        legalName: row.legal_name,
        insurancePolicies: row.insurance_policies || [],
      })) as CarrierData[];

      setMcRangeCarriers(mapped);
      log(`✅ Loaded ${mapped.length} carriers.`);
    } catch (err: any) { log(`❌ DB Error: ${err.message}`); }
  };

  const startScraping = async () => {
    if (isProcessing) return;
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) return log('⚠️ No carriers to process.');

    setIsProcessing(true);
    isRunningRef.current = true;
    pendingSavesRef.current = [];
    setStats({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });
    log(`🚀 Scraper started. Batch Save: ${BATCH_SIZE} | Pause: 60s`);

    const updated = [...targetCarriers];
    let completed = 0;

    const worker = async (index: number) => {
      if (!isRunningRef.current) return;
      const carrier = updated[index];
      const dot = carrier.dotNumber;
      if (!dot) { completed++; return; }

      try {
        const result = await fetchInsuranceData(dot);
        const hasInsurance = result.policies.length > 0;

        updated[index] = { ...updated[index], insurancePolicies: result.policies };
        pendingSavesRef.current.push({ dot, policies: result.policies });

        setStats(s => ({
          ...s,
          processed: s.processed + 1,
          insFound: s.insFound + (hasInsurance ? 1 : 0),
          insEmpty: s.insEmpty + (hasInsurance ? 0 : 1),
        }));

        if (hasInsurance) log(`✅ DOT ${dot} | ${result.policies.length} Policies`);
        
        // Trigger Batch Save and Cooling Pause
        if (pendingSavesRef.current.length >= BATCH_SIZE) {
          await flushSaves();
          log(`🕒 Pause Triggered: 60s cooldown to prevent IP flags...`);
          setIsPaused(true);
          await new Promise(r => setTimeout(r, COOLDOWN_MS));
          setIsPaused(false);
          log(`▶️ Resuming scrape...`);
        }

      } catch (err: any) { log(`❌ DOT ${dot} Error: ${err.message}`); }
      
      completed++;
      setProgress(Math.round((completed / targetCarriers.length) * 100));
    };

    const activePromises: Promise<void>[] = [];
    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) break;
      const p = worker(i).then(() => { activePromises.splice(activePromises.indexOf(p), 1); });
      activePromises.push(p);
      if (activePromises.length >= CONCURRENCY) await Promise.race(activePromises);
    }

    await Promise.all(activePromises);
    await flushSaves(); // Final save
    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Scrape Finished.`);
  };

  const handleStop = async () => {
    isRunningRef.current = false;
    log('🛑 Stopping... performing final database sync.');
    await flushSaves();
    setIsProcessing(false);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" /> Insurance Scraper
          </h1>
          <p className="text-slate-500 font-medium ml-8 italic">Batch Saving Protocol (Every {BATCH_SIZE})</p>
        </div>
        <button
          onClick={isProcessing ? handleStop : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all ${
            isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Start Scrape</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
        <div className="col-span-4 space-y-4 overflow-y-auto pr-1">
          {/* Pause Notification */}
          {isPaused && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center gap-3 text-amber-400 animate-pulse">
              <Hourglass size={20} />
              <span className="text-sm font-bold uppercase">60s Cooling Pause active...</span>
            </div>
          )}

          {/* MC Range Loader */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
             <div className="flex items-center justify-between mb-3 font-black text-[10px] text-slate-500 uppercase tracking-widest">
                <span className="flex items-center gap-2"><Database size={12} className="text-indigo-400" /> DB Range Search</span>
                <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-3 py-1 rounded-full ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800'}`}>
                  {mcRangeMode ? 'Active' : 'Off'}
                </button>
             </div>
             {mcRangeMode && (
               <div className="space-y-2">
                 <div className="flex gap-2">
                    <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                    <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                 </div>
                 <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-xs font-black uppercase tracking-tighter transition-all">Load from DB</button>
               </div>
             )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Found</span>
                <span className="text-2xl font-black text-green-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Queued Save</span>
                <span className="text-2xl font-black text-indigo-400">{pendingSavesRef.current.length}</span>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">Total DB Updated</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Done</span>
                <span className="text-3xl font-black text-slate-300">{progress}%</span>
              </div>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-1.5 border border-slate-800">
              <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex items-center justify-between px-6">
            <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2"><ClipboardList size={14} /> Pipeline Console</span>
            <div className="flex gap-4 text-[10px] font-mono text-slate-600">
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> Scraping</span>
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> DB Buffer</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.map((entry, i) => (
              <div key={i} className={`flex gap-3 p-1 ${entry.includes('✅') ? 'text-green-400' : entry.includes('❌') ? 'text-red-400' : 'text-slate-400'}`}>
                <span className="opacity-20">{new Date().toLocaleTimeString()}</span>
                <span>{entry}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
