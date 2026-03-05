import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, Lock, Database, ShieldAlert } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { scrapeRealCarrier, downloadCSV, fetchSafetyData } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

// RESTORED SPEED: Back to 5 concurrent workers
const CONCURRENCY_LIMIT = 5;

interface ScraperProps {
  user: User;
  onUpdateUsage: (count: number) => void;
  onNewCarriers: (data: CarrierData[]) => void;
  onUpgrade: () => void;
  onFinish?: () => void;
}

export const Scraper: React.FC<ScraperProps> = ({ user, onUpdateUsage, onNewCarriers, onUpgrade, onFinish }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState<ScraperConfig>({
    startPoint: '1580000',
    recordCount: 50,
    includeCarriers: true,
    includeBrokers: false,
    onlyAuthorized: true,
    useMockData: false,
    useProxy: true,
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const [scrapedData, setScrapedData] = useState<CarrierData[]>([]);
  const [progress, setProgress] = useState(0);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [dbSaveCount, setDbSaveCount] = useState(0);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleRun = () => {
    if (isRunning) {
      setIsRunning(false);
      isRunningRef.current = false;
      setLogs(prev => [...prev, "⚠️ Process paused."]);
    } else {
      if (user.recordsExtractedToday >= user.dailyLimit) {
        setShowUpgradeModal(true);
        return;
      }
      setIsRunning(true);
      isRunningRef.current = true;
      setLogs(prev => [...prev, `🚀 Engine Started (Speed: ${CONCURRENCY_LIMIT}x)`]);
      setScrapedData([]);
      setProgress(0);
      processScrapingConcurrent();
    }
  };

  const processScrapingConcurrent = async () => {
    const start = parseInt(config.startPoint);
    const total = config.recordCount;
    let completed = 0;
    let sessionExtracted = 0;
    
    const tasks = Array.from({ length: total }, (_, i) => (start + i).toString());
    const successfulResults: CarrierData[] = [];

    const worker = async (mc: string) => {
      if (!isRunningRef.current) return;

      try {
        // STEP 1: Get basic info
        const baseData = await scrapeRealCarrier(mc, config.useProxy);

        if (baseData && baseData.dotNumber) {
          // STEP 2: Immediately enrich with Safety Rating (This was what was missing)
          const safety = await fetchSafetyData(baseData.dotNumber);
          
          const newData: CarrierData = {
            ...baseData,
            safetyRating: safety?.rating || 'NOT RATED',
            ratingDate: safety?.date || '—'
          };

          const matchesFilter = !config.onlyAuthorized || newData.status.toUpperCase().includes('AUTHORIZED');
          
          if (matchesFilter) {
            setScrapedData(prev => [...prev, newData]);
            successfulResults.push(newData);
            
            const saveResult = await saveCarrierToSupabase(newData);
            if (saveResult.success) {
              setDbSaveCount(prev => prev + 1);
              // FIXED LOG: Now shows actual rating instead of undefined
              setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData.legalName} | Rating: ${newData.safetyRating}`]);
            }
            sessionExtracted++;
            onUpdateUsage(1);
          }
        } else {
          setLogs(prev => [...prev, `[No Data] MC ${mc} not found.`]);
        }
      } catch (e) {
        setLogs(prev => [...prev, `[Error] MC ${mc}: Failed.`]);
      }

      completed++;
      setProgress(Math.round((completed / total) * 100));
    };

    // ORIGINAL CONCURRENCY LOOP (Restore speed)
    const activePromises: Promise<void>[] = [];
    for (const mc of tasks) {
      if (!isRunningRef.current) break;
      const p = worker(mc).then(() => {
        activePromises.splice(activePromises.indexOf(p), 1);
      });
      activePromises.push(p);
      if (activePromises.length >= CONCURRENCY_LIMIT) await Promise.race(activePromises);
    }

    await Promise.all(activePromises);
    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `✅ Finished.`]);
  };

  // ... (Rest of your original UI code remains exactly the same)
  return (
      // Keep your original return statement here
      <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
          {/* ... all your UI components ... */}
      </div>
  );
};
