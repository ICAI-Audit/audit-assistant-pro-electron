'use strict';

const CORE_TABLES = new Set([
  'firm_settings',
  'partners',
  'clients',
  'financial_years',
  'client_gstins',
]);

const ENGAGEMENT_TABLES = new Set([
  'audit_procedures',
  'procedure_assignees',
  'procedure_checklist_items',
  'procedure_evidence_requirements',
  'evidence_files',
  'evidence_links',
  'risks',
  'review_notes',
  'compliance_applicability',
  'materiality_risk_assessment',
  'audit_report_setup',
  'audit_report_main_content',
  'audit_report_documents',
  'audit_report_document_versions',
  'audit_report_comments',
  'audit_report_evidence',
  'audit_report_exports',
  'key_audit_matters',
  'caro_clause_responses',
  'trial_balance_lines',
  'schedule_iii_config',
  'tb_new_entity_info',
  'tb_new_ledgers',
  'tb_new_stock_items',
  'tb_new_classification_mappings',
  'tb_new_sessions',
  'going_concern_workpapers',
  'going_concern_checklist_items',
  'gc_annexure_net_worth',
  'gc_annexure_profitability',
  'gc_annexure_borrowings',
  'gc_annexure_cash_flows',
  'gc_annexure_ratios',
  'rule_engine_override_rules',
  'ifc_report_content',
  'ifc_control_responses',
  'tax_audit_engagements',
  'tax_audit_clause_responses',
  'tax_audit_clause_evidence',
  'tax_audit_acceptance_checks',
  'tax_audit_qualifications',
  'tax_audit_review_notes',
  'tax_audit_exports',
]);

const MANAGER_DELETE_TABLES = new Set([
  'audit_procedures',
  'procedure_assignees',
  'procedure_checklist_items',
  'procedure_evidence_requirements',
  'evidence_files',
  'evidence_links',
  'risks',
  'review_notes',
  'compliance_applicability',
  'materiality_risk_assessment',
]);

const AUDIT_PROGRAM_TABLES = new Set([
  'audit_programs_new',
  'audit_program_sections',
  'audit_program_boxes',
  'audit_program_attachments',
]);

const GLOBAL_MANAGER_TABLES = new Set([
  'caro_clause_library',
  'caro_standard_answers',
  'aile_rule_sets',
  'aile_mapping_rules',
  'rule_engine_group_rules',
  'rule_engine_keyword_rules',
  'rule_engine_validation_rules',
  'standard_programs',
  'standard_procedures',
  'procedure_template_checklist_items',
  'procedure_template_evidence_requirements',
  'engagement_letter_templates',
]);

const GLOBAL_READ_TABLES = new Set([
  'notifications',
  'activity_logs',
  'audit_trail',
  'feedback_reports',
  'feedback_attachments',
  'tally_bridge_sessions',
  'tally_bridge_requests',
  'fs_templates',
  'tax_audit_statutory_versions',
]);

const PARENT_RELATIONS = {
  procedure_assignees: ['procedure_id', 'audit_procedures'],
  procedure_checklist_items: ['procedure_id', 'audit_procedures'],
  procedure_evidence_requirements: ['procedure_id', 'audit_procedures'],
  audit_program_sections: ['audit_program_id', 'audit_programs_new'],
  audit_program_boxes: ['section_id', 'audit_program_sections'],
  audit_program_attachments: ['audit_program_id', 'audit_programs_new'],
  tax_audit_clause_responses: ['tax_audit_id', 'tax_audit_engagements'],
  tax_audit_acceptance_checks: ['tax_audit_id', 'tax_audit_engagements'],
  tax_audit_qualifications: ['tax_audit_id', 'tax_audit_engagements'],
  tax_audit_review_notes: ['tax_audit_id', 'tax_audit_engagements'],
};

const VALID_ROLES = new Set(['admin', 'partner', 'manager', 'senior', 'staff']);

function getTableColumns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
}

function getAuthorizationContext(db, userId) {
  const profile = db.prepare(
    'SELECT user_id FROM profiles WHERE user_id = ? AND is_active = 1'
  ).get(userId);
  if (!profile) {
    throw new Error('Authenticated account is inactive or unavailable.');
  }

  const roles = db.prepare(
    'SELECT role FROM user_roles WHERE user_id = ?'
  ).all(userId).map((row) => row.role);
  const supportedRoles = roles.filter((role) => VALID_ROLES.has(role));
  if (supportedRoles.length === 0) {
    throw new Error('This account has no supported application role.');
  }

  const roleSet = new Set(supportedRoles);
  const isAdmin = roleSet.has('admin');
  const isPartner = isAdmin || roleSet.has('partner');

  return {
    userId,
    roles: roleSet,
    isAdmin,
    isPartner,
    isManagerOrAbove: isPartner || roleSet.has('manager'),
    hasGlobalEngagementAccess: isPartner,
  };
}

function canAccessTable(context, table, action) {
  if (!['select', 'insert', 'upsert', 'update', 'delete'].includes(action)) {
    return false;
  }
  if (action === 'upsert') {
    return canAccessTable(context, table, 'insert')
      && canAccessTable(context, table, 'update');
  }

  if (table === 'user_roles') {
    return action === 'select' || context.isAdmin;
  }
  if (table === 'profiles') {
    return action === 'select' || action === 'update';
  }
  if (CORE_TABLES.has(table)) {
    if (action === 'select') return true;
    if (action === 'insert' || action === 'update') return context.isManagerOrAbove;
    return context.isPartner;
  }
  if (table === 'engagements') {
    if (action === 'select' || action === 'insert') return true;
    if (action === 'update') return true;
    return context.isManagerOrAbove;
  }
  if (table === 'engagement_assignments') {
    return action === 'select' || context.isManagerOrAbove;
  }
  if (ENGAGEMENT_TABLES.has(table)) {
    if (action === 'delete' && MANAGER_DELETE_TABLES.has(table)) {
      return context.isManagerOrAbove;
    }
    return true;
  }
  if (AUDIT_PROGRAM_TABLES.has(table)) {
    return action !== 'delete' || context.isPartner;
  }
  if (GLOBAL_MANAGER_TABLES.has(table)) {
    if (table === 'engagement_letter_templates') {
      return action === 'select' || context.isPartner;
    }
    return action === 'select' || context.isManagerOrAbove;
  }
  if (GLOBAL_READ_TABLES.has(table)) {
    if (table === 'notifications') {
      return ['select', 'insert', 'update', 'delete'].includes(action);
    }
    if (table === 'activity_logs' || table === 'audit_trail') {
      return action === 'select' || action === 'insert';
    }
    if (table === 'feedback_reports' || table === 'feedback_attachments') {
      if (action === 'select' || action === 'insert') return true;
      if (action === 'update') return context.isPartner;
      return false;
    }
    if (table === 'fs_templates' || table === 'tally_bridge_sessions' || table === 'tally_bridge_requests') {
      return true;
    }
    return action === 'select';
  }
  return false;
}

function hasEngagementAccess(db, context, engagementId) {
  if (context.hasGlobalEngagementAccess) return true;
  if (!engagementId) return false;
  return Boolean(db.prepare(`
    SELECT 1
    FROM engagement_assignments
    WHERE user_id = ? AND engagement_id = ?
  `).get(context.userId, engagementId));
}

function getRecordEngagementIds(db, table, row, visited = new Set()) {
  if (!row || visited.has(table)) return [];
  visited.add(table);

  if (table === 'evidence_links') {
    const procedure = db.prepare(
      'SELECT engagement_id FROM audit_procedures WHERE id = ?'
    ).get(row.procedure_id);
    const evidence = db.prepare(
      'SELECT engagement_id FROM evidence_files WHERE id = ?'
    ).get(row.evidence_id);
    if (!procedure?.engagement_id || procedure.engagement_id !== evidence?.engagement_id) {
      return [];
    }
    return [procedure.engagement_id];
  }

  if (table === 'tax_audit_clause_evidence') {
    const audit = db.prepare(
      'SELECT engagement_id FROM tax_audit_engagements WHERE id = ?'
    ).get(row.tax_audit_id);
    const evidence = db.prepare(
      'SELECT engagement_id FROM evidence_files WHERE id = ?'
    ).get(row.evidence_file_id);
    if (!audit?.engagement_id || audit.engagement_id !== evidence?.engagement_id) {
      return [];
    }
    return [audit.engagement_id];
  }

  if (table === 'engagements') {
    return row.id ? [row.id] : [];
  }

  if (Object.prototype.hasOwnProperty.call(row, 'engagement_id')) {
    return row.engagement_id ? [row.engagement_id] : [];
  }

  const relation = PARENT_RELATIONS[table];
  if (relation) {
    const [foreignKey, parentTable] = relation;
    const parent = db.prepare(
      `SELECT * FROM "${parentTable}" WHERE id = ?`
    ).get(row[foreignKey]);
    return getRecordEngagementIds(db, parentTable, parent, visited);
  }

  return null;
}

function rowIsAuthorized(db, context, table, row) {
  if (table === 'notifications' && row.user_id !== context.userId) {
    return false;
  }

  const engagementIds = getRecordEngagementIds(db, table, row);
  if (engagementIds === null) {
    return !ENGAGEMENT_TABLES.has(table) && !AUDIT_PROGRAM_TABLES.has(table);
  }
  return engagementIds.length > 0
    && engagementIds.every((engagementId) => hasEngagementAccess(db, context, engagementId));
}

function buildEngagementScope(db, context, table, sourceAlias = table, visited = new Set()) {
  if (visited.has(table)) return null;
  visited.add(table);

  if (table === 'evidence_links') {
    const assignedClause = context.hasGlobalEngagementAccess
      ? ''
      : 'AND p.engagement_id IN (SELECT engagement_id FROM engagement_assignments WHERE user_id = ?)';
    return {
      sql: `EXISTS (
        SELECT 1
        FROM audit_procedures p
        JOIN evidence_files e ON e.id = "${sourceAlias}"."evidence_id"
        WHERE p.id = "${sourceAlias}"."procedure_id"
          AND p.engagement_id = e.engagement_id
          ${assignedClause}
      )`,
      params: context.hasGlobalEngagementAccess ? [] : [context.userId],
    };
  }

  if (table === 'tax_audit_clause_evidence') {
    const assignedClause = context.hasGlobalEngagementAccess
      ? ''
      : 'AND a.engagement_id IN (SELECT engagement_id FROM engagement_assignments WHERE user_id = ?)';
    return {
      sql: `EXISTS (
        SELECT 1
        FROM tax_audit_engagements a
        JOIN evidence_files e ON e.id = "${sourceAlias}"."evidence_file_id"
        WHERE a.id = "${sourceAlias}"."tax_audit_id"
          AND a.engagement_id = e.engagement_id
          ${assignedClause}
      )`,
      params: context.hasGlobalEngagementAccess ? [] : [context.userId],
    };
  }

  if (table === 'engagements') {
    return context.hasGlobalEngagementAccess
      ? null
      : {
        sql: `"${sourceAlias}"."id" IN (
          SELECT engagement_id FROM engagement_assignments WHERE user_id = ?
        )`,
        params: [context.userId],
      };
  }

  if (table === 'engagement_assignments') {
    return context.hasGlobalEngagementAccess
      ? null
      : {
        sql: `"${sourceAlias}"."engagement_id" IN (
          SELECT engagement_id FROM engagement_assignments WHERE user_id = ?
        )`,
        params: [context.userId],
      };
  }

  const columns = getTableColumns(db, table);
  if (columns.includes('engagement_id')) {
    return context.hasGlobalEngagementAccess
      ? null
      : {
        sql: `"${sourceAlias}"."engagement_id" IN (
          SELECT engagement_id FROM engagement_assignments WHERE user_id = ?
        )`,
        params: [context.userId],
      };
  }

  const relation = PARENT_RELATIONS[table];
  if (relation) {
    const [foreignKey, parentTable] = relation;
    const parentScope = buildEngagementScope(db, context, parentTable, parentTable, visited);
    if (!parentScope && !context.hasGlobalEngagementAccess) return { sql: '1 = 0', params: [] };
    const parentWhere = parentScope ? ` WHERE ${parentScope.sql}` : '';
    return {
      sql: `"${sourceAlias}"."${foreignKey}" IN (
        SELECT "${parentTable}"."id" FROM "${parentTable}"${parentWhere}
      )`,
      params: parentScope?.params || [],
    };
  }

  if (table === 'notifications') {
    return {
      sql: `"${sourceAlias}"."user_id" = ?`,
      params: [context.userId],
    };
  }

  return ENGAGEMENT_TABLES.has(table) || AUDIT_PROGRAM_TABLES.has(table)
    ? { sql: '1 = 0', params: [] }
    : null;
}

function isProtectedUpdate(table, context, data, row) {
  const keys = Object.keys(data || {});
  if (keys.some((key) => key === 'id')) return true;
  if (table === 'profiles') {
    const allowed = new Set(['full_name', 'avatar_url', 'phone', 'membership_number']);
    return row.user_id !== context.userId
      || keys.some((key) => !allowed.has(key));
  }
  if (table === 'user_roles') {
    return !context.isAdmin
      || row.user_id === context.userId
      || keys.some((key) => !['role'].includes(key));
  }
  if (table === 'engagements' && keys.some((key) => ['created_by', 'id'].includes(key))) return true;
  if (table === 'engagement_assignments' && keys.some((key) => ['user_id', 'engagement_id', 'id'].includes(key))) return true;
  if (ENGAGEMENT_TABLES.has(table) && keys.some((key) => ['id', 'engagement_id', 'created_by', 'uploaded_by'].includes(key))) {
    return true;
  }
  return false;
}

module.exports = {
  buildEngagementScope,
  canAccessTable,
  getAuthorizationContext,
  getRecordEngagementIds,
  isProtectedUpdate,
  rowIsAuthorized,
};
