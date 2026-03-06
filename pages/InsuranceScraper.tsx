import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Download } from 'lucide-react';
import { CarrierData } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

// High concurrency — searchcarriers.com is a private API, not FMCSA
// No rate limiting risk, run as fast as possible
const CONCURRENCY = 10;

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({
  carriers,
  onUpdateCarriers,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({
    processed: 0,
    insFound: 0,
    insEmpty: 0,
    dbSaved: 0,
  });

  // MC Range mode — load from Supabase instead of passed carriers
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── Load carriers from Supabase by MC range ──
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Loading MC ${mcRangeStart} → ${mcRangeEnd} from database...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);
      if (error) throw error;
      setMcRangeCarriers(data || []);
      log(`✅ Loaded ${data?.length || 0} carriers from DB range.`);
    } catch (err: any) {
      log(`❌ DB Error: ${err.message}`);
    }
  };

  // ── Main scraper — insurance only, concurrent ──
  const startScraping = async () => {
    if (isProcessing) return;

    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) {
      log('⚠️ No carriers to process.');
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setProgress(0);
    setStats({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });
    log(`🚀 Starting insurance scrape for ${targetCarriers.length} carriers (concurrency: ${CONCURRENCY})...`);

    const updated = [...targetCarriers];
    let completed = 0;

    const worker = async (index: number) => {
      if (!isRunningRef.current) return;

      const carrier = updated[index];
      const dot = carrier.dotNumber;

      if (!dot) {
        log(`⚠️ [${index + 1}] MC ${carrier.mcNumber} — no DOT number, skipping`);
        completed++;
        setProgress(Math.round((completed / targetCarriers.length) * 100));
        return;
      }

      try {
        const result = await fetchInsuranceData(dot);
        const hasInsurance = result.policies.length > 0;

        // Update carrier object
        updated[index] = { ...updated[index], insurancePolicies: result.policies };

        // Save to Supabase
        const saveResult = await updateCarrierInsurance(dot, { policies: result.policies });

        // Update stats
        setStats(s => ({
          ...s,
          processed: s.processed + 1,
          insFound: s.insFound + (hasInsurance ? 1 : 0),
          insEmpty: s.insEmpty + (hasInsurance ? 0 : 1),
          dbSaved: s.dbSaved + (saveResult.success ? 1 : 0),
        }));

        if (hasInsurance) {
          log(`✅ MC ${carrier.mcNumber} | DOT ${dot} → ${result.policies.length} policies found`);
        } else {
          log(`⬜ MC ${carrier.mcNumber} | DOT ${dot} → No insurance on file`);
        }

        // Push live update to parent
        onUpdateCarriers([...updated]);

      } catch (err: any) {
        log(`❌ MC ${carrier.mcNumber} | DOT ${dot} → Error: ${err.message}`);
      }

      completed++;
      setProgress(Math.round((completed / targetCarriers.length) * 100));
    };

    // Run with concurrency limit
    const activePromises: Promise<void>[] = [];

    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) break;

      const p = worker(i).then(() => {
        activePromises.splice(activePromises.indexOf(p), 1);
      });
      activePromises.push(p);

      if (activePromises.length >= CONCURRENCY) {
        await Promise.race(activePromises);
      }
    }

    await Promise.all(activePromises);

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Done. ${completed} processed, ${stats.insFound} with insurance.`);
  };

  const handleStop = () => {
    isRunningRef.current = false;
    log('⚠️ Stopped by user.');
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">

      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="text-indigo-500" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Insurance Scraper</h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">
            Bulk insurance data from searchcarriers.com · Concurrency {CONCURRENCY}
          </p>
        </div>
        <button
          onClick={isProcessing ? handleStop : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all transform active:scale-95 ${
            isProcessing
              ? 'bg-red-500/10 text-red-500 border border-red-500/50'
              : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
          }`}
        >
          {isProcessing
            ? <><Loader2 className="animate-spin" size={20} /> Stop</>
            : <><Zap size={20} /> Start Scrape</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">

        {/* Left Panel */}
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">

          {/* MC Range Loader */}
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Database size={14} className="text-indigo-400" /> Load from DB Range
              </span>
              <button
                onClick={() => setMcRangeMode(!mcRangeMode)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-colors ${
                  mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {mcRangeMode ? 'ACTIVE' : 'OFF'}
              </button>
            </div>
            {mcRangeMode && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mcRangeStart}
                    onChange={e => setMcRangeStart(e.target.value)}
                    placeholder="Start MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    value={mcRangeEnd}
                    onChange={e => setMcRangeEnd(e.target.value)}
                    placeholder="End MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleMcRangeSearch}
                  className="w-full bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xs font-black uppercase tracking-tighter transition-all"
                >
                  Load Carriers
                </button>
                {mcRangeCarriers.length > 0 && (
                  <p className="text-xs text-indigo-400 text-center font-bold">
                    {mcRangeCarriers.length} carriers loaded
                  </p>
                )}
              </div>
            )}
            {!mcRangeMode && (
              <p className="text-xs text-slate-600">
                Using {carriers.length} carriers from current session
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl space-y-4">

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-2">With Insurance</span>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-green-400" size={16} />
                  <span className="text-2xl font-black text-white">{stats.insFound}</span>
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-2">No Insurance</span>
                <div className="flex items-center gap-2">
                  <RotateCcw className="text-slate-500" size={16} />
                  <span className="text-2xl font-black text-slate-400">{stats.insEmpty}</span>
                </div>
              </div>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">DB Saved</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Processed</span>
                <span className="text-3xl font-black text-slate-300">{stats.processed}</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-indigo-600 to-indigo-400 h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Console */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex items-center justify-between px-6">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Insurance Scrape Console
            </span>
            <span className="text-[10px] font-mono text-slate-600">
              searchcarriers.com · concurrency {CONCURRENCY}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.length === 0 && (
              <span className="text-slate-600 italic">Ready — press Start Scrape to begin...</span>
            )}
            {logs.map((entry, i) => (
              <div
                key={i}
                className={`flex gap-3 p-2 rounded-lg ${
                  entry.includes('✅') ? 'text-green-400' :
                  entry.includes('❌') ? 'text-red-400' :
                  entry.includes('⚠️') ? 'text-amber-400' :
                  entry.includes('🎉') ? 'text-indigo-400 font-bold' :
                  'text-slate-400'
                }`}
              >
                <span className="opacity-30 shrink-0">
                  {new Date().toLocaleTimeString()}
                </span>
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
