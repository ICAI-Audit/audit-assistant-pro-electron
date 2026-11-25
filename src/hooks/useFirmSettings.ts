import { useState, useEffect } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const db = getSQLiteClient();

export interface FirmSettings {
  id: string;
  firm_name: string;
  firm_registration_no: string | null;
  constitution: string | null;
  no_of_partners: number | null;
  icai_unique_sl_no: string | null;
  address: string | null;
  place: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useFirmSettings() {
  const [firmSettings, setFirmSettings] = useState<FirmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchFirmSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await db
        .from('firm_settings')
        .select('*')
        .limit(1)
        .single()
        .execute();

      if (error) {
        // If no data found, that's okay - settings might not exist yet
        if (error.message && error.message.includes('No rows')) {
          setFirmSettings(null);
          setLoading(false);
          return;
        }
        throw error;
      }
      
      // Set data even if it's null (means no settings exist yet)
      setFirmSettings(data || null);
    } catch (error: any) {
      console.error('Error fetching firm settings:', error);
      // Don't show error toast for "no data" scenarios
      if (error?.message && !error.message.includes('No rows')) {
        console.warn('Failed to fetch firm settings:', error.message);
      }
      setFirmSettings(null);
    } finally {
      setLoading(false);
    }
  };

  const saveFirmSettings = async (data: Partial<FirmSettings>) => {
    if (!user) {
      toast.error('You must be logged in to save firm settings');
      return null;
    }

    try {
      if (firmSettings && firmSettings.id) {
        // Update existing
        const { data: updated, error } = await db
          .from('firm_settings')
          .update({
            firm_name: data.firm_name || firmSettings.firm_name,
            firm_registration_no: data.firm_registration_no ?? firmSettings.firm_registration_no,
            constitution: data.constitution ?? firmSettings.constitution,
            no_of_partners: data.no_of_partners ?? firmSettings.no_of_partners,
            icai_unique_sl_no: data.icai_unique_sl_no ?? firmSettings.icai_unique_sl_no,
            address: data.address ?? firmSettings.address,
            place: (data.place ?? firmSettings.place)?.trim() || null,
          })
          .eq('id', firmSettings.id)
          .execute();

        if (error) throw error;
        
        // Fetch updated record
        const { data: refreshed, error: fetchError } = await db
          .from('firm_settings')
          .select('*')
          .eq('id', firmSettings.id)
          .single()
          .execute();

        if (fetchError) throw fetchError;
        if (refreshed) {
          setFirmSettings(refreshed);
        }
        toast.success('Firm settings saved');
        return refreshed;
      } else {
        // Create new
        const { data: created, error } = await db
          .from('firm_settings')
          .insert({
            firm_name: data.firm_name || 'My Firm',
            firm_registration_no: data.firm_registration_no || null,
            constitution: data.constitution || null,
            no_of_partners: data.no_of_partners || null,
            icai_unique_sl_no: data.icai_unique_sl_no || null,
            address: data.address || null,
            place: data.place?.trim() || null,
            created_by: user.id,
          })
          .select()
          .single()
          .execute();

        if (error) throw error;
        if (created) {
          setFirmSettings(created);
        }
        toast.success('Firm settings created');
        return created;
      }
    } catch (error: any) {
      console.error('Error saving firm settings:', error);
      toast.error(error.message || 'Failed to save firm settings');
      return null;
    }
  };

  useEffect(() => {
    fetchFirmSettings();
  }, []);

  return {
    firmSettings,
    loading,
    saveFirmSettings,
    refetch: fetchFirmSettings,
  };
}
