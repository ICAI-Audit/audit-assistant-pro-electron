import { TAX_AUDIT_PROGRAMME_CHECKLIST } from '@/data/taxAuditProgrammeChecklist';

export type AuditProgrammeFilterStatus = 'all' | TaxAuditProgrammeStatus;
export type TaxAuditProgrammeStatus = 'Not started' | 'In progress' | 'Completed' | 'Reviewed' | 'Not applicable';
export type TaxAuditProgrammeResponse = 'Yes' | 'No' | 'Not applicable' | 'To be reviewed';

export type TaxAuditProgrammeItemState = {
  status: TaxAuditProgrammeStatus;
  response: TaxAuditProgrammeResponse;
  assigned_to: string;
  due_date: string;
  working_reference: string;
  remarks: string;
  reviewed_by: string;
  reviewed_at: string;
};

export type TaxAuditProgrammeState = {
  items: Record<string, TaxAuditProgrammeItemState>;
  last_updated_at: string;
};

export type TaxAuditProgrammeStats = {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  reviewed: number;
  notApplicable: number;
  needsReview: number;
  requiredIncomplete: number;
  hasResponses: boolean;
  completionPercent: number;
};

export type SaveTaxAuditProgrammeInput = {
  currentSetupJson?: string | null;
  programme: TaxAuditProgrammeState;
  updatedAt?: string;
};

export const TAX_AUDIT_PROGRAMME_STATUS_OPTIONS: TaxAuditProgrammeStatus[] = [
  'Not started',
  'In progress',
  'Completed',
  'Reviewed',
  'Not applicable',
];

export const TAX_AUDIT_PROGRAMME_RESPONSE_OPTIONS: TaxAuditProgrammeResponse[] = [
  'Yes',
  'No',
  'Not applicable',
  'To be reviewed',
];

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isTaxAuditProgrammeStatus = (value: unknown): value is TaxAuditProgrammeStatus =>
  TAX_AUDIT_PROGRAMME_STATUS_OPTIONS.includes(value as TaxAuditProgrammeStatus);

const isTaxAuditProgrammeResponse = (value: unknown): value is TaxAuditProgrammeResponse =>
  TAX_AUDIT_PROGRAMME_RESPONSE_OPTIONS.includes(value as TaxAuditProgrammeResponse);

export const buildDefaultProgrammeItemState = (): TaxAuditProgrammeItemState => ({
  status: 'Not started',
  response: 'To be reviewed',
  assigned_to: '',
  due_date: '',
  working_reference: '',
  remarks: '',
  reviewed_by: '',
  reviewed_at: '',
});

export const normalizeTaxAuditProgramme = (value: unknown): TaxAuditProgrammeState => {
  const programme = isPlainObject(value) ? value : {};
  const rawItems = isPlainObject(programme.items) ? programme.items : {};
  const items = TAX_AUDIT_PROGRAMME_CHECKLIST.reduce<Record<string, TaxAuditProgrammeItemState>>((result, checklistItem) => {
    const rawItem = isPlainObject(rawItems[checklistItem.id]) ? rawItems[checklistItem.id] : {};
    result[checklistItem.id] = {
      ...buildDefaultProgrammeItemState(),
      status: isTaxAuditProgrammeStatus(rawItem.status) ? rawItem.status : 'Not started',
      response: isTaxAuditProgrammeResponse(rawItem.response) ? rawItem.response : 'To be reviewed',
      assigned_to: typeof rawItem.assigned_to === 'string' ? rawItem.assigned_to : '',
      due_date: typeof rawItem.due_date === 'string' ? rawItem.due_date : '',
      working_reference: typeof rawItem.working_reference === 'string' ? rawItem.working_reference : '',
      remarks: typeof rawItem.remarks === 'string' ? rawItem.remarks : '',
      reviewed_by: typeof rawItem.reviewed_by === 'string' ? rawItem.reviewed_by : '',
      reviewed_at: typeof rawItem.reviewed_at === 'string' ? rawItem.reviewed_at : '',
    };
    return result;
  }, {});

  return {
    items,
    last_updated_at: typeof programme.last_updated_at === 'string' ? programme.last_updated_at : '',
  };
};

export const summarizeTaxAuditProgramme = (programme: TaxAuditProgrammeState): TaxAuditProgrammeStats => {
  const states = TAX_AUDIT_PROGRAMME_CHECKLIST.map((item) => ({
    master: item,
    state: programme.items[item.id] || buildDefaultProgrammeItemState(),
  }));

  const completed = states.filter(({ state }) => state.status === 'Completed').length;
  const reviewed = states.filter(({ state }) => state.status === 'Reviewed').length;
  const notApplicable = states.filter(({ state }) => state.status === 'Not applicable').length;
  const completeLike = completed + reviewed + notApplicable;
  const needsReview = states.filter(
    ({ state }) => state.status === 'In progress' || state.response === 'No' || state.response === 'To be reviewed'
  ).length;
  const requiredIncomplete = states.filter(
    ({ master, state }) =>
      master.isRequiredByDefault &&
      state.status !== 'Completed' &&
      state.status !== 'Reviewed' &&
      state.status !== 'Not applicable'
  ).length;
  const hasResponses = states.some(({ state }) =>
    state.status !== 'Not started' ||
    state.response !== 'To be reviewed' ||
    Boolean(state.assigned_to || state.due_date || state.working_reference || state.remarks || state.reviewed_at)
  );

  return {
    total: states.length,
    notStarted: states.filter(({ state }) => state.status === 'Not started').length,
    inProgress: states.filter(({ state }) => state.status === 'In progress').length,
    completed,
    reviewed,
    notApplicable,
    needsReview,
    requiredIncomplete,
    hasResponses,
    completionPercent: states.length > 0 ? Math.round((completeLike / states.length) * 100) : 0,
  };
};

export const buildTaxAuditProgrammeSetupJson = ({
  currentSetupJson,
  programme,
  updatedAt = new Date().toISOString(),
}: SaveTaxAuditProgrammeInput) => {
  let setupJson: Record<string, unknown> = {};
  try {
    const parsed = currentSetupJson ? JSON.parse(currentSetupJson) : {};
    setupJson = isPlainObject(parsed) ? parsed : {};
  } catch {
    setupJson = {};
  }

  const previousProgramme = isPlainObject(setupJson.auditProgramme) ? setupJson.auditProgramme : {};

  return JSON.stringify({
    ...setupJson,
    auditProgramme: {
      ...previousProgramme,
      items: programme.items,
      last_updated_at: updatedAt,
    },
  });
};
