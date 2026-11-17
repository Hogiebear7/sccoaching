import { ParqForm } from "./ParqForm";

export const dynamic = "force-dynamic";

export default function ParqPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold">Before your first session</p>
        <h1 className="text-headline text-[40px]">Quick health check</h1>
      </div>
      <ParqForm />
    </div>
  );
}
