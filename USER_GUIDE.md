> Historical application guide. For the reviewed architecture, feature status and validation limits, start with [project knowledge](docs/project/README.md). Do not infer feature completeness from this older guide.

# AuditFlow Pro - User Guide

## Complete Step-by-Step Guide for Team Members

Welcome to AuditFlow Pro! This guide will walk you through every feature and procedure to help you work efficiently on audit engagements.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Understanding User Roles](#2-understanding-user-roles)
3. [Navigating the Dashboard](#3-navigating-the-dashboard)
4. [Working with Engagements](#4-working-with-engagements)
5. [Risk Register](#5-risk-register)
6. [Audit Procedures](#6-audit-procedures)
7. [Materiality](#7-materiality)
8. [Evidence Vault](#8-evidence-vault)
9. [Review Notes](#9-review-notes)
10. [Misstatements](#10-misstatements)
11. [Trial Balance](#11-trial-balance)
12. [Audit Tools](#12-audit-tools)
13. [Completion](#13-completion)
14. [Communication Features](#14-communication-features)
15. [Admin Functions](#15-admin-functions-partners--managers-only)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Getting Started

### 1.1 Logging In

1. Open the application in your web browser
2. Enter your registered email address
3. Enter your password
4. Click **"Sign In"**

> **First-time users:** Contact your Partner/Manager to create your account. You will receive login credentials via email.

### 1.2 First Login Checklist

After your first login:
- [ ] Update your profile information (name, phone number)
- [ ] Review assigned engagements
- [ ] Familiarize yourself with the navigation menu

### 1.3 Understanding the Interface

The application has three main areas:
- **Left Sidebar:** Navigation menu to access different modules
- **Top Header:** Shows current engagement, notifications, and user profile
- **Main Content Area:** Displays the selected module's content

---

## 2. Understanding User Roles

### Role Hierarchy (Highest to Lowest)

| Role | Permissions |
|------|-------------|
| **Partner** | Full access, can manage all settings, approve final reports |
| **Manager** | Manage engagements, assign work, review team output |
| **Senior** | Lead audit procedures, create review notes, supervise staff |
| **Staff** | Execute audit procedures, upload evidence, respond to notes |
| **Viewer** | Read-only access to assigned engagements |

### What You Can Do Based on Your Role

**Staff Members:**
- View assigned engagements and procedures
- Complete audit procedures assigned to you
- Upload evidence files
- Respond to review notes
- Update procedure status

**Seniors:**
- All Staff permissions, plus:
- Create and assign procedures to staff
- Create review notes
- Review staff work

**Managers:**
- All Senior permissions, plus:
- Create engagements
- Assign team members
- Set materiality levels
- Review and clear notes

**Partners:**
- Full system access
- Final approval authority
- Admin settings management

---

## 3. Navigating the Dashboard

### 3.1 Selecting an Engagement

**Before working on any audit task, you must select an engagement:**

1. Click on the **engagement selector** in the header (top of the page)
2. Browse or search for your engagement
3. Click to select it
4. The engagement name will now appear in the header

> ⚠️ **Important:** Most features require an active engagement to be selected. If you see "No engagement selected," choose one first.

### 3.2 Dashboard Overview

The main dashboard shows:
- **Quick Stats:** Total procedures, completed, pending, overdue
- **Progress Chart:** Visual representation of audit progress
- **Risk Summary:** High/Medium/Low risk counts
- **Recent Activity:** Latest actions by team members
- **My Tasks:** Procedures assigned to you

---

## 4. Working with Engagements

### 4.1 Viewing Engagement Details

1. Navigate to **Engagements** from the sidebar
2. View the list of all engagements you have access to
3. Click on an engagement to view details

### 4.2 Engagement Information Includes

- Client name and details
- Financial year under audit
- Engagement type (Statutory Audit, Tax Audit, etc.)
- Start and end dates
- Assigned Partner and Manager
- Current status

### 4.3 Team Assignment (Managers/Partners Only)

1. Open the engagement
2. Click **"Manage Team"**
3. Select team members to assign
4. Assign roles for this engagement
5. Click **"Save"**

---

## 5. Risk Register

### 5.1 Understanding Risks

The Risk Register tracks all identified audit risks:
- **Inherent Risk:** Risk before considering controls
- **Control Risk:** Risk that controls won't prevent/detect errors
- **Combined Risk:** Overall risk assessment

### 5.2 Adding a New Risk (Seniors/Managers)

1. Navigate to **Risk Register**
2. Click **"Add Risk"**
3. Fill in the form:
   - **Risk Area:** Select the financial statement area
   - **Description:** Describe the risk in detail
   - **Risk Type:** Select Significant Risk, Normal Risk, etc.
   - **Inherent Risk:** Rate as High/Medium/Low
   - **Control Risk:** Rate as High/Medium/Low
   - **Key Controls:** List relevant controls
   - **Audit Response:** How will you address this risk?
4. Click **"Save"**

### 5.3 Updating Risk Status

1. Find the risk in the register
2. Click the **Edit** button
3. Update the status (Identified → Assessed → Addressed)
4. Add any notes or changes
5. Click **"Update"**

---

## 6. Audit Procedures

### 6.1 Understanding Procedure Status

| Status | Meaning |
|--------|---------|
| **Not Started** | Work has not begun |
| **In Progress** | Currently being worked on |
| **Pending Review** | Completed, awaiting manager review |
| **Reviewed** | Manager has reviewed |
| **Completed** | Fully finished and approved |

### 6.2 Viewing Your Assigned Procedures

1. Navigate to **Audit Programs**
2. Filter by "Assigned to Me"
3. View all procedures requiring your attention

### 6.3 Completing a Procedure

**Step-by-step process:**

1. **Open the procedure** by clicking on it
2. **Read the requirements** carefully
3. **Perform the work** as described
4. **Document your work:**
   - Add conclusion notes
   - Reference workpaper numbers
   - Link to evidence files
5. **Update status** to "Pending Review"
6. **Save** your changes

### 6.4 Best Practices for Procedures

- ✅ Complete all required fields
- ✅ Reference specific evidence files
- ✅ Write clear, concise conclusions
- ✅ Update status promptly
- ✅ Notify reviewer when ready
- ❌ Don't leave procedures without conclusions
- ❌ Don't mark complete without evidence

---

## 7. Materiality

### 7.1 Understanding Materiality Levels

- **Overall Materiality:** Maximum tolerable error
- **Performance Materiality:** Working materiality (typically 50-75% of overall)
- **Trivial Threshold:** Amount below which errors are not tracked (typically 5% of overall)

### 7.2 Setting Materiality (Managers/Partners)

1. Navigate to **Materiality**
2. Enter the **benchmark basis** (e.g., Total Revenue, Total Assets)
3. Enter the **benchmark amount**
4. Select the **percentage** to apply
5. System calculates materiality automatically
6. Adjust if needed based on professional judgment
7. Click **"Save"**

### 7.3 Using Materiality in Procedures

- Compare identified errors against the trivial threshold
- Accumulate errors exceeding trivial threshold
- Evaluate total against performance materiality
- Report findings exceeding overall materiality

---

## 8. Evidence Vault

### 8.1 Uploading Evidence

1. Navigate to **Evidence Vault**
2. Click **"Upload File"**
3. Select file(s) from your computer
4. Add details:
   - **Name:** Descriptive name for the file
   - **Workpaper Reference:** (e.g., WP-001)
   - **Linked Procedure:** Select related procedure
5. Click **"Upload"**

### 8.2 Supported File Types

- PDF documents
- Excel spreadsheets (.xlsx, .xls)
- Word documents (.docx, .doc)
- Images (.jpg, .png)
- Other common formats

### 8.3 Managing Evidence

- **Search:** Use the search bar to find files
- **Filter:** Filter by type, date, or procedure
- **Download:** Click to download any file
- **Link:** Associate files with procedures
- **Delete:** Remove files (with permission)

### 8.4 Evidence Best Practices

- ✅ Use meaningful file names
- ✅ Always add workpaper references
- ✅ Link to relevant procedures
- ✅ Organize by audit area
- ❌ Don't upload duplicate files
- ❌ Don't leave files unlinked

---

## 9. Review Notes

### 9.1 What Are Review Notes?

Review notes are questions, comments, or issues raised during the review process. They facilitate communication between team members.

### 9.2 Creating a Review Note (Seniors/Managers/Partners)

1. Navigate to **Review Notes**
2. Click **"Add Note"**
3. Fill in:
   - **Title:** Brief summary of the issue
   - **Content:** Detailed description
   - **Priority:** Low/Medium/High
   - **Assigned To:** Select team member
   - **Linked Procedure:** (Optional) Select related procedure
4. Click **"Create"**

### 9.3 Responding to Review Notes

When you receive a review note:

1. Navigate to **Review Notes**
2. Find notes assigned to you (filter "Assigned to Me")
3. Click on the note to open it
4. Read the question/issue carefully
5. Click **"Respond"**
6. Enter your response with explanation
7. Reference any supporting evidence
8. Click **"Submit Response"**

### 9.4 Review Note Status Flow

```
Open → Responded → Cleared
              ↓
           Reopened (if not satisfactory)
```

### 9.5 Clearing Notes (Reviewers Only)

1. Open a responded note
2. Review the response
3. If satisfactory, click **"Clear Note"**
4. If not, click **"Reopen"** and explain why

---

## 10. Misstatements

### 10.1 Recording a Misstatement

1. Navigate to **Misstatements**
2. Click **"Add Misstatement"**
3. Enter details:
   - **Description:** What is the error?
   - **Account Affected:** Which account(s)?
   - **Amount:** Debit and Credit amounts
   - **Type:** Factual, Judgmental, or Projected
   - **Status:** Corrected or Uncorrected
4. Click **"Save"**

### 10.2 Types of Misstatements

| Type | Description |
|------|-------------|
| **Factual** | Definite errors with no doubt |
| **Judgmental** | Differences in estimates or judgments |
| **Projected** | Extrapolated from sample testing |

### 10.3 Tracking and Summarizing

- View summary of all misstatements
- Compare total against materiality
- Track corrected vs uncorrected
- Generate summary for audit completion

---

## 11. Trial Balance

### 11.1 Importing Trial Balance

1. Navigate to **Trial Balance**
2. Click **"Import"**
3. Download the Excel template (if needed)
4. Upload your completed template
5. Map columns if required
6. Review imported data
7. Click **"Confirm Import"**

### 11.2 Working with Trial Balance

- View current year vs prior year
- See lead schedules by account
- Link accounts to audit procedures
- Track adjustments and reclassifications

---

## 12. Audit Tools

The Audit Tools module provides productivity tools to streamline your audit workflow. Access it from the sidebar under "Audit Tools."

### 12.1 Tally Related Tools

Tools for integrating with Tally ERP accounting software:

| Tool | Description | Status |
|------|-------------|--------|
| **Get TB from Tally** | Extract Trial Balance directly from Tally ERP for the selected period | Beta |
| **Query on Transactions** | Run custom queries on Tally ledger transactions with filters | Beta |
| **Ledger Extraction** | Extract specific ledger accounts with transaction details | Coming Soon |
| **Daybook Export** | Export daybook/journal register for any period | Coming Soon |

**Connecting to Tally:**
1. Navigate to **Audit Tools** → **Tally Tools**
2. Enter the Tally port number (default: 9000)
3. Click **"Connect to Tally"**
4. Ensure Tally is running with ODBC enabled

### 12.2 GST Related Tools

Tools for GST compliance and reconciliation:

| Tool | Description | Status |
|------|-------------|--------|
| **Get GSTR-1, 3B & 2A** | Download GST returns from the GST portal | Coming Soon |
| **Reconcile with Books** | Compare GST returns with books of accounts | Coming Soon |
| **JSON to Excel Converter** | Convert GST JSON files to Excel format | Available |
| **ITC Reconciliation** | Match GSTR-2A/2B with purchase register | Coming Soon |
| **E-Way Bill Tracker** | Track and validate e-way bills | Coming Soon |

**Using JSON to Excel Converter:**
1. Navigate to **Audit Tools** → **GST Related**
2. Click on **"JSON to Excel Converter"**
3. Upload your GST JSON file
4. Download the converted Excel file

### 12.3 MCA Data Tools

Tools for accessing Ministry of Corporate Affairs data:

| Tool | Description |
|------|-------------|
| **Get Company Master Data** | Retrieve company details including registered address, capital, and status |
| **Download Financials / AOC-4 / MGT-7** | Download filed financial statements and annual returns |
| **DIR-3 KYC / DIN Status** | Check Director Identification Number status and KYC compliance |
| **Charges & Signatories** | View registered charges and authorized signatories |
| **Company Documents** | Access MOA, AOA, and incorporation documents |
| **Related Party Check** | Identify common directors across companies |

**Searching for Company Data:**
1. Navigate to **Audit Tools** → **MCA Data**
2. Enter the CIN or LLPIN number
3. Click **"Search"**
4. Select the tool you need

### 12.4 Income Tax Tools

Tools for Income Tax compliance verification:

| Tool | Description |
|------|-------------|
| **Get 26AS** | Download Form 26AS with TDS/TCS credits and tax payments |
| **Check Notices on IT Website** | View pending notices from Income Tax department |
| **Check TDS Related Notices** | Review TDS default and demand notices |
| **AIS (Annual Information Statement)** | Access financial transactions reported to IT department |
| **TIS (Taxpayer Information Summary)** | View pre-filled income details and high-value transactions |
| **ITR Status & History** | Check filing status, refund status, and history |

### 12.5 PDF Tools

Document processing utilities:

| Tool | Description | Status |
|------|-------------|--------|
| **Merge PDF Documents** | Combine multiple PDFs into a single document | Available |
| **Split PDF File** | Split a PDF by page range or extract specific pages | Available |
| **Convert Word to PDF** | Convert .doc/.docx files to PDF | Available |
| **Convert Excel to PDF** | Convert .xls/.xlsx files to PDF | Available |
| **Redact Personal Information** | Automatically detect and redact PII | Beta |
| **OCR - Extract Text from PDF** | Extract text from scanned documents | Coming Soon |
| **Compress PDF** | Reduce PDF file size | Available |
| **Add Watermark** | Add custom watermarks to documents | Coming Soon |

**Using PDF Tools:**
1. Navigate to **Audit Tools** → **PDF Tools**
2. Click on the desired tool
3. Upload your file(s)
4. Download the processed result

### 12.6 Analytics Tools

Data analysis utilities for audit procedures:

| Tool | Description | Status |
|------|-------------|--------|
| **Ratio Analysis Calculator** | Calculate liquidity, profitability, and solvency ratios | Available |
| **Benford's Law Analysis** | Detect anomalies in financial data | Coming Soon |
| **Duplicate Transaction Finder** | Identify potential duplicate transactions | Coming Soon |
| **Bank Statement Analyzer** | Parse and analyze bank statements | Coming Soon |
| **Sampling Calculator** | Calculate sample sizes using statistical methods | Available |
| **Trend Analysis** | Perform month-on-month and year-on-year analysis | Coming Soon |

---

## 13. Completion

### 13.1 Completion Checklist

The Completion module helps ensure all tasks are done:

1. Navigate to **Completion**
2. Review the completion checklist
3. Each item shows status:
   - ✅ Completed
   - ⚠️ Pending
   - ❌ Not Started
4. Address any incomplete items

### 13.2 Generating Reports

1. Ensure all checklist items are complete
2. Click **"Generate Report"**
3. Select report type
4. Review generated document
5. Export as PDF or Word

### 13.3 Final Steps

- [ ] All procedures completed and reviewed
- [ ] All review notes cleared
- [ ] Misstatements summarized and evaluated
- [ ] Evidence vault organized
- [ ] Partner sign-off obtained

---

## 14. Communication Features

### 14.1 WhatsApp Integration

Contact team members directly via WhatsApp:

1. Go to **Admin Settings** (or view team in engagement)
2. Find the team member
3. Click the **WhatsApp icon** (green message icon)
4. WhatsApp will open with their number ready

### 14.2 Email Integration

Send emails directly:

1. Find the team member
2. Click the **Email icon** (envelope icon)
3. Your email client will open with their address

### 14.3 Notifications

Stay informed with in-app notifications:

1. Click the **Bell icon** in the header
2. View recent notifications
3. Click a notification to go to related item
4. Mark as read when reviewed

---

## 15. Admin Functions (Partners & Managers Only)

### 15.1 Managing Clients

**Adding a New Client:**
1. Navigate to **Admin Settings** → **Clients**
2. Click **"Add Client"**
3. Enter client details:
   - Name, Industry, PAN, CIN
   - Contact person and details
   - Address and state
4. Click **"Save"**

**Bulk Import:**
1. Click **"Bulk Import"**
2. Download Excel template
3. Fill in client data
4. Upload completed template

### 15.2 Managing Team Members

**Viewing Team:**
1. Navigate to **Admin Settings** → **Team**
2. View all team members
3. See their roles and contact info

**Updating Roles:**
1. Find the team member
2. Use the role dropdown to change their role
3. Confirm the change

### 15.3 Managing Partners

**Adding Partner Information:**
1. Navigate to **Admin Settings** → **Partners**
2. Click **"Add Partner"**
3. Enter details:
   - Name, Membership Number
   - Date of Joining
   - Contact information
4. Click **"Save"**

### 15.4 Managing Financial Years

1. Navigate to **Admin Settings** → **Financial Years**
2. Add new financial years as needed
3. Set active/inactive status

### 15.5 Firm Settings

1. Navigate to **Admin Settings** → **Firm Details**
2. Update firm information:
   - Firm name
   - Registration number
   - ICAI unique serial number
   - Constitution type
   - Number of partners

---

## 16. Troubleshooting

### Common Issues and Solutions

#### "No engagement selected" message
**Solution:** Click the engagement selector in the header and choose an engagement.

#### Can't see certain features
**Solution:** Your role may not have access. Contact your Manager or Partner.

#### Can't upload files
**Solution:** 
- Check file size (max 10MB)
- Check file format is supported
- Try a different browser

#### Review note not updating
**Solution:** Refresh the page and try again.

#### Data not loading
**Solution:**
1. Check your internet connection
2. Refresh the page
3. Log out and log back in
4. Contact support if issue persists

### Getting Help

1. **In-App:** Click the help icon (?) for contextual help
2. **Manager:** Contact your engagement manager
3. **Admin:** Contact the system administrator
4. **IT Support:** For technical issues

---

## Quick Reference Card

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | Ctrl + S |
| Search | Ctrl + F |
| Refresh | F5 |
| Cancel | Esc |

### Status Color Codes

| Color | Meaning |
|-------|---------|
| 🟢 Green | Complete/Low Risk |
| 🟡 Yellow | In Progress/Medium Risk |
| 🔴 Red | Overdue/High Risk |
| ⚪ Gray | Not Started |

### Daily Workflow Checklist

**Start of Day:**
- [ ] Log in and check notifications
- [ ] Review assigned tasks
- [ ] Check for new review notes
- [ ] Prioritize work for the day

**During Work:**
- [ ] Update procedure status as you work
- [ ] Upload evidence immediately after obtaining
- [ ] Respond to review notes promptly
- [ ] Document findings clearly

**End of Day:**
- [ ] Save all work
- [ ] Update status of in-progress items
- [ ] Note any blockers for tomorrow
- [ ] Log out securely

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | December 2024 | Initial release |

---

*This guide is maintained by the IT/Admin team. For updates or corrections, please contact your system administrator.*
