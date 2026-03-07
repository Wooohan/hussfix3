try {
  if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");
  
  // 1. Fetch from Insurance API
  const { policies } = await fetchInsuranceData(dot);
  
  // 2. Attempt to Save to Supabase
  const saveResult = await updateCarrierInsurance(dot, { policies });
  
  if (saveResult.success) {
    dbSaved++;
    // Only update local state once DB confirms
    updatedCarriers[i] = { ...updatedCarriers[i], insurancePolicies: policies };
    setLogs(prev => [...prev, `✅ [${dot}] Synced to DB`]);
  } else {
    // This is likely where your 120-record batch is failing
    console.error(`DB Sync Error for ${dot}:`, saveResult.error);
    setLogs(prev => [...prev, `⚠️ [${dot}] Fetched but DB SAVE FAILED: ${saveResult.error?.message}`]);
  }
  
  // 3. Small "Breather" for the DB (Throttling)
  if (i % 10 === 0) await new Promise(res => setTimeout(res, 200)); 

} catch (err) {
  insFailed++;
  setLogs(prev => [...prev, `❌ [${dot}] API Fetch Timeout/Error`]);
}
