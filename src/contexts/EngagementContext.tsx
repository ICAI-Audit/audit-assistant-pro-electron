import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const db = getSQLiteClient();

interface Engagement {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  financial_year: string;
  engagement_type: string;
  status: string;
  created_by?: string | null;
  partner_id: string | null;
  materiality_amount: number | null;
  performance_materiality: number | null;
}

type EngagementRow = Engagement & {
  client?: { name?: string | null } | null;
};

interface EngagementContextType {
  currentEngagement: Engagement | null;
  engagements: Engagement[];
  loading: boolean;
  /**
   * Resolves true once the engagement has changed, false when the user chose to stay (a screen holding
   * unsaved work asked first). With nothing to lose the change is made at once, before this returns.
   */
  setCurrentEngagement: (engagement: Engagement | null) => Promise<boolean>;
  /** As setCurrentEngagement; 'sign-out' when the engagement is cleared to log out (the question then says so). */
  clearEngagement: (purpose?: LeavePurpose) => Promise<boolean>;
  refreshEngagements: () => Promise<void>;
}

const EngagementContext = createContext<EngagementContextType | undefined>(undefined);

const STORAGE_KEY = 'auditpro_current_engagement';

/**
 * A screen holding work that a change of engagement clears (PDF Tools' unsaved results) registers a
 * guard. The guard returns what would be lost (it may end with a question of its own), or null when
 * there is nothing to lose.
 */
type LeaveGuard = () => string | null;
const leaveGuards = new Set<LeaveGuard>();
export function registerEngagementLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuards.add(guard);
  return () => {
    leaveGuards.delete(guard);
  };
}

/** Why the engagement is left: changed (another one, or the selector), or cleared to log out. */
export type LeavePurpose = 'change' | 'sign-out';
export interface LeaveQuestion {
  title: string;
  description: string;
  action: string;
}

/**
 * The question asked in the application's own dialog, or null when no guard has anything to lose. The
 * guards' texts say what would be lost; a closing question of theirs is replaced by one that fits the
 * route, so Log Out never asks "Change engagement anyway?".
 */
export function leaveQuestionFor(texts: readonly (string | null)[], purpose: LeavePurpose): LeaveQuestion | null {
  const facts = texts.filter((t): t is string => Boolean(t && t.trim())).map((t) => t.replace(/\s*[^.!?]*\?\s*$/, '').trim() || t.trim());
  if (facts.length === 0) return null;
  return purpose === 'sign-out'
    ? { title: 'Log out anyway?', description: facts.join(' '), action: 'Log out' }
    : { title: 'Change engagement anyway?', description: facts.join(' '), action: 'Change engagement' };
}

/**
 * Makes a change of engagement: at once when nothing would be lost; otherwise it asks first and makes the
 * change only after OK, before the returned promise resolves, so a caller's toast, navigation or sign-out
 * runs only after it. The guards are read now, not when they were registered.
 */
export function changeAfterAsking(purpose: LeavePurpose, apply: () => void, ask: (question: LeaveQuestion) => Promise<boolean>): Promise<boolean> {
  const question = leaveQuestionFor([...leaveGuards].map((guard) => guard()), purpose);
  if (!question) {
    apply();
    return Promise.resolve(true);
  }
  return ask(question).then((ok) => {
    if (ok) apply();
    return ok;
  });
}

export function EngagementProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentEngagement, setCurrentEngagementState] = useState<Engagement | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEngagements = async () => {
    if (!user) {
      setEngagements([]);
      setLoading(false);
      return [] as Engagement[];
    }

    try {
      const { data, error } = await db
        .from('engagements')
        .select('id, name, client_id, client_name, financial_year, engagement_type, status, partner_id, materiality_amount, performance_materiality')
        .order('created_at', { ascending: false })
        .execute();

      if (error) throw error;
      const resolved = (data as EngagementRow[] | null)?.map(({ client, ...item }) => ({
        ...item,
        client_name: client?.name || item.client_name,
      })) || [];
      setEngagements(resolved);
      setCurrentEngagementState((current) => {
        if (!current || resolved.some((item) => item.id === current.id)) return current;
        localStorage.removeItem(STORAGE_KEY);
        return null;
      });
      return resolved;
    } catch (error) {
      console.error('Error fetching engagements:', error);
      return [] as Engagement[];
    } finally {
      setLoading(false);
    }
  };

  // Load saved engagement from localStorage on mount
  useEffect(() => {
    if (user) {
      setLoading(true);
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setCurrentEngagementState(parsed);
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      fetchEngagements();
    } else {
      setCurrentEngagementState(null);
      setEngagements([]);
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!currentEngagement || engagements.length === 0) return;
    const refreshed = engagements.find((item) => item.id === currentEngagement.id);
    if (!refreshed) {
      setCurrentEngagementState(null);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const fieldsToCheck: Array<keyof Engagement> = [
      'client_id',
      'client_name',
      'name',
      'financial_year',
      'engagement_type',
      'status',
      'partner_id',
      'materiality_amount',
      'performance_materiality',
    ];
    const shouldUpdate = fieldsToCheck.some((field) => refreshed[field] !== currentEngagement[field]);
    if (shouldUpdate) {
      setCurrentEngagementState(refreshed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    }
  }, [engagements, currentEngagement]);

  // The question before unsaved work is thrown away, asked in the application's own dialog: a native
  // window.confirm box left the window taking no typing until it lost and regained focus (Windows).
  const [question, setQuestion] = useState<LeaveQuestion | null>(null);
  const [asking, setAsking] = useState(false);
  const pendingAnswer = useRef<((ok: boolean) => void) | null>(null);
  const ask = (next: LeaveQuestion) =>
    new Promise<boolean>((resolve) => {
      pendingAnswer.current?.(false);
      pendingAnswer.current = resolve;
      setQuestion(next);
      setAsking(true);
    });
  const answer = (ok: boolean) => {
    const resolve = pendingAnswer.current;
    pendingAnswer.current = null;
    setAsking(false); // the words stay while the dialog fades out
    resolve?.(ok);
  };
  // Another user, or none: a question still open is about work that is already gone.
  useEffect(() => () => answer(false), [user?.id]);

  const setCurrentEngagement = (engagement: Engagement | null) => {
    const apply = () => {
      setCurrentEngagementState(engagement);
      if (engagement) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(engagement));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    };
    if (engagement?.id === currentEngagement?.id) {
      apply();
      return Promise.resolve(true);
    }
    return changeAfterAsking('change', apply, ask);
  };

  const clearEngagement = (purpose: LeavePurpose = 'change') => {
    const apply = () => {
      setCurrentEngagementState(null);
      localStorage.removeItem(STORAGE_KEY);
    };
    if (!currentEngagement) {
      apply();
      return Promise.resolve(true);
    }
    return changeAfterAsking(purpose, apply, ask);
  };

  const refreshEngagements = async () => {
    await fetchEngagements();
  };

  return (
    <EngagementContext.Provider
      value={{
        currentEngagement,
        engagements,
        loading,
        setCurrentEngagement,
        clearEngagement,
        refreshEngagements,
      }}
    >
      {children}
      <AlertDialog open={asking} onOpenChange={(open) => !open && answer(false)}>
        {/* Stay has the focus when the question opens (Radix), so Enter keeps the work; Escape is Stay too. */}
        <AlertDialogContent data-testid="engagement-leave-question">
          <AlertDialogHeader>
            <AlertDialogTitle>{question?.title}</AlertDialogTitle>
            <AlertDialogDescription>{question?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="engagement-leave-stay">Stay</AlertDialogCancel>
            <AlertDialogAction
              data-testid="engagement-leave-go"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => answer(true)}
            >
              {question?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EngagementContext.Provider>
  );
}

export function useEngagement() {
  const context = useContext(EngagementContext);
  if (context === undefined) {
    throw new Error('useEngagement must be used within an EngagementProvider');
  }
  return context;
}
