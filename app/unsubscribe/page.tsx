import { UnsubscribeForm } from "./UnsubscribeForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Unsubscribe | S&C Performance Coaching" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-16">
      <h1 className="text-headline text-3xl">Unsubscribe</h1>
      <UnsubscribeForm token={typeof t === "string" ? t : ""} />
    </main>
  );
}
