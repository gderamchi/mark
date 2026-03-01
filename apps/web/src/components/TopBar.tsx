import type { Session } from "@supabase/supabase-js";

type TopBarProps = {
  session: Session | null;
  userEmail: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
};

export function TopBar({ session, userEmail, onSignIn, onSignOut }: TopBarProps) {
  return (
    <header className="topbar card" role="banner">
      <div className="brand-block">
        <p className="eyebrow">Mark Agent</p>
        <h1>Voice Assistant</h1>
      </div>

      {session ? (
        <div className="topbar-actions account-block">
          <p className="account-email" title={userEmail ?? "Authenticated user"}>
            {userEmail ?? "Signed in"}
          </p>
          <button className="btn btn-quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-compact" onClick={onSignIn}>
          Sign In With Google
        </button>
      )}
    </header>
  );
}
