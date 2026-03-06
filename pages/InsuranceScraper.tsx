import React, { useState, useEffect, useRef } from 'react';
import { Play, Download, Database, SearchIcon, ClipboardList, Loader2, Zap } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {

  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const [stats, setStats] = useState({
    total: 0,
    insFound: 0,
    insFailed: 0,
    dbSaved: 0
  });

  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<InsurancePolicy[] | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startEnrichmentProcess();
    }
  }, [autoStart, carriers]);

  const startEnrichmentProcess = async () => {

    if (isProcessing) return;

    if (carriers.length === 0) {
      setLogs(prev => [...prev, "❌ No carriers found. Load carriers first."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;

    setLogs(prev => [...prev, `🚀 INSURANCE ENRICHMENT STARTED`]);
    setLogs(prev => [...prev, `🔍 Target: ${carriers.length} USDOT records`]);

    const updatedCarriers = [...carriers];

    let insFound = 0;
    let insFailed = 0;
    let dbSaved = 0;

    for (let i = 0; i < updatedCarriers.length; i++) {

      if (!isRunningRef.current) break;

      const dot = updatedCarriers[i].dotNumber;

      setLogs(prev => [...prev, `⏳ [${i + 1}/${updatedCarriers.length}] Fetching Insurance for DOT ${dot}`]);

      try {

        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");

        const { policies } = await fetchInsuranceData(dot);

        updatedCarriers[i] = {
          ...updatedCarriers[i],
          insurancePolicies: policies
        };

        const saveResult = await updateCarrierInsurance(dot, { policies });

        if (saveResult.success) dbSaved++;

        if (policies.length > 0) {
          insFound++;
          setLogs(prev => [...prev, `✅ ${policies.length} policies found for ${dot}`]);
        } else {
          setLogs(prev => [...prev, `⚠️ No insurance found for ${dot}`]);
        }

      } catch (err) {

        insFailed++;
        setLogs(prev => [...prev, `❌ Insurance fetch failed for ${dot}`]);

      }

      setProgress(Math.round(((i + 1) / updatedCarriers.length) * 100));

      setStats({
        total: updatedCarriers.length,
        insFound,
        insFailed,
        dbSaved
      });

      if ((i + 1) % 3 === 0 || (i + 1) === updatedCarriers.length) {
        onUpdateCarriers([...updatedCarriers]);
      }

    }

    setIsProcessing(false);
    isRunningRef.current = false;

    setLogs(prev => [...prev, `🎉 Insurance Enrichment Complete`]);
    setLogs(prev => [...prev, `💾 Total DB Updates: ${dbSaved}`]);
  };

  const handleManualCheck = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!manualDot) return;

    setIsManualLoading(true);
    setManualResult(null);

    try {

      const { policies } = await fetchInsuranceData(manualDot);
      setManualResult(policies);

    } catch (error) {

      console.error("Manual check failed", error);

    } finally {

      setIsManualLoading(false);

    }
  };

  const handleExport = () => {

    const enrichedData = carriers.filter(c => c.insurancePolicies && c.insurancePolicies.length > 0);

    if (enrichedData.length === 0) return;

    const headers = ["DOT", "Legal Name", "Insurance Carrier", "Coverage", "Type"];

    const rows = enrichedData.flatMap(c => {

      return c.insurancePolicies!.map(p => [

        c.dotNumber,
        `"${c.legalName}"`,
        `"${p.carrier}"`,
        p.coverageAmount,
        p.type

      ]);

    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;

    link.download = `insurance_data_${new Date().toISOString().split('T')[0]}.csv`;

    link.click();
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden">

      <div className="flex justify-between items-end mb-8">

        <div>
          <h1 className="text-3xl font-extrabold text-white">Insurance Intelligence</h1>
          <p className="text-slate-400">Batch Insurance Extraction & Supabase Sync</p>
        </div>

        <div className="flex gap-4">

          <button
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
            className="flex items-center gap-3 px-8 py-3 rounded-2xl font-black bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
            {isProcessing ? 'Stop' : 'Run Insurance Scraper'}
          </button>

          <button
            disabled={stats.insFound === 0}
            onClick={handleExport}
            className="flex items-center gap-3 px-6 py-3 bg-slate-800 disabled:opacity-50 text-white rounded-2xl"
          >
            <Download size={20} />
            Export CSV
          </button>

        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1">

        {/* Manual Lookup */}

        <div className="col-span-12 lg:col-span-4">

          <div className="bg-slate-900 p-6 rounded-3xl">

            <h3 className="text-sm font-bold mb-4 flex gap-2 items-center">
              <SearchIcon size={16} /> Manual Insurance Lookup
            </h3>

            <form onSubmit={handleManualCheck}>

              <input
                value={manualDot}
                onChange={(e) => setManualDot(e.target.value)}
                placeholder="Enter USDOT"
                className="w-full bg-slate-800 p-3 rounded-xl text-white"
              />

              <button
                type="submit"
                disabled={isManualLoading}
                className="mt-3 w-full bg-indigo-600 p-3 rounded-xl"
              >
                {isManualLoading ? <Loader2 className="animate-spin mx-auto" /> : "Check Insurance"}
              </button>

            </form>

            {manualResult && (
              <div className="mt-4 space-y-2">

                {manualResult.length === 0 && (
                  <div className="text-slate-400 text-sm">No insurance found</div>
                )}

                {manualResult.map((p, i) => (
                  <div key={i} className="bg-slate-800 p-3 rounded-xl text-sm">
                    <div className="font-bold">{p.carrier}</div>
                    <div>{p.coverageAmount}</div>
                    <div className="text-slate-400">{p.type}</div>
                  </div>
                ))}

              </div>
            )}

          </div>

        </div>

        {/* Logs */}

        <div className="col-span-12 lg:col-span-8 bg-slate-950 rounded-3xl p-6 overflow-y-auto">

          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={16} />
            <span className="text-sm">Processing Logs</span>
          </div>

          <div className="space-y-2 text-xs font-mono">

            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}

            <div ref={logsEndRef} />

          </div>

        </div>

      </div>
    </div>
  );
};
