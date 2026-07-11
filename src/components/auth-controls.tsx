"use client";

import { useAuth, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export function AuthControls() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return <div className="h-7 w-12" />;
  }

  return (
    <div className="flex items-center gap-1">
      {!isSignedIn ? (
        <>
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-accent-teal hover:bg-card-bg transition"
            >
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-card-bg hover:text-foreground transition"
            >
              Sign up
            </button>
          </SignUpButton>
        </>
      ) : (
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-7 w-7",
            },
          }}
        />
      )}
    </div>
  );
}
