import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Database, SearchIcon, ClipboardList, Loader2, Zap, X, AlertCircle } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

// ── Policy Card ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD':  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO':  'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND':   'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  const classColors: Record<string, string> = {
    'PRIMARY': 'bg-green-500/20 text-green-300',
    'EXCESS':  'bg-orange-500/20 text-orange-300',
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
      <div className="pt-1 border-t border-slate-800 flex justify-between items-center">
        <span className="text-[10px] text-slate-600 font-mono">DOT #{dot}</span>
        <span className="text-[10px] text-indigo-400 font-black">ACTIVE</span>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  // MC Range
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  // Manual DOT lookup
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);
  const [manualError, setManualError] = useState('');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startEnrichmentProcess(carriers);
    }
  }, [autoStart, carriers]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── Load from DB range ──
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

      const mapped = (data || []).map((row: any) => ({
        mcNumber:        row.mc_number        || '',
        dotNumber:       row.dot_number       || '',
        legalName:       row.legal_name       || '',
        dbaName:         row.dba_name         || '',
        entityType:      row.entity_type      || '',
        status:          row.status           || '',
        email:           row.email            || '',
        phone:           row.phone            || '',
        powerUnits:      row.power_units      || '',
        drivers:         row.drivers          || '',
        physicalAddress: row.physical_address || '',
        mailingAddress:  row.mailing_address  || '',
        dateScraped:     row.date_scraped     || '',
        mcs150Date:      row.mcs150_date      || '',
        mcs150Mileage:   row.mcs150_mileage   || '',
        operationClassification: row.operation_classification || [],
        carrierOperation:        row.carrier_operation        || [],
        cargoCarried:            row.cargo_carried            || [],
        outOfServiceDate:  row.out_of_service_date || '',
        stateCarrierId:    row.state_carrier_id   || '',
        dunsNumber:        row.duns_number         || '',
        safetyRating:      row.safety_rating       || '',
        safetyRatingDate:  row.safety_rating_date  || '',
        basicScores:       row.basic_scores        || [],
        oosRates:          row.oos_rates           || [],
        insurancePolicies: row.insurance_policies  || [],
      }));

      setMcRangeCarriers(mapped);
      log(`✅ Loaded ${mapped.length} carriers from DB range.`);
    } catch (err: any) {
      log(`❌ DB Error: ${err.message}`);
    }
  };

  // ── Manual DOT lookup ──
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
    } catch (e: any) {
      setManualError(`Error: ${e.message}`);
    } finally {
      setIsManualLoading(false);
    }
  };

  // ── Main sequential batch — same pattern as working component ──
  const startEnrichmentProcess = async (overrideCarriers?: CarrierData[]) => {
    if (isProcessing) return;

    const targetCarriers = overrideCarriers || (mcRangeMode ? mcRangeCarriers : carriers);
    if (targetCarriers.length === 0) {
      log('⚠️ No carriers to process.');
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setProgress(0);
    setStats({ total: targetCarriers.length, insFound: 0, insFailed: 0, dbSaved: 0 });
    log(`🚀 Starting insurance scrape for ${targetCarriers.length} carriers...`);
    log(`💾 Supabase sync: ENABLED`);

    const updatedCarriers = [...targetCarriers];
    let insFound = 0;
    let insFailed = 0;
    let dbSaved = 0;

    for (let i = 0; i < updatedCarriers.length; i++) {
      if (!isRunningRef.current) break;

      const carrier = updatedCarriers[i];
      const dot = carrier.dotNumber;

      log(`⏳ [${i + 1}/${updatedCarriers.length}] DOT: ${dot} | MC: ${carrier.mcNumber}`);

      try {
        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error('Invalid DOT');

        const { policies } = await fetchInsuranceData(dot);
        updatedCarriers[i] = { ...updatedCarriers[i], insurancePolicies: policies };

        const saveResult = await updateCarrierInsurance(dot, { policies });
        if (saveResult.success) dbSaved++;

        if (policies.length > 0) {
          insFound++;
          log(`✅ MC ${carrier.mcNumber} | DOT ${dot} → ${policies.length} policies → ${saveResult.success ? 'Saved ✓' : `DB Error: ${saveResult.error}`}`);
        } else {
          log(`⬜ MC ${carrier.mcNumber} | DOT ${dot} → No insurance on file`);
        }
      } catch (err: any) {
        insFailed++;
        log(`❌ MC ${carrier.mcNumber} | DOT ${dot} → ${err.message}`);
      }

      setProgress(Math.round(((i + 1) / updatedCarriers.length) * 100));
      setStats({ total: targetCarriers.length, insFound, insFailed, dbSaved });

      if ((i + 1) % 3 === 0 || (i + 1) === updatedCarriers.length) {
        onUpdateCarriers([...updatedCarriers]);
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Done. ${insFound} with insurance, ${insFailed} failed, ${dbSaved} saved to DB.`);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">

      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="text-indigo-500" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Insurance Scraper</h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">Sequential batch · searchcarriers.com · Supabase sync</p>
        </div>
        <button
          onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
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
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-1">

          {/* Manual DOT Lookup */}
          <div className="bg-slate-900/50 border border-slate-700/50 p-5 rounded-3xl">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <SearchIcon size={12} className="text-indigo-400" /> Manual DOT Lookup
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualDot}
                onChange={e => setManualDot(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
                placeholder="Enter USDOT number..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 placeholder-slate-600"
              />
              <button
                onClick={handleManualLookup}
                disabled={isManualLoading || !manualDot.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-black transition-colors"
              >
                {isManualLoading ? <Loader2 className="animate-spin" size={16} /> : <SearchIcon size={16} />}
              </button>
            </div>

            {manualError && (
              <div className="mt-3 flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <AlertCircle size={14} /> {manualError}
              </div>
            )}

            {manualResult && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-indigo-400 uppercase">
                    {manualResult.policies.length} Policies — DOT #{manualResult.dot}
                  </p>
                  <button onClick={() => setManualResult(null)} className="text-slate-600 hover:text-slate-400">
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {manualResult.policies.map((p, i) => (
                    <PolicyCard key={i} policy={p} dot={manualResult.dot} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* DB Range Loader */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-3xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Database size={12} className="text-indigo-400" /> Load from DB Range
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
                  <p className="text-xs text-indigo-400 text-center font-bold">{mcRangeCarriers.length} carriers loaded ✓</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600">Using {carriers.length} carriers from current session</p>
            )}
          </div>

          {/* Stats */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-3xl space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">With Insurance</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Failed</span>
                <span className="text-2xl font-black text-red-400">{stats.insFailed}</span>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl flex justify-between">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">DB Saved</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Total</span>
                <span className="text-3xl font-black text-slate-300">{stats.total}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1.5 font-black text-slate-500 uppercase">
                <span>Progress</span><span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-400 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Console */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800/50 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex items-center justify-between px-6">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Insurance Pipeline Console
            </span>
            <div className="flex items-center gap-3 text-[10px] font-mono text-slate-600">
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> searchcarriers.com</span>
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> Supabase</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.length === 0 && (
              <span className="text-slate-600 italic block text-center py-20">Ready — press Start Scrape or search a DOT above...</span>
            )}
            {logs.map((entry, i) => (
              <div key={i} className={`flex gap-3 p-2 rounded-lg ${
                entry.includes('✅') ? 'text-green-400' :
                entry.includes('❌') ? 'text-red-400' :
                entry.includes('⚠️') ? 'text-amber-400' :
                entry.includes('🎉') ? 'text-indigo-400 font-bold' :
                'text-slate-400'
              }`}>
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
