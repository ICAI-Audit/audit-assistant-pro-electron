import { useCallback, useEffect, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';

const db = getSQLiteClient();

const SECTION_NAME = 'form_3ca';

const removeUndefinedValues = <T extends Record<string, unknown>>(value: T): T => {
  const cleaned = { ...value };
  Object.keys(cleaned).forEach((key) => {
    if (cleaned[key] === undefined) {
      delete cleaned[key];
    }
  });
  return cleaned;
};

export function useForm3CADocument(engagementId?: string | null) {
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
        .maybeSingle();

      if (error) throw error;
      setDocument(data || null);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load 3CA document', err);
      setError(err.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  const saveDocument = useCallback(
    async (contentHtml: string, sectionTitle?: string, contentJson: Record<string, unknown> = {}) => {
      if (!engagementId) {
        setError('Select an engagement before saving');
        return null;
      }

      setSaving(true);
      try {
        const payload = removeUndefinedValues({
          engagement_id: engagementId,
          section_name: SECTION_NAME,
          section_title: sectionTitle || 'Form 3CA',
          content_json: JSON.stringify(contentJson),
          content_html: contentHtml,
          changed_by: user?.id || null,
        });

        const existing = await db
          .from('audit_report_documents')
          .select('*')
          .eq('engagement_id', engagementId)
          .eq('section_name', SECTION_NAME)
          .maybeSingle();

        let error;
        if (existing.data) {
          const result = await db
            .from('audit_report_documents')
            .update(payload)
            .eq('engagement_id', engagementId)
            .eq('section_name', SECTION_NAME)
            .execute();
          error = result.error;
        } else {
          const result = await db
            .from('audit_report_documents')
            .insert(payload)
            .execute();
          error = result.error;
        }

        if (error) throw error;
        const { data: savedData, error: fetchError } = await db
          .from('audit_report_documents')
          .select('*')
          .eq('engagement_id', engagementId)
          .eq('section_name', SECTION_NAME)
          .maybeSingle();

        if (fetchError) throw fetchError;
        const savedDocument = savedData || { ...payload };
        setDocument(savedDocument);
        setError(null);
        return savedDocument;
      } catch (err: any) {
        console.error('Failed to save 3CA document', err);
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
