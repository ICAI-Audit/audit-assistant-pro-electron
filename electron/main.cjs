const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const { initializeAutoUpdater } = require('./auto-updater.cjs');
const crypto = require('crypto');
const fs = require('fs');
let Database;
let bcrypt;

function safeLog(...args) {
  try {
    console.log(...args);
  } catch (error) {
    if (!error || error.code !== 'EPIPE') {
      // Ignore logging failures to keep the main process stable.
    }
  }
}

// ODBC is optional - only load if available
let odbc = null;
try {
  odbc = require('odbc');
} catch (error) {
  console.warn('ODBC module not available - Tally integration will be disabled');
}

// SQLite is optional - only load if available
let sqliteDb = null;
function getSqliteDb() {
  try {
    if (!Database) {
      try {
        Database = require('better-sqlite3');
        safeLog('✅ better-sqlite3 loaded successfully');
      } catch (error) {
        safeLog('❌ better-sqlite3 module not available:', error.message);
        safeLog('   Error details:', error.stack);
        safeLog('   This usually means the module needs to be rebuilt for Electron.');
        safeLog('   Try running: npx electron-rebuild -f -w better-sqlite3');
        return null;
      }
    }
    if (!bcrypt) {
      try {
        bcrypt = require('bcrypt');
        safeLog('✅ bcrypt loaded successfully');
      } catch (error) {
        safeLog('❌ bcrypt module not available:', error.message);
        safeLog('   Error details:', error.stack);
        safeLog('   This usually means the module needs to be rebuilt for Electron.');
        safeLog('   Try running: npx electron-rebuild -f -w bcrypt');
        return null;
      }
    }
    if (!sqliteDb) {
      try {
        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'audit_assistant.db');
        sqliteDb = new Database(dbPath);

        // Enable foreign keys and optimizations
        sqliteDb.pragma('foreign_keys = ON');
        sqliteDb.pragma('journal_mode = WAL');
        sqliteDb.pragma('synchronous = NORMAL');

        safeLog('✅ SQLite database opened at:', dbPath);
        safeLog('🔧 Initializing database schema from schema files...');

        // Always initialize full schema to ensure all tables exist
        // This is idempotent (uses CREATE TABLE IF NOT EXISTS)
        // DO NOT wrap in try-catch - we want this to fail loudly if there's a problem
        initializeDatabaseSchema(sqliteDb);
        runAuditReportSetupSchemaMigration(sqliteDb);
        runAuditReportMainContentSchemaMigration(sqliteDb);
        runEngagementLetterTemplateTypeMigration(sqliteDb);
        safeLog('✅ All database tables initialized successfully!');
        runTaxAuditAy2025Backfill(sqliteDb);

      } catch (dbError) {
        safeLog('❌ Failed to create SQLite database:', dbError.message);
        safeLog('   Error details:', dbError.stack);

        // Show error dialog to user
        const { dialog } = require('electron');
        if (app && app.isReady()) {
          dialog.showErrorBox(
            'Database Initialization Error',
            `Failed to initialize database:\n\n${dbError.message}\n\nDetails: ${dbError.stack ? dbError.stack.substring(0, 500) : 'See console logs'}\n\nPlease check the console for full details and reinstall if the problem persists.`
          );
        }

        throw dbError;
      }
    }

    return sqliteDb;
  } catch (error) {
    safeLog('❌ Failed to initialize SQLite database:', error.message);
    safeLog('   Full error:', error.stack);
    return null;
  }
}

/**
 * Initialize database schema by reading and executing all schema files
 * Uses ONLY the schema files from sqlite/schema/ directory
 */
function initializeDatabaseSchema(db) {
  safeLog('   📦 Initializing database schema from SQL files...');

  // Helper function to clean SQL statement - removes comments but keeps the SQL
  const cleanStatement = (stmt) => {
    return stmt
      .split('\n')
      .map(line => line.trim())
      .filter(line => !line.startsWith('--'))  // Remove comment-only lines
      .join('\n')
      .trim();
  };

  // Smart SQL statement splitter that respects BEGIN...END blocks
  const splitSqlStatements = (sql) => {
    const statements = [];
    let currentStatement = '';
    let beginCount = 0;
    
    // Split by semicolon but track BEGIN/END depth
    const lines = sql.split('\n');
    
    for (let line of lines) {
      const trimmed = line.trim();
      
      // Skip comment-only lines
      if (trimmed.startsWith('--')) {
        continue;
      }
      
      // Add line to current statement
      currentStatement += line + '\n';
      
      // Track BEGIN/END depth (case-insensitive, word boundaries)
      const upperLine = trimmed.toUpperCase();
      if (/\bBEGIN\b/.test(upperLine)) {
        beginCount++;
      }
      if (/\bEND\b/.test(upperLine)) {
        beginCount--;
      }
      
      // If line ends with semicolon and we're not inside a BEGIN...END block
      if (trimmed.endsWith(';') && beginCount === 0) {
        const cleaned = cleanStatement(currentStatement);
        if (cleaned.length > 0) {
          statements.push(cleaned);
        }
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim().length > 0) {
      const cleaned = cleanStatement(currentStatement);
      if (cleaned.length > 0) {
        statements.push(cleaned);
      }
    }
    
    return statements;
  };

  // Determine schema directory location - try multiple paths
  let schemaDir = null;
  const possiblePaths = [];

  if (app.isPackaged) {
    // In production, try resources path first
    possiblePaths.push(path.join(process.resourcesPath, 'sqlite', 'schema'));
    possiblePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'sqlite', 'schema'));
    possiblePaths.push(path.join(__dirname, '..', 'sqlite', 'schema'));
    safeLog('   📦 Running as packaged app');
    safeLog('   resourcesPath:', process.resourcesPath);
  } else {
    // In development
    possiblePaths.push(path.join(__dirname, '..', 'sqlite', 'schema'));
    possiblePaths.push(path.join(process.cwd(), 'sqlite', 'schema'));
    safeLog('   🔧 Running in development mode');
  }

  // Find first existing schema directory
  for (const p of possiblePaths) {
    safeLog(`   Checking path: ${p}`);
    if (fs.existsSync(p)) {
      schemaDir = p;
      safeLog(`   ✓ Found schema directory at: ${p}`);
      break;
    }
  }

  if (!schemaDir) {
    const errorMsg = `Schema directory not found! Tried paths:\n${possiblePaths.join('\n')}`;
    safeLog(`   ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const schemaFiles = [
    '01_core_tables.sql',
    '02_audit_workflow_tables.sql',
    '03_audit_program_tables.sql',
    '04_audit_report_tables.sql',
    '05_trial_balance_tables.sql',
    '06_going_concern_tables.sql',
    '07_rule_engine_tables.sql',
    '08_template_system_tables.sql',
    '09_tax_audit_tables.sql'
  ];

  safeLog(`   Executing ${schemaFiles.length} schema files...`);

  let totalSuccess = 0;
  let totalSkip = 0;
  let totalErrors = 0;

  schemaFiles.forEach((file, index) => {
    const filePath = path.join(schemaDir, file);

    if (!fs.existsSync(filePath)) {
      safeLog(`   ❌ Schema file not found: ${filePath}`);
      throw new Error(`Missing required schema file: ${file}`);
    }

    const sql = fs.readFileSync(filePath, 'utf8');

    if (!sql || sql.trim().length === 0) {
      safeLog(`   ⚠️  Schema file is empty: ${file}`);
      return;
    }

    // Use smart SQL splitter that handles BEGIN...END blocks properly
    const statements = splitSqlStatements(sql);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      try {
        // Execute statement (already includes semicolon from splitter)
        db.exec(statement);
        successCount++;
      } catch (error) {
        // "already exists" errors are OK - table/index/trigger already there
        if (error.message && error.message.includes('already exists')) {
          skipCount++;
        } else {
          // Real error - log it but continue with other statements
          errorCount++;
          safeLog(`      ⚠️  Error in ${file}: ${error.message}`);
          // Log statement preview for debugging
          const preview = statement.substring(0, 100).replace(/\n/g, ' ');
          safeLog(`         Statement: ${preview}...`);
        }
      }
    }

    totalSuccess += successCount;
    totalSkip += skipCount;
    totalErrors += errorCount;

    if (errorCount > 0) {
      safeLog(`   ${index + 1}. ⚠️  ${file} - ${successCount} ok, ${skipCount} existed, ${errorCount} errors`);
    } else {
      safeLog(`   ${index + 1}. ✓ ${file} - ${successCount} ok, ${skipCount} existed`);
    }
  });

  safeLog(`   📊 Total: ${totalSuccess} statements executed, ${totalSkip} already existed, ${totalErrors} errors`);

  // Verify tables created
  const tableCount = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
  ).get();

  safeLog(`✅ Database schema initialized! (${tableCount.count} tables)`);

  // Verify specific important tables exist
  const importantTables = [
    'clients',
    'engagements',
    'profiles',
    'user_roles',
    'financial_years',
    'audit_programs_new',
    'risks',
    'evidence_files'
  ];
  const missingTables = [];
  for (const tableName of importantTables) {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);
    if (!exists) {
      missingTables.push(tableName);
      safeLog(`   ❌ Missing table: ${tableName}`);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(`Critical tables missing after initialization: ${missingTables.join(', ')}`);
  }

  safeLog(`✅ Verified all ${importantTables.length} critical tables exist`);
}

function runAuditReportSetupSchemaMigration(db) {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'audit_report_setup'"
  ).get();

  if (!tableExists) {
    return;
  }

  const existingColumns = new Set(
    db.prepare('PRAGMA table_info(audit_report_setup)').all().map((column) => column.name)
  );

  const requiredColumns = [
    ['is_standalone', 'INTEGER DEFAULT 1'],
    ['is_public_unlisted_company', 'INTEGER DEFAULT 0'],
    ['is_private_exceeding_threshold', 'INTEGER DEFAULT 0'],
    ['is_private_non_exceeding_threshold', 'INTEGER DEFAULT 0'],
    ['private_turnover_above_50cr', 'INTEGER DEFAULT 0'],
    ['private_borrowing_above_25cr', 'INTEGER DEFAULT 0'],
    ['caro_exclusion_reason', 'TEXT'],
    ['caro_annexure_letter', "TEXT DEFAULT 'A'"],
    ['ifc_annexure_letter', "TEXT DEFAULT 'B'"],
    ['company_profit_or_loss', 'TEXT'],
    ['branch_locations', 'TEXT'],
    ['predecessor_auditor_name', 'TEXT'],
    ['predecessor_report_date', 'TEXT'],
    ['has_subsidiaries', 'INTEGER DEFAULT 0'],
    ['paid_up_capital', 'REAL DEFAULT 0'],
    ['reserves_surplus', 'REAL DEFAULT 0'],
    ['borrowings_amount', 'REAL DEFAULT 0'],
    ['report_status', "TEXT DEFAULT 'draft'"],
    ['locked_at', 'TEXT'],
    ['locked_by', 'TEXT'],
    ['unlock_reason', 'TEXT'],
    ['unlocked_at', 'TEXT'],
    ['unlocked_by', 'TEXT'],
  ];

  const addedColumns = [];
  for (const [columnName, definition] of requiredColumns) {
    if (existingColumns.has(columnName)) {
      continue;
    }

    db.exec(`ALTER TABLE audit_report_setup ADD COLUMN "${columnName}" ${definition}`);
    addedColumns.push(columnName);
  }

  if (addedColumns.length > 0) {
    safeLog(`   Audit report setup schema migration added: ${addedColumns.join(', ')}`);
  }
}

function runAuditReportMainContentSchemaMigration(db) {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'audit_report_main_content'"
  ).get();

  if (!tableExists) {
    return;
  }

  const existingColumns = new Set(
    db.prepare('PRAGMA table_info(audit_report_main_content)').all().map((column) => column.name)
  );

  const requiredColumns = [
    ['basis_for_opinion_is_example', 'INTEGER DEFAULT 0'],
    ['going_concern_details', 'TEXT'],
    ['going_concern_note_ref', 'TEXT'],
    ['finalized_at', 'TEXT'],
    ['finalized_by', 'TEXT'],
    ['board_report_status', 'TEXT'],
    ['board_report_misstatement_details', 'TEXT'],
    ['clause_143_3_a_status', 'TEXT'],
    ['clause_143_3_a_details', 'TEXT'],
    ['clause_143_3_b_audit_trail_status', 'TEXT'],
    ['clause_143_3_b_audit_trail_details', 'TEXT'],
    ['clause_143_3_b_server_outside_india', 'INTEGER'],
    ['clause_143_3_c_branch_returns', 'TEXT'],
    ['clause_143_3_e_going_concern_impact', 'TEXT'],
    ['clause_143_3_f_directors_disqualified', 'INTEGER'],
    ['clause_143_3_f_disqualified_details', 'TEXT'],
    ['clause_143_3_g_qualification_impact', 'TEXT'],
    ['clause_143_3_h_remuneration_status', 'TEXT'],
    ['clause_143_3_h_details', 'TEXT'],
    ['clause_143_3_i_ifc_qualification', 'TEXT'],
    ['rule_11_a_pending_litigations', 'TEXT'],
    ['rule_11_a_note_ref', 'TEXT'],
    ['rule_11_b_long_term_contracts', 'TEXT'],
    ['rule_11_b_note_ref', 'TEXT'],
    ['rule_11_c_iepf_status', 'TEXT'],
    ['rule_11_c_delay_amount', 'REAL'],
    ['rule_11_c_delay_details', 'TEXT'],
    ['rule_11_d_audit_procedures_status', 'TEXT'],
    ['rule_11_d_loan_fund_representations', 'INTEGER'],
    ['rule_11_d_modification_details', 'TEXT'],
    ['rule_11_d_receiving_fund_representations', 'INTEGER'],
    ['rule_11_e_dividend_status', 'TEXT'],
    ['rule_11_e_dividend_note_ref', 'TEXT'],
    ['rule_11_e_dividend_details', 'TEXT'],
    ['rule_11_e_interim_dividend_paid', 'INTEGER'],
    ['rule_11_e_interim_dividend_declared_not_paid', 'INTEGER'],
    ['rule_11_e_final_dividend_previous_year', 'INTEGER'],
    ['rule_11_e_final_dividend_proposed', 'INTEGER'],
    ['rule_11_e_final_dividend_amount', 'REAL'],
    ['rule_11_e_interim_dividend_amount', 'REAL'],
    ['rule_11_f_audit_trail_status', 'TEXT'],
    ['rule_11_f_audit_trail_details', 'TEXT'],
    ['rule_11_g_funds_advanced_status', 'TEXT'],
    ['rule_11_g_funds_advanced_details', 'TEXT'],
  ];

  const addedColumns = [];
  for (const [columnName, definition] of requiredColumns) {
    if (existingColumns.has(columnName)) {
      continue;
    }

    db.exec(`ALTER TABLE audit_report_main_content ADD COLUMN "${columnName}" ${definition}`);
    addedColumns.push(columnName);
  }

  if (addedColumns.length > 0) {
    safeLog(`   Audit report main content schema migration added: ${addedColumns.join(', ')}`);
  }
}

function runEngagementLetterTemplateTypeMigration(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'engagement_letter_templates'").get();

  if (!table?.sql) {
    return;
  }

  const requiredTemplateTypes = [
    'statutory_audit_company_without_ifc',
    'statutory_audit_company_with_ifc',
    'tax_audit_partnership_3ca',
    'tax_audit_partnership_3cb',
  ];

  if (requiredTemplateTypes.every((type) => table.sql.includes(`'${type}'`))) {
    return;
  }

  safeLog('   Migrating engagement letter template type constraint...');

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS engagement_letter_templates_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        template_type TEXT NOT NULL CHECK (template_type IN ('statutory_audit_company_without_ifc', 'statutory_audit_company_with_ifc', 'tax_audit_partnership_3ca', 'tax_audit_partnership_3cb')),
        template_name TEXT NOT NULL,
        template_description TEXT,
        file_content TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size_bytes INTEGER,
        mime_type TEXT,
        available_variables TEXT,
        version_number INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        uploaded_by TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        admin_notes TEXT,
        FOREIGN KEY (uploaded_by) REFERENCES profiles(user_id) ON DELETE CASCADE
      );
    `);

    const compatibleRows = db.prepare(`
      SELECT *
      FROM engagement_letter_templates
      WHERE template_type IN ('statutory_audit_company_without_ifc', 'statutory_audit_company_with_ifc', 'tax_audit_partnership_3ca', 'tax_audit_partnership_3cb')
    `).all();

    const insert = db.prepare(`
      INSERT OR REPLACE INTO engagement_letter_templates_new (
        id,
        template_type,
        template_name,
        template_description,
        file_content,
        file_name,
        file_size_bytes,
        mime_type,
        available_variables,
        version_number,
        is_active,
        uploaded_by,
        uploaded_at,
        updated_by,
        updated_at,
        admin_notes
      ) VALUES (
        @id,
        @template_type,
        @template_name,
        @template_description,
        @file_content,
        @file_name,
        @file_size_bytes,
        @mime_type,
        @available_variables,
        @version_number,
        @is_active,
        @uploaded_by,
        @uploaded_at,
        @updated_by,
        @updated_at,
        @admin_notes
      )
    `);

    compatibleRows.forEach((row) => insert.run(row));

    db.exec(`
      DROP TRIGGER IF EXISTS update_engagement_letter_templates_timestamp;
      DROP INDEX IF EXISTS idx_engagement_letter_templates_type;
      DROP INDEX IF EXISTS idx_engagement_letter_templates_active;
      DROP INDEX IF EXISTS idx_engagement_letter_templates_uploaded_by;
      DROP TABLE engagement_letter_templates;
      ALTER TABLE engagement_letter_templates_new RENAME TO engagement_letter_templates;
      CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_type ON engagement_letter_templates(template_type);
      CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_active ON engagement_letter_templates(is_active);
      CREATE INDEX IF NOT EXISTS idx_engagement_letter_templates_uploaded_by ON engagement_letter_templates(uploaded_by);
      CREATE TRIGGER IF NOT EXISTS update_engagement_letter_templates_timestamp
      AFTER UPDATE ON engagement_letter_templates
      BEGIN
          UPDATE engagement_letter_templates SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `);
  });

  rebuild();
  safeLog('   Engagement letter template type constraint migration complete.');
}

function runTaxAuditAy2025Backfill(db) {
  const oldVersion = 'ITA_1961_RULE_6G_3CA_3CB_3CD';
  const newVersion = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';
  const targetAssessmentYear = 'AY 2025-26';
  const targetFinancialYear = 'FY 2024-25';

  const hasTable = (tableName) => Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName)
  );

  if (
    !hasTable('tax_audit_statutory_versions') ||
    !hasTable('tax_audit_engagements') ||
    !hasTable('tax_audit_clause_responses')
  ) {
    safeLog('   Tax Audit AY 2025-26 backfill skipped: Tax Audit tables are not available.');
    return;
  }

  const insertVersion = db.prepare(`
    INSERT OR IGNORE INTO tax_audit_statutory_versions (
      version_key,
      display_name,
      act_name,
      rule_reference,
      form_set,
      effective_from,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const eligibleEngagements = db.prepare(`
    SELECT id, engagement_id, assessment_year, financial_year
    FROM tax_audit_engagements
    WHERE statutory_version = ?
      AND (assessment_year IS NULL OR TRIM(assessment_year) = '' OR TRIM(assessment_year) = ?)
      AND (financial_year IS NULL OR TRIM(financial_year) = '' OR TRIM(financial_year) = ?)
  `);

  const findDuplicate = db.prepare(`
    SELECT id
    FROM tax_audit_engagements
    WHERE engagement_id = ?
      AND statutory_version = ?
      AND id != ?
    LIMIT 1
  `);

  const updateEngagement = db.prepare(`
    UPDATE tax_audit_engagements
    SET statutory_version = ?
    WHERE id = ?
      AND statutory_version = ?
  `);

  const updateClauseResponses = db.prepare(`
    UPDATE tax_audit_clause_responses
    SET statutory_version = ?
    WHERE tax_audit_id = ?
      AND statutory_version = ?
  `);

  try {
    insertVersion.run(
      newVersion,
      'Income-tax Act, 1961 - Rule 6G - Forms 3CA/3CB/3CD - AY 2025-26',
      'Income-tax Act, 1961',
      'Rule 6G, Income-tax Rules, 1962; Notification No. 23/2025',
      '3CA/3CB/3CD',
      '2025-04-01'
    );

    const rows = eligibleEngagements.all(oldVersion, targetAssessmentYear, targetFinancialYear);
    let migrated = 0;
    let clauseResponsesUpdated = 0;
    const conflicts = [];

    const migrateRows = db.transaction(() => {
      for (const row of rows) {
        const duplicate = findDuplicate.get(row.engagement_id, newVersion, row.id);
        if (duplicate) {
          conflicts.push({
            oldTaxAuditId: row.id,
            existingTaxAuditId: duplicate.id,
            engagementId: row.engagement_id,
          });
          continue;
        }

        const engagementResult = updateEngagement.run(newVersion, row.id, oldVersion);
        if (engagementResult.changes === 0) {
          continue;
        }

        migrated += engagementResult.changes;
        const clauseResult = updateClauseResponses.run(newVersion, row.id, oldVersion);
        clauseResponsesUpdated += clauseResult.changes;
      }
    });

    migrateRows();

    if (conflicts.length > 0) {
      safeLog(`   Tax Audit AY 2025-26 backfill conflicts: ${conflicts.length} engagement(s) left unchanged.`);
      conflicts.forEach((conflict) => {
        safeLog(
          `      engagement_id=${conflict.engagementId}, old_tax_audit_id=${conflict.oldTaxAuditId}, existing_ay_2025_26_tax_audit_id=${conflict.existingTaxAuditId}`
        );
      });
    }

    safeLog(
      `   Tax Audit AY 2025-26 backfill complete: ${migrated} engagement(s) migrated, ${clauseResponsesUpdated} clause response(s) updated.`
    );
  } catch (error) {
    safeLog('   Tax Audit AY 2025-26 backfill failed:', error.message);
    throw error;
  }
}

let currentUserId = null;

const isDev = process.env.NODE_ENV !== 'production' && (process.env.NODE_ENV === 'development' || (app && !app.isPackaged));

// ODBC connection handling
let odbcConnection = null;

function setAppMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { role: 'close', label: 'Close Window' },
        { type: 'separator' },
        { role: 'quit', label: 'Exit', accelerator: 'Alt+F+X' },
      ],
    },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '&View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '&Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About ICAI VERA',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox({
              type: 'info',
              title: 'About ICAI VERA',
              message: 'ICAI VERA',
              detail: `Version: ${app.getVersion()}\nProfessional Audit Tool`,
              buttons: ['OK'],
              icon: path.join(__dirname, '../build/icon.png'),
            });
          }
        }
      ]
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  const { ipcMain } = require('electron');

  // --- SQLite AUTH & QUERY HANDLERS ---
  ipcMain.handle('sqlite-auth', async (event, payload) => {
    const db = getSqliteDb();
    if (!db) {
      return { data: null, error: { message: 'SQLite not available. Please ensure better-sqlite3 and bcrypt are installed.' } };
    }

    const { action, email, password, fullName } = payload || {};

    try {
      if (action === 'signup') {
        if (!email || !password) {
          return { data: null, error: { message: 'Email and password are required.' } };
        }

        const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(email);
        if (existing) {
          return { data: null, error: { message: 'This email is already registered.' } };
        }

        const id = crypto.randomBytes(16).toString('hex');
        const user_id = id;
        const name = fullName || email.split('@')[0];
        const passwordHash = bcrypt.hashSync(password, 10);

        const insertProfile = db.prepare(`
          INSERT INTO profiles (id, user_id, full_name, email, password_hash, is_active)
          VALUES (?, ?, ?, ?, ?, 1)
        `);
        insertProfile.run(id, user_id, name, email, passwordHash);

        const countRow = db.prepare('SELECT COUNT(*) as count FROM user_roles').get();
        const isFirstUser = !countRow || countRow.count === 0;
        const role = isFirstUser ? 'admin' : 'staff';

        const insertRole = db.prepare(`
          INSERT INTO user_roles (id, user_id, role)
          VALUES (?, ?, ?)
        `);
        insertRole.run(crypto.randomBytes(16).toString('hex'), user_id, role);

        currentUserId = user_id;

        return {
          data: {
            id,
            user_id,
            email,
            full_name: name,
            role,
          },
          error: null,
        };
      }

      if (action === 'login') {
        if (!email || !password) {
          return { data: null, error: { message: 'Email and password are required.' } };
        }

        const row = db.prepare('SELECT * FROM profiles WHERE email = ? AND is_active = 1').get(email);
        if (!row || !row.password_hash) {
          return { data: null, error: { message: 'Invalid login credentials' } };
        }

        const ok = bcrypt.compareSync(password, row.password_hash);
        if (!ok) {
          return { data: null, error: { message: 'Invalid login credentials' } };
        }

        currentUserId = row.user_id;

        return {
          data: {
            id: row.id,
            user_id: row.user_id,
            email: row.email,
            full_name: row.full_name,
          },
          error: null,
        };
      }

      if (action === 'logout') {
        currentUserId = null;
        return { data: null, error: null };
      }

      return { data: null, error: { message: 'Unknown auth action' } };
    } catch (error) {
      console.error('SQLite auth error:', error);
      return { data: null, error: { message: error.message || 'SQLite auth failed' } };
    }
  });

  ipcMain.handle('sqlite-get-current-user', async () => {
    const db = getSqliteDb();
    if (!db || !currentUserId) {
      return null;
    }
    try {
      const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(currentUserId);
      if (!row) return null;
      return {
        id: row.id,
        user_id: row.user_id,
        email: row.email,
        full_name: row.full_name,
      };
    } catch (error) {
      console.error('SQLite getCurrentUser error:', error);
      return null;
    }
  });

  ipcMain.handle('sqlite-query', async (event, payload) => {
    const db = getSqliteDb();
    if (!db) {
      safeLog('❌ sqlite-query called but database is not available');
      return { data: null, error: { message: 'SQLite not available. Please ensure better-sqlite3 and bcrypt are installed and rebuilt for Electron. Run: npx electron-rebuild -f -w better-sqlite3,bcrypt' } };
    }

    // Extract table name outside try-catch so it's available in error handler
    const { table, action, columns, filters, data, orderBy, limit, onConflict } = payload || {};

    try {
      if (!table || !action) {
        return { data: null, error: { message: 'Table and action are required.' } };
      }

      const safeIdentifier = (identifier) => {
        if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
          throw new Error(`Invalid SQL identifier: ${identifier}`);
        }
        // Wrap in double quotes to handle SQL reserved keywords like "order"
        return `"${identifier}"`;
      };

      const toSqliteValue = (value) => {
        if (typeof value === 'boolean') {
          return value ? 1 : 0;
        }
        if (value === undefined) {
          return null;
        }
        if (Array.isArray(value) || (value && typeof value === 'object' && !Buffer.isBuffer(value))) {
          return JSON.stringify(value);
        }
        return value;
      };

      const safeTable = safeIdentifier(table);
      const colList = columns && typeof columns === 'string' ? columns : '*';
      const whereClauses = [];
      const params = [];

      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (f && f.column) {
            const column = safeIdentifier(f.column);
            const operator = f.operator || 'eq';
            if (operator === 'in') {
              const values = Array.isArray(f.value) ? f.value : [];
              if (values.length === 0) {
                whereClauses.push('1 = 0');
              } else {
                whereClauses.push(`${column} IN (${values.map(() => '?').join(', ')})`);
                params.push(...values.map(toSqliteValue));
              }
            } else if (operator === 'neq') {
              whereClauses.push(`${column} != ?`);
              params.push(toSqliteValue(f.value));
            } else if (operator === 'gte') {
              whereClauses.push(`${column} >= ?`);
              params.push(toSqliteValue(f.value));
            } else if (operator === 'lte') {
              whereClauses.push(`${column} <= ?`);
              params.push(toSqliteValue(f.value));
            } else if (operator === 'gt') {
              whereClauses.push(`${column} > ?`);
              params.push(toSqliteValue(f.value));
            } else if (operator === 'lt') {
              whereClauses.push(`${column} < ?`);
              params.push(toSqliteValue(f.value));
            } else if (operator === 'is') {
              if (f.value === null) {
                whereClauses.push(`${column} IS NULL`);
              } else {
                whereClauses.push(`${column} IS ?`);
                params.push(toSqliteValue(f.value));
              }
            } else {
              whereClauses.push(`${column} = ?`);
              params.push(toSqliteValue(f.value));
            }
          }
        }
      }

      const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';

      // Build ORDER BY clause
      let orderSql = '';
      if (orderBy && orderBy.column) {
        const orderColumn = safeIdentifier(orderBy.column);
        const direction = orderBy.ascending ? 'ASC' : 'DESC';
        orderSql = ` ORDER BY ${orderColumn} ${direction}`;
      }

      // Build LIMIT clause
      let limitSql = '';
      if (limit && typeof limit === 'number' && limit > 0) {
        limitSql = ` LIMIT ${limit}`;
      }

      if (action === 'select') {
        const sql = `SELECT ${colList} FROM ${safeTable}${whereSql}${orderSql}${limitSql}`;
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        return { data: rows, error: null };
      }

      if (action === 'insert') {
        if (!data || (Array.isArray(data) && data.length === 0)) {
          return { data: null, error: { message: 'No data to insert.' } };
        }
        const rows = Array.isArray(data) ? data : [data];
        const inserted = [];
        for (const row of rows) {
          const cleanRow = { ...row };
          // ONLY set created_by='system' if the field exists in the row but is empty
          // Don't add created_by to tables that don't have this column (like activity_logs)
          if ('created_by' in cleanRow && !cleanRow.created_by) {
            cleanRow.created_by = 'system';
          }

          const keys = Object.keys(cleanRow);
          const placeholders = keys.map(() => '?').join(', ');
          const safeKeys = keys.map(safeIdentifier);
          const sql = `INSERT INTO ${safeTable} (${safeKeys.join(', ')}) VALUES (${placeholders})`;
          const stmt = db.prepare(sql);
          const result = stmt.run(...keys.map((k) => toSqliteValue(cleanRow[k])));

          // Fetch the inserted row to get the auto-generated ID
          const insertedRow = db.prepare(`SELECT * FROM ${safeTable} WHERE rowid = ?`).get(result.lastInsertRowid);
          inserted.push(insertedRow || cleanRow);
        }
        return { data: inserted, error: null };
      }

      if (action === 'upsert') {
        if (!data || (Array.isArray(data) && data.length === 0)) {
          return { data: null, error: { message: 'No data to upsert.' } };
        }
        const rows = Array.isArray(data) ? data : [data];
        const conflictColumnNames = typeof onConflict === 'string' && onConflict.trim()
          ? onConflict.split(',').map((column) => column.trim()).filter(Boolean)
          : [];
        const conflictColumns = conflictColumnNames.map(safeIdentifier);
        const upserted = [];

        for (const row of rows) {
          const cleanRow = { ...row };
          const keys = Object.keys(cleanRow);
          const safeKeys = keys.map(safeIdentifier);
          const placeholders = keys.map(() => '?').join(', ');

          let conflictSql = '';
          if (conflictColumns.length > 0) {
            const updateKeys = safeKeys.filter((key) => !conflictColumns.includes(key));
            if (updateKeys.length > 0) {
              conflictSql = ` ON CONFLICT(${conflictColumns.join(', ')}) DO UPDATE SET ${updateKeys.map((key) => `${key} = excluded.${key}`).join(', ')}`;
            } else {
              conflictSql = ` ON CONFLICT(${conflictColumns.join(', ')}) DO NOTHING`;
            }
          } else {
            conflictSql = ' OR REPLACE';
          }

          const sql = conflictColumns.length > 0
            ? `INSERT INTO ${safeTable} (${safeKeys.join(', ')}) VALUES (${placeholders})${conflictSql}`
            : `INSERT${conflictSql} INTO ${safeTable} (${safeKeys.join(', ')}) VALUES (${placeholders})`;
          const stmt = db.prepare(sql);
          const result = stmt.run(...keys.map((k) => toSqliteValue(cleanRow[k])));

          if (conflictColumns.length > 0) {
            const lookupWhere = conflictColumns.map((column) => `${column} = ?`).join(' AND ');
            const lookupParams = conflictColumnNames.map((column) => toSqliteValue(cleanRow[column]));
            const upsertedRow = db.prepare(`SELECT * FROM ${safeTable} WHERE ${lookupWhere}`).get(...lookupParams);
            upserted.push(upsertedRow || cleanRow);
          } else {
            const upsertedRow = db.prepare(`SELECT * FROM ${safeTable} WHERE rowid = ?`).get(result.lastInsertRowid);
            upserted.push(upsertedRow || cleanRow);
          }
        }

        return { data: upserted, error: null };
      }

      if (action === 'update') {
        if (!data) {
          return { data: null, error: { message: 'No data to update.' } };
        }
        const keys = Object.keys(data);
        const setSql = keys.map((k) => `${safeIdentifier(k)} = ?`).join(', ');
        const sql = `UPDATE ${safeTable} SET ${setSql}${whereSql}`;
        const stmt = db.prepare(sql);
        stmt.run(...keys.map((k) => toSqliteValue(data[k])), ...params);
        const updatedRows = db.prepare(`SELECT * FROM ${safeTable}${whereSql}`).all(...params);
        return { data: updatedRows, error: null };
      }

      if (action === 'delete') {
        const sql = `DELETE FROM ${safeTable}${whereSql}`;
        const stmt = db.prepare(sql);
        stmt.run(...params);
        return { data: null, error: null };
      }

      return { data: null, error: { message: 'Unknown query action' } };
    } catch (error) {
      console.error('SQLite query error:', error);

      // Better error reporting for missing tables
      if (error.message && error.message.includes('no such table')) {
        const tableName = table || 'unknown';
        safeLog(`❌ Table not found: ${tableName}`);
        safeLog('   This should have been created on startup. Check schema initialization logs.');
        return { data: null, error: { message: `Table ${tableName} does not exist. The database schema may not have initialized correctly. Please restart the application.` } };
      }

      return { data: null, error: { message: error.message || 'SQLite query failed' } };
    }
  });

  const resolveStoragePath = (bucket, relativePath) => {
    if (!bucket || !relativePath) {
      throw new Error('Bucket and path are required.');
    }
    const safeBucket = String(bucket).replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeBucket) {
      throw new Error('Invalid storage bucket.');
    }
    const storageRoot = path.join(app.getPath('userData'), 'files', safeBucket);
    const resolved = path.resolve(storageRoot, String(relativePath));
    const rootResolved = path.resolve(storageRoot);
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
      throw new Error('Invalid file path.');
    }
    return { storageRoot, resolved };
  };

  ipcMain.handle('file-save', async (event, payload) => {
    try {
      const { bucket, path: relativePath, buffer } = payload || {};
      const { storageRoot, resolved } = resolveStoragePath(bucket, relativePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.mkdirSync(storageRoot, { recursive: true });
      fs.writeFileSync(resolved, Buffer.from(buffer));
      return { success: true, path: relativePath };
    } catch (error) {
      safeLog('File save error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('app:getDownloadsPath', async () => {
    return app.getPath('downloads');
  });

  ipcMain.handle('app:openPath', async (event, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') {
      return 'Invalid path.';
    }
    return shell.openPath(targetPath);
  });

  ipcMain.handle('app:exportFile', async (event, payload) => {
    try {
      const { defaultFilename, buffer, showSaveDialog = true } = payload || {};
      const safeFilename = String(defaultFilename || 'export.docx')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_');
      const filename = safeFilename.toLowerCase().endsWith('.docx') ? safeFilename : `${safeFilename}.docx`;
      const downloadsPath = app.getPath('downloads');
      let filePath = path.join(downloadsPath, filename);

      if (showSaveDialog) {
        const result = await dialog.showSaveDialog({
          title: 'Export Word Document',
          defaultPath: filePath,
          filters: [{ name: 'Word Document', extensions: ['docx'] }],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        filePath = result.filePath;
      } else {
        const parsedPath = path.parse(filePath);
        let counter = 1;
        while (fs.existsSync(filePath)) {
          filePath = path.join(parsedPath.dir, `${parsedPath.name}_${counter}${parsedPath.ext}`);
          counter += 1;
        }
      }

      if (!buffer) {
        throw new Error('No file data received for export');
      }

      fs.writeFileSync(filePath, Buffer.from(buffer));
      return { success: true, path: filePath };
    } catch (error) {
      safeLog('File export error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-get-path', async (event, bucket, relativePath) => {
    try {
      const { resolved } = resolveStoragePath(bucket, relativePath);
      return { success: true, path: resolved };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-download', async (event, bucket, relativePath) => {
    try {
      const { resolved } = resolveStoragePath(bucket, relativePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }
      const buffer = fs.readFileSync(resolved);
      return { success: true, buffer, mimeType: null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-delete', async (event, bucket, relativePath) => {
    try {
      const { resolved } = resolveStoragePath(bucket, relativePath);
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Check if ODBC connection is already active (without creating new connection)
  ipcMain.handle('odbc-check-connection', async () => {
    try {
      if (!odbcConnection) {
        return { success: false, isConnected: false };
      }

      // Test if connection is still valid
      try {
        await odbcConnection.query('SELECT TOP 1 $Name FROM Ledger');
        return { success: true, isConnected: true };
      } catch (err) {
        // Connection is dead, clear it
        odbcConnection = null;
        return { success: false, isConnected: false, error: 'Connection lost' };
      }
    } catch (error) {
      return { success: false, isConnected: false, error: error.message };
    }
  });

  ipcMain.handle('odbc-test-connection', async (event, portOverride) => {
    try {
      if (!odbc) {
        return { success: false, error: 'ODBC module not available. Install the Tally ODBC driver and restart the app.' };
      }
      // If already connected, verify it's still active
      if (odbcConnection) {
        try {
          const testResult = await odbcConnection.query('SELECT TOP 1 $Name FROM Ledger');
          if (testResult.length > 0) {
            return { success: true, driver: 'Existing Connection', sampleData: testResult[0] };
          }
        } catch (err) {
          // Connection is dead, clear it and create new one
          odbcConnection = null;
        }
      }

      // Common Tally ODBC drivers
      const drivers = ['Tally ODBC Driver64', 'Tally ODBC Driver', 'Tally ODBC 64-bit Driver'];
      const port = typeof portOverride === 'string' && portOverride.trim() ? portOverride.trim() : '9000';

      for (const driver of drivers) {
        try {
          const connStr = `DRIVER={${driver}};SERVER=localhost;PORT=${port}`;
          odbcConnection = await odbc.connect(connStr);

          // Test query
          const result = await odbcConnection.query('SELECT TOP 1 $Name FROM Ledger');

          if (result.length > 0) {
            return { success: true, driver, sampleData: result[0] };
          }
        } catch (err) {
          safeLog(`Failed with driver ${driver}:`, err.message);
          continue;
        }
      }

      return { success: false, error: 'No compatible ODBC driver found or Tally not running' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('odbc-disconnect', async () => {
    try {
      if (odbcConnection) {
        try {
          await odbcConnection.close();
        } catch (err) {
          safeLog('ODBC disconnect error:', err.message);
        }
      }
      odbcConnection = null;
      return { success: true };
    } catch (error) {
      odbcConnection = null;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('odbc-fetch-trial-balance', async (event, fromDate, toDate) => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      // Note: Tally ODBC doesn't directly support date filtering in SELECT queries
      // The balances returned are as of the current Tally date setting
      // To get period-specific balances, Tally's date should be set before querying
      // For now, we fetch all ledgers - the balances reflect Tally's current date context

      // Convert dates to Tally format (DD-MMM-YYYY) for potential future use
      const formatDateForTally = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = String(d.getDate()).padStart(2, '0');
        const month = months[d.getMonth()];
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
      };

      const toDateFormatted = formatDateForTally(toDate);
      safeLog(`Trial Balance: Fetching for period ${fromDate} to ${toDate} (Tally date: ${toDateFormatted})`);
      safeLog('Note: Ensure Tally is set to the correct date before fetching. ODBC returns balances as of Tally\'s current date.');

      // First, get company name
      let companyName = '';
      try {
        const companyQuery = `SELECT $Name FROM Company`;
        const companyResult = await odbcConnection.query(companyQuery);
        if (companyResult && companyResult.length > 0) {
          companyName = companyResult[0]['$Name'] || '';
          safeLog(`Trial Balance: Company Name - ${companyName}`);
        }
      } catch (err) {
        console.warn('Could not fetch company name:', err.message);
      }

      const query = `
        SELECT $Name, $_PrimaryGroup, $Parent, $IsRevenue, 
               $OpeningBalance, $ClosingBalance, $DebitTotals, $CreditTotals,
               $Code, $Branch
        FROM Ledger
        ORDER BY $_PrimaryGroup, $Name
      `;

      const result = await odbcConnection.query(query);

      // Also fetch stock items to include opening stock
      let stockItems = [];
      let totalOpeningStock = 0;
      let totalClosingStock = 0;
      try {
        const stockQuery = `
          SELECT $Name, $OpeningValue, $ClosingValue
          FROM StockItem
        `;
        const stockResult = await odbcConnection.query(stockQuery);
        if (stockResult && stockResult.length > 0) {
          stockItems = stockResult;
          // In Tally ODBC, stock values are typically negative (representing asset/debit)
          // We take absolute value of the SUM (not individual items) to get total stock value
          const sumOpeningStock = stockResult.reduce((sum, row) => {
            const val = parseFloat(row['$OpeningValue']) || 0;
            return sum + val;
          }, 0);
          const sumClosingStock = stockResult.reduce((sum, row) => {
            const val = parseFloat(row['$ClosingValue']) || 0;
            return sum + val;
          }, 0);
          // Take absolute value of the final sum
          totalOpeningStock = Math.abs(sumOpeningStock);
          totalClosingStock = Math.abs(sumClosingStock);
          safeLog(`Trial Balance: Found ${stockResult.length} stock items. Opening Stock: ${totalOpeningStock}, Closing Stock: ${totalClosingStock}`);
        }
      } catch (stockErr) {
        console.warn('Could not fetch stock items (may not be available):', stockErr.message);
      }

      // Process the data to match the Excel template format
      // Parse numeric values properly - Tally may return strings
      const parseNumeric = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
      };

      // IMPORTANT: Filter out Stock-in-Hand ledgers because Tally ODBC returns CURRENT stock value
      // in $OpeningBalance/$ClosingBalance, NOT the actual opening value. We'll add the correct
      // Opening Stock entry separately using calculated values from StockItem query.
      const processedData = result
        .filter(row => {
          const primaryGroup = (row['$_PrimaryGroup'] || '').toLowerCase();
          const accountHead = (row['$Name'] || '').toLowerCase();
          // Exclude Stock-in-Hand ledgers - we'll add correct Opening Stock separately
          if (primaryGroup === 'stock-in-hand' ||
            accountHead.includes('stock-in-hand') ||
            accountHead === 'stock in hand') {
            safeLog(`Trial Balance: Excluding ledger "${row['$Name']}" (Stock-in-Hand) - will add corrected stock entry`);
            return false;
          }
          return true;
        })
        .map(row => {
          const accountHead = row['$Name'] || '';
          const primaryGroup = row['$_PrimaryGroup'] || '';
          const openingBalance = parseNumeric(row['$OpeningBalance']);
          let closingBalance = parseNumeric(row['$ClosingBalance']);

          // For Profit & Loss A/c, use opening balance as closing balance
          // because Tally's TB shows P&L without current year's profit/loss
          // This prevents "Net Profit" from appearing in closing balance
          if (accountHead.toLowerCase() === 'profit & loss a/c' ||
            accountHead.toLowerCase() === 'profit and loss a/c' ||
            accountHead.toLowerCase() === 'profit & loss account' ||
            accountHead.toLowerCase() === 'profit and loss account') {
            closingBalance = openingBalance;
          }

          return {
            accountHead,
            openingBalance,
            totalDebit: parseNumeric(row['$DebitTotals']),
            totalCredit: parseNumeric(row['$CreditTotals']),
            closingBalance,
            accountCode: row['$Code'] || '',
            branch: row['$Branch'] || 'HO',
            // Add hierarchy data
            primaryGroup,
            parent: row['$Parent'] || '',
            isRevenue: row['$IsRevenue'] === 'Yes' || row['$IsRevenue'] === true || row['$IsRevenue'] === 1,
          };
        });

      // Add Opening Stock as a separate entry using correctly calculated value from StockItem query
      // Note: Opening Stock is a STATIC account in Trial Balance - both opening and closing should
      // show the SAME value (the stock value at START of period). Closing Stock is shown in P&L.
      if (totalOpeningStock !== 0) {
        processedData.push({
          accountHead: 'Opening Stock',
          openingBalance: -totalOpeningStock, // Negative because it's an asset (debit balance in Tally convention)
          totalDebit: 0,
          totalCredit: 0,
          closingBalance: -totalOpeningStock, // Use OPENING value for closing too (static account)
          accountCode: 'STOCK-OPENING',
          branch: 'HO',
          primaryGroup: 'Stock-in-Hand',
          parent: 'Current Assets',
          isRevenue: false,
        });
        safeLog(`Trial Balance: Added Opening Stock entry with correct value: ${totalOpeningStock}`);
      }

      safeLog(`Trial Balance: Processed ${processedData.length} ledgers (including stock if applicable)`);

      return {
        success: true,
        data: processedData,
        companyName,
        stockInfo: {
          itemCount: stockItems.length,
          openingStock: totalOpeningStock,
          closingStock: totalClosingStock
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('odbc-fetch-month-wise', async (event, fyStartYear, targetMonth) => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      safeLog('fyStartYear:', fyStartYear, 'targetMonth:', targetMonth);

      const monthOrder = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
      const targetIndex = monthOrder.indexOf(targetMonth);
      if (targetIndex === -1) {
        return { success: false, error: `Invalid target month: ${targetMonth}` };
      }

      const selectedMonths = monthOrder.slice(0, targetIndex + 1);
      const monthSqlParts = [];

      // Build SQL parts for each month
      for (const mName of selectedMonths) {
        const year = (mName === "Jan" || mName === "Feb" || mName === "Mar") ? fyStartYear + 1 : fyStartYear;

        let day;
        if (["Apr", "Jun", "Sep", "Nov"].includes(mName)) day = "30";
        else if (mName === "Feb") day = (year % 4 === 0) ? "29" : "28";
        else day = "31";

        const currDate = `${day}-${mName}-${year}`;
        monthSqlParts.push(`($$ToValue:"${currDate}":$ClosingBalance)`);
      }

      const query = `SELECT $Name, $_PrimaryGroup, $IsRevenue, $OpeningBalance, ${monthSqlParts.join(', ')} FROM Ledger`;

      const result = await odbcConnection.query(query);
      safeLog('Month wise query result length:', result.length);
      if (result.length > 0) {
        safeLog('First row keys:', Object.keys(result[0]));
        safeLog('First row:', result[0]);
      }

      if (!result || result.length === 0) {
        return { success: false, error: 'No data found' };
      }

      // Process data
      const lines = [];
      const plGroupKeywords = [
        'Sales Accounts', 'Purchase Accounts', 'Direct Expenses', 'Indirect Expenses',
        'Direct Incomes', 'Indirect Incomes', 'Expense', 'Income', 'Interest'
      ];

      for (const row of result) {
        const ledgerName = row['$Name'] || '';
        const primaryGroup = row['$_PrimaryGroup'] || '';
        const isRevenue = row['$IsRevenue'] === 'Yes' || row['$IsRevenue'] === true;
        const openingBalance = parseFloat(row['$OpeningBalance']) || 0;

        // Check if PL
        const isRevCheck = isRevenue;
        const groupCheck = plGroupKeywords.some(keyword =>
          primaryGroup.toLowerCase().includes(keyword.toLowerCase())
        );
        const isPL = isRevCheck || groupCheck;

        // Get monthly balances (closing balances)
        // ODBC may return columns with different names - try multiple possibilities
        const monthlyBalances = {};
        const rowKeys = Object.keys(row);

        // Log available keys for debugging (only for first row)
        if (lines.length === 0 && rowKeys.length > 0) {
          safeLog('Available row keys:', rowKeys);
          safeLog('Month SQL parts:', monthSqlParts);
        }

        selectedMonths.forEach((month, i) => {
          let balance = 0;

          // Strategy 1: Access by position (most reliable - ODBC returns columns in SELECT order)
          // Columns: $Name (0), $_PrimaryGroup (1), $IsRevenue (2), $OpeningBalance (3), then month columns (4+)
          const monthIndex = 4 + i;
          if (monthIndex < rowKeys.length) {
            const key = rowKeys[monthIndex];
            balance = parseFloat(row[key]) || 0;
          }

          // Strategy 2: Try exact SQL expression as key (fallback)
          if (balance === 0) {
            const sqlExpr = monthSqlParts[i];
            if (row[sqlExpr] !== undefined && row[sqlExpr] !== null) {
              balance = parseFloat(row[sqlExpr]) || 0;
            }
          }

          // Strategy 3: Try finding by month name in key (last resort)
          if (balance === 0) {
            const altKeys = rowKeys.filter(key =>
              key.toLowerCase().includes(month.toLowerCase()) &&
              !key.includes('Name') &&
              !key.includes('Group') &&
              !key.includes('Revenue') &&
              !key.includes('Opening')
            );
            if (altKeys.length > 0) {
              balance = parseFloat(row[altKeys[0]]) || 0;
            }
          }

          monthlyBalances[month] = balance;
        });

        // Check if has non-zero balances
        let hasNonZero = false;
        if (isPL) {
          // For PL, check movements
          const movements = {};
          selectedMonths.forEach((month, i) => {
            if (i === 0) {
              movements[month] = monthlyBalances[month] - openingBalance;
            } else {
              const prevMonth = selectedMonths[i - 1];
              movements[month] = monthlyBalances[month] - monthlyBalances[prevMonth];
            }
          });
          hasNonZero = Object.values(movements).some(val => val !== 0);
        } else {
          // For BS, check absolute balances
          hasNonZero = Object.values(monthlyBalances).some(val => val !== 0);
        }

        if (hasNonZero) {
          lines.push({
            accountName: ledgerName,
            primaryGroup: primaryGroup,
            isRevenue: isPL, // Use isPL (includes group check) instead of just isRevenue flag
            openingBalance: openingBalance,
            monthlyBalances: monthlyBalances,
          });
        }
      }

      safeLog('Processed lines count:', lines.length);
      const plLines = lines.filter(line => line.isRevenue); // isRevenue now contains isPL classification
      const bsLines = lines.filter(line => !line.isRevenue);
      safeLog('PL lines:', plLines.length, 'BS lines:', bsLines.length);

      return { success: true, data: { plLines, bsLines, months: selectedMonths, fyStartYear, targetMonth } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Opening Balance Matching - Fetch Old Tally Ledger Data (Closing Balances)
  safeLog('Registering IPC handler: odbc-fetch-old-tally-ledgers');
  ipcMain.handle('odbc-fetch-old-tally-ledgers', async () => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      const query = `
      SELECT 
        $Name, 
        $_PrimaryGroup, 
        $Parent, 
        $OpeningBalance, 
        $_ClosingBalance, 
        $IsRevenue
      FROM Ledger
    `;

      const result = await odbcConnection.query(query);

      // Process and clean data
      const processedData = result.map(row => {
        const closingBalance = parseFloat(row['$_ClosingBalance'] || 0) || 0;
        const isRevenue = row['$IsRevenue'] === 1 || row['$IsRevenue'] === 'Yes' || row['$IsRevenue'] === true;

        // Convert closing balance to Dr/Cr format
        // Tally convention: Positive = Debit, Negative = Credit
        // Reference: trial_balance.py line 37-59
        const drBalance = closingBalance > 0 ? closingBalance : 0;
        const crBalance = closingBalance < 0 ? Math.abs(closingBalance) : 0;

        return {
          $Name: row['$Name'] || '',
          $_PrimaryGroup: row['$_PrimaryGroup'] || '',
          $Parent: row['$Parent'] || '',
          $OpeningBalance: row['$OpeningBalance'] || 0,
          $_ClosingBalance: closingBalance,
          $IsRevenue: isRevenue ? 'Yes' : 'No',
          Dr_Balance: drBalance,
          Cr_Balance: crBalance,
        };
      }).filter(row =>
        row.$IsRevenue !== 'Yes' && row.$_ClosingBalance !== 0
      );

      return { success: true, data: processedData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Opening Balance Matching - Fetch New Tally Ledger Data (Opening Balances)
  safeLog('Registering IPC handler: odbc-fetch-new-tally-ledgers');
  ipcMain.handle('odbc-fetch-new-tally-ledgers', async () => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      const query = `
      SELECT 
        $Name, 
        $_PrimaryGroup, 
        $Parent, 
        $OpeningBalance, 
        $IsRevenue
      FROM Ledger
    `;

      const result = await odbcConnection.query(query);

      // Process and clean data
      const processedData = result.map(row => {
        const openingBalance = parseFloat(row['$OpeningBalance'] || 0) || 0;
        const isRevenue = row['$IsRevenue'] === 1 || row['$IsRevenue'] === 'Yes' || row['$IsRevenue'] === true;

        // Convert opening balance to Dr/Cr format
        // Tally convention: Positive = Debit, Negative = Credit
        // Reference: trial_balance.py line 37-59
        const drBalance = openingBalance > 0 ? openingBalance : 0;
        const crBalance = openingBalance < 0 ? Math.abs(openingBalance) : 0;

        return {
          $Name: row['$Name'] || '',
          $_PrimaryGroup: row['$_PrimaryGroup'] || '',
          $Parent: row['$Parent'] || '',
          $OpeningBalance: openingBalance,
          $IsRevenue: isRevenue ? 'Yes' : 'No',
          Dr_Balance: drBalance,
          Cr_Balance: crBalance,
        };
      }).filter(row =>
        row.$IsRevenue !== 'Yes' && row.$OpeningBalance !== 0
      );

      return { success: true, data: processedData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Opening Balance Matching - Compare balances and generate XML
  safeLog('Registering IPC handler: odbc-compare-opening-balances');
  ipcMain.handle('odbc-compare-opening-balances', async (event, { oldData, newData }) => {
    try {
      // Create comparison report
      const comparison = {
        balanceMismatches: [],
        nameMismatches: [],
      };

      // Normalize ledger names for comparison
      const normalizeName = (name) => (name || '').trim().toLowerCase();

      // Create maps for quick lookup
      const oldMap = new Map();
      oldData.forEach(ledger => {
        const key = normalizeName(ledger.$Name);
        oldMap.set(key, ledger);
      });

      const newMap = new Map();
      newData.forEach(ledger => {
        const key = normalizeName(ledger.$Name);
        newMap.set(key, ledger);
      });

      // Find balance mismatches (matched ledgers with different balances)
      newData.forEach(newLedger => {
        const key = normalizeName(newLedger.$Name);
        const oldLedger = oldMap.get(key);

        if (oldLedger && newLedger.$Name !== 'Profit & Loss A/c') {
          const drDiff = Math.abs((newLedger.Dr_Balance || 0) - (oldLedger.Dr_Balance || 0));
          const crDiff = Math.abs((newLedger.Cr_Balance || 0) - (oldLedger.Cr_Balance || 0));

          if (drDiff > 0.01 || crDiff > 0.01) {
            comparison.balanceMismatches.push({
              $Name: newLedger.$Name,
              $_PrimaryGroup: newLedger.$_PrimaryGroup,
              $Parent: newLedger.$Parent,
              New_Dr_Balance: newLedger.Dr_Balance,
              New_Cr_Balance: newLedger.Cr_Balance,
              Old_Dr_Balance: oldLedger.Dr_Balance,
              Old_Cr_Balance: oldLedger.Cr_Balance,
              Dr_Difference: (newLedger.Dr_Balance || 0) - (oldLedger.Dr_Balance || 0),
              Cr_Difference: (newLedger.Cr_Balance || 0) - (oldLedger.Cr_Balance || 0),
            });
          }
        }
      });

      // Find name mismatches (unmatched ledgers)
      oldData.forEach(oldLedger => {
        const key = normalizeName(oldLedger.$Name);
        if (!newMap.has(key)) {
          comparison.nameMismatches.push({
            'Name as per OLD Tally': oldLedger.$Name,
            'Name as per NEW Tally': '',
            'Balance as per OLD Tally': oldLedger.Dr_Balance > 0
              ? `Dr ${oldLedger.Dr_Balance}`
              : oldLedger.Cr_Balance > 0
                ? `Cr ${oldLedger.Cr_Balance}`
                : '0',
            'Balance as per NEW Tally': '',
            'Remarks': 'Not in New Tally, or the balance may be NIL',
          });
        }
      });

      newData.forEach(newLedger => {
        const key = normalizeName(newLedger.$Name);
        if (!oldMap.has(key)) {
          comparison.nameMismatches.push({
            'Name as per OLD Tally': '',
            'Name as per NEW Tally': newLedger.$Name,
            'Balance as per OLD Tally': '',
            'Balance as per NEW Tally': newLedger.Dr_Balance > 0
              ? `Dr ${newLedger.Dr_Balance}`
              : newLedger.Cr_Balance > 0
                ? `Cr ${newLedger.Cr_Balance}`
                : '0',
            'Remarks': 'Not in Old Tally, or the balance may be NIL',
          });
        }
      });

      // Generate XML for import
      let xmlContent = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <TALLYMESSAGE>`;

      comparison.balanceMismatches.forEach(ledger => {
        const ledgerName = (ledger.$Name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const oldDr = ledger.Old_Dr_Balance || 0;
        const oldCr = ledger.Old_Cr_Balance || 0;

        let openingBalance = 0;
        if (oldDr > 0) {
          openingBalance = -oldDr; // Negative for debit
        } else if (oldCr > 0) {
          openingBalance = oldCr; // Positive for credit
        }

        if (openingBalance !== 0) {
          xmlContent += `
      <LEDGER NAME="${ledgerName}" ACTION="Alter">
        <NAME.LIST>
          <NAME>${ledgerName}</NAME>
        </NAME.LIST>
        <OPENINGBALANCE>${openingBalance.toFixed(2)}</OPENINGBALANCE>
      </LEDGER>`;
        }
      });

      xmlContent += `
    </TALLYMESSAGE>
  </BODY>
</ENVELOPE>`;

      return {
        success: true,
        comparison,
        xml: xmlContent,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Fetch Month Wise Data via ODBC
  safeLog('Registering IPC handler: odbc-fetch-month-wise-data');
  ipcMain.handle('odbc-fetch-month-wise-data', async (event, { fyStartYear, targetMonth }) => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      // Map month names to numbers
      const monthMap = {
        'Apr': 4, 'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9,
        'Oct': 10, 'Nov': 11, 'Dec': 12, 'Jan': 1, 'Feb': 2, 'Mar': 3
      };

      const targetMonthNum = monthMap[targetMonth] || 3;
      const months = [];
      const lines = [];

      // Generate month list from April to target month
      for (let m = 4; m <= targetMonthNum; m++) {
        const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.push(monthNames[m]);
      }

      // Fetch ledger data with monthly balances
      // Note: This is a simplified implementation - Tally ODBC may need specific queries for monthly data
      const query = `
      SELECT 
        $Name, 
        $_PrimaryGroup, 
        $Parent,
        $IsRevenue,
        $OpeningBalance,
        $ClosingBalance
      FROM Ledger
      ORDER BY $_PrimaryGroup, $Name
    `;

      const result = await odbcConnection.query(query);

      // Process data - Note: Monthly balances would need more complex queries in real implementation
      result.forEach(row => {
        const isRevenue = row['$IsRevenue'] === 1 || row['$IsRevenue'] === 'Yes' || row['$IsRevenue'] === true;
        const openingBalance = parseFloat(row['$OpeningBalance'] || 0) || 0;
        const closingBalance = parseFloat(row['$ClosingBalance'] || 0) || 0;

        // For now, distribute closing balance evenly across months (simplified)
        // In production, you'd need to query actual monthly transaction data
        const monthlyBalances = {};
        months.forEach(month => {
          monthlyBalances[month] = closingBalance / months.length;
        });

        lines.push({
          accountName: row['$Name'] || '',
          primaryGroup: row['$_PrimaryGroup'] || '',
          isRevenue,
          openingBalance,
          monthlyBalances,
        });
      });

      return { success: true, lines, months };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Fetch GST Not Feeded Data via ODBC
  safeLog('Registering IPC handler: odbc-fetch-gst-not-feeded');
  ipcMain.handle('odbc-fetch-gst-not-feeded', async () => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      // Query all ledgers - GST registration can be on any ledger, not just Sundry Debtors/Creditors
      // This matches the XML/Tally Bridge approach which queries all ledgers
      let query = `
      SELECT 
        $Name, 
        $_PrimaryGroup,
        $GSTRegistrationType,
        $GSTIN,
        $PartyGSTIN
      FROM Ledger
      ORDER BY $Name
    `;

      let result;
      try {
        result = await odbcConnection.query(query);
        safeLog(`GST Not Feeded: Queried ${result.length} total ledgers`);
      } catch (err) {
        console.error('Error querying GST data:', err.message);
        // Try without WHERE clause to see what fields are available
        try {
          query = `SELECT TOP 10 $Name, $_PrimaryGroup, $GSTRegistrationType, $GSTIN FROM Ledger`;
          const testResult = await odbcConnection.query(query);
          safeLog('Test query result sample:', testResult[0]);
          throw new Error(`Query failed: ${err.message}. Available fields: ${Object.keys(testResult[0] || {}).join(', ')}`);
        } catch (testErr) {
          throw new Error(`Failed to query GST data: ${err.message}`);
        }
      }

      // Filter in JavaScript to handle different GSTIN formats and registration types
      // Tally ODBC field names can vary. We normalize/validate before deciding "missing".

      // Check if a registration type should require GSTIN (only "Regular" registration)
      const isRegularRegistration = (regType) => {
        if (!regType) return false;
        const normalized = regType.toString().trim().toLowerCase();
        // Exclude unregistered, consumer, composition, unknown, etc.
        // Only exact match for "regular" to avoid false positives
        if (normalized === 'regular') return true;
        // Also handle "Regular - ..." variants but NOT "Unregistered" or other types
        if (normalized.startsWith('regular') && !normalized.includes('unregistered')) return true;
        return false;
      };

      // Check if GSTIN value is actually present (more lenient - any 15 char alphanumeric is accepted)
      const hasValidGstin = (value) => {
        if (value === undefined || value === null) return false;
        const s = value.toString().trim();
        if (!s) return false;
        const low = s.toLowerCase();
        // Reject obvious placeholders/empty values
        if (low === 'null' || low === 'na' || low === 'n/a' || low === 'nil' ||
          s === '0' || s === '-' || s === '--' || low === 'not available' ||
          low === 'not applicable') return false;

        // Accept any 15-character alphanumeric string as valid GSTIN
        // This is more lenient to avoid showing ledgers where GSTIN is actually entered
        const upper = s.toUpperCase().replace(/\s/g, '');
        if (upper.length === 15 && /^[A-Z0-9]{15}$/.test(upper)) {
          return true;
        }

        // Also accept if it looks like a partial/old format GSTIN (at least has some content)
        // If user has entered something meaningful (more than 5 chars, alphanumeric), consider it fed
        if (upper.length >= 10 && /^[A-Z0-9]+$/.test(upper)) {
          return true;
        }

        return false;
      };

      const pickBestGstin = (row) => {
        const candidates = [
          row['$GSTIN'],
          row['GSTIN'],
          row['$PartyGSTIN'],
          row['PartyGSTIN'],
        ];
        for (const c of candidates) {
          if (hasValidGstin(c)) return c.toString().trim().toUpperCase();
        }
        return '';
      };

      const lines = result
        .map(row => {
          const gstRegType = row['$GSTRegistrationType'] || row['GSTRegistrationType'] || '';
          const gstin = pickBestGstin(row);

          return {
            ledgerName: row['$Name'] || '',
            primaryGroup: row['$_PrimaryGroup'] || row['PrimaryGroup'] || '',
            partyGSTIN: gstin || '',
            registrationType: gstRegType,
            gstRegistrationType: gstRegType, // Alias for compatibility
          };
        })
        .filter(line => {
          // Filter: Only include if GST Registration Type is "Regular" AND GSTIN is missing
          // Explicitly exclude Unregistered, Consumer, Composition, Unknown, etc.
          if (!isRegularRegistration(line.registrationType)) return false;

          // Check if GSTIN is missing
          return !hasValidGstin(line.partyGSTIN);
        });

      safeLog(`GST Not Feeded: Found ${lines.length} ledgers with Regular GST but no GSTIN out of ${result.length} total ledgers checked`);

      // Log sample data for debugging if no results found
      if (lines.length === 0 && result.length > 0) {
        const regularLedgers = result.filter(r => {
          const regType = (r['$GSTRegistrationType'] || r['GSTRegistrationType'] || '').toString().trim();
          return isRegularRegistration(regType);
        });
        safeLog(`Found ${regularLedgers.length} Regular GST ledgers out of ${result.length} total, all have GSTIN entered`);
        if (regularLedgers.length > 0) {
          const sample = regularLedgers[0];
          safeLog('Sample Regular GST ledger:', {
            name: sample['$Name'],
            primaryGroup: sample['$_PrimaryGroup'],
            gstRegType: sample['$GSTRegistrationType'],
            gstin: sample['$PartyGSTIN'] || sample['$GSTIN'] || '(empty)',
          });
        }
      }

      return { success: true, lines };
    } catch (error) {
      console.error('Error fetching GST Not Feeded data:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('odbc-fetch-stock-items', async () => {
    try {
      if (!odbcConnection) {
        return { success: false, error: 'Not connected to Tally ODBC' };
      }

      // Query stock items from Tally
      const query = `
      SELECT 
        $Name,
        $Parent,
        $_PrimaryGroup,
        $OpeningValue,
        $ClosingValue
      FROM StockItem
      ORDER BY $Parent, $Name
    `;

      const result = await odbcConnection.query(query);
      safeLog(`Stock Items: Fetched ${result.length} stock items`);

      if (!result || result.length === 0) {
        return { success: true, items: [] };
      }

      // Process stock items
      const items = result.map(row => ({
        'Item Name': row['$Name'] || '',
        'Stock Group': row['$Parent'] || '',
        'Primary Group': row['$_PrimaryGroup'] || '',
        'Opening Value': parseFloat(row['$OpeningValue']) || 0,
        'Closing Value': parseFloat(row['$ClosingValue']) || 0,
        'Stock Category': '', // Will be classified by user
        'Composite Key': `STOCK|${row['$Name'] || ''}`
      }));

      safeLog(`Stock Items: Processed ${items.length} items`);
      return { success: true, items };
    } catch (error) {
      console.error('Error fetching stock items:', error);
      return { success: false, error: error.message };
    }
  });
}

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../build/icon.png'),
    title: 'ICAI VERA',
    show: false,
  });

  // Show window maximized when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:8080';
    mainWindow.loadURL(devServerUrl);
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  try {
    app.setPath('cache', path.join(app.getPath('userData'), 'Cache'));
  } catch (error) {
    safeLog('Unable to set cache path:', error && error.message ? error.message : error);
  }

  // Set App User Model ID for Windows
  app.setAppUserModelId('com.icai-vera.app');

  app.setAboutPanelOptions({
    applicationName: 'ICAI VERA',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © 2026 ICAI VERA',
    authors: ['ICAI VERA'],
    website: 'https://github.com/ICAI-Audit/audit-assistant-pro-electron',
    iconPath: path.join(__dirname, '../build/icon.png'),
  });

  safeLog('Electron app ready - IPC handlers should be registered');
  setAppMenu();
  registerIpcHandlers();
  createWindow();

  // Initialize auto-updater with GitHub provider
  console.log('[AUTO-UPDATER] Initializing from main.cjs...');
  initializeAutoUpdater();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for GSTZen API
// Use localhost for development/testing as per user logs. 
// For production, this should be 'https://app.gstzen.in'
const API_BASE_URL = 'https://staging.gstzen.in';

async function handleApiRequest(endpoint, method, data, token) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const tokenInfo = token ? ' token=[REDACTED]' : '';
    safeLog(`[API Request] ${method} ${endpoint}${tokenInfo}`);

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    // Handle empty response (e.g. 204 No Content)
    // Handle empty response (e.g. 204 No Content)
    const text = await response.text();
    let json = {};
    try {
      if (text && text.trim()) {
        json = JSON.parse(text);
      }
    } catch (e) {
      console.error(`[API] Invalid JSON from ${endpoint}:`, text.substring(0, 500));
      // Fallback: If not JSON, but has text, maybe return it as message?
      // If HTML, prevent bloat.
      if (response.ok) {
        // If 200 OK but invalid JSON, it's a backend issue.
        return { ok: false, status: 500, data: { message: "Invalid response from server" } };
      }
    }

    safeLog(`[API Response] ${method} ${endpoint} -> ${response.status}`);
    return { ok: response.ok, status: response.status, data: json };
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { ok: false, data: { message: error.message || 'Network request failed' } };
  }
}

ipcMain.handle('gstzen-login', async (event, credentials) => {
  return handleApiRequest('/accounts/api/login/token/', 'POST', credentials);
});


ipcMain.handle('gstzen-generate-otp', async (event, { data, token }) => {
  return handleApiRequest('/api/gstn-generate-otp/', 'POST', data, token);
});

ipcMain.handle('gstzen-establish-session', async (event, { data, token }) => {
  return handleApiRequest('/api/gstn-establish-session/', 'POST', data, token);
});

ipcMain.handle('gstzen-download-gstr1', async (event, { data, token }) => {
  return handleApiRequest('/api/gstr1/download/', 'POST', {
    api_name: data.api_name,
    gstin: data.gstin,
    ret_period: data.filing_period || data.ret_period, // Handle potential field name diffs
  }, token);
});

ipcMain.handle('gstzen-api-request', async (event, { endpoint, method, data, token }) => {
  safeLog(`[IPC] gstzen-api-request: ${method} ${endpoint}`);
  return handleApiRequest(endpoint, method, data, token);
});

