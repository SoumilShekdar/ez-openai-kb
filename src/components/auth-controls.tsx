"use client";

import Link from "next/link";
import { useAuth, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const linkClassName =
  "rounded-lg px-2 py-1 text-xs font-semibold transition";

function SignedOutLinks() {
  return (
    <>
      <Link
        href="/sign-in"
        className={`${linkClassName} text-accent-teal hover:bg-card-bg`}
      >
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className={`${linkClassName} text-slate-400 hover:bg-card-bg hover:text-foreground`}
      >
        Sign up
      </Link>
    </>
  );
}

export function AuthControls() {
  const { isSignedIn, isLoaded } = useAuth();

  // Keep visible controls while Clerk boots (or if JS fails to load).
  if (!isLoaded) {
    return (
      <div className="flex items-center gap-1">
        <SignedOutLinks />
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <UserButton
        appearance={{
          elements: {
            avatarBox: "h-7 w-7",
          },
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <SignInButton mode="modal">
        <button
          type="button"
          className={`${linkClassName} text-accent-teal hover:bg-card-bg`}
        >
          Sign in
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button
          type="button"
          className={`${linkClassName} text-slate-400 hover:bg-card-bg hover:text-foreground`}
        >
          Sign up
        </button>
      </SignUpButton>
    </div>
  );
}
