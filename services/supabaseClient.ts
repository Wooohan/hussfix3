import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ============================================================
// DATABASE TYPES (Strictly matching your SQL Schema)
// ============================================================
export interface CarrierRecord {
  id?: string;
  mc_number: string;
  dot_number: string;
  legal_name: string;
  dba_name?: string | null;
  entity_type: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  power_units?: string | null;
  drivers?: string | null;
  non_cmv_units?: string | null;
  physical_address?: string | null;
  mailing_address?: string | null;
  date_scraped: string;
  mcs150_date?: string | null;
  mcs150_mileage?: string | null;
  operation_classification?: string[];
  carrier_operation?: string[];
  cargo_carried?: string[];
  out_of_service_date?: string | null;
  state_carrier_id?: string | null;
  duns_number?: string | null;
  safety_rating?: string | null;
  safety_rating_date?: string | null;
  basic_scores?: any;
  oos_rates?: any;
  insurance_policies?: any; // Matches SQL: insurance_policies
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// SAVE / UPSERT OPERATIONS
// ============================================================

export const saveCarrierToSupabase = async (carrier: any) => {
  try {
    const record: CarrierRecord = {
      mc_number: carrier.mcNumber,
      dot_number: String(carrier.dotNumber),
      legal_name: carrier.legalName,
      dba_name: carrier.dbaName || null,
      entity_type: carrier.entityType,
      status: carrier.status,
      email: carrier.email || null,
      phone: carrier.phone || null,
      power_units: carrier.powerUnits || null,
      drivers: carrier.drivers || null,
      non_cmv_units: carrier.nonCmvUnits || null,
      physical_address: carrier.physicalAddress || null,
      mailing_address: carrier.mailingAddress || null,
      date_scraped: carrier.dateScraped,
      mcs150_date: carrier.mcs150Date || null,
      mcs150_mileage: carrier.mcs150Mileage || null,
      operation_classification: carrier.operationClassification || [],
      carrier_operation: carrier.carrierOperation || [],
      cargo_carried: carrier.cargoCarried || [],
      out_of_service_date: carrier.outOfServiceDate || null,
      state_carrier_id: carrier.stateCarrierId || null,
      duns_number: carrier.dunsNumber || null,
      safety_rating: carrier.safetyRating || null,
      safety_rating_date: carrier.safetyRatingDate || null,
      basic_scores: carrier.basicScores || null,
      oos_rates: carrier.oosRates || null,
      insurance_policies: carrier.insurancePolicies || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('carriers')
      .upsert(record, { onConflict: 'mc_number' })
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err: any) {
    console.error('❌ Supabase Save Error:', err);
    return { success: false, error: err.message || err };
  }
};

// ============================================================
// UPDATE OPERATIONS (Fixed for snake_case)
// ============================================================

export const updateCarrierInsurance = async (dotNumber: string, data: { policies: any[] }) => {
  try {
    // FIX: Using snake_case to match SQL table exactly
    const { data: result, error, status } = await supabase
      .from('carriers')
      .update({ 
        insurance_policies: data.policies, // FIXED: was insurancePolicies
        updated_at: new Date().toISOString() 
      })
      .eq('dot_number', String(dotNumber)) // FIXED: was dotNumber
      .select();

    if (error) {
      console.error("❌ DB Update Failed:", error.message, "Code:", error.code);
      return { success: false, error: { message: error.message, code: error.code } };
    }

    // Check if the record actually existed to be updated
    if (!result || result.length === 0) {
      return { success: false, error: { message: `No carrier found with DOT ${dotNumber}`, code: 'NOT_FOUND' } };
    }

    return { success: true, data: result };
  } catch (err: any) {
    console.error("🚨 Network/CORS Error:", err);
    return { success: false, error: { message: err.message, code: 'NETWORK_FAILURE' } };
  }
};

// ============================================================
// FETCH OPERATIONS (Fixed Range logic)
// ============================================================

export const getCarriersByMCRange = async (start: string, end: string) => {
  try {
    const { data, error } = await supabase
      .from('carriers')
      .select('*')
      .gte('mc_number', start)
      .lte('mc_number', end)
      .order('mc_number', { ascending: true });

    if (error) throw error;

    // Map back to CamelCase for your React components
    return (data || []).map(record => ({
      mcNumber: record.mc_number,
      dotNumber: record.dot_number,
      legalName: record.legal_name,
      insurancePolicies: record.insurance_policies || [],
      status: record.status
    }));
  } catch (err) {
    console.error('❌ Range Fetch Error:', err);
    return [];
  }
};

export const fetchCarriersFromSupabase = async (filters: any = {}) => {
  try {
    let query = supabase.from('carriers').select('*');

    if (filters.mcNumber) query = query.ilike('mc_number', `%${filters.mcNumber}%`);
    if (filters.dotNumber) query = query.ilike('dot_number', `%${filters.dotNumber}%`);
    if (filters.legalName) query = query.ilike('legal_name', `%${filters.legalName}%`);
    
    query = query.order('created_at', { ascending: false }).limit(filters.limit || 200);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((record: any) => ({
      mcNumber: record.mc_number,
      dotNumber: record.dot_number,
      legalName: record.legal_name,
      dbaName: record.dba_name,
      entityType: record.entity_type,
      status: record.status,
      email: record.email,
      phone: record.phone,
      powerUnits: record.power_units,
      drivers: record.drivers,
      physicalAddress: record.physical_address,
      dateScraped: record.date_scraped,
      insurancePolicies: record.insurance_policies || [],
      basicScores: record.basic_scores || [],
      oosRates: record.oos_rates || []
    }));
  } catch (err) {
    console.error('❌ Fetch Error:', err);
    return [];
  }
};
