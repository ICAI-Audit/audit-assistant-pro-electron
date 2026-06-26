import { useCallback, useEffect, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';

const db = getSQLiteClient();

const SECTION_NAME = 'form_3cb';

export function useForm3CBDocument(engagementId?: string | null) {
  const { user } = useAuth();
  const [document, setDocument] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocument = useCallback(async () => {
    if (!engagementId) {
      setDocument(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await db
        .from('audit_report_documents')
        .select('*')
        .eq('engagement_id', engagementId)
        .eq('section_name', SECTION_NAME)
        .single();

      if (error) throw error;
      setDocument(data || null);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load 3CB document', err);
      setError(err.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  const saveDocument = useCallback(
    async (contentHtml: string, sectionTitle?: string) => {
      if (!engagementId) {
        setError('Select an engagement before saving');
        return null;
      }

      setSaving(true);
      try {
        const payload = {
          engagement_id: engagementId,
          section_name: SECTION_NAME,
          section_title: sectionTitle || 'Form 3CB',
          content_html: contentHtml,
          changed_by: user?.id || null,
        };

        const existing = await db
          .from('audit_report_documents')
          .select('*')
          .eq('engagement_id', engagementId)
          .eq('section_name', SECTION_NAME)
          .single();

        const result = existing.data
          ? await db
              .from('audit_report_documents')
              .update(payload)
              .eq('engagement_id', engagementId)
              .eq('section_name', SECTION_NAME)
              .execute()
          : await db.from('audit_report_documents').insert(payload).execute();

        if (result.error) throw result.error;
        setDocument(result.data);
        setError(null);
        return result.data;
      } catch (err: any) {
        console.error('Failed to save 3CB document', err);
        setError(err.message || 'Failed to save document');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [engagementId, user?.id]
  );

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  return {
    document,
    loading,
    saving,
    error,
    saveDocument,
    refresh: fetchDocument,
  };
}
