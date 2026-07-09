// Prototype surface (mock-data, unauthenticated) — see docs/surface-architecture.md.
import CoachBottomNav from "@/components/admin-mobile/CoachBottomNav";

export default function AdminMobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex justify-center">
      <div className="relative w-full max-w-[430px] min-h-screen bg-zinc-950 flex flex-col">
        <main className="flex-1 overflow-y-auto pb-nav-safe">
          {children}
        </main>
        <CoachBottomNav />
      </div>
    </div>
  );
}
