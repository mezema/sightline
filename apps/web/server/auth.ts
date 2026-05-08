import { devOwnerUserId } from "./fake-workflow";

export type RequestOwner = {
  id: string;
  clerkUserId: string;
  email: string;
};

export async function getRequestOwner(): Promise<RequestOwner> {
  if (!isClerkConfigured()) {
    return {
      id: devOwnerUserId,
      clerkUserId: "dev-user",
      email: "dev@sightline.local",
    };
  }

  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (!session.userId) throw new Error("Authentication required.");
  const user = await currentUser().catch((error: unknown) => {
    console.warn("Could not load Clerk current user; falling back to session owner.", error instanceof Error ? error.message : String(error));
    return null;
  });
  return {
    id: user?.id ?? session.userId,
    clerkUserId: session.userId,
    email: user?.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress ?? `${session.userId}@sightline.local`,
  };
}

export function isClerkConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
