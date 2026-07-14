export const TAX_AUDIT_STATUTORY_SCOPE_LABEL = 'AY 2025-26 | Rule 6G | Forms 3CA, 3CB, 3CD';
export const TAX_AUDIT_SUPPORTED_ASSESSMENT_YEAR = '2025-26';

export const getTaxAuditStatutoryVersionWarning = (assessmentYear?: string | null) => {
  const ay = (assessmentYear || '').trim();
  if (!ay) {
    return `Assessment year is not set. The configured Form 3CD library is tagged for ${TAX_AUDIT_STATUTORY_SCOPE_LABEL}; verify the applicable statutory form before finalization.`;
  }
  if (ay !== TAX_AUDIT_SUPPORTED_ASSESSMENT_YEAR) {
    return `This engagement is for AY ${ay}, while the configured Form 3CD library is tagged for ${TAX_AUDIT_STATUTORY_SCOPE_LABEL}. Verify the current Income-tax Rules, CBDT notifications and portal schema before relying on statutory export.`;
  }
  return '';
};
