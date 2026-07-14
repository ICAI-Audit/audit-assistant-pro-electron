import { useState, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { auth as sqliteAuth } from '@/integrations/sqlite/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Building2, Loader2, AlertCircle, CheckCircle2, ArrowLeft, Trash2 } from 'lucide-react';
import { z } from 'zod';

// Storage keys for Remember Me functionality
const REMEMBER_ME_EMAIL_KEY = 'icai_vera_remember_email';
const REMEMBER_ME_FLAG_KEY = 'icai_vera_remember_me';

// Helper functions for secure storage
const saveRememberedEmail = (email: string) => {
  try {
    localStorage.setItem(REMEMBER_ME_EMAIL_KEY, email);
    localStorage.setItem(REMEMBER_ME_FLAG_KEY, 'true');
  } catch (err) {
    console.error('Failed to save remembered email:', err);
  }
};

const getRememberedEmail = (): string | null => {
  try {
    const isRemembered = localStorage.getItem(REMEMBER_ME_FLAG_KEY) === 'true';
    if (isRemembered) {
      return localStorage.getItem(REMEMBER_ME_EMAIL_KEY);
    }
  } catch (err) {
    console.error('Failed to retrieve remembered email:', err);
  }
  return null;
};

const clearRememberedEmail = () => {
  try {
    localStorage.removeItem(REMEMBER_ME_EMAIL_KEY);
    localStorage.removeItem(REMEMBER_ME_FLAG_KEY);
  } catch (err) {
    console.error('Failed to clear remembered email:', err);
  }
};

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signupSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

const resetPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

const updatePasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('login');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showUpdatePassword, setShowUpdatePassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  // Signup form state
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');

  // Update password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Load remembered email on component mount
  useEffect(() => {
    const rememberedEmail = getRememberedEmail();
    if (rememberedEmail) {
      setLoginEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, []);

  // Check for password reset flow - handle token exchange
  useEffect(() => {
    const handlePasswordReset = async () => {
      const isReset = searchParams.get('reset') === 'true';
      
      if (isReset) {
        // Check if we have hash params (token from email link)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        
        if (accessToken && type === 'recovery') {
          // Password reset handled by SQLite auth
          // Note: Password reset flow may need to be implemented differently for SQLite
          // For now, we'll skip the token exchange
          setError('Password reset via email link not yet supported in SQLite. Please contact administrator.');
          
          if (error) {
            setError('Password reset link has expired or is invalid. Please request a new one.');
            setShowForgotPassword(true);
            return;
          }
          
          // Clear hash from URL
          window.history.replaceState(null, '', window.location.pathname + '?reset=true');
        }
        
        setShowUpdatePassword(true);
      }
    };
    
    handlePasswordReset();
  }, [searchParams]);

  // Redirect if already logged in (but not during password reset)
  if (user && !loading && !showUpdatePassword) {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    try {
      loginSchema.parse({ email: loginEmail, password: loginPassword });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
        return;
      }
    }

    setIsSubmitting(true);
    const { error: signInError } = await signIn(loginEmail, loginPassword);
    setIsSubmitting(false);

    if (signInError) {
      if (signInError.message.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please try again.');
      } else {
        setError(signInError.message);
      }
    } else {
      // Save email if Remember Me is checked
      if (rememberMe) {
        saveRememberedEmail(loginEmail);
      } else {
        clearRememberedEmail();
      }
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    try {
      signupSchema.parse({
        fullName: signupFullName,
        email: signupEmail,
        password: signupPassword,
        confirmPassword: signupConfirmPassword,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
        return;
      }
    }

    setIsSubmitting(true);
    const { error: signUpError } = await signUp(signupEmail, signupPassword, signupFullName);
    setIsSubmitting(false);

    if (signUpError) {
      if (signUpError.message.includes('already registered')) {
        setError('This email is already registered. Please log in instead.');
      } else {
        setError(signUpError.message);
      }
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    try {
      resetPasswordSchema.parse({ email: resetEmail });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
        return;
      }
    }

    setIsSubmitting(true);
    // Password reset via email not yet implemented in SQLite
    const resetError = new Error('Password reset via email not yet supported. Please contact administrator.');
    // const { error: resetError } = await sqliteAuth.resetPasswordForEmail(resetEmail, {
    //   redirectTo: `${window.location.origin}/auth?reset=true`,
    // });
    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
    } else {
      setSuccessMessage('Password reset link sent! Check your email inbox.');
      setResetEmail('');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    try {
      updatePasswordSchema.parse({ password: newPassword, confirmPassword: confirmNewPassword });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
        return;
      }
    }

    setIsSubmitting(true);
    const { error: updateError } = await sqliteAuth.updateUser({
      data: { password: newPassword },
    });
    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccessMessage('Password updated successfully! You can now log in with your new password.');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowUpdatePassword(false);
      // Sign out so user can log in with new password
      await sqliteAuth.signOut();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Building2 className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">AuditPro</h1>
          <p className="text-muted-foreground mt-2">
            Professional audit management for chartered accountants
          </p>
        </div>

        {/* Auth Card */}
        <div className="audit-card">
          {showUpdatePassword ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Update Password</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your new password below.
                </p>
              </div>

              {/* Error Display */}
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Success Display */}
              {successMessage && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-600">{successMessage}</p>
                </div>
              )}

              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </form>
            </div>
          ) : showForgotPassword ? (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setShowForgotPassword(false);
                  setError(null);
                  setSuccessMessage(null);
                }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </button>
              
              <div>
                <h2 className="text-xl font-semibold text-foreground">Reset Password</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

              {/* Error Display */}
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Success Display */}
              {successMessage && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-600">{successMessage}</p>
                </div>
              )}

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@firm.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </form>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setError(null); setSuccessMessage(null); }} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Log In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              {/* Error Display */}
              {error && (
                <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Success Display */}
              {successMessage && (
                <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-600">{successMessage}</p>
                </div>
              )}

              {/* Login Form */}
              <TabsContent value="login" className="mt-6">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="you@firm.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(true);
                          setError(null);
                          setSuccessMessage(null);
                        }}
                        className="text-sm text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>

                  {/* Remember Me Checkbox */}
                  <div className="flex items-center space-x-2 py-2">
                    <Checkbox
                      id="remember-me"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                    />
                    <Label htmlFor="remember-me" className="font-normal cursor-pointer flex-1">
                      Remember this email
                    </Label>
                    {rememberMe && loginEmail && (
                      <button
                        type="button"
                        onClick={() => {
                          clearRememberedEmail();
                          setRememberMe(false);
                          setLoginEmail('');
                        }}
                        className="p-1 hover:bg-destructive/10 rounded transition-colors"
                        title="Clear remembered email"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Signup Form */}
              <TabsContent value="signup" className="mt-6">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="CA Your Name"
                      value={signupFullName}
                      onChange={(e) => setSignupFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@firm.com"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm Password</Label>
                    <Input
                      id="signup-confirm"
                      type="password"
                      placeholder="••••••••"
                      value={signupConfirmPassword}
                      onChange={(e) => setSignupConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          By signing up, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
