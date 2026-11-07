import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { AuthField, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/nova-senha")({ component: NovaSenhaPage });

type LinkState = "checking" | "ready" | "invalid";

function NovaSenhaPage() {
  const navigate = useNavigate();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    let recoveryEventReceived = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        recoveryEventReceived = true;
        setLinkState("ready");
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(window.location.search);
      const isRecoveryLink =
        hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
      setLinkState(data.session && (isRecoveryLink || recoveryEventReceived) ? "ready" : "invalid");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextPasswordError = validarSenha(password);
    const nextConfirmationError = !confirmation
      ? "Confirme sua nova senha."
      : confirmation !== password
        ? "As senhas não coincidem."
        : "";
    setPasswordError(nextPasswordError);
    setConfirmationError(nextConfirmationError);

    if (nextPasswordError || nextConfirmationError) {
      if (nextPasswordError) passwordInputRef.current?.focus();
      else confirmationInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("Não foi possível atualizar a senha", { description: error.message });
        return;
      }

      const { error: signOutError } = await supabase.auth.signOut();
      toast.success("Senha atualizada", {
        description: "Entre com sua nova senha.",
      });
      await navigate({ to: signOutError ? "/" : "/login", replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const invalido = linkState === "invalid";

  return (
    <AuthShell
      eyebrow="Recuperar acesso"
      title={invalido ? "Este link expirou." : "Defina sua nova senha."}
      lead={
        invalido
          ? "Ele já foi usado ou passou do prazo. No login, clique em “Esqueci minha senha” para receber outro."
          : "Use pelo menos 6 caracteres e confirme a senha para salvar."
      }
      trocaKey={linkState}
    >
      {linkState === "checking" ? (
        <p className="lsf-note" role="status">
          Verificando o link…
        </p>
      ) : invalido ? (
        <Link to="/login" className="lsf-btn">
          Voltar para o login
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <form onSubmit={handleSubmit} noValidate aria-label="Definir nova senha">
          <PasswordField
            id="new-password"
            label="Nova senha"
            dica="Mínimo de 6 caracteres"
            placeholder="Crie uma senha"
            value={password}
            visible={showPassword}
            error={passwordError}
            inputRef={passwordInputRef}
            autoComplete="new-password"
            onChange={(value) => {
              setPassword(value);
              if (passwordError && !validarSenha(value)) setPasswordError("");
              if (confirmationError && value === confirmation) setConfirmationError("");
            }}
            onBlur={() => setPasswordError(validarSenha(password))}
            onToggleVisibility={() => setShowPassword((visible) => !visible)}
          />
          <PasswordField
            id="confirm-password"
            label="Confirmar nova senha"
            placeholder="Repita a nova senha"
            value={confirmation}
            visible={showConfirmation}
            error={confirmationError}
            inputRef={confirmationInputRef}
            autoComplete="new-password"
            onChange={(value) => {
              setConfirmation(value);
              if (confirmationError && value === password) setConfirmationError("");
            }}
            onBlur={() =>
              setConfirmationError(
                !confirmation
                  ? "Confirme sua nova senha."
                  : confirmation !== password
                    ? "As senhas não coincidem."
                    : "",
              )
            }
            onToggleVisibility={() => setShowConfirmation((visible) => !visible)}
          />

          <button type="submit" className="lsf-btn mt-2" disabled={submitting}>
            {submitting ? "Salvando…" : "Salvar nova senha"}
            {!submitting ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function PasswordField({
  id,
  label,
  dica,
  placeholder,
  value,
  visible,
  error,
  inputRef,
  autoComplete,
  onChange,
  onBlur,
  onToggleVisibility,
}: {
  id: string;
  label: string;
  dica?: string;
  placeholder: string;
  value: string;
  visible: boolean;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  autoComplete: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onToggleVisibility: () => void;
}) {
  const errorId = `${id}-error`;

  return (
    <AuthField
      id={id}
      rotulo={label}
      dica={dica}
      erro={error}
      icone={<Lock className="size-[18px]" aria-hidden="true" />}
    >
      <Input
        ref={inputRef}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ paddingRight: 52 }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        minLength={6}
        required
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lsf-eye h-9 w-9 text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)] active:scale-100"
        aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={onToggleVisibility}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </AuthField>
  );
}

function validarSenha(value: string) {
  if (!value) return "Digite sua nova senha.";
  if (value.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
  return "";
}
