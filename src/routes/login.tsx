import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useShake } from "@/hooks/use-feedback";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { AuthField, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { fetchSignupOpen, redirectIfAuthenticated, safeRedirectPath } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: async ({ search }) => {
    await redirectIfAuthenticated(search.redirect);
  },
  component: LoginPage,
});

type Mode = "login" | "signup";

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectParam } = Route.useSearch();
  const { session, isLoading: sessionLoading } = useSession();
  const destination = safeRedirectPath(redirectParam);

  // Sessão pode aparecer depois da hidratação (token em localStorage).
  useEffect(() => {
    if (!sessionLoading && session) {
      navigate({ to: destination });
    }
  }, [session, sessionLoading, navigate, destination]);

  // Signup aberto apenas enquanto não existe admin (has_any_admin() === false).
  const { data: signupOpen = false, isLoading: signupCheckLoading } = useQuery({
    queryKey: ["auth", "signup-open"],
    queryFn: fetchSignupOpen,
    staleTime: 60 * 1000,
  });

  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const mode: Mode = signupOpen ? (modeOverride ?? "signup") : "login";
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // falha do servidor (senha errada, conta existente…): o formulário balança junto do aviso
  const [authFailure, setAuthFailure] = useState(0);
  const formShake = useShake(authFailure);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextEmailError = validarEmail(email);
    setEmailError(nextEmailError);

    if (nextEmailError) {
      emailInputRef.current?.focus();
      return;
    }

    if (!recoveryMode) {
      const nextPasswordError = validarSenha(password);
      setPasswordError(nextPasswordError);
      if (nextPasswordError) {
        passwordInputRef.current?.focus();
        return;
      }
    }

    setSubmitting(true);
    try {
      if (recoveryMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/nova-senha`,
        });
        if (error) {
          setAuthFailure((n) => n + 1);
          toast.error("Não foi possível enviar o link", { description: error.message });
          return;
        }
        setRecoverySent(true);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
          },
        });
        if (error) {
          setAuthFailure((n) => n + 1);
          toast.error("Não foi possível criar a conta", { description: error.message });
          return;
        }
        if (data.session) {
          toast.success("Conta criada", { description: "Bem-vindo à Automação de Redes Sociais." });
          navigate({ to: destination });
          return;
        }
        toast.success("Conta criada", {
          description: "Abra o link que enviamos para o seu e-mail e depois entre aqui.",
        });
        setModeOverride("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setAuthFailure((n) => n + 1);
          toast.error("Não foi possível entrar", {
            description: /not confirmed/i.test(error.message)
              ? "Seu e-mail ainda não foi confirmado. Abra o link que enviamos para ele e tente de novo."
              : "Confira o e-mail e a senha. Se esqueceu a senha, clique em “Esqueci minha senha”.",
          });
          return;
        }
        navigate({ to: destination });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const eyebrow = recoveryMode ? "Recuperar acesso" : mode === "signup" ? "Criar conta" : "Entrar";
  const title = recoveryMode
    ? "Recupere sua senha."
    : mode === "signup"
      ? "Crie a conta de administrador."
      : "Bem-vindo de volta.";
  const lead = recoveryMode
    ? "Enviaremos um link para criar uma nova senha."
    : mode === "signup"
      ? "Quem cria a primeira conta vira administrador."
      : "Crie, revise e publique na voz da sua marca.";

  return (
    <AuthShell eyebrow={eyebrow} title={title} lead={lead} trocaKey={eyebrow}>
      {/* O par de abas só existe enquanto o cadastro está aberto — depois do
          primeiro admin, ele fecha e a única porta é entrar. */}
      {signupOpen && !recoveryMode ? (
        <div
          className="lsf-seg"
          role="tablist"
          aria-label="Escolher acesso"
          data-mode={mode === "signup" ? "register" : "login"}
        >
          <span className="lsf-seg-thumb" aria-hidden="true" />
          {(
            [
              { valor: "login", rotulo: "Entrar" },
              { valor: "signup", rotulo: "Criar conta" },
            ] as const
          ).map((aba) => (
            <button
              key={aba.valor}
              type="button"
              role="tab"
              aria-selected={mode === aba.valor}
              onClick={() => setModeOverride(aba.valor)}
            >
              {aba.rotulo}
            </button>
          ))}
        </div>
      ) : null}

      {recoveryMode && recoverySent ? (
        <div role="status" aria-live="polite">
          <p className="lsf-note" style={{ margin: "0 0 24px" }}>
            Se houver uma conta para{" "}
            <strong className="font-medium text-[var(--via-text-primary)]">{email.trim()}</strong>,
            ela receberá um link para redefinir a senha.
          </p>
          <button
            type="button"
            className="lsf-btn"
            onClick={() => {
              setRecoveryMode(false);
              setRecoverySent(false);
              setEmailError("");
            }}
          >
            Voltar ao login
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className={cn(formShake)}
          aria-label={
            recoveryMode
              ? "Recuperar senha"
              : mode === "signup"
                ? "Criar conta de administrador"
                : "Entrar"
          }
        >
          <AuthField
            id="email"
            rotulo="E-mail"
            erro={emailError}
            icone={<Mail className="size-[18px]" aria-hidden="true" />}
          >
            <Input
              ref={emailInputRef}
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="voce@empresa.com"
              value={email}
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);
                if (emailError && !validarEmail(value)) setEmailError("");
              }}
              onBlur={() => setEmailError(validarEmail(email))}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              required
            />
          </AuthField>

          {!recoveryMode ? (
            <AuthField
              id="password"
              rotulo="Senha"
              erro={passwordError}
              dica={mode === "signup" ? "Mínimo de 6 caracteres" : undefined}
              icone={<Lock className="size-[18px]" aria-hidden="true" />}
            >
              <Input
                ref={passwordInputRef}
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={mode === "signup" ? "Crie uma senha" : "Sua senha"}
                style={{ paddingRight: 52 }}
                value={password}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                  if (passwordError && !validarSenha(value)) setPasswordError("");
                }}
                onBlur={() => setPasswordError(validarSenha(password))}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "password-error" : undefined}
                minLength={6}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lsf-eye h-9 w-9 text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)] active:scale-100"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </AuthField>
          ) : null}

          <button
            type="submit"
            className="lsf-btn mt-2"
            disabled={submitting || signupCheckLoading}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {submitting
              ? "Aguarde…"
              : recoveryMode
                ? "Enviar link"
                : mode === "signup"
                  ? "Criar conta de administrador"
                  : "Entrar"}
            {!submitting ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
          </button>

          {recoveryMode ? (
            <button
              type="button"
              className="lsf-link"
              onClick={() => {
                setRecoveryMode(false);
                setEmailError("");
              }}
            >
              Voltar ao login
            </button>
          ) : (
            <button
              type="button"
              className="lsf-link"
              onClick={() => {
                setModeOverride("login");
                setRecoveryMode(true);
                setRecoverySent(false);
                setEmailError("");
                setPasswordError("");
              }}
            >
              Esqueci minha senha
            </button>
          )}
        </form>
      )}

      {!recoveryMode ? (
        <p className="lsf-note" style={{ marginTop: 32 }}>
          {signupOpen
            ? "Depois do primeiro cadastro, novos usuários só entram por convite de um administrador."
            : "Ainda não tem acesso? Peça um convite ao administrador da sua conta."}
        </p>
      ) : null}
    </AuthShell>
  );
}

function validarEmail(value: string) {
  const email = value.trim();
  if (!email) return "Digite seu e-mail.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Digite um e-mail válido.";
  return "";
}

function validarSenha(value: string) {
  if (!value) return "Digite sua senha.";
  if (value.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
  return "";
}
