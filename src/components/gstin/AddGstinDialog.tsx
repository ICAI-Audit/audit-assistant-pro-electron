import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { gstzenApi } from "@/services/gstzen-api";
import { useToast } from "@/components/ui/use-toast";
import { formatGstinInput, getGstinValidationError } from "@/lib/gstinValidation";

interface AddGstinDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

interface ValidatedGstin {
    gstin: string;
    name: string;
    type: string;
    valid: boolean;
    company_details?: any;
}

// Utility function to parse multiple GSTINs from text
const parseGstinList = (input: string): string[] => {
    return input
        .split(/[\s,]+/)
        .map((gstin) => formatGstinInput(gstin))
        .filter((gstin) => gstin.length > 0);
};

export function AddGstinDialog({ open, onOpenChange, onSuccess }: AddGstinDialogProps) {
    const { toast } = useToast();
    const [gstinInput, setGstinInput] = useState("");
    const [validatedGstins, setValidatedGstins] = useState<ValidatedGstin[]>([]);
    const [isValidating, setIsValidating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleValidate = async () => {
        if (!gstinInput.trim()) {
            toast({
                title: "No GSTINs entered",
                description: "Please enter at least one GSTIN to validate.",
                variant: "destructive",
            });
            return;
        }

        const parsedGstins = parseGstinList(gstinInput);
        if (parsedGstins.length === 0) {
            toast({
                title: "Invalid input",
                description: "Please enter valid GSTINs separated by commas or spaces.",
                variant: "destructive",
            });
            return;
        }

        const invalidEntry = parsedGstins.find((gstin) => {
            const validationError = getGstinValidationError(gstin);
            return validationError !== null;
        });
        if (invalidEntry) {
            const validationError = getGstinValidationError(invalidEntry);
            toast({
                title: "Invalid GSTIN",
                description: `${invalidEntry}: ${validationError}`,
                variant: "destructive",
            });
            return;
        }

        setIsValidating(true);
        try {
            const gstinListString = parsedGstins.join(",");
            const response = await gstzenApi.validateGstins(gstinListString);

            if (!response.success) {
                toast({
                    title: "Validation failed",
                    description: response.error || "Failed to validate GSTINs",
                    variant: "destructive",
                });
                return;
            }

            const data = response.data;
            if (data?.status === 0) {
                toast({
                    title: "Validation error",
                    description: data.message || "Failed to validate GSTINs",
                    variant: "destructive",
                });
                return;
            }

            // Process validated GSTINs
            const gstinList = data?.gstin_list || {};
            const validated: ValidatedGstin[] = [];

            for (const gstin of parsedGstins) {
                const details = gstinList[gstin];
                if (details?.valid) {
                    const companyDetails = details.company_details;
                    if (typeof companyDetails === "object" && companyDetails !== null) {
                        validated.push({
                            gstin,
                            name: companyDetails.legal_name || "",
                            type: "",
                            valid: true,
                            company_details: companyDetails,
                        });
                    } else {
                        validated.push({
                            gstin,
                            name: "",
                            type: "",
                            valid: true,
                            company_details: companyDetails,
                        });
                    }
                } else {
                    // Invalid GSTIN - still add it so user can see it
                    validated.push({
                        gstin,
                        name: "",
                        type: "",
                        valid: false,
                    });
                }
            }

            setValidatedGstins(validated);
            toast({
                title: "Validation complete",
                description: `Validated ${validated.filter((g) => g.valid).length} of ${validated.length} GSTINs`,
            });
        } catch (error) {
            console.error("Validation error:", error);
            toast({
                title: "Validation failed",
                description: error instanceof Error ? error.message : "An error occurred",
                variant: "destructive",
            });
        } finally {
            setIsValidating(false);
        }
    };

    const handleSave = async () => {
        // Filter out invalid GSTINs and check all required fields
        const validGstins = validatedGstins.filter((g) => g.valid && g.name.trim() && g.type);
        
        if (validGstins.length === 0) {
            toast({
                title: "No valid GSTINs to save",
                description: "Please ensure all GSTINs are valid and have name and taxpayer type filled.",
                variant: "destructive",
            });
            return;
        }

        // Check for missing fields
        const missingFields = validatedGstins.filter((g) => g.valid && (!g.name.trim() || !g.type));
        if (missingFields.length > 0) {
            toast({
                title: "Missing information",
                description: `Please fill in name and taxpayer type for all GSTINs.`,
                variant: "destructive",
            });
            return;
        }

        setIsSaving(true);
        let successCount = 0;
        let failCount = 0;

        try {
            // Save each GSTIN individually
            for (const gstin of validGstins) {
                try {
                    // Map taxpayer type from UI to API format
                    let taxpayerType: "REGULAR" | "COMPOSITION" | "ISD" = "REGULAR";
                    if (gstin.type === "Composition") {
                        taxpayerType = "COMPOSITION";
                    } else if (gstin.type === "Input Service") {
                        taxpayerType = "ISD";
                    }

                    const response = await gstzenApi.createGstin({
                        gstin: gstin.gstin,
                        name: gstin.name.trim(),
                        taxpayer_type: taxpayerType,
                    });

                    if (response.success && response.data?.status === 1) {
                        successCount++;
                    } else {
                        failCount++;
                        console.error(`Failed to save ${gstin.gstin}:`, response.error || response.data?.message);
                    }
                } catch (error) {
                    failCount++;
                    console.error(`Error saving ${gstin.gstin}:`, error);
                }
            }

            toast({
                title: "Save complete",
                description: `Successfully saved ${successCount} GSTIN${successCount !== 1 ? "s" : ""}. ${failCount > 0 ? `${failCount} failed.` : ""}`,
                variant: failCount > 0 ? "destructive" : "default",
            });

            if (successCount > 0) {
                // Reset form
                setGstinInput("");
                setValidatedGstins([]);
                if (onSuccess) onSuccess();
                onOpenChange(false);
            }
        } catch (error) {
            console.error("Save error:", error);
            toast({
                title: "Save failed",
                description: error instanceof Error ? error.message : "An error occurred",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddGstin = () => {
        setValidatedGstins([...validatedGstins, { gstin: "", name: "", type: "", valid: true }]);
    };

    const handleRemoveGstin = (index: number) => {
        setValidatedGstins(validatedGstins.filter((_, i) => i !== index));
    };

    const updateGstin = (index: number, field: keyof ValidatedGstin, value: string) => {
        const updated = [...validatedGstins];
        updated[index] = { ...updated[index], [field]: value };
        setValidatedGstins(updated);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !isValidating && !isSaving && onOpenChange(val)}>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add GSTINs</DialogTitle>
                    <DialogDescription>
                        Enter GSTINs to validate and add to your account. You can enter multiple GSTINs separated by commas or spaces.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {validatedGstins.length === 0 ? (
                        <div className="space-y-2">
                            <Label htmlFor="gstin-input">Enter GSTIN Numbers</Label>
                            <Textarea
                                id="gstin-input"
                                placeholder="Paste GSTINs separated by commas or spaces: 29AAFCC9980MZZT, 27AAFCC9980MZZP"
                                rows={5}
                                value={gstinInput}
                                onChange={(e) => setGstinInput(e.target.value)}
                                disabled={isValidating}
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Enter GSTINs separated by commas, spaces, or new lines. Click "Validate GSTINs" to proceed.
                            </p>
                            <Button onClick={handleValidate} disabled={isValidating || !gstinInput.trim()}>
                                {isValidating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Validating...
                                    </>
                                ) : (
                                    "Validate GSTINs"
                                )}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">Review and Complete GSTIN Details</h3>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setValidatedGstins([]);
                                        setGstinInput("");
                                    }}
                                >
                                    Start Over
                                </Button>
                            </div>

                            {validatedGstins.map((gstin, index) => (
                                <div
                                    key={index}
                                    className={`p-4 border rounded-lg space-y-3 ${
                                        !gstin.valid
                                            ? "border-red-200 bg-red-50/30"
                                            : !gstin.name.trim() || !gstin.type
                                            ? "border-yellow-200 bg-yellow-50/30"
                                            : "border-gray-200"
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {gstin.valid ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            ) : (
                                                <AlertCircle className="h-4 w-4 text-red-600" />
                                            )}
                                            <span className="font-mono text-sm font-medium">{gstin.gstin}</span>
                                        </div>
                                        {validatedGstins.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemoveGstin(index)}
                                                disabled={isSaving}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>

                                    {!gstin.valid ? (
                                        <p className="text-sm text-red-600">Invalid GSTIN</p>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label htmlFor={`name-${index}`}>Taxpayer Name *</Label>
                                                <Input
                                                    id={`name-${index}`}
                                                    value={gstin.name}
                                                    onChange={(e) => updateGstin(index, "name", e.target.value)}
                                                    placeholder="Enter taxpayer name"
                                                    disabled={isSaving}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor={`type-${index}`}>Taxpayer Type *</Label>
                                                <Select
                                                    value={gstin.type}
                                                    onValueChange={(value) => updateGstin(index, "type", value)}
                                                    disabled={isSaving}
                                                >
                                                    <SelectTrigger id={`type-${index}`}>
                                                        <SelectValue placeholder="Select type" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Regular">Regular Taxpayer</SelectItem>
                                                        <SelectItem value="Composition">Composition Tax Payer</SelectItem>
                                                        <SelectItem value="Input Service">Input Service Distributor</SelectItem>
                                                        <SelectItem value="Special Economic Zone (SEZ)">
                                                            Special Economic Zone (SEZ)
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleAddGstin}
                                    disabled={isSaving}
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Another GSTIN
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isValidating || isSaving}
                    >
                        Cancel
                    </Button>
                    {validatedGstins.length > 0 && (
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save to Account"
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
