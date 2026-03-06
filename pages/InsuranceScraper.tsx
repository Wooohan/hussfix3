import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

// High concurrency — searchcarriers.com is a private API, not FMCSA
const CONCURRENCY = 1;
const SAVE_BATCH_SIZE = 1000;
const SAVE_PAUSE_DURATION = 60000; // 60 seconds

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

// ── Policy Card Component ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD':  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO':  'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND':   'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  const classColors: Record<string, string> = {
    'PRIMARY': 'bg-green-500/20 text-green-300',
    'EXCESS':  'bg-orange-500/20 text-orange-300',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 hover:border-indigo-500/50 transition-colors">
      {/* Card content remains the same */}
    </div>
  );
};

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

  // MC Range mode
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  // Manual DOT search
  const [dotSearch, setDotSearch] = useState('');
  const [dotSearching, setDotSearching] = useState(false);
  const [dotResult, setDotResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);
  const [dotError, setDotError] = useState('');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const carriersToSaveRef = useRef<CarrierData[]>([]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── Manual DOT Search ──
  const handleDotSearch = async () => {
    // This function remains the same
  };

  // ── Load carriers from Supabase by MC range ──
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Loading MC ${mcRangeStart} → ${mcRangeEnd} from database...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd))
        .order('mc_number', { ascending: true });

      if (error) throw error;

      // Map Supabase snake_case → camelCase CarrierData, excluding safety fields
      const mapped = (data || []).map((row: any) => ({
        mcNumber: row.mc_number || '',
        dotNumber: row.dot_number || '',
        legalName: row.legal_name || '',
        dbaName: row.dba_name || '',
        entityType: row.entity_type || '',
        status: row.status || '',
        email: row.email || '',
        phone: row.phone || '',
        powerUnits: row.power_units || '',
        drivers: row.drivers || '',
        physicalAddress: row.physical_address || '',
        mailingAddress: row.mailing_address || '',
        dateScraped: row.date_scraped || '',
        mcs150Date: row.mcs150_date || '',
        mcs150Mileage: row.mcs150_mileage || '',
        operationClassification: row.operation_classification || [],
        carrierOperation: row.carrier_operation || [],
        cargoCarried: row.cargo_carried || [],
        outOfServiceDate: row.out_of_service_date || '',
        stateCarrierId: row.state_carrier_id || '',
        dunsNumber: row.duns_number || '',
        insurancePolicies: row.insurance_policies || [],
      }));

      setMcRangeCarriers(mapped);
      log(`✅ Loaded ${mapped.length} carriers from DB range.`);
    } catch (err: any) {
      log(`❌ DB Error: ${err.message}`);
    }
  };

  // ── Bulk Save to Supabase ──
  const saveBatchToSupabase = async () => {
    if (carriersToSaveRef.current.length === 0) return;

    const toSave = [...carriersToSaveRef.current];
    carriersToSaveRef.current = []; // Clear the queue

    log(`💾 Saving batch of ${toSave.length} carriers to Supabase...`);

    let savedCount = 0;
    for (const carrier of toSave) {
      if (carrier.insurancePolicies && carrier.insurancePolicies.length > 0) {
        const { success } = await updateCarrierInsurance(carrier.dotNumber, { policies: carrier.insurancePolicies });
        if (success) {
          savedCount++;
        }
      }
    }
    
    setStats(s => ({ ...s, dbSaved: s.dbSaved + savedCount }));
    log(`💾 Batch save complete. ${savedCount} carriers updated in DB.`);
  };

  // ── Main batch scraper ──
  const startScraping = async () => {
    if (isProcessing) return;

    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) {
      log('⚠️ No carriers to process.');
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    carriersToSaveRef.current = [];
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
      } else {
        try {
          const result = await fetchInsuranceData(dot);
          const hasInsurance = result.policies.length > 0;

          updated[index] = { ...updated[index], insurancePolicies: result.policies };
          
          if (hasInsurance) {
            carriersToSaveRef.current.push(updated[index]);
            log(`✅ MC ${carrier.mcNumber} | DOT ${dot} → ${result.policies.length} policies found.`);
          } else {
            log(`⬜ MC ${carrier.mcNumber} | DOT ${dot} → No insurance on file`);
          }

          setStats(s => ({
            ...s,
            processed: s.processed + 1,
            insFound: s.insFound + (hasInsurance ? 1 : 0),
            insEmpty: s.insEmpty + (hasInsurance ? 0 : 1),
          }));

        } catch (err: any) {
          log(`❌ MC ${carrier.mcNumber} | DOT ${dot} → Error: ${err.message}`);
        }
      }

      completed++;
      setProgress(Math.round((completed / targetCarriers.length) * 100));
      onUpdateCarriers([...updated]);

      // Check if it's time to save and pause
      if (isRunningRef.current && completed % SAVE_BATCH_SIZE === 0 && completed < targetCarriers.length) {
        await saveBatchToSupabase();
        log(`⏸️ Pausing for ${SAVE_PAUSE_DURATION / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, SAVE_PAUSE_DURATION));
        log(`▶️ Resuming scrape...`);
      }
    };

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

    // Final save for any remaining items
    await saveBatchToSupabase();

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Done. ${completed} processed, ${stats.insFound} with insurance.`);
  };

  const handleStop = async () => {
    if (isRunningRef.current) {
      isRunningRef.current = false;
      log('⚠️ Stop requested by user. Finishing current operations...');
      // The loop will break, and the final save will be triggered.
    }
  };

 return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="text-indigo-500" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Insurance Scraper</h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">
            Bulk insurance data · Direct save to Supabase · Concurrency {CONCURRENCY}
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

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">

        {/* Left Panel */}
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-1">

          {/* ── Manual DOT Search ── */}
          <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-2xl">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Search size={12} className="text-indigo-400" /> Manual DOT Lookup
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={dotSearch}
                onChange={e => setDotSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDotSearch()}
                placeholder="Enter USDOT number..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 placeholder-slate-600"
              />
              <button
                onClick={handleDotSearch}
                disabled={dotSearching || !dotSearch.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-black transition-colors"
              >
                {dotSearching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              </button>
            </div>

            {/* DOT Search Results */}
            {dotError && (
              <div className="mt-3 flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <AlertCircle size={14} />
                {dotError}
              </div>
            )}

            {dotResult && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-indigo-400 uppercase">
                    {dotResult.policies.length} Policies Found — DOT #{dotResult.dot}
                  </p>
                  <button
                    onClick={() => setDotResult(null)}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {dotResult.policies.map((policy, i) => (
                    <PolicyCard key={i} policy={policy} dot={dotResult.dot} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* MC Range Loader */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Database size={12} className="text-indigo-400" /> Batch from DB Range
              </span>
              <button
                onClick={() => setMcRangeMode(!mcRangeMode)}
                className={`px-3 py-1 rounded-full text-[10px] font-black transition-colors ${
                  mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {mcRangeMode ? 'ACTIVE' : 'OFF'}
              </button>
            </div>
            {mcRangeMode ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mcRangeStart}
                    onChange={e => setMcRangeStart(e.target.value)}
                    placeholder="Start MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    value={mcRangeEnd}
                    onChange={e => setMcRangeEnd(e.target.value)}
                    placeholder="End MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleMcRangeSearch}
                  className="w-full bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-xs font-black uppercase tracking-tighter transition-all"
                >
                  Load Carriers
                </button>
                {mcRangeCarriers.length > 0 && (
                  <p className="text-xs text-indigo-400 text-center font-bold">
                    {mcRangeCarriers.length} carriers loaded ✓
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                Using {carriers.length} carriers from current session
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">With Insurance</span>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-green-400" size={14} />
                  <span className="text-2xl font-black text-white">{stats.insFound}</span>
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">No Insurance</span>
                <div className="flex items-center gap-2">
                  <RotateCcw className="text-slate-500" size={14} />
                  <span className="text-2xl font-black text-slate-400">{stats.insEmpty}</span>
                </div>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">Policies Saved to DB</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Processed</span>
                <span className="text-3xl font-black text-slate-300">{stats.processed}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1.5 font-black text-slate-500 uppercase">
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
            <div className="flex items-center gap-3 text-[10px] font-mono text-slate-600">
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> searchcarriers.com
              </span>
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> Supabase
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.length === 0 && (
              <span className="text-slate-600 italic">Ready — press Start Scrape or search a DOT above...</span>
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
                <span className="opacity-30 shrink-0">{new Date().toLocaleTimeString()}</span>
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

