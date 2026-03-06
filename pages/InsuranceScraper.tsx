import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle, Hourglass } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { supabase } from '../services/supabaseClient';

const CONCURRENCY = 3; 
const BATCH_SIZE = 1000; 
const COOLDOWN_MS = 60000; 

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

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
  
  // Using a local buffer for the 1000-item batching
  const pendingSavesRef = useRef<{ dot: string; data: any }[]>([]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── FIX: REPLACED UPSERT WITH PARALLEL UPDATES ──
  const flushSaves = async () => {
    if (pendingSavesRef.current.length === 0) return;
    
    const batchData = [...pendingSavesRef.current];
    pendingSavesRef.current = []; 
    
    log(`💾 Syncing ${batchData.length} records to Supabase via Parallel Pipeline...`);
    
    try {
      // We process the batch in chunks of 20 to avoid slamming the connection pool
      const chunkSize = 20;
      let totalSuccess = 0;

      for (let i = 0; i < batchData.length; i += chunkSize) {
        const chunk = batchData.slice(i, i + chunkSize);
        
        const results = await Promise.all(chunk.map(async (item) => {
          const { error } = await supabase
            .from('carriers')
            .update({ 
              insurance_policies: item.data.policies,
              date_scraped: new Date().toISOString() 
            })
            .eq('dot_number', item.dot); // Updates specifically by DOT
          
          return !error;
        }));

        totalSuccess += results.filter(Boolean).length;
      }

      setStats(s => ({ ...s, dbSaved: s.dbSaved + totalSuccess }));
      log(`✅ DB Sync Complete: ${totalSuccess} successful updates.`);
    } catch (err: any) {
      log(`❌ DB Sync Error: ${err.message}`);
    }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Querying MC ${mcRangeStart} to ${mcRangeEnd}...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('mc_number, dot_number, legal_name')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd));

      if (error) throw error;
      setMcRangeCarriers((data || []).map(row => ({
        mcNumber: row.mc_number,
        dotNumber: row.dot_number,
        legalName: row.legal_name,
        insurancePolicies: []
      })));
      log(`✅ Loaded ${data?.length || 0} carriers from database.`);
    } catch (err: any) { log(`❌ Load Error: ${err.message}`); }
  };

  const startScraping = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ No carriers found in range.');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });
    log(`🚀 Starting Scrape. Concurrency: ${CONCURRENCY} | Batch: ${BATCH_SIZE}`);

    let completed = 0;

    const worker = async (carrier: CarrierData) => {
      if (!isRunningRef.current) return;
      if (!carrier.dotNumber) { completed++; return; }

      try {
        const result = await fetchInsuranceData(carrier.dotNumber);
        const hasIns = result.policies.length > 0;

        pendingSavesRef.current.push({ 
          dot: carrier.dotNumber, 
          data: { policies: result.policies } 
        });

        setStats(s => ({
          ...s,
          processed: s.processed + 1,
          insFound: s.insFound + (hasIns ? 1 : 0),
          insEmpty: s.insEmpty + (hasIns ? 0 : 1),
        }));

        if (pendingSavesRef.current.length >= BATCH_SIZE) {
          await flushSaves();
          log(`🕒 Batch limit reached. 60s Cooling Pause...`);
          setIsPaused(true);
          await new Promise(r => setTimeout(r, COOLDOWN_MS));
          setIsPaused(false);
          log(`▶️ Resuming...`);
        }
      } catch (e: any) { log(`❌ DOT ${carrier.dotNumber} failed: ${e.message}`); }
      
      completed++;
      setProgress(Math.round((completed / target.length) * 100));
    };

    // Parallel Processing Pool
    for (let i = 0; i < target.length; i += CONCURRENCY) {
      if (!isRunningRef.current) break;
      const chunk = target.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(c => worker(c)));
    }

    await flushSaves(); 
    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Done. Processed ${completed} total.`);
  };

  const handleStop = async () => {
    isRunningRef.current = false;
    log('🛑 User requested stop. Syncing buffer...');
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
          <p className="text-slate-500 font-medium ml-8 italic">Cleaned: Insurance Only | Sync: {BATCH_SIZE}</p>
        </div>
        <button
          onClick={isProcessing ? handleStop : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all ${
            isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Start Scrape</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
        <div className="col-span-4 space-y-4 overflow-y-auto">
          {isPaused && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center gap-3 text-amber-400 animate-pulse">
              <Hourglass size={18} />
              <span className="text-xs font-black uppercase tracking-tighter">Cooldown Pause (60s)</span>
            </div>
          )}

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <span>MC Range Search</span>
              <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-2 py-1 rounded transition-colors ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800'}`}>
                {mcRangeMode ? 'ACTIVE' : 'OFF'}
              </button>
            </div>
            {mcRangeMode && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                  <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
                <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-xs font-black uppercase transition-all">Load From DB</button>
              </div>
            )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black block mb-1">Found Ins.</span>
                <span className="text-2xl font-black text-green-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black block mb-1">Pending Save</span>
                <span className="text-2xl font-black text-indigo-400">{pendingSavesRef.current.length}</span>
              </div>
            </div>
            <div className="bg-indigo-500/10 p-5 rounded-2xl border border-indigo-500/20 flex justify-between items-center">
              <div>
                <p className="text-[10px] text-indigo-400 font-black uppercase">DB Updates</p>
                <p className="text-3xl font-black">{stats.dbSaved}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 font-black uppercase">Completion</p>
                <p className="text-3xl font-black text-slate-400">{progress}%</p>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-8 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <ClipboardList size={14} /> Pipeline Console
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 p-1 rounded ${log.includes('✅') ? 'text-green-400' : log.includes('❌') ? 'text-red-400' : log.includes('🚀') ? 'text-indigo-400' : 'text-slate-400'}`}>
                <span className="opacity-20 shrink-0">{new Date().toLocaleTimeString()}</span>
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
