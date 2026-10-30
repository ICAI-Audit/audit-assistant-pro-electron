import { useState, useEffect } from 'react';
import { getSQLiteClient, storage } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { toast } from 'sonner';

const db = getSQLiteClient();

export interface EvidenceFile {
  id: string;
  name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  mime_type: string | null;
  linked_procedure: string | null;
  workpaper_ref: string | null;
  uploaded_by: string;
  engagement_id: string | null;
  created_at: string;
  uploader_name?: string;
  // Approval workflow fields
  approval_stage: 'draft' | 'prepared' | 'reviewed' | 'approved';
  prepared_by: string | null;
  prepared_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
}

export function useEvidenceFiles(engagementId?: string) {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, profile, role } = useAuth();
  const { currentEngagement } = useEngagement();

  const effectiveEngagementId = engagementId || currentEngagement?.id;

  const logActivity = async (action: string, entity: string, details: string, entityId?: string, logEngagementId?: string) => {
    if (!user || !profile) return;
    await db.from('activity_logs').insert({
      user_id: user.id,
      user_name: profile.full_name,
      action,
      entity,
      entity_id: entityId || null,
      engagement_id: logEngagementId || null,
      details,
    }).execute();
  };

  const logAuditTrail = async (
    entityType: string,
    entityId: string,
    action: string,
    oldValue?: string,
    newValue?: string,
    reason?: string
  ) => {
    if (!user) return;
    await db.from('audit_trail').insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      old_value: oldValue || null,
      new_value: newValue || null,
      reason: reason || null,
      performed_by: user.id,
    }).execute();
  };

  const fetchFiles = async () => {
    if (!effectiveEngagementId) {
      setFiles([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await db
        .from('evidence_files')
        .select('*')
        .eq('engagement_id', effectiveEngagementId)
        .order('created_at', { ascending: false })
        .execute();

      if (error) throw error;

      // Fetch uploader names
      const uploaderIds = [...new Set(data?.map(f => f.uploaded_by) || [])];
      
      // Fetch all profiles and filter - SQLite doesn't have .in() yet
      let profileMap = new Map<string, string>();
      
      if (uploaderIds.length > 0) {
        const { data: allProfiles } = await db
          .from('profiles')
          .select('user_id, full_name')
          .execute();
        
        // Filter to only the uploader IDs we need
        const profiles = allProfiles?.filter(p => uploaderIds.includes(p.user_id)) || [];
        profileMap = new Map(profiles.map(p => [p.user_id, p.full_name]));
      }
      
      const filesWithNames = data?.map(f => ({
        ...f,
        uploader_name: profileMap.get(f.uploaded_by) || 'Unknown'
      })) || [];

      setFiles(filesWithNames as EvidenceFile[]);
    } catch (error) {
      console.error('Error fetching evidence files:', error);
      toast.error('Failed to load evidence files');
    } finally {
      setLoading(false);
    }
  };

  const uploadFile = async (
    file: File,
    metadata: {
      name: string;
      file_type: string;
      linked_procedure?: string;
      workpaper_ref?: string;
    }
  ) => {
    if (!user) {
      toast.error('You must be logged in to upload files');
      return null;
    }

    if (!effectiveEngagementId) {
      toast.error('Please select an engagement first');
      return null;
    }

    try {
      const filePath = `${effectiveEngagementId}/${user.id}/${Date.now()}-${file.name}`;

      const { data, error: dbError } = await db
        .from('evidence_files')
        .insert({
          name: metadata.name || file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: metadata.file_type,
          mime_type: file.type,
          linked_procedure: metadata.linked_procedure || null,
          workpaper_ref: metadata.workpaper_ref || null,
          uploaded_by: user.id,
          engagement_id: effectiveEngagementId,
        })
        .execute();

      if (dbError) throw dbError;

      const newFile = Array.isArray(data) ? data[0] : data;
      if (!newFile) {
        throw new Error('Failed to save file metadata');
      }

      try {
        const { error: uploadError } = await storage
          .from('evidence')
          .upload(filePath, file);

        if (uploadError) throw uploadError;
      } catch (uploadError) {
        const { error: cleanupError } = await db
          .from('evidence_files')
          .delete()
          .eq('id', newFile.id)
          .execute();
        if (cleanupError) {
          throw new Error(`Evidence upload failed and its metadata could not be removed: ${cleanupError.message}`);
        }
        throw uploadError;
      }

      // Log activity
      await logActivity('Uploaded', 'Evidence', `Uploaded file: ${metadata.name || file.name}`, newFile.id, effectiveEngagementId);

      toast.success('File uploaded successfully');
      await fetchFiles();
      return newFile;
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error(error.message || 'Failed to upload file');
      return null;
    }
  };

  const updateFile = async (id: string, updates: Partial<EvidenceFile>) => {
    try {
      const { error } = await db
        .from('evidence_files')
        .update(updates)
        .eq('id', id)
        .execute();

      if (error) throw error;
      
      toast.success('File updated');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error updating file:', error);
      toast.error(error.message || 'Failed to update file');
    }
  };

  const deleteFile = async (file: EvidenceFile) => {
    if (file.locked) {
      toast.error('Cannot delete locked file');
      return;
    }

    try {
      // Delete from storage
      const { error: storageError } = await storage
        .from('evidence')
        .remove([file.file_path]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await db
        .from('evidence_files')
        .delete()
        .eq('id', file.id)
        .execute();

      if (dbError) throw dbError;

      // Log activity
      await logActivity('Deleted', 'Evidence', `Deleted file: ${file.name}`, file.id, file.engagement_id || undefined);

      toast.success('File deleted successfully');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error deleting file:', error);
      toast.error(error.message || 'Failed to delete file');
    }
  };

  const downloadFile = async (file: EvidenceFile) => {
    try {
      const { data, error } = await storage
        .from('evidence')
        .download(file.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error downloading file:', error);
      toast.error(error.message || 'Failed to download file');
    }
  };

  const getFileUrl = async (file: EvidenceFile) => {
    const { data } = await storage
      .from('evidence')
      .getPublicUrl(file.file_path);
    return data?.publicUrl || null;
  };

  // Approval workflow actions
  const markPrepared = async (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    try {
      const { error } = await db
        .from('evidence_files')
        .update({ approval_stage: 'prepared' })
        .eq('id', id)
        .execute();

      if (error) throw error;

      await logAuditTrail('evidence_file', id, 'marked_prepared', file.approval_stage, 'prepared');
      await logActivity('Prepared', 'Evidence', `Marked file as prepared: ${file.name}`, id, file.engagement_id || undefined);
      
      toast.success('File marked as prepared');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error marking prepared:', error);
      toast.error(error.message || 'Failed to mark as prepared');
    }
  };

  const markReviewed = async (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    if (role !== 'partner' && role !== 'manager') {
      toast.error('Only Partner/Manager can mark as reviewed');
      return;
    }

    try {
      const { error } = await db
        .from('evidence_files')
        .update({ approval_stage: 'reviewed' })
        .eq('id', id)
        .execute();

      if (error) throw error;

      await logAuditTrail('evidence_file', id, 'marked_reviewed', file.approval_stage, 'reviewed');
      await logActivity('Reviewed', 'Evidence', `Marked file as reviewed: ${file.name}`, id, file.engagement_id || undefined);
      
      toast.success('File marked as reviewed');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error marking reviewed:', error);
      toast.error(error.message || 'Failed to mark as reviewed');
    }
  };

  const approveFile = async (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    if (role !== 'partner' && role !== 'manager') {
      toast.error('Only Partner/Manager can approve');
      return;
    }

    try {
      const { error } = await db
        .from('evidence_files')
        .update({ approval_stage: 'approved' })
        .eq('id', id)
        .execute();

      if (error) throw error;

      await logAuditTrail('evidence_file', id, 'approved', file.approval_stage, 'approved');
      await logActivity('Approved', 'Evidence', `Approved file: ${file.name}`, id, file.engagement_id || undefined);
      
      toast.success('File approved and locked');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error approving:', error);
      toast.error(error.message || 'Failed to approve');
    }
  };

  const unlockFile = async (id: string, reason: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    if (role !== 'partner' && role !== 'manager') {
      toast.error('Only Partner/Manager can unlock');
      return;
    }

    if (!reason.trim()) {
      toast.error('Unlock reason is required');
      return;
    }

    try {
      const { error } = await db
        .from('evidence_files')
        .update({ 
          locked: 0, 
          unlock_reason: reason,
          approval_stage: 'reviewed'
        })
        .eq('id', id)
        .execute();

      if (error) throw error;

      await logAuditTrail('evidence_file', id, 'unlocked', 'locked', 'unlocked', reason);
      await logActivity('Unlocked', 'Evidence', `Unlocked file: ${file.name}. Reason: ${reason}`, id, file.engagement_id || undefined);
      
      toast.success('File unlocked');
      await fetchFiles();
    } catch (error: any) {
      console.error('Error unlocking:', error);
      toast.error(error.message || 'Failed to unlock');
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [effectiveEngagementId]);

  return {
    files,
    loading,
    uploadFile,
    updateFile,
    deleteFile,
    downloadFile,
    getFileUrl,
    markPrepared,
    markReviewed,
    approveFile,
    unlockFile,
    refetch: fetchFiles,
    canReview: role === 'partner' || role === 'manager',
    canApprove: role === 'partner' || role === 'manager',
    canUnlock: role === 'partner' || role === 'manager',
  };
}
