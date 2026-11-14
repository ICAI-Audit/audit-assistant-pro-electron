import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { EngagementProvider } from "@/contexts/EngagementContext";
import { TallyProvider } from "@/contexts/TallyContext";
import { AppUpdaterManager } from "@/components/AppUpdaterManager";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ProtectedEngagementRoute } from "@/components/auth/ProtectedEngagementRoute";
import { ProtectedAdminRoute } from "@/components/auth/ProtectedAdminRoute";
import { MainLayout } from "@/components/layout/MainLayout";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import Dashboard from "./pages/Dashboard";
import SelectEngagement from "./pages/SelectEngagement";
import Engagements from "./pages/Engagements";
// Large module (FSG financial statement generator): loaded when first opened.
const FinancialStatementReview = lazy(() => import("./pages/FinancialStatementReview"));
import Appointment from "./pages/Appointment";
import Materiality from "./pages/Materiality";
import RiskRegister from "./pages/RiskRegister";
import AuditExecution from "./pages/AuditExecution";
import ProcedureWorkpaper from "./pages/ProcedureWorkpaper";
import EvidenceVault from "./pages/EvidenceVault";
import ReviewNotes from "./pages/ReviewNotes";
import Misstatements from "./pages/Misstatements";
import AuditTrail from "./pages/AuditTrail";
import Completion from "./pages/Completion";
import Settings from "./pages/Settings";
import Feedback from "./pages/Feedback";
import AdminDashboard from "./pages/AdminDashboard";
import AdminSettings from "./pages/AdminSettings";
import AuditTools from "./pages/AuditTools";
import CaatTools from "./pages/CaatTools";
import PermanentFile from "./pages/PermanentFile";
import AuditReport from "./pages/AuditReport";
import TaxAudit from "./pages/TaxAudit";
import ComplianceApplicability from "./pages/ComplianceApplicability";
import GstzenIntegration from "./pages/GstzenIntegration";
import GstzenLogin from "./pages/GstzenLogin";
import Gstr1Dashboard from "./pages/Gstr1Dashboard";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { EngagementLetterGenerator } from "@/components/appointment/EngagementLetterGenerator";

const queryClient = new QueryClient();

function AuthRedirector() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Force auth route on app load if no user session
    // This avoids restoring a previous route before login.
    if (!loading && !user && location.pathname !== "/auth") {
      console.log('🔄 AuthRedirector: No user detected, redirecting to /auth');
      navigate("/auth", { replace: true });
    }
  }, [loading, user, location.pathname, navigate]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppUpdaterManager />
        <Toaster />
        <Sonner />
        <HashRouter>
          <AuthProvider>
          <AuthRedirector />
          <EngagementProvider>
            <TallyProvider>
              <Routes>
                {/* Public route */}
                <Route path="/auth" element={<Auth />} />

                {/* Engagement selection (requires auth but not engagement) */}
                <Route
                  path="/select-engagement"
                  element={
                    <ProtectedRoute>
                      <SelectEngagement />
                    </ProtectedRoute>
                  }
                />

                {/* Protected routes that require engagement selection */}
                <Route
                  path="/permanent-file"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <PermanentFile />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Dashboard />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/engagements"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Engagements />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                {/* Audit Execution → Financial Statement Review (T-019). It replaced the
                    former Financial Review screen; the old paths redirect here. */}
                <Route
                  path="/financial-statement-review"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout fullBleed>
                        <RouteErrorBoundary title="Financial Statement Review">
                          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Financial Statement Review…</div>}>
                            <FinancialStatementReview />
                          </Suspense>
                        </RouteErrorBoundary>
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route path="/financial-review" element={<Navigate to="/financial-statement-review" replace />} />
                <Route path="/trial-balance" element={<Navigate to="/financial-statement-review" replace />} />
                <Route
                  path="/appointment"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Appointment />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/appointment/engagement-letter"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <EngagementLetterGenerator />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/materiality"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Materiality />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/risks"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <RiskRegister />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/audit-execution"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <AuditExecution />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/programs-new"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <AuditExecution />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/procedures/:procedureId/workpaper"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <ProcedureWorkpaper />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/evidence"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <EvidenceVault />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/review-notes"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <ReviewNotes />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/misstatements"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Misstatements />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/audit-trail"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <AuditTrail />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/completion"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Completion />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/audit-tools"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <AuditTools />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/caat-tools"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout fullBleed>
                        <CaatTools />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/tax-audit"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <TaxAudit />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/audit-report"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <AuditReport />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/feedback"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <Feedback />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Settings />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/gstr1-integration"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <GstzenIntegration />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/gstzen-login"
                  element={
                    <ProtectedRoute>
                      <GstzenLogin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/gstin/:gstinUuid/gstr1"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Gstr1Dashboard />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedAdminRoute>
                      <MainLayout>
                        <AdminDashboard />
                      </MainLayout>
                    </ProtectedAdminRoute>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <ProtectedAdminRoute>
                      <MainLayout>
                        <AdminSettings />
                      </MainLayout>
                    </ProtectedAdminRoute>
                  }
                />
                <Route
                  path="/compliance-applicability"
                  element={
                    <ProtectedEngagementRoute>
                      <MainLayout>
                        <ComplianceApplicability />
                      </MainLayout>
                    </ProtectedEngagementRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </TallyProvider>
          </EngagementProvider>
        </AuthProvider>
      </HashRouter>
    </TooltipProvider>
</QueryClientProvider>
);

export default App;




