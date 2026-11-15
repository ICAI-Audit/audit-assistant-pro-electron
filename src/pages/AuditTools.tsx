import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import PdfToolsMount from "@/components/pdf-tools/PdfToolsMount";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTabShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useEngagement } from "@/contexts/EngagementContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  formatGstinInput,
  getGstinTaxpayerType,
  getGstinValidationError,
  GSTIN_TAXPAYER_TYPE_LABELS,
  type GstinTaxpayerType,
} from "@/lib/gstinValidation";
import { createVerifiedGstinCsv, parseGstinSpreadsheet, type InvalidGstinRow } from "@/lib/gstinSpreadsheet";
import { getSQLiteClient } from "@/integrations/sqlite/client";

const db = getSQLiteClient();

import DeferredTax from "@/components/audit/DeferredTax";
import DeferredTaxCalculator from "@/components/audit/DeferredTaxCalculator";
const LedgerAnalysisTool = lazy(() => import("@/modules/ledger-analysis/LedgerAnalysisTool"));
import {
  FileSpreadsheet,
  Building2,
  Receipt,
  FileText,
  Download,
  Search,
  FileJson,
  FilePlus,
  FileType,
  Table,
  Shield,
  AlertTriangle,
  AlertCircle,
  Bell,
  Users,
  CreditCard,
  Calculator,
  Loader2,
  Scale,
} from "lucide-react";

interface ToolCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  status?: "available" | "coming-soon" | "beta";
  onClick?: () => void;
}

const ToolCard = ({ title, description, icon, status = "available", onClick }: ToolCardProps) => {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${status === "coming-soon" ? "opacity-60" : ""
        }`}
      onClick={status !== "coming-soon" ? onClick : undefined}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            {icon}
          </div>
          {status === "coming-soon" && (
            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
          )}
        </div>
        <CardTitle className="text-base mt-3">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardContent>
    </Card>
  );
};

type GstinBulkLookupResult = {
  gstin: string;
  name: string;
  taxpayerType: GstinTaxpayerType | "";
  valid: boolean;
  message: string | null;
};

const GSTTools = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentEngagement } = useEngagement();
  const { user } = useAuth();

  const [gstinDialogOpen, setGstinDialogOpen] = useState(false);
  const [gstinInput, setGstinInput] = useState("");
  const [gstinName, setGstinName] = useState("");
  const [taxpayerType, setTaxpayerType] = useState<GstinTaxpayerType | "">("");
  const [gstinLookupConsent, setGstinLookupConsent] = useState(false);
  const [isFetchingGstinDetails, setIsFetchingGstinDetails] = useState(false);
  const [gstinLookupMessage, setGstinLookupMessage] = useState<string | null>(null);
  const [bulkGstinFile, setBulkGstinFile] = useState<File | null>(null);
  const [bulkInvalidGstins, setBulkInvalidGstins] = useState<InvalidGstinRow[]>([]);
  const [bulkDuplicateCount, setBulkDuplicateCount] = useState(0);
  const [bulkLookupResults, setBulkLookupResults] = useState<GstinBulkLookupResult[]>([]);
  const [bulkLookupProgress, setBulkLookupProgress] = useState<{ completed: number; total: number } | null>(null);
  const [isBulkLookupRunning, setIsBulkLookupRunning] = useState(false);
  const cancelBulkLookupRef = useRef(false);
  const [gstins, setGstins] = useState<{ id: string; gstin: string; created_at: string }[]>([]);
  const [isLoadingGstins, setIsLoadingGstins] = useState(false);
  const [isSavingGstin, setIsSavingGstin] = useState(false);
  const [editingGstinId, setEditingGstinId] = useState<string | null>(null);
  const [editingGstinValue, setEditingGstinValue] = useState("");
  const [isUpdatingGstin, setIsUpdatingGstin] = useState(false);
  const [isDeletingGstinId, setIsDeletingGstinId] = useState<string | null>(null);

  const clientId = currentEngagement?.client_id;

  const fetchClientGstins = useCallback(async () => {
    if (!clientId) {
      setGstins([]);
      return;
    }

    setIsLoadingGstins(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .select("id, gstin, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGstins(data || []);
    } catch (error) {
      console.error("Error fetching GSTINs:", error);
      toast({
        title: "Failed to load GST numbers",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingGstins(false);
    }
  }, [clientId, toast]);

  useEffect(() => {
    fetchClientGstins();
  }, [fetchClientGstins]);

  const handleOpenGstinDialog = () => {
    if (!clientId) {
      toast({
        title: "Client not linked",
        description: "This engagement is not linked to a client. Link a client in Admin Settings → Clients.",
        variant: "destructive",
      });
      return;
    }
    setGstinInput("");
    setGstinName("");
    setTaxpayerType("");
    setGstinLookupConsent(false);
    setGstinLookupMessage(null);
    setBulkGstinFile(null);
    setBulkInvalidGstins([]);
    setBulkDuplicateCount(0);
    setBulkLookupResults([]);
    setGstinDialogOpen(true);
  };

  const handleFetchGstinDetails = async () => {
    const normalized = formatGstinInput(gstinInput);
    if (!gstinLookupConsent) {
      toast({ title: "Consent required", description: "Confirm the internet lookup statement before fetching GSTIN details." });
      return;
    }
    const validationError = getGstinValidationError(normalized);
    if (validationError) {
      toast({ title: "Invalid GSTIN", description: validationError, variant: "destructive" });
      return;
    }

    setIsFetchingGstinDetails(true);
    setGstinLookupMessage(null);
    try {
      const response = await window.electronAPI.gstinLookup.fetchDetails({
        gstin: normalized,
        consentConfirmed: true,
      });
      if (!response.success || !response.data) throw new Error(response.error || "GSTIN details could not be fetched.");
      if (!response.data.valid) {
        const message = "Local structure/checksum validation passed, but e-waybill.in did not confirm this GSTIN. No verified taxpayer details were returned.";
        setGstinLookupMessage(message);
        toast({ title: "GSTIN not confirmed by provider", description: message, variant: "destructive" });
        return;
      }

      setGstinName(response.data.name);
      if (response.data.taxpayerType) setTaxpayerType(response.data.taxpayerType);
      if (!response.data.name) {
        setGstinLookupMessage("Lookup completed, but the service did not return a taxpayer name. You can enter it manually.");
        toast({ title: "Name not returned", description: "The lookup service did not return a taxpayer name. You can enter it manually." });
      } else {
        setGstinLookupMessage("Taxpayer name fetched; registration type derived from the GSTIN.");
        toast({ title: "GSTIN details fetched", description: "Taxpayer name and registration type are ready to review." });
      }
    } catch (error) {
      setGstinLookupMessage(error instanceof Error ? error.message : "GSTIN details could not be fetched.");
      toast({
        title: "GSTIN lookup failed",
        description: error instanceof Error ? error.message : "Check your internet connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingGstinDetails(false);
    }
  };

  const handleDownloadGstinTemplate = async () => {
    const exportFile = window.electronAPI.app?.exportFile;
    if (!exportFile) {
      toast({ title: "Template download unavailable", description: "The Electron save dialog is not available." });
      return;
    }

    try {
      const buffer = new TextEncoder().encode("\uFEFFGSTIN\r\n").buffer as ArrayBuffer;
      const savedPath = await exportFile({
        defaultFilename: "GSTIN_Template.csv",
        buffer,
        mimeType: "text/csv;charset=utf-8",
        fileExtension: "csv",
        showSaveDialog: true,
      });
      if (savedPath) toast({ title: "Template downloaded", description: savedPath });
    } catch (error) {
      toast({
        title: "Template download failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadVerifiedGstins = async () => {
    const verifiedRows = bulkLookupResults.filter((result) => result.valid);
    if (verifiedRows.length === 0) {
      toast({ title: "No verified GSTINs", description: "Only provider-confirmed GSTINs are included in this download." });
      return;
    }

    const exportFile = window.electronAPI.app?.exportFile;
    if (!exportFile) {
      toast({ title: "Download unavailable", description: "The Electron save dialog is not available." });
      return;
    }

    try {
      const csv = createVerifiedGstinCsv(verifiedRows.map((result) => ({
        gstin: result.gstin,
        name: result.name,
        taxpayerType: result.taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[result.taxpayerType] : "",
      })));
      const buffer = new TextEncoder().encode(`\uFEFF${csv}`).buffer as ArrayBuffer;
      const savedPath = await exportFile({
        defaultFilename: "Verified_GSTINs.csv",
        buffer,
        mimeType: "text/csv;charset=utf-8",
        fileExtension: "csv",
        showSaveDialog: true,
      });
      if (savedPath) toast({ title: "Verified GSTINs downloaded", description: savedPath });
    } catch (error) {
      toast({
        title: "Verified GSTIN download failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleBulkGstinLookup = async () => {
    if (!gstinLookupConsent) {
      toast({ title: "Consent required", description: "Confirm the internet lookup statement before fetching GSTIN details." });
      return;
    }
    if (!bulkGstinFile) {
      toast({ title: "Spreadsheet required", description: "Choose a CSV, XLS, or XLSX file first." });
      return;
    }

    let parsed;
    try {
      parsed = parseGstinSpreadsheet(await bulkGstinFile.arrayBuffer());
    } catch (error) {
      toast({
        title: "Spreadsheet could not be read",
        description: error instanceof Error ? error.message : "Choose a supported spreadsheet with GSTIN in cell A1.",
        variant: "destructive",
      });
      return;
    }

    setBulkInvalidGstins(parsed.invalidGstins);
    setBulkDuplicateCount(parsed.duplicateCount);
    setBulkLookupResults([]);
    if (parsed.invalidGstins.length > 0) {
      toast({
        title: "Invalid GSTINs excluded",
        description: `${parsed.invalidGstins.length} invalid GSTIN${parsed.invalidGstins.length === 1 ? " was" : "s were"} not sent to the API.`,
        variant: "destructive",
      });
    }
    if (parsed.validGstins.length === 0) {
      setBulkLookupProgress(null);
      if (parsed.invalidGstins.length === 0) {
        toast({ title: "No GSTINs found", description: "Enter GSTIN values below the GSTIN header." });
      }
      return;
    }

    setIsBulkLookupRunning(true);
    cancelBulkLookupRef.current = false;
    setBulkLookupProgress({ completed: 0, total: parsed.validGstins.length });
    const results: GstinBulkLookupResult[] = [];
    try {
      for (const gstin of parsed.validGstins) {
        if (cancelBulkLookupRef.current) break;
        try {
          const response = await window.electronAPI.gstinLookup.fetchDetails({
            gstin,
            consentConfirmed: true,
          });
          if (!response.success || !response.data) {
            results.push({ gstin, name: "", taxpayerType: "", valid: false, message: response.error || "Lookup failed." });
          } else {
            results.push({
              gstin,
              name: response.data.name,
              taxpayerType: getGstinTaxpayerType(gstin) || "",
              valid: response.data.valid,
              message: response.data.message,
            });
          }
        } catch (error) {
          results.push({
            gstin,
            name: "",
            taxpayerType: "",
            valid: false,
            message: error instanceof Error ? error.message : "Lookup failed.",
          });
        }
        setBulkLookupResults([...results]);
        setBulkLookupProgress({ completed: results.length, total: parsed.validGstins.length });
      }

      const confirmedCount = results.filter((result) => result.valid).length;
      toast({
        title: cancelBulkLookupRef.current ? "Bulk lookup stopped" : "Bulk lookup complete",
        description: cancelBulkLookupRef.current
          ? `Stopped after ${results.length} of ${parsed.validGstins.length} lookups. The current request was allowed to finish.`
          : `Lookup confirmed ${confirmedCount} of ${results.length} structurally valid GSTINs.`,
      });
    } finally {
      setIsBulkLookupRunning(false);
    }
  };

  const handleSaveBulkGstins = async () => {
    if (!clientId || !user?.id) {
      toast({ title: "Login required", description: "Sign in and select a client before saving GSTINs.", variant: "destructive" });
      return;
    }

    const existingGstins = new Set(gstins.map((item) => formatGstinInput(item.gstin)));
    const saveableResults = bulkLookupResults.filter(
      (result) => result.valid && result.name.trim() && result.taxpayerType && !existingGstins.has(result.gstin)
    );
    if (saveableResults.length === 0) {
      toast({
        title: "No complete GSTIN details to save",
        description: "Confirmed rows need a taxpayer name and a valid GSTIN-derived type.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .insert(saveableResults.map((result) => ({
          client_id: clientId,
          gstin: result.gstin,
          name: result.name.trim(),
          taxpayer_type: result.taxpayerType,
          created_by: user.id,
        })))
        .select("id, gstin, created_at");
      if (error) throw error;

      setGstins((current) => [...(data || []), ...current]);
      toast({ title: "GSTINs saved", description: `Saved ${data?.length || 0} GSTINs to this client locally.` });
      setBulkLookupResults([]);
      setBulkInvalidGstins([]);
      setBulkGstinFile(null);
    } catch (error) {
      toast({
        title: "Could not save GSTINs",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingGstin(false);
    }
  };

  const handleAddGstin = async () => {
    const normalized = formatGstinInput(gstinInput);
    const name = gstinName.trim();

    if (!clientId) {
      toast({
        title: "Client not linked",
        description: "Please link a client before adding GST numbers.",
        variant: "destructive",
      });
      return;
    }
    if (!normalized) {
      toast({ title: "GSTIN required", description: "Enter a GST number to continue." });
      return;
    }
    const gstinValidationError = getGstinValidationError(normalized);
    if (gstinValidationError) {
      toast({
        title: "Invalid GSTIN",
        description: gstinValidationError,
        variant: "destructive",
      });
      return;
    }
    if (!name) {
      toast({ title: "Company name required", description: "Enter the company/taxpayer name." });
      return;
    }
    if (gstins.some((gstin) => gstin.gstin === normalized)) {
      toast({ title: "GSTIN already added", description: "This GSTIN already exists for this client." });
      return;
    }
    if (!user?.id) {
      toast({
        title: "Login required",
        description: "Please sign in again to add GST numbers.",
        variant: "destructive",
      });
      return;
    }

    if (!taxpayerType) {
      toast({ title: "Taxpayer type required", description: "Select a type or fetch it from the lookup service." });
      return;
    }
    setIsSavingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .insert({
          client_id: clientId,
          gstin: normalized,
          name,
          taxpayer_type: taxpayerType,
          created_by: user.id,
        })
        .select("id, gstin, created_at")
        .single();

      if (error) throw error;

      setGstins((prev) => [data, ...prev]);
      setGstinInput("");
      setGstinName("");
      setTaxpayerType("");
      setGstinDialogOpen(false);
      toast({
        title: "GST number added",
        description: `${normalized} saved locally for ${currentEngagement?.client_name || "this client"}.`,
      });
    } catch (error) {
      console.error("Error adding GSTIN:", error);
      toast({
        title: "Failed to add GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingGstin(false);
    }
  };

  const startEditGstin = (gstinId: string, gstinValue: string) => {
    setEditingGstinId(gstinId);
    setEditingGstinValue(formatGstinInput(gstinValue));
  };

  const cancelEditGstin = () => {
    setEditingGstinId(null);
    setEditingGstinValue("");
  };

  const handleUpdateGstin = async () => {
    if (!clientId || !editingGstinId) return;
    const normalized = formatGstinInput(editingGstinValue);

    if (!normalized) {
      toast({ title: "GSTIN required", description: "Enter a GST number to continue." });
      return;
    }
    const gstinValidationError = getGstinValidationError(normalized);
    if (gstinValidationError) {
      toast({
        title: "Invalid GSTIN",
        description: gstinValidationError,
        variant: "destructive",
      });
      return;
    }
    if (gstins.some((gstin) => gstin.gstin === normalized && gstin.id !== editingGstinId)) {
      toast({ title: "GSTIN already added", description: "This GSTIN already exists for this client." });
      return;
    }

    setIsUpdatingGstin(true);
    try {
      const { data, error } = await db
        .from("client_gstins")
        .update({ gstin: normalized })
        .eq("id", editingGstinId)
        .eq("client_id", clientId)
        .select("id, gstin, created_at")
        .single();

      if (error) throw error;

      setGstins((prev) => prev.map((item) => (item.id === data.id ? data : item)));
      toast({ title: "GST number updated", description: `${normalized} updated.` });
      cancelEditGstin();
    } catch (error) {
      console.error("Error updating GSTIN:", error);
      toast({
        title: "Failed to update GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingGstin(false);
    }
  };

  const handleDeleteGstin = async (gstinId: string, gstinValue: string) => {
    if (!clientId) return;

    setIsDeletingGstinId(gstinId);
    try {
      const { error } = await db
        .from("client_gstins")
        .delete()
        .eq("id", gstinId)
        .eq("client_id", clientId);

      if (error) throw error;

      setGstins((prev) => prev.filter((item) => item.id !== gstinId));
      toast({
        title: "GST number removed",
        description: `${gstinValue} removed from this client.`,
      });
    } catch (error) {
      console.error("Error deleting GSTIN:", error);
      toast({
        title: "Failed to delete GST number",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingGstinId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="GST Number Master"
          description="Add GST numbers linked to this client. Numbers are scoped per client."
          icon={<FilePlus className="h-5 w-5 text-primary" />}
          status="available"
          onClick={handleOpenGstinDialog}
        />
        <ToolCard
          title="GSTR1 Data Download"
          description="Download GSTR1 reports directly from GST portal for audit and reconciliation purposes."
          icon={<Download className="h-5 w-5 text-primary" />}
          status="available"
          onClick={() => navigate("/gstr1-integration")}
        />
        <ToolCard
          title="Reconcile with Books"
          description="Compare GST returns with books of accounts. Identify mismatches in sales, purchases, and ITC claims."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="JSON to Excel Converter"
          description="Convert GST JSON files to Excel format for easy analysis and documentation."
          icon={<FileJson className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="ITC Reconciliation"
          description="Match GSTR-2A/2B with purchase register to identify eligible and ineligible ITC claims."
          icon={<Receipt className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="E-Way Bill Tracker"
          description="Track and validate e-way bills for goods movement verification."
          icon={<FileText className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      <Dialog open={gstinDialogOpen} onOpenChange={(open) => {
        if (!open && (isFetchingGstinDetails || isBulkLookupRunning || isSavingGstin)) return;
        setGstinDialogOpen(open);
        if (!open) setGstinLookupConsent(false);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>GST Number Master</DialogTitle>
            <DialogDescription>
              Manage GST numbers for {currentEngagement?.client_name || "this client"}. GST numbers are client-specific.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="gstin-input">GSTIN *</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    id="gstin-input"
                    value={gstinInput}
                    onChange={(e) => {
                      const normalized = formatGstinInput(e.target.value);
                      setGstinInput(normalized);
                      setGstinName("");
                      setTaxpayerType(getGstinTaxpayerType(normalized) || "");
                      setGstinLookupMessage(null);
                    }}
                    placeholder="Enter GSTIN (15 characters)"
                    maxLength={15}
                    className="font-mono"
                    disabled={isSavingGstin || isFetchingGstinDetails}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleFetchGstinDetails}
                    disabled={!gstinLookupConsent || !gstinInput.trim() || isFetchingGstinDetails || isSavingGstin}
                  >
                    {isFetchingGstinDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    {isFetchingGstinDetails ? "Fetching details..." : "Fetch taxpayer details"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gstin-name">Company/Taxpayer Name *</Label>
                <Input
                  id="gstin-name"
                  value={gstinName}
                  onChange={(e) => setGstinName(e.target.value)}
                  placeholder="Enter company or taxpayer name"
                  disabled={isSavingGstin}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxpayer-type">Taxpayer/Registration Type *</Label>
                <Input
                  id="taxpayer-type"
                  value={taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[taxpayerType] : ""}
                  placeholder=""
                  readOnly
                />
              </div>
            </div>

            {gstinLookupMessage && <p className="text-sm text-muted-foreground" role="status">{gstinLookupMessage}</p>}

            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="gstin-lookup-consent"
                  checked={gstinLookupConsent}
                  onCheckedChange={(checked) => setGstinLookupConsent(checked === true)}
                  disabled={isFetchingGstinDetails || isBulkLookupRunning}
                />
                <Label htmlFor="gstin-lookup-consent" className="text-sm font-normal leading-5">
                  I hereby confirm and agree to the use of an API over the internet for fetching and retrieving GSTIN-related details and information, as required for the intended purpose.
                </Label>
              </div>
              <p className="pl-6 text-xs text-muted-foreground">
                Only GSTINs that pass local structure and checksum checks are sent to API.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleAddGstin} disabled={isSavingGstin || isFetchingGstinDetails}>
                {isSavingGstin ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FilePlus className="h-4 w-4 mr-2" />
                )}
                Add GSTIN
              </Button>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="bulk-gstin-file">Bulk GSTIN file</Label>
                  <p className="text-xs text-muted-foreground">CSV, XLS, or XLSX. The first worksheet must have GSTIN in cell A1, with GSTINs in column A from row 2 onward.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleDownloadGstinTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Download CSV template
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  id="bulk-gstin-file"
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={(event) => {
                    setBulkGstinFile(event.target.files?.[0] || null);
                    setBulkInvalidGstins([]);
                    setBulkDuplicateCount(0);
                    setBulkLookupResults([]);
                    setBulkLookupProgress(null);
                  }}
                  disabled={isBulkLookupRunning || isSavingGstin}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBulkGstinLookup}
                  disabled={!bulkGstinFile || !gstinLookupConsent || isBulkLookupRunning || isSavingGstin}
                >
                  {isBulkLookupRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                  Validate and fetch
                </Button>
              </div>
              {isBulkLookupRunning && (
                <Button type="button" variant="outline" onClick={() => { cancelBulkLookupRef.current = true; }}>
                  Stop after current lookup
                </Button>
              )}
              {bulkLookupProgress && (
                <p className="text-sm text-muted-foreground" role="status">
                  Fetching details: {bulkLookupProgress.completed} of {bulkLookupProgress.total}
                </p>
              )}
              {bulkDuplicateCount > 0 && (
                <p className="text-sm text-muted-foreground">Skipped {bulkDuplicateCount} duplicate GSTIN row{bulkDuplicateCount === 1 ? "" : "s"}.</p>
              )}
              {bulkInvalidGstins.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p className="font-medium">These GSTINs are invalid and were not sent to the API:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {bulkInvalidGstins.map((item, index) => <li key={`${item.gstin}-${index}`}><span className="font-mono">{item.gstin}</span>: {item.error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {bulkLookupResults.length > 0 && (
                <div className="space-y-2">
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {bulkLookupResults.map((result, index) => (
                      <div key={result.gstin} className={`rounded-md border p-3 ${result.valid ? "" : "border-red-300 bg-red-50/50"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-sm">{result.gstin}</span>
                          <span className={`text-xs ${result.valid ? "text-green-700" : "text-red-700"}`}>
                            {result.valid ? "Lookup confirmed" : "Not confirmed"}
                          </span>
                        </div>
                        {result.valid && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`bulk-gstin-name-${index}`}>Taxpayer name</Label>
                              <Input
                                id={`bulk-gstin-name-${index}`}
                                value={result.name}
                                onChange={(event) => setBulkLookupResults((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`bulk-gstin-type-${index}`}>Taxpayer/registration type</Label>
                              <Input
                                id={`bulk-gstin-type-${index}`}
                                value={result.taxpayerType ? GSTIN_TAXPAYER_TYPE_LABELS[result.taxpayerType] : ""}
                                readOnly
                              />
                            </div>
                          </div>
                        )}
                        {result.message && <p className="mt-2 text-xs text-muted-foreground">{result.message}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDownloadVerifiedGstins}
                      disabled={!bulkLookupResults.some((result) => result.valid) || isBulkLookupRunning || isSavingGstin}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download verified GSTINs
                    </Button>
                    <Button type="button" onClick={handleSaveBulkGstins} disabled={isSavingGstin || isBulkLookupRunning}>
                      {isSavingGstin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus className="mr-2 h-4 w-4" />}
                      Save complete GSTINs locally
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Saved GST numbers appear only for this client. Saving is local and does not call GSTZen.</p>
            </div>

            {isLoadingGstins ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading GST numbers...
              </div>
            ) : gstins.length === 0 ? (
              <div className="text-sm text-muted-foreground">No GST numbers added yet.</div>
            ) : (
              <div className="space-y-2">
                {gstins.map((gstin) => (
                  <div
                    key={gstin.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex-1">
                      {editingGstinId === gstin.id ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={editingGstinValue}
                            onChange={(e) => setEditingGstinValue(formatGstinInput(e.target.value))}
                            maxLength={15}
                            className="font-mono"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleUpdateGstin}
                              disabled={isUpdatingGstin}
                            >
                              {isUpdatingGstin ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : null}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEditGstin}
                              disabled={isUpdatingGstin}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="font-mono text-sm">{gstin.gstin}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {editingGstinId !== gstin.id && (
                        <div className="text-xs text-muted-foreground">
                          Added {new Date(gstin.created_at).toLocaleDateString()}
                        </div>
                      )}
                      {editingGstinId !== gstin.id && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEditGstin(gstin.id, gstin.gstin)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteGstin(gstin.id, gstin.gstin)}
                            disabled={isDeletingGstinId === gstin.id}
                          >
                            {isDeletingGstinId === gstin.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Delete"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MCATools = () => {
  const { toast } = useToast();
  const [cinNumber, setCinNumber] = useState("");

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 rounded-lg p-4 border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Label htmlFor="cin">CIN Number:</Label>
            <Input
              id="cin"
              value={cinNumber}
              onChange={(e) => setCinNumber(e.target.value)}
              placeholder="Enter CIN/LLPIN"
              className="flex-1"
            />
          </div>
          <Button size="sm" onClick={() => toast({ title: "Searching MCA...", description: `Looking up ${cinNumber}` })}>
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Get Company Master Data"
          description="Retrieve complete company master data including registered address, authorized capital, paid-up capital, and company status."
          icon={<Building2 className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Download Financials / AOC-4 / MGT-7"
          description="Download filed financial statements (AOC-4) and annual returns (MGT-7) directly from MCA."
          icon={<Download className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="DIR-3 KYC / DIN Status"
          description="Check Director Identification Number (DIN) status and DIR-3 KYC compliance for directors."
          icon={<Users className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Charges & Signatories"
          description="View registered charges on company assets and list of authorized signatories."
          icon={<CreditCard className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Company Documents"
          description="Access MOA, AOA, and other incorporation documents filed with MCA."
          icon={<FileText className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Related Party Check"
          description="Identify common directors and potential related parties across companies."
          icon={<Shield className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>
    </div>
  );
};

const IncomeTaxTools = () => {
  const { toast } = useToast();
  const [pan, setPan] = useState("");
  const [showDeferredTaxDialog, setShowDeferredTaxDialog] = useState(false);


  return (
    <div className="space-y-6">
      <div className="bg-muted/50 rounded-lg p-4 border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Label htmlFor="pan">PAN Number:</Label>
            <Input
              id="pan"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="Enter PAN"
              className="flex-1 uppercase"
              maxLength={10}
            />
          </div>
          <Button size="sm" onClick={() => toast({ title: "Income Tax Portal", description: "Authentication required" })}>
            <Search className="h-4 w-4 mr-2" />
            Connect
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Deferred Tax Calculator (AS-22)"
          description="Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22 for taxes on income."
          icon={<Scale className="h-5 w-5 text-primary" />}
          onClick={() => setShowDeferredTaxDialog(true)}
        />
        <ToolCard
          title="Check Notices on IT Website"
          description="View pending notices and communications from the Income Tax department for the assessee."
          icon={<Bell className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Check TDS Related Notices"
          description="Review TDS default notices, demand notices, and challan correction requirements."
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="AIS (Annual Information Statement)"
          description="Access Annual Information Statement showing all financial transactions reported to IT department."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="TIS (Taxpayer Information Summary)"
          description="View Taxpayer Information Summary with pre-filled income details and high-value transactions."
          icon={<Table className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      <Dialog open={showDeferredTaxDialog} onOpenChange={setShowDeferredTaxDialog}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deferred Tax Calculator (AS-22)</DialogTitle>
            <DialogDescription>
              Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <DeferredTaxCalculator />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const AnalyticsTools = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showDTLDialog, setShowDTLDialog] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          title="Deferred Tax Calculator (AS-22)"
          description="Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22 for taxes on income."
          icon={<Scale className="h-5 w-5 text-primary" />}
          onClick={() => setShowDTLDialog(true)}
        />
        <ToolCard
          title="Ratio Analysis Calculator"
          description="Calculate key financial ratios including liquidity, profitability, and solvency ratios from trial balance."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          onClick={() => toast({ title: "Ratio Analysis", description: "Import trial balance first" })}
        />
        <ToolCard
          title="Benford's Law Analysis"
          description="Apply Benford's Law to detect anomalies in financial data that may indicate fraud or errors."
          icon={<Search className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Duplicate Transaction Finder"
          description="Identify potential duplicate transactions based on amount, date, and party matching. Opens Ledger Analysis > Duplicates."
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          onClick={() => navigate("/audit-tools?tab=ledger")}
        />
        <ToolCard
          title="Bank Statement Analyzer"
          description="Parse and analyze bank statements for reconciliation and unusual transaction detection."
          icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
        <ToolCard
          title="Sampling Calculator"
          description="Calculate sample sizes using statistical sampling methods (MUS, random, stratified)."
          icon={<Calculator className="h-5 w-5 text-primary" />}
          onClick={() => toast({ title: "Sampling Calculator", description: "Feature available" })}
        />
        <ToolCard
          title="Trend Analysis"
          description="Perform month-on-month and year-on-year trend analysis on key financial metrics."
          icon={<Table className="h-5 w-5 text-primary" />}
          status="coming-soon"
        />
      </div>

      {/* Deferred Tax Calculator Dialog */}
      <Dialog open={showDTLDialog} onOpenChange={setShowDTLDialog}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deferred Tax Calculator (AS-22)</DialogTitle>
            <DialogDescription>
              Calculate Deferred Tax Assets (DTA) and Deferred Tax Liabilities (DTL) as per Accounting Standard 22
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <DeferredTax />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// The Tally Tools tab and its code were removed at the owner's request (T-033): Ledger Analysis replaces them
// (Tally / Busy / Zoho / Excel data; fetching lives in electron/ledger-analysis). Old ?tab=tally links open Ledger Analysis.
const AUDIT_TOOLS_TABS = ['ledger', 'gst', 'mca', 'incometax', 'pdf', 'analytics'];
const tabFromQuery = (q: string | null) => (q === 'tally' ? 'ledger' : q && AUDIT_TOOLS_TABS.includes(q) ? q : null);

export default function AuditTools() {
  const { currentEngagement } = useEngagement();
  const location = useLocation();
  const queryTab = new URLSearchParams(location.search).get('tab');
  const [activeTab, setActiveTab] = useState(tabFromQuery(queryTab) || 'ledger');

  useEffect(() => {
    // Follow ?tab= only when it changes, so the user can still switch tabs afterwards.
    const t = tabFromQuery(queryTab);
    if (t) setActiveTab(t);
  }, [queryTab]);

  // Enable tab keyboard shortcuts (Ctrl+1-6, Alt+Arrow)
  useTabShortcuts(AUDIT_TOOLS_TABS, activeTab, setActiveTab);

  if (!currentEngagement) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VERA Tools</h1>
          <p className="text-muted-foreground">
            Productivity tools to streamline your audit workflow
          </p>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select an engagement from the sidebar to use VERA tools.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">VERA Tools</h1>
        <p className="text-muted-foreground">
          {currentEngagement.client_name} - {currentEngagement.name}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger
            value="ledger"
            className="flex items-center gap-2"
          >
            <Scale className="h-4 w-4" />
            Ledger Analysis
          </TabsTrigger>
          <TabsTrigger
            value="gst"
            className="flex items-center gap-2"
          >
            <Receipt className="h-4 w-4" />
            GST Related
          </TabsTrigger>
          <TabsTrigger
            value="mca"
            className="flex items-center gap-2"
          >
            <Building2 className="h-4 w-4" />
            MCA Data
          </TabsTrigger>
          <TabsTrigger
            value="incometax"
            className="flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            Income Tax
          </TabsTrigger>
          <TabsTrigger
            value="pdf"
            className="flex items-center gap-2"
          >
            <FileType className="h-4 w-4" />
            PDF Tools
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            className="flex items-center gap-2"
          >
            <Calculator className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Ledger Analysis...</div>}>
            <LedgerAnalysisTool />
          </Suspense>
        </TabsContent>

        <TabsContent value="gst">
          <GSTTools />
        </TabsContent>

        <TabsContent value="mca">
          <MCATools />
        </TabsContent>

        <TabsContent value="incometax">
          <IncomeTaxTools />
        </TabsContent>

        <TabsContent value="pdf">
          <PdfToolsMount />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTools />
        </TabsContent>
      </Tabs>
    </div>
  );
}
